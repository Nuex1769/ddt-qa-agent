import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const shot = async (page: Page, name: string) => {
  await mkdir('/opt/cursor/artifacts', { recursive: true })
  await mkdir('../artifacts/bar-home', { recursive: true })
  await page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` })
  await page.screenshot({ path: `../artifacts/bar-home/${name}.png` })
}

const mockApi = async (page: Page) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: route.request().url().endsWith('/auth/config') ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify({ demo_mode: true }),
    }),
  )
}

const noOverflow = async (page: Page) => {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
}

const dockClear = async (page: Page) => {
  const box = await page.evaluate(() => {
    const input = document.querySelector('.ss-composer input') as HTMLElement
    input.scrollIntoView({ block: 'center' })
    const dock = document.querySelector('.ss-dock')!.getBoundingClientRect()
    const cart = document.querySelector('.ss-cart')!.getBoundingClientRect()
    const nav = document.querySelector('.ss-nav')!.getBoundingClientRect()
    const field = input.getBoundingClientRect()
    return {
      cartAboveNav: cart.bottom <= nav.top + 1,
      dockInView: dock.top >= 0 && dock.bottom <= window.innerHeight + 1,
      inputClear: field.height > 0 && field.bottom <= dock.top + 1 && field.top >= 0,
    }
  })
  expect(box.cartAboveNav).toBe(true)
  expect(box.dockInView).toBe(true)
  expect(box.inputClear).toBe(true)
}

test('今晚：杯子、纸条和视口不互相遮挡', async ({ page }) => {
  await mockApi(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  await expect(page.getByText('慢半拍')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('调成喜欢的样子')
  await expect(page.locator('.ss-info')).toContainText('青柠晚风')
  await expect(page.locator('.ss-info')).toContainText('180 ml')
  await expect(page.locator('.ss-info')).toContainText('0.0%')
  await expect(page.locator('.ss-info')).toContainText('¥38')
  await expect(page.locator('.ss-source')).toContainText('没有调用模型或店员')
  await expect(page.getByRole('button', { name: '氛围声', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.locator('.ss-app')).toHaveAttribute('data-webgl', /live|flat/, {
    timeout: 20000,
  })
  await noOverflow(page)
  await dockClear(page)
  const mode = await page.locator('.ss-app').getAttribute('data-webgl')
  if (mode === 'live') {
    const canvas = page.locator('canvas.ss-canvas')
    await expect(canvas).toHaveAttribute('data-scene', 'live')
    const before = await canvas.getAttribute('data-glass-yaw')
    await page.getByRole('button', { name: '杯子向右转' }).click()
    await expect(canvas).not.toHaveAttribute('data-glass-yaw', before || '')
    await page.evaluate(() => {
      const node = document.querySelector('canvas.ss-canvas')
      ;(window as unknown as { kept?: Element | null }).kept = node
    })
    await page.locator('.ss-rec-select', { hasText: '柚见小麦' }).click()
    await expect(page.locator('.ss-info h2')).toHaveText('柚见小麦')
    await expect(page.locator('.ss-info')).toContainText('330 ml')
    await expect(page.locator('.ss-info')).toContainText('4.5%')
    await expect(page.locator('.ss-info')).toContainText('¥42')
    await expect(canvas).toHaveAttribute('data-drink', 'wheat')
    expect(
      await page.evaluate(
        () =>
          document.querySelector('canvas.ss-canvas') ===
          (window as unknown as { kept?: Element }).kept,
      ),
    ).toBe(true)
  } else {
    await expect(page.getByRole('img', { name: /平面示意图/ })).toBeVisible()
  }
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.ss-main').evaluate((node) => {
    node.scrollTop = 0
  })
  await shot(page, 'bar-mobile-tonight')
  expect(errors).toEqual([])
})

test('纸条按本机规则给出说明，老样子要确认才入单', async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  await page.getByRole('button', { name: '微甜 · 无酒精' }).click()
  await expect(page.locator('.ss-answer')).toContainText('留了2杯')
  await expect(page.locator('.ss-rec', { hasText: '青柠晚风' })).toBeVisible()
  await expect(page.locator('.ss-rec', { hasText: '柚子汽水' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '酒精度 无酒精' })).toBeChecked()
  await expect(page.getByRole('radio', { name: '甜度 微甜' })).toBeChecked()
  await page.getByRole('button', { name: '老样子', exact: true }).click()
  await expect(page.locator('.ss-answer')).toContainText('最近5笔已完成订单中点了4次，通常1杯')
  await expect(page.getByRole('button', { name: '今晚的单，0杯，合计0元' })).toBeVisible()
  await page.getByRole('button', { name: '查看推荐依据' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('虚构演示订单')
  await expect(dialog).toContainText('已取消 · 不计入')
  await expect(dialog).toContainText('已退款 · 不计入')
  await expect(dialog.locator('.ss-history li')).toHaveCount(7)
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByRole('button', { name: '按老样子加入今晚的单' }).click()
  await expect(page.getByRole('button', { name: '今晚的单，1杯，合计38元' })).toBeVisible()
  await page.getByRole('textbox', { name: '告诉调酒师你的口味' }).fill('老样子，30元以内')
  await page.getByRole('button', { name: '发送口味需求' }).click()
  await expect(page.locator('.ss-answer')).toContainText('不符合本次口味或预算要求')
  await expect(page.getByRole('button', { name: '按老样子加入今晚的单' })).toHaveCount(0)
  await page.getByRole('button', { name: '我的杯垫', exact: true }).click()
  await expect(page.getByText('杯垫还空着')).toBeVisible()
  await expect(page.getByRole('button', { name: '今晚的单，1杯，合计38元' })).toBeVisible()
})

test('历史不足或口味分散时不擅自定酒', async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  for (const scenario of ['empty', 'ambiguous', 'alcohol'] as const) {
    await page.evaluate((current) => {
      const history =
        current === 'empty'
          ? []
          : Array.from({ length: 6 }, (_, index) => ({
              id: String(index),
              status: 'completed',
              completed_at: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
              items: [
                {
                  drink_id: current === 'ambiguous' && index < 3 ? 'lime' : 'wheat',
                  quantity: 1,
                },
              ],
            }))
      localStorage.setItem('slow-side-order-history', JSON.stringify(history))
    }, scenario)
    await page.reload()
    if (scenario === 'alcohol') {
      await page.getByRole('textbox', { name: '告诉调酒师你的口味' }).fill('老样子，要无酒精')
      await page.getByRole('button', { name: '发送口味需求' }).click()
    } else await page.getByRole('button', { name: '老样子', exact: true }).click()
    await expect(page.locator('.ss-answer')).toContainText(
      scenario === 'empty'
        ? '不足以判断'
        : scenario === 'ambiguous'
          ? '口味比较分散'
          : '不符合本次口味或预算要求',
    )
    await expect(page.getByRole('button', { name: '按老样子加入今晚的单' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '今晚的单，0杯，合计0元' })).toBeVisible()
  }
})

test('杯垫是纪念，今晚的单才记杯数', async ({ page }) => {
  await mockApi(page)
  await page.addInitScript(() =>
    localStorage.setItem('slow-side-usual', JSON.stringify(['wheat', 'wheat'])),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  await page.getByRole('button', { name: '把青柠晚风加入今晚的单', exact: true }).click()
  await expect(page.getByRole('button', { name: '今晚的单，1杯，合计38元' })).toBeVisible()
  await page.getByRole('button', { name: '印上杯垫' }).click()
  await expect(page.getByRole('status')).toContainText('印上杯垫')
  await page.getByRole('button', { name: '我的杯垫', exact: true }).click()
  await expect(page.locator('.ss-coaster-list')).toContainText('青柠晚风')
  await expect(page.locator('.ss-coaster-list time')).toContainText('2026')
  await expect(page.getByRole('button', { name: '今晚的单，1杯，合计38元' })).toBeVisible()
  await page.getByRole('button', { name: '今晚的单，1杯，合计38元' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('没有下单')
  await expect(dialog.getByRole('button', { name: /支付|去结算|下单/ })).toHaveCount(0)
  await dialog.getByRole('button', { name: '增加青柠晚风数量' }).click()
  await expect(dialog.locator('output')).toHaveText('2')
  await page.setViewportSize({ width: 320, height: 640 })
  await noOverflow(page)
  await shot(page, 'bar-mobile-cart')
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await expect(page.getByRole('button', { name: '今晚的单，2杯，合计76元' })).toBeVisible()
  await shot(page, 'bar-mobile-coaster')
  await page.getByRole('button', { name: '从杯垫揭下青柠晚风' }).click()
  await expect(page.getByText('杯垫还空着')).toBeVisible()
  await expect(page.getByRole('button', { name: '今晚的单，2杯，合计76元' })).toBeVisible()
})

test('翻酒单可以筛选，分类和酒精度同时生效', async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  await page.getByRole('button', { name: '直接翻酒单' }).click()
  await expect(page.getByRole('heading', { name: '翻酒单' })).toBeVisible()
  await expect(page.locator('.ss-menu-list li')).toHaveCount(7)
  await page.getByRole('radio', { name: '分类 精酿' }).click()
  await expect(page.locator('.ss-menu-list')).toContainText('柚见小麦')
  await expect(page.locator('.ss-menu-list')).toContainText('慢火波特')
  await expect(page.locator('.ss-menu-list')).not.toContainText('青柠晚风')
  await page.getByRole('radio', { name: '酒精度 无酒精' }).click()
  await expect(page.getByText('没有同时符合这些筛选的酒。')).toBeVisible()
  await page.getByRole('button', { name: '清空筛选' }).click()
  await page.getByRole('button', { name: '从酒单把慢拍金汤力加入今晚的单' }).click()
  await expect(page.getByRole('button', { name: '今晚的单，1杯，合计52元' })).toBeVisible()
  await page.locator('.ss-menu-open', { hasText: '橙色旧时光' }).click()
  await expect(page.locator('.ss-info h2')).toHaveText('橙色旧时光')
  await expect(page.locator('.ss-info')).toContainText('22%')
  await noOverflow(page)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.ss-main').evaluate((node) => {
    node.scrollTop = 0
  })
  await shot(page, 'bar-mobile-old-fashioned')
  await page.getByRole('button', { name: '翻酒单', exact: true }).click()
  await shot(page, 'bar-mobile-menu')
})

test('没有 WebGL 时酒单和今晚的单仍可用', async ({ page }) => {
  await mockApi(page)
  await page.addInitScript(() => localStorage.setItem('slow-side-force-flat', '1'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  await expect(page.locator('.ss-app')).toHaveAttribute('data-webgl', 'flat')
  await expect(page.getByRole('img', { name: /平面示意图，当前是青柠晚风/ })).toBeVisible()
  await expect(page.getByText('这个环境没有可用的 WebGL')).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await shot(page, 'bar-mobile-fallback')
  await page.getByRole('button', { name: '直接翻酒单' }).click()
  await page.getByRole('button', { name: '从酒单把青柠晚风加入今晚的单' }).click()
  await expect(page.getByRole('button', { name: '今晚的单，1杯，合计38元' })).toBeVisible()
  await shot(page, 'bar-mobile-fallback-menu')
})

test('减少动态效果时仍可操作', async ({ page }) => {
  await mockApi(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/bar')
  await expect(page.locator('.ss-app')).toHaveAttribute('data-reduced-motion', 'true')
  await page.getByRole('button', { name: '把青柠晚风加入今晚的单', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('还不是订单')
})

test('桌面宽度不溢出，知识助手入口仍在', async ({ page }) => {
  await mockApi(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/bar')
  await expect(page.locator('.ss-app')).toHaveAttribute('data-webgl', /live|flat/, {
    timeout: 20000,
  })
  await expect(page.getByRole('link', { name: '知识助手' })).toHaveAttribute('href', '/chat')
  await noOverflow(page)
  await dockClear(page)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.ss-main').evaluate((node) => {
    node.scrollTop = 0
  })
  await shot(page, 'bar-desktop-tonight')
  await page.goto('/chat')
  await expect(page.getByRole('button', { name: '以演示管理员身份进入' })).toBeVisible()
  expect(errors).toEqual([])
})
