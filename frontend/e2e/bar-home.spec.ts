import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const mockApi = async (page: import('@playwright/test').Page) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ demo_mode: true }),
    }),
  )
}

test('订单推测老样子：证据、确认与杯垫隔离', async ({ page }) => {
  await mockApi(page)
  // 旧版本手动保存的组合不能影响订单推测。
  await page.addInitScript(() =>
    localStorage.setItem('slow-side-usual', JSON.stringify(['wheat', 'wheat'])),
  )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  await expect(page.locator('.bar-vinyl')).toBeVisible()
  await expect(page.locator('.bc-drink')).toHaveCount(2)
  await mkdir('../artifacts/bar-home', { recursive: true })
  await expect
    .poll(() =>
      page.locator('.bc-hero img').evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  await page.screenshot({ path: '../artifacts/bar-home/01-home.png', fullPage: true })
  await page.getByRole('button', { name: '老样子', exact: true }).click()
  await expect(page.locator('.bc-bartender-answer')).toContainText(
    '最近5笔已完成订单中点了4次，通常1杯',
  )
  await expect(page.locator('.bc-usual-confirm')).toContainText('青柠晚风 × 1')
  await expect(page.locator('.bc-drink')).toHaveCount(1)
  await page.screenshot({ path: '../artifacts/bar-home/06-usual-inference.png', fullPage: true })
  await page.getByRole('button', { name: '查看推荐依据' }).click()
  await expect(page.getByRole('dialog')).toContainText('虚构演示订单')
  await expect(page.getByRole('dialog')).toContainText('已取消 · 不计入')
  await expect(page.getByRole('dialog')).toContainText('已退款 · 不计入')
  await expect(page.locator('.bc-history-row')).toHaveCount(7)
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByRole('button', { name: '我的杯垫', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('还没有选中的酒')
  await expect(page.getByRole('button', { name: '记为我的老样子' })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByRole('button', { name: '确认老样子，加入杯垫' }).click()
  await page.getByRole('button', { name: '我的杯垫', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('青柠晚风 × 1')
  await page.getByRole('button', { name: '增加青柠晚风数量' }).click()
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await page.reload()
  await page.getByRole('button', { name: '老样子', exact: true }).click()
  await expect(page.locator('.bc-usual-confirm')).toContainText('青柠晚风 × 1')
  await page.getByRole('button', { name: '我的杯垫', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('青柠晚风 × 2')
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByRole('textbox', { name: '告诉调酒师你的口味' }).fill('老样子，30元以内')
  await page.getByRole('button', { name: '发送口味需求' }).click()
  await expect(page.locator('.bc-usual-confirm')).toHaveCount(0)
  await expect(page.locator('.bc-bartender-answer')).toContainText('不符合本次口味或预算要求')
  await page.setViewportSize({ width: 320, height: 640 })
  await expect(page.getByRole('button', { name: '发送口味需求' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('杯垫：纸质酒单、数量小计与空状态，不把待选清单记为习惯', async ({ page }) => {
  await mockApi(page)
  await page.addInitScript(() =>
    localStorage.setItem('slow-side-tray', JSON.stringify(['lime', 'lime', 'wheat'])),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  await page.getByRole('button', { name: '我的杯垫', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: '我的杯垫', exact: true })).toBeVisible()
  await expect(dialog.locator('.bc-coaster-total')).toContainText('118')
  await expect(dialog.getByRole('button', { name: '记为我的老样子' })).toHaveCount(0)
  await expect
    .poll(() =>
      dialog
        .locator('.bc-coaster-item img')
        .first()
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  await mkdir('../artifacts/bar-home', { recursive: true })
  await page.screenshot({ path: '../artifacts/bar-home/03-coaster.png', fullPage: true })
  await dialog.getByRole('button', { name: '增加青柠晚风数量' }).click()
  await expect(dialog.locator('.bc-coaster-total')).toContainText('156')
  await dialog.getByRole('button', { name: '减少青柠晚风数量' }).click()
  await expect(dialog.locator('.bc-coaster-total')).toContainText('118')
  await dialog.getByRole('button', { name: '移除柚见小麦' }).click()
  await expect(dialog.locator('.bc-coaster-total')).toContainText('76')
  await page.setViewportSize({ width: 320, height: 640 })
  await expect(dialog.getByRole('button', { name: '继续选一杯' })).toBeInViewport()
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: '../artifacts/bar-home/05-coaster-small.png', fullPage: true })
  await dialog.getByRole('button', { name: '移除青柠晚风' }).click()
  await expect(dialog).toContainText('杯垫还空着，今晚还长')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '../artifacts/bar-home/04-coaster-empty.png', fullPage: true })
  await dialog.getByRole('button', { name: '去选今晚的第一杯' }).click()
  await expect(dialog).toBeHidden()
})

test('历史不足、偏好分散与本次无酒精要求：先追问，不擅自选酒', async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  for (const scenario of ['empty', 'ambiguous', 'alcohol']) {
    await page.evaluate((scenario) => {
      const history =
        scenario === 'empty'
          ? []
          : Array.from({ length: 6 }, (_, i) => ({
              id: String(i),
              status: 'completed',
              completed_at: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
              items: [
                { drink_id: scenario === 'ambiguous' && i < 3 ? 'lime' : 'wheat', quantity: 1 },
              ],
            }))
      localStorage.setItem('slow-side-order-history', JSON.stringify(history))
    }, scenario)
    await page.reload()
    await page
      .getByRole('textbox', { name: '告诉调酒师你的口味' })
      .fill(scenario === 'alcohol' ? '老样子，要无酒精' : '老样子')
    await page.getByRole('button', { name: '发送口味需求' }).click()
    await expect(page.locator('.bc-bartender-answer')).toContainText(
      scenario === 'empty'
        ? '不足以判断'
        : scenario === 'ambiguous'
          ? '口味比较分散'
          : '不符合本次口味或预算要求',
    )
    await expect(page.locator('.bc-usual-confirm')).toHaveCount(0)
    await expect(page.locator('.bc-drink')).toHaveCount(0)
  }
})
