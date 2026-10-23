const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const storage = new Map()
const messages = []
global.wx = {
  getStorageSync: (key) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
  setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
  showToast: ({ title }) => messages.push(title),
  pageScrollTo() {}, switchTab() {},
  request() { throw new Error('离线预览不能调用网络') },
}
function page(name) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js')
  let definition
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: (value) => { definition = value }, require: createRequire(filename), wx: global.wx,
  }, { filename })
  return { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value) } }
}
const event = (dataset) => ({ currentTarget: { dataset } })
test('唱片酒馆：离线推荐、分类、杯垫、订单推测老样子与忌口', async () => {
  const home = page('discover')
  home.onLoad()
  await home.loadMenu()
  assert.equal(home.data.error, '')
  assert.equal(home.data.mock, true)
  assert.equal(home.data.visible.length, 2)
  home.selectFilter(event({ filter: '精酿' }))
  assert.equal(home.data.visible[0].name, '柚见小麦')
  await home.quick(event({ message: '给我一杯微甜的无酒精鸡尾酒' }))
  assert.equal(home.data.visible.length, 1)
  assert.equal(home.data.visible[0].alcohol_percent, 0)
  assert.equal(home.data.visible[0].sweetness, 1)
  home.setData({ input: '40元以内' })
  await home.ask()
  assert.ok(home.data.visible.every((d) => d.price_fen <= 4000 && d.alcohol_percent === 0))
  home.openDrink(event({ id: 'lime' }))
  assert.equal(home.data.selected.name, '青柠晚风')
  await home.add(event({ id: 'lime', quantity: 1 }))
  assert.equal(home.data.selected, null)
  const cart = page('cart')
  await cart.load()
  assert.equal(cart.data.items.length, 1)
  await cart.change(event({ id: 'lime', delta: 1 }))
  assert.equal(cart.data.items[0].quantity, 2)
  const historyBefore = storage.get('slow_side_mock_v1').orders
  const nextVisit = page('discover')
  await nextVisit.loadMenu()
  nextVisit.setData({ input: '老样子' })
  await nextVisit.ask()
  assert.equal(nextVisit.data.usual, true)
  assert.equal(nextVisit.data.recommendations[0].quantity, 1)
  assert.equal(nextVisit.data.recommendations[0].drink.id, 'lime')
  assert.match(nextVisit.data.latest.answer, /最近5笔已完成订单中点了4次，通常1杯/)
  assert.deepEqual(storage.get('slow_side_mock_v1').orders, historyBefore)
  await cart.load()
  assert.equal(cart.data.items[0].quantity, 2, '推荐本身不能改变杯垫')
  await nextVisit.addUsual()
  await cart.load()
  assert.equal(cart.data.items[0].quantity, 3)
  const profile = page('profile')
  await profile.load()
  profile.setData({ zeroAlcohol: true, avoid: '薄荷' })
  await profile.save()
  await nextVisit.loadMenu()
  assert.equal(nextVisit.data.items.length, 0)
  nextVisit.newConversation()
  nextVisit.setData({ input: '老样子' })
  await nextVisit.ask()
  assert.equal(nextVisit.data.recommendations.length, 0, '忌口变化后不能继续推荐旧组合')
  assert.match(nextVisit.data.latest.answer, /不符合/)
  await cart.load()
  assert.equal(cart.data.hasInvalid, true)
  await cart.remove(event({ id: 'lime' }))
  assert.equal(cart.data.items.length, 0)
  assert.equal(typeof cart.remember, 'undefined')
  assert.equal(profile.data.historyCount, 5)
  const state = storage.get('slow_side_mock_v1')
  state.preferences = { zero_alcohol: false, avoid: [] }
  state.orders = []
  state.usual = [{ drink_id: 'lime', quantity: 9 }]
  storage.set('slow_side_mock_v1', state)
  await nextVisit.quick(event({ message: '老样子' }))
  assert.equal(nextVisit.data.recommendations.length, 0)
  assert.match(nextVisit.data.latest.answer, /不足以判断/)
  state.orders = historyBefore.filter((r) => r.status === 'completed').slice(0, 3).flatMap((r, i) => [
    { ...r, id: 'lime-' + i, items: [{ drink_id: 'lime', quantity: 1 }] },
    { ...r, id: 'wheat-' + i, items: [{ drink_id: 'wheat', quantity: 1 }] },
  ])
  storage.set('slow_side_mock_v1', state)
  await nextVisit.quick(event({ message: '老样子' }))
  assert.equal(nextVisit.data.recommendations.length, 0)
  assert.match(nextVisit.data.latest.answer, /口味比较分散/)
})
