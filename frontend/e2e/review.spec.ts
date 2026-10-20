import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

async function setup(page: Page) {
  const login = await page.request.post('/api/auth/demo', { data: { account: 'admin' } })
  expect(login.ok()).toBeTruthy()
  const title = `文档审查验收-${Date.now()}`
  const response = await page.request.post('/api/documents', {
    multipart: {
      title,
      product: title,
      version: 'v1',
      visibility: 'company',
      file: {
        name: `${title}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(
          '玄隼晶体在低温衍射实验中呈六方晶格，晶胞测定应采用双峰拟合法。该结论仅适用于实验样本甲。',
        ),
      },
    },
  })
  expect(response.ok()).toBeTruthy()
  const doc = await response.json()
  await page.goto('/documents')
  await page.getByRole('textbox', { name: '搜索文档' }).fill(title)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  return { title, doc }
}

for (const width of [1440, 390]) {
  test(`document action buttons contain their content without overlap at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const { title, doc } = await setup(page)
    try {
      for (const account of ['admin', 'product']) {
        const login = await page.request.post('/api/auth/demo', { data: { account } })
        expect(login.ok()).toBeTruthy()
        await page.reload()
        await page.getByRole('textbox', { name: '搜索文档' }).fill(title)
        const review = page.getByRole('button', { name: `审查 ${title}`, exact: true })
        await review.scrollIntoViewIfNeeded()
        const actions = review.locator('..')
        const layout = await actions.evaluate((element) => {
          const buttons = Array.from(element.querySelectorAll('button'))
          return buttons.map((button, index) => {
            const box = button.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(button)
            const content = range.getBoundingClientRect()
            const next = buttons[index + 1]?.getBoundingClientRect()
            return {
              contentInside:
                content.left >= box.left &&
                content.right <= box.right &&
                content.top >= box.top &&
                content.bottom <= box.bottom,
              noOverlap: !next || box.right <= next.left,
            }
          })
        })
        expect(layout.length).toBe(account === 'admin' ? 3 : 2)
        for (const button of layout) {
          expect(button.contentInside).toBeTruthy()
          expect(button.noOverlap).toBeTruthy()
        }
        await mkdir('../artifacts', { recursive: true })
        await page.screenshot({ path: `../artifacts/document-actions-${account}-${width}.png` })
        await review.click()
        const workspace = page.locator('.review-dialog')
        await expect(workspace.getByText('审查完成', { exact: false })).toBeVisible()
        await expect(workspace.locator('.review-suggestion')).toHaveCount(1)
        await expect(workspace.locator('.review-suggestion')).toContainText('处理建议')
        await expect(workspace.locator('.review-suggestion pre')).toContainText('一级标题')
        if (account === 'admin') {
          await page.screenshot({ path: `../artifacts/document-review-suggestions-${width}.png` })
        }
        await workspace.getByRole('button', { name: '关闭弹窗' }).click()
      }
    } finally {
      await page.request.post('/api/auth/demo', { data: { account: 'admin' } })
      await page.request.delete(`/api/documents/${doc.id}`)
    }
  })
}

test('review conversation adopts edits, resumes a saved draft, compares and confirms publishing', async ({
  page,
}) => {
  const { title, doc } = await setup(page)
  try {
    await page.getByRole('button', { name: `审查 ${title}`, exact: true }).click()
    const workspace = page.locator('.review-dialog')
    await expect(workspace.getByText('审查完成', { exact: false })).toBeVisible()
    await expect(workspace.getByText('未找到相关资料，本轮仅针对当前文档审查。')).toBeVisible()
    await expect(workspace.locator('.review-suggestion pre')).toContainText('保留原有正文内容')
    await workspace.getByRole('button', { name: '发送审查重点' }).click()
    await expect(workspace.getByRole('alert')).toContainText('请填写 1–4000 字')
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
    await workspace
      .getByRole('textbox', { name: '审查追问' })
      .fill('请重点检查标题与操作说明是否清楚。')
    await workspace.getByRole('button', { name: '发送审查重点' }).click()
    await expect(workspace.locator('.review-turn')).toHaveCount(2)
    await expect(workspace.locator('.review-turn').last()).toContainText('审查完成')
    await workspace.getByRole('button', { name: '采用建议', exact: true }).first().click()
    await expect(page.getByText('已采用建议并保存为草稿', { exact: true })).toBeVisible()
    await expect(workspace.getByRole('textbox', { name: '草稿正文', exact: true })).toHaveValue(
      new RegExp(`^# ${title}`),
    )
    const edited = `# ${title}\n\n玄隼晶体在低温衍射实验中呈六方晶格，晶胞测定应采用双峰拟合法。\n\n该结论仅适用于实验样本甲，测定前需核验样本编号。`
    await workspace.getByRole('textbox', { name: '草稿正文', exact: true }).fill(edited)
    await workspace.getByRole('button', { name: '保存为草稿', exact: true }).click()
    await expect(page.getByText('草稿已保存，尚未发布', { exact: true })).toBeVisible()
    expect((await (await page.request.get(`/api/documents/${doc.id}`)).json()).version).toBe('v1')
    await mkdir('../artifacts', { recursive: true })
    await page.screenshot({ path: '../artifacts/desktop-document-review.png' })
    await workspace.getByRole('button', { name: '关闭弹窗' }).click()
    await page.getByRole('button', { name: `更多操作 ${title}`, exact: true }).click()
    await page.getByRole('menuitem', { name: '版本与草稿' }).click()
    await expect(workspace.getByRole('textbox', { name: '草稿正文', exact: true })).toHaveValue(
      edited,
    )
    await workspace.getByRole('button', { name: '版本对比与发布' }).click()
    const comparison = page.locator('.version-compare-dialog')
    await expect(comparison.getByRole('heading', { name: '文档版本对比' })).toBeVisible()
    await expect(comparison.locator('.version-diff')).toContainText('测定前需核验样本编号')
    await page.screenshot({ path: '../artifacts/desktop-document-diff.png' })
    await comparison.getByRole('button', { name: '确认发布', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('旧版本会保留')
    expect((await (await page.request.get(`/api/documents/${doc.id}`)).json()).version).toBe('v1')
    await page.getByRole('button', { name: '确认发布新版本', exact: true }).click()
    await expect(page.getByText('版本 v2 已发布，知识库索引已更新', { exact: true })).toBeVisible()
    const current = await (await page.request.get(`/api/documents/${doc.id}`)).json()
    expect(current.version).toBe('v2')
    expect(current.content).toBe(edited)
    const history = await (await page.request.get(`/api/documents/${doc.id}/versions`)).json()
    expect(
      history.filter((version: { status: string }) => version.status === 'published'),
    ).toHaveLength(2)
  } finally {
    await page.request.delete(`/api/documents/${doc.id}`)
  }
})

test('mobile draft editing validates fields, preserves failed saves, and confirms discarding edits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { title, doc } = await setup(page)
  try {
    await page.getByRole('button', { name: `更多操作 ${title}`, exact: true }).click()
    await page.getByRole('menuitem', { name: '版本与草稿' }).click()
    const workspace = page.locator('.review-dialog')
    await workspace.getByRole('button', { name: '从当前版本创建草稿' }).click()
    await expect(workspace.getByRole('textbox', { name: '草稿正文', exact: true })).toBeVisible()
    await workspace.getByRole('textbox', { name: '新版本号' }).fill('')
    await workspace.getByRole('button', { name: '保存为草稿', exact: true }).click()
    await expect(workspace.getByRole('alert')).toContainText('新版本号须为 1–40 字')
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
    await workspace.getByRole('textbox', { name: '新版本号' }).fill('v2')
    const editor = workspace.getByRole('textbox', { name: '草稿正文', exact: true })
    const content = `${await editor.inputValue()}\n\n移动端追加的维护说明。`
    await editor.fill(content)
    await page.route('**/api/documents/*/versions/*', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ detail: '保存暂不可用，请稍后重试' }),
          })
        : route.continue(),
    )
    await workspace.getByRole('button', { name: '保存为草稿', exact: true }).click()
    await expect(workspace.getByRole('alert')).toContainText('保存暂不可用')
    await expect(editor).toHaveValue(content)
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(1)
    await workspace.getByRole('button', { name: '关闭弹窗' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('放弃未保存的修改')
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(editor).toHaveValue(content)
    await page.unroute('**/api/documents/*/versions/*')
    await workspace.getByRole('button', { name: '保存为草稿', exact: true }).click()
    await expect(page.getByText('草稿已保存，尚未发布', { exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0, {
      timeout: 8000,
    })
    await page.screenshot({ path: '../artifacts/mobile-document-review.png' })
    await workspace.getByRole('button', { name: '版本对比与发布' }).click()
    await expect(page.locator('.version-compare-dialog .version-diff')).toContainText('移动端追加')
    await page.screenshot({ path: '../artifacts/mobile-document-diff.png' })
  } finally {
    await page.request.delete(`/api/documents/${doc.id}`)
  }
})

test('review stream without done preserves partial findings and never claims completion', async ({
  page,
}) => {
  const { title, doc } = await setup(page)
  try {
    await page.route('**/api/reviews/*/messages', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: `event: result\ndata: ${JSON.stringify({ id: 'partial', question: '检查当前文档', summary: '已经完成的部分审查内容。', findings: [], sources: [], status: 'streaming', completed_parts: 1, total_parts: 2 })}\n\n`,
      }),
    )
    await page.getByRole('button', { name: `审查 ${title}`, exact: true }).click()
    const workspace = page.locator('.review-dialog')
    await expect(workspace.getByRole('alert')).toContainText('连接提前中断')
    await expect(workspace).toContainText('已经完成的部分审查内容')
    await expect(workspace).toContainText('审查未完成')
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/documents/${doc.id}`)
  }
})
