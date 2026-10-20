import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

async function login(page: Page, role = 'admin') {
  await page.goto('/')
  await page.evaluate(async (role) => {
    await fetch('/api/auth/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: role }),
    })
  }, role)
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: '让产品知识，触手可及。' })).toBeVisible()
}

test('settings displays actual keyword retrieval on desktop and mobile', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  await expect(page.getByText('关键词检索 · 无需向量服务')).toBeVisible()
  await expect(page.getByText('本地资料摘录', { exact: true })).toBeVisible()
  await mkdir('../artifacts', { recursive: true })
  await page.screenshot({ path: '../artifacts/desktop-settings.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('关键词检索 · 无需向量服务')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: '../artifacts/mobile-settings.png', fullPage: true })
})

test('desktop: login, streamed answer, citations, persisted conversation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: '以演示管理员身份进入' }).click()
  await expect(page.getByRole('heading', { name: '让产品知识，触手可及。' })).toBeVisible()
  await mkdir('../artifacts', { recursive: true })
  await page.screenshot({ path: '../artifacts/desktop-chat.png', fullPage: true })
  await page.getByRole('textbox', { name: '输入产品问题' }).fill('知识库支持上传哪些文件？')
  await page.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
  await expect(page.locator('.messages')).toContainText('PDF')
  await expect(page.getByRole('button', { name: '停止生成' })).toBeHidden()
  await expect(page.locator('.message-assistant .message-heading')).toContainText('基于知识库')
  await page.screenshot({ path: '../artifacts/desktop-answer.png', fullPage: true })
  await page.locator('.source-chip').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.preview-body')).toContainText('虚构')
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await page.reload()
  await expect(page.locator('.message-assistant')).toContainText('PDF')
  expect(errors).toEqual([])
})

