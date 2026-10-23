// Exercise the native Page handlers against the running local demo API.
// Run only against an isolated demo database, like frontend browser tests.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
// 此脚本专门验收真实演示 API；默认界面使用离线 mock。
require('../miniprogram/config').mockMode = false
const base = process.env.TAVERN_E2E_BASE || 'http://127.0.0.1:8000'
const storage = new Map()
const toasts = []
let failedPath = ''

global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  showToast: (value) => toasts.push(value),
  showModal: (options) => options.success({ confirm: true }),
  switchTab: () => {},
  pageScrollTo: () => {},
  request(options) {
    const suffix = new URL(options.url).pathname
    if (suffix === failedPath) {
      options.success({ statusCode: 503, data: { detail: '服务暂不可用，请稍后重试' } })
      return
    }
    fetch(base + suffix, {
      method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : JSON.stringify(options.data),
    }).then(async (response) => options.success({ statusCode: response.status, data: await response.json() }))
      .catch(() => options.fail())
  },
}

function loadPage(name) {
  const filename = path.join(root, 'miniprogram/pages', name, 'index.js')
  let definition
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: (value) => { definition = value }, require: createRequire(filename), wx: global.wx,
  }, { filename })
  return { ...definition, data: structuredClone(definition.data),
    setData(values) { Object.assign(this.data, values) },
  }
}

async function ready(page) {
  if (page.loadMenu) await page.loadMenu()
  else await page.load()
  assert.equal(page.data.error, '')
}

test('原生小程序：需求推荐、购物车、老样子、忌口和失败恢复', async () => {
  const config = await (await fetch(base + '/api/tavern/config')).json()
  assert.equal(config.demo_mode, true, '该验收只允许使用演示环境')
  const admin = await fetch(base + '/api/auth/demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'admin' }),
  })
  assert.equal(admin.status, 200)
  const cookie = admin.headers.get('set-cookie').split(';')[0]
  const data = JSON.parse(fs.readFileSync(path.join(root, 'examples/tavern-menu.json'), 'utf8'))
  const imported = await fetch(base + '/api/admin/tavern/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(data),
  })
  assert.ok([201, 409].includes(imported.status))

  const discover = loadPage('discover')
  await ready(discover)
  assert.ok(discover.data.items.length >= 4)
  assert.ok(discover.data.items.every((item) => !('private_recipe' in item)))
  discover.setData({ input: '给我一杯微甜的无酒精鸡尾酒' })
  await discover.ask()
  assert.equal(discover.data.error, '')
  assert.ok(discover.data.recommendations.length >= 2)
  assert.ok(discover.data.recommendations.every((item) => item.drink.alcohol_percent === 0 && item.drink.sweetness <= 2))
  discover.setData({ input: '40元以内' })
  await discover.ask()
  assert.ok(discover.data.recommendations.every((item) => item.drink.price_fen <= 4000))
  const first = discover.data.recommendations[0].drink
  await discover.add({ currentTarget: { dataset: { id: first.id, quantity: 1 } } })
  assert.equal(toasts.at(-1).title, '已加入我的杯垫')

  const cart = loadPage('cart')
  await ready(cart)
  assert.equal(cart.data.items.length, 1)
  await cart.change({ currentTarget: { dataset: { id: first.id, delta: 1 } } })
  assert.equal(cart.data.items[0].quantity, 2)
  discover.newConversation()
  discover.setData({ input: '老样子' })
  await discover.ask()
  assert.equal(discover.data.usual, true)
  assert.equal(discover.data.recommendations.length, 0)
  assert.match(discover.data.latest.answer, /不足以判断/)
  await discover.addUsual()
  await ready(cart)
  assert.equal(cart.data.items[0].quantity, 2)

  const profile = loadPage('profile')
  await ready(profile)
  assert.equal(profile.data.historyCount, 0)
  profile.setData({ zeroAlcohol: true, avoid: '坚果，牛奶' })
  await profile.save()
  assert.equal(toasts.at(-1).title, '口味偏好已保存')
  await ready(discover)
  assert.ok(discover.data.items.every((item) => item.alcohol_percent === 0 && item.allergens.length === 0))

  // Mutating after another page changed preferences must preserve the existing cart.
  await cart.change({ currentTarget: { dataset: { id: first.id, delta: 1 } } })
  assert.match(cart.data.error, /已变化/)
  assert.equal(cart.data.items[0].quantity, 2)
  await ready(cart)
  assert.equal(cart.data.items[0].quantity, 2)

  // Retrying login after a transient error must not replace a valid demo identity.
  const customerApi = require('../miniprogram/utils/api')
  const originalToken = storage.get('tavern_customer_token')
  await customerApi.login()
  assert.equal(storage.get('tavern_customer_token'), originalToken)

  failedPath = '/api/tavern/recommend'
  discover.setData({ input: '再来一杯' })
  await discover.ask()
  assert.match(discover.data.error, /暂不可用/)
  assert.equal(discover.data.busy, false)
  assert.equal(discover.data.input, '再来一杯')
  assert.equal(discover.data.recommendations.length, 0)
  failedPath = ''

  storage.set('tavern_customer_token', 'invalid-token')
  await cart.load()
  assert.match(cart.data.error, /登录已过期/)
  assert.equal(storage.has('tavern_customer_token'), false)
})
