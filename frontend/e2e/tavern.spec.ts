import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

test('酒单：校验、导入、搜索、编辑、失败反馈与移动端', async ({ page }) => {
  await page.request.post('/api/auth/demo', { data: { account: 'admin' } })
  await page.goto('/tavern')
  await expect(page.getByRole('heading', { name: '酒单与配方' })).toBeVisible()
  await page.getByRole('button', { name: '新增酒款', exact: true }).click()
  await page.getByRole('button', { name: '保存酒款' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请填写酒名')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '导入酒单', exact: true }).click()
  const title = `青柠验收-${Date.now()}`
  const drink = {
    name: title,
    description: '虚构浏览器验收酒款',
    category: '鸡尾酒',
    price_fen: 3800,
    alcohol_percent: 0,
    sweetness: 1,
    ingredients: ['青柠', '苏打水'],
    allergens: [],
    tags: ['清爽'],
    private_recipe: '内部配方测试',
    available: true,
  }
  await page.getByRole('dialog').getByRole('button', { name: '导入酒单' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请选择')
  await page.getByLabel('酒单文件').setInputFiles({
    name: 'menu.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ drinks: [drink] })),
  })
  await page.getByRole('dialog').getByRole('button', { name: '导入酒单' }).click()
  await expect(page.getByText('已导入 1 款酒', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('textbox', { name: '搜索酒款' }).fill(title)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText(title)
  await mkdir('../artifacts', { recursive: true })
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 })
  await page.screenshot({ path: '../artifacts/desktop-tavern.png', fullPage: true })
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.getByLabel('内部配方')).toHaveValue('内部配方测试')
  await page.getByLabel('售价（元）').fill('42.50')
  await page.getByRole('button', { name: '保存酒款' }).click()
  await expect(page.locator('tbody')).toContainText('¥42.50')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.route('**/api/admin/tavern/drinks/*', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: '服务暂不可用，请重试' }),
        })
      : route.continue(),
  )
  await page.getByRole('button', { name: '保存酒款' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('服务暂不可用')
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(1)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.table-scroll')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(
    await page.locator('.table-scroll').evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 })
  await page.screenshot({ path: '../artifacts/mobile-tavern.png', fullPage: true })
})

test('普通成员不能进入配方管理', async ({ page }) => {
  await page.request.post('/api/auth/demo', { data: { account: 'support' } })
  await page.goto('/tavern')
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByRole('link', { name: '酒单与配方' })).toHaveCount(0)
  expect((await page.request.get('/api/admin/tavern/drinks')).status()).toBe(403)
})
