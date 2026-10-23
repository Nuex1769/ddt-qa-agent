import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

test.use({ deviceScaleFactor: 2 })

test('三种酒馆主界面：手机效果图与 mock 对话、酒单、杯垫交互', async ({ page }) => {
  await mkdir('../artifacts/bar-concepts', { recursive: true })
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: route.request().url().endsWith('/auth/config') ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify({ demo_mode: true }),
    }),
  )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 1020 })
  for (const [index, style] of ['vinyl', 'taproom', 'quiet'].entries()) {
    await page.goto(`/bar-concepts?style=${style}`)
    await expect(page.locator('.bar-phone')).toBeVisible()
    await expect(page.locator('.bc-drink')).toHaveCount(2)
    await expect
      .poll(() =>
        page.locator('.bc-hero img').evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: `../artifacts/bar-concepts/0${index + 1}-${style}.png`,
      fullPage: true,
    })
    await page.getByRole('textbox', { name: '告诉调酒师你的口味' }).fill('微甜的无酒精鸡尾酒')
    await page.getByRole('button', { name: '发送口味需求' }).click()
    await expect(page.locator('.bc-bartender-answer')).toContainText('0.0%')
    await expect(page.locator('.bc-drink')).toHaveCount(1)
    await expect(page.locator('.bc-drink')).toContainText('青柠晚风')
    await page.getByRole('button', { name: '把青柠晚风加入杯垫' }).click()
    await page.getByRole('button', { name: '我的杯垫' }).click()
    await expect(page.getByRole('dialog')).toContainText('青柠晚风 × 1')
    await page.getByRole('button', { name: '清空本次选择' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: '精酿', exact: true }).click()
    await expect(page.locator('.bc-drink')).toHaveCount(1)
    await expect(page.locator('.bc-drink')).toContainText('柚见小麦')
  }
  expect(errors).toEqual([])
  await page.setViewportSize({ width: 1440, height: 1150 })
  await page.goto('/bar-concepts')
  await expect(page.locator('.bar-phone')).toHaveCount(3)
  await page.screenshot({ path: '../artifacts/bar-concepts/00-comparison.png', fullPage: true })
})
