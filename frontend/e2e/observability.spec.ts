import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

async function login(page: Page, account = 'admin') {
  expect((await page.request.post('/api/auth/demo', { data: { account } })).ok()).toBeTruthy()
}

async function createReviewRecords(page: Page, count = 1) {
  const title = `观测验收-${Date.now()}`
  const response = await page.request.post('/api/documents', {
    multipart: {
      title,
      product: title,
      version: 'v1',
      visibility: 'company',
      file: {
        name: `${title}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('海盐晶体仅用于低温形态测定实验，实验样本为编号丙的独立样本。'),
      },
    },
  })
  expect(response.ok()).toBeTruthy()
  const doc = await response.json()
  try {
    const review = await (
      await page.request.post(`/api/documents/${doc.id}/reviews`, { data: {} })
    ).json()
    for (let index = 0; index < count; index++) {
      const result = await page.request.post(`/api/reviews/${review.id}/messages`, {
        data: { question: '检查文档描述及缺失信息。' },
      })
      expect(await result.text()).toContain('event: done')
    }
  } finally {
    await page.request.delete(`/api/documents/${doc.id}`)
  }
  const items = await (await page.request.get('/api/observability/traces?operation=review')).json()
  return items.items[0].id as string
}

test('administrator sees real review traces, pagination, filtering and details on desktop and mobile', async ({
  page,
}) => {
  await login(page)
  const id = await createReviewRecords(page, 21)
  await page.goto('/observability')
  await expect(page.getByRole('heading', { name: '观测记录', exact: true })).toBeVisible()
  await expect(page.getByText('本地观测已开启 · Langfuse 未启用')).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(20)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.pagination')).toContainText('2 /')
  await page.getByRole('textbox', { name: '搜索观测记录' }).fill(id)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('.pagination')).toContainText('1 / 1')
  await expect(page.locator('tbody')).toContainText('仅本地')
  await page.getByRole('button', { name: `查看记录 ${id}` }).click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByRole('heading', { name: '观测记录详情' })).toBeVisible()
  await expect(detail).toContainText('文档分段分析')
  await expect(detail).toContainText('资料检索')
  await expect(detail).toContainText('不保存提示词、问题、回答或文档正文')
  await expect(detail.getByRole('link', { name: '在 Langfuse 打开' })).toHaveCount(0)
  await expect(detail).not.toContainText('海盐晶体')
  await mkdir('../artifacts', { recursive: true })
  await page.screenshot({ path: '../artifacts/desktop-observation-detail.png' })
  await detail.getByRole('button', { name: '关闭弹窗' }).click()
  await page.screenshot({ path: '../artifacts/desktop-observability.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: `查看记录 ${id}` }).click()
  await expect(detail.getByRole('heading', { name: '观测记录详情' })).toBeVisible()
  expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy()
  await page.screenshot({ path: '../artifacts/mobile-observation-detail.png' })
  await detail.getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByRole('textbox', { name: '搜索观测记录' }).fill('definitely-unmatched-trace')
  await expect(page.locator('.table-state')).toContainText('暂无匹配的观测记录')
  await page.getByRole('combobox', { name: '操作筛选' }).click()
  await page.getByRole('option', { name: '文档审查', exact: true }).click()
  await page.screenshot({ path: '../artifacts/mobile-observability.png', fullPage: true })
  await page.getByRole('button', { name: '接入说明' }).click()
  await expect(detail).toContainText('LANGFUSE_SECRET_KEY=<项目 Secret Key>')
})

test('observation list and detail request failures stay recoverable', async ({ page }) => {
  await login(page)
  const id = await createReviewRecords(page)
  await page.route('**/api/observability/traces?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: '观测记录暂不可用，请重试' }),
    }),
  )
  await page.goto('/observability')
  await expect(page.getByRole('alert')).toContainText('观测记录暂不可用')
  await page.unroute('**/api/observability/traces?*')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('tbody tr').first()).toContainText('文档审查')
  await page.getByRole('textbox', { name: '搜索观测记录' }).fill(id)
  await page.route(`**/api/observability/traces/${id}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: '详情暂不可用' }),
    }),
  )
  await page.getByRole('button', { name: `查看记录 ${id}` }).click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByRole('alert')).toContainText('详情暂不可用')
  await page.unroute(`**/api/observability/traces/${id}`)
  await detail.getByRole('button', { name: '重试', exact: true }).click()
  await expect(detail).toContainText('文档分段分析')
})

test('ordinary members have neither observation navigation nor API access', async ({ page }) => {
  await login(page, 'product')
  expect((await page.request.get('/api/observability/traces')).status()).toBe(403)
  await page.goto('/observability')
  await expect(page).toHaveURL(/\/chat$/)
  await expect(
    page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '观测记录' }),
  ).toHaveCount(0)
})

test('failed Langfuse sync shows failure feedback and queues a retry without claiming delivery', async ({
  page,
}) => {
  await login(page)
  const id = await createReviewRecords(page)
  let queued = false
  let reject = true
  await page.route('**/api/observability/config', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ json: { ...(await response.json()), enabled: true, configured: true } })
  })
  await page.route(`**/api/observability/traces/${id}`, async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      json: {
        ...(await response.json()),
        export_status: queued ? 'pending' : 'failed',
        export_attempts: queued ? 0 : 3,
        export_error: queued ? '' : 'Langfuse 返回 HTTP 401，请检查地址和服务端凭证',
      },
    })
  })
  await page.route(`**/api/observability/traces/${id}/retry`, (route) => {
    if (reject) return route.fulfill({ status: 503, json: { detail: '同步队列暂不可用，请重试' } })
    queued = true
    return route.fulfill({ json: { queued: true } })
  })
  await page.goto('/observability')
  await page.getByRole('textbox', { name: '搜索观测记录' }).fill(id)
  await page.getByRole('button', { name: `查看记录 ${id}` }).click()
  const detail = page.getByRole('dialog')
  await expect(detail).toContainText('同步失败 · 已尝试 3 次')
  await detail.getByRole('button', { name: '重新同步', exact: true }).click()
  await expect(detail.getByRole('alert')).toContainText('同步队列暂不可用')
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(1)
  reject = false
  await detail.getByRole('button', { name: '重新同步', exact: true }).click()
  await expect(page.getByText('已加入同步队列，请稍后刷新查看结果', { exact: true })).toBeVisible()
  await expect(detail).toContainText('等待同步 · 已尝试 0 次')
  await expect(detail.getByRole('link', { name: '在 Langfuse 打开' })).toHaveCount(0)
})