test('document upload validates form, supports preview, filters and confirmed delete', async ({
  page,
}) => {
  await login(page)
  await page.getByRole('link', { name: '知识文档', exact: true }).click()
  await page.getByRole('button', { name: '上传文档', exact: true }).click()
  await page.getByRole('button', { name: '上传并建立索引' }).click()
  await expect(page.getByRole('dialog')).toContainText('请填写标题、产品、版本并选择文件')
  const title = `端到端验收资料-${Date.now()}`
  await page.locator('#document-file').setInputFiles({
    name: `${title}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 验收文档\n\n玄武产品的数据备份周期为每四小时一次。仅用于端到端测试。'),
  })
  await page.getByRole('textbox', { name: '所属产品' }).fill('玄武产品')
  await page.getByRole('textbox', { name: '产品版本' }).fill('v-test')
  await page.getByRole('button', { name: '上传并建立索引' }).click()
  await expect(page.getByText('文档已入库，可以开始提问')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('textbox', { name: '搜索文档' }).fill(title)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText(title)
  await page.screenshot({ path: '../artifacts/desktop-documents.png', fullPage: true })
  await page.getByRole('button', { name: `更多操作 ${title}`, exact: true }).click()
  await page.getByRole('menuitem', { name: '删除文档', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('永久删除')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('tbody')).toContainText(title)
  await page.getByRole('button', { name: `更多操作 ${title}`, exact: true }).click()
  await page.getByRole('menuitem', { name: '删除文档', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByText('文档及其索引已删除')).toBeVisible()
  await expect(page.locator('tbody')).toContainText('没有匹配的文档')
})

test('failed upload stays in its dialog and shows one error toast', async ({ page }) => {
  await login(page)
  await page.goto('/documents')
  await page.getByRole('button', { name: '上传文档', exact: true }).click()
  await page.locator('#document-file').setInputFiles({
    name: 'test.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('测试上传文件，内容足够长以通过解析校验。'),
  })
  await page.getByRole('textbox', { name: '所属产品' }).fill('测试产品')
  await page.getByRole('textbox', { name: '产品版本' }).fill('v1')
  await page.route('**/api/documents', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ detail: '模型服务暂不可用，请检查连接后重试' }),
        })
      : route.continue(),
  )
  await page.getByRole('button', { name: '上传并建立索引' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('模型服务暂不可用')
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(1)
})

test('mobile: responsive chat, navigation drawer and readable document table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'support')
  await expect(page.getByRole('button', { name: '打开导航菜单' })).toBeVisible()
  await page.screenshot({ path: '../artifacts/mobile-chat.png', fullPage: true })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()
  await page.getByRole('button', { name: '打开导航菜单' }).click()
  await page.getByRole('dialog').getByRole('link', { name: '知识文档', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.table-scroll')).toBeVisible()
  await expect(page.locator('tbody')).not.toContainText('产品内部发布计划')
  expect(
    await page.locator('.table-scroll').evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBeTruthy()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()
  await page.screenshot({ path: '../artifacts/mobile-documents.png', fullPage: true })
})

test('401 clears identity and returns to login', async ({ page }) => {
  await login(page)
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }))
  await page.getByRole('link', { name: '知识文档', exact: true }).click()
  await expect(page.getByRole('heading', { name: '进入知识工作空间' })).toBeVisible()
  await expect(page.getByText('知识库管理员', { exact: true })).toBeHidden()
})

test('stream interruption is surfaced as incomplete, never as success', async ({ page }) => {
  await login(page)
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: delta\ndata: {"text":"尚未完整生成的回答"}\n\n',
    }),
  )
  await page.getByRole('textbox', { name: '输入产品问题' }).fill('测试断流')
  await page.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('连接提前中断')
  await expect(page.locator('.message-assistant .message-heading')).toContainText('回答未完成')
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0)
})

test('settings: invalid member form stays inline and account can be created', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.getByRole('button', { name: '创建成员', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请填写所有账号信息')
  await page.getByRole('textbox', { name: '成员姓名' }).fill('验收同事')
  await page.getByRole('textbox', { name: '登录账号' }).fill(`e2e-${Date.now()}`)
  await page.getByRole('textbox', { name: '所属部门' }).fill('测试部')
  await page.getByLabel('初始密码').fill('e2e-test-password-123')
  await page.getByRole('button', { name: '创建成员', exact: true }).click()
  await expect(page.getByText('成员账号已创建')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('stopping generation saves an incomplete answer that survives refresh', async ({ page }) => {
  await login(page)
  await page.getByRole('textbox', { name: '输入产品问题' }).fill('知识库支持上传哪些文件？')
  await page.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(page.locator('.message-assistant .markdown')).toBeVisible()
  await page.getByRole('button', { name: '停止生成' }).click()
  await expect(page.locator('.message-assistant .message-heading')).toContainText('回答未完成')
  const id = page.url().split('/').at(-1)
  await expect
    .poll(async () =>
      page.evaluate(async (id) => {
        const data = await (await fetch(`/api/conversations/${id}`)).json()
        return data.messages.at(-1)?.status
      }, id),
    )
    .toBe('interrupted')
  await page.reload()
  await expect(page.locator('.message-assistant .message-heading')).toContainText('回答未完成')
})

test('document pagination and product filter reset the page', async ({ page }) => {
  await login(page)
  // Use the browser's authenticated context for setup and cleanup of test-only records.
  const prefix = `分页验收-${Date.now()}`
  const ids: string[] = []
  try {
    for (let index = 0; index < 7; index++) {
      const response = await page.request.post('/api/documents', {
        multipart: {
          title: `${prefix}-${index}`,
          product: prefix,
          version: 'v-test',
          visibility: 'company',
          file: {
            name: `${index}.md`,
            mimeType: 'text/markdown',
            buffer: Buffer.from(`分页测试资料，第 ${index} 份。仅用于验证表格分页和筛选页码重置。`),
          },
        },
      })
      expect(response.ok()).toBeTruthy()
      ids.push((await response.json()).id)
    }
    await page.goto('/documents')
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page.locator('.pagination')).toContainText('2 / 2')
    await page.getByRole('combobox', { name: '产品筛选' }).click()
    await page.getByRole('option', { name: prefix, exact: true }).click()
    await expect(page.locator('.pagination')).toContainText('1 / 1')
    await expect(page.locator('tbody tr')).toHaveCount(7)
  } finally {
    for (const id of ids) await page.request.delete(`/api/documents/${id}`)
  }
})

test('SSE decoder handles UTF-8 and CRLF split at every byte', async ({ page }) => {
  await login(page)
  const result = await page.evaluate(async () => {
    // Vite serves this TypeScript module to the browser in the development test environment.
    const modulePath = '/src/lib/api.ts'
    const { streamChat } = await import(/* @vite-ignore */ modulePath)
    const payload = new TextEncoder().encode(
      'event: delta\r\ndata: {"text":"中文💡"}\r\n\r\nevent: done\r\ndata: {"message_id":"saved"}\r\n\r\n',
    )
    const originalFetch = window.fetch
    const result: [string, Record<string, unknown>][] = []
    window.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of payload) controller.enqueue(Uint8Array.of(byte))
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    try {
      await streamChat(
        {},
        new AbortController().signal,
        (type: string, data: Record<string, unknown>) => result.push([type, data]),
      )
    } finally {
      window.fetch = originalFetch
    }
    return result
  })
  expect(result).toEqual([
    ['delta', { text: '中文💡' }],
    ['done', { message_id: 'saved' }],
  ])
})

test('citation preview highlights and scrolls to its chunk while preserving Markdown', async ({
  page,
}) => {
  await login(page)
  const title = `引用定位验收-${Date.now()}`
  const introduction = Array.from(
    { length: 45 },
    (_, i) =>
      `## 背景 ${i + 1}\n\n这里介绍日常操作流程和资料归档方式。${'常规资料仅用于上下文展示。'.repeat(8)}`,
  ).join('\n\n')
  const target = [
    '## 星槎锚点操作指南',
    '😀 星槎锚点支持**批量导入**，操作前请阅读[使用说明](https://example.com)。',
    '| 功能 | 说明 |\n| --- | --- |\n| 星槎锚点 | 校验 &amp; 重试 |',
    '```txt\n星槎锚点的失败记录可以重试\n```',
  ].join('\n\n')
  const uploaded = await page.request.post('/api/documents', {
    multipart: {
      title,
      product: title,
      version: 'v-test',
      visibility: 'company',
      file: {
        name: `${title}.md`,
        mimeType: 'text/markdown',
        buffer: Buffer.from(`${introduction}\n\n${target}`),
      },
    },
  })
  expect(uploaded.ok()).toBeTruthy()
  const docId = (await uploaded.json()).id
  try {
    const answer = await page.request.post('/api/chat', {
      data: { question: '星槎锚点如何使用？', product: title },
    })
    expect(answer.ok()).toBeTruthy()
    const stream = await answer.text()
    const conversation = JSON.parse(/event: conversation\ndata: (.+)/.exec(stream)![1])
    const sources = JSON.parse(/event: sources\ndata: (.+)/.exec(stream)![1]).items
    const source = sources.find((item: { text: string }) => item.text.includes('星槎锚点'))
    expect(source.section).toBeGreaterThan(2)
    await page.goto(`/chat/${conversation.id}`)
    const chip = page.getByRole('button', {
      name: new RegExp(`${title}.*片段 ${source.section}$`),
    })
    await chip.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('.citation-highlight').first()).toBeVisible()
    await expect(dialog.locator('.citation-notice')).toContainText(
      `已高亮引用片段 ${source.section}`,
    )
    await expect(dialog.locator('.markdown')).toContainText('背景 1')
    await expect(dialog.locator('strong')).toContainText('批量导入')
    await expect(dialog.locator('table')).toContainText('校验 & 重试')
    await expect(dialog.locator('pre code')).toContainText('失败记录可以重试')
    await expect(dialog.getByRole('link', { name: '使用说明' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
    expect(await dialog.locator('.citation-highlight').allTextContents()).toContain('批量导入')
    await expect
      .poll(() => dialog.locator('.preview-body').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0)
    const firstMark = dialog.locator('.citation-highlight').first()
    const markBox = await firstMark.boundingBox()
    const bodyBox = await dialog.locator('.preview-body').boundingBox()
    expect(markBox!.y).toBeGreaterThanOrEqual(bodyBox!.y)
    expect(markBox!.y).toBeLessThan(bodyBox!.y + bodyBox!.height)
    await mkdir('../artifacts', { recursive: true })
    await page.screenshot({ path: '../artifacts/desktop-citation-highlight.png' })
    await page.getByRole('button', { name: '关闭弹窗' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await chip.click()
    await expect(dialog.locator('.citation-highlight').first()).toBeVisible()
    await expect
      .poll(() => dialog.locator('.preview-body').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: '../artifacts/mobile-citation-highlight.png' })
  } finally {
    await page.request.delete(`/api/documents/${docId}`)
  }
})

test('citation preview rejects a document changed since the answer was generated', async ({
  page,
}) => {
  await login(page)
  const title = `过期引用验收-${Date.now()}`
  const upload = async (method: 'post' | 'put', path: string, content: string) =>
    page.request[method](path, {
      multipart: {
        title,
        product: title,
        version: 'v-test',
        visibility: 'company',
        file: { name: `${title}.md`, mimeType: 'text/markdown', buffer: Buffer.from(content) },
      },
    })
  const uploaded = await upload(
    'post',
    '/api/documents',
    '松风产品支持每四小时备份数据，这是原始的操作说明。',
  )
  expect(uploaded.ok()).toBeTruthy()
  const docId = (await uploaded.json()).id
  try {
    const answer = await page.request.post('/api/chat', {
      data: { question: '松风产品如何备份？', product: title },
    })
    const conversation = JSON.parse(/event: conversation\ndata: (.+)/.exec(await answer.text())![1])
    await page.goto(`/chat/${conversation.id}`)
    await expect(page.locator('.source-chip')).toBeVisible()
    const updated = await upload(
      'put',
      `/api/documents/${docId}`,
      '松风产品改为每日备份，新版资料应当重新检索。',
    )
    expect(updated.ok()).toBeTruthy()
    await page.locator('.source-chip').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('alert')).toContainText('参考资料已更新')
    await expect(dialog.locator('.citation-highlight')).toHaveCount(0)
    await expect(dialog.locator('.markdown')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/documents/${docId}`)
  }
})
