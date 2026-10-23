// 仅用于本地主界面演示。与真实顾客数据、服务端推荐完全分离。
const { demoOrders, inferUsual } = require('./usual')
const key = 'slow_side_mock_v1'
const drinks = [
  { id: 'lime', name: '青柠晚风', category: '鸡尾酒', price_fen: 3800, alcohol_percent: 0, sweetness: 1,
    description: '微甜 · 柑橘 · 气泡', tags: ['清爽', '微甜', '柑橘'], ingredients: ['青柠', '薄荷', '苏打水', '糖浆'], allergens: [], photo: 'cocktails.jpg', volume: '180 ml' },
  { id: 'wheat', name: '柚见小麦', category: '精酿', price_fen: 4200, alcohol_percent: 4.5, sweetness: 1,
    description: '柚子香 · 轻酒体 · 低苦度', tags: ['清爽', '柚子', '小麦'], ingredients: ['水', '小麦芽', '大麦芽', '啤酒花', '柚子'], allergens: ['麸质'], photo: 'craft-beer.jpg', volume: '330 ml' },
  { id: 'old', name: '橙色旧时光', category: '鸡尾酒', price_fen: 5800, alcohol_percent: 22, sweetness: 2,
    description: '橙皮 · 木质 · 醇厚', tags: ['橙皮', '醇厚'], ingredients: ['波本威士忌', '方糖', '苦精', '橙皮'], allergens: [], photo: 'cocktail-bar.jpg', volume: '180 ml' },
]
const fresh = () => ({ revision: 0, cart: [], orders: demoOrders(), preferences: { zero_alcohol: false, avoid: [] }, intent: {} })
const read = () => {
  const state = wx.getStorageSync(key) || fresh()
  if (!Array.isArray(state.orders)) state.orders = demoOrders()
  return state
}
const save = (state) => { wx.setStorageSync(key, state); return state }
function allowed(drink, state, intent = {}) {
  const avoid = [...state.preferences.avoid, ...(intent.avoid || [])]
  const text = [...drink.ingredients, ...drink.allergens].join(' ')
  return (!(state.preferences.zero_alcohol || intent.zero) || drink.alcohol_percent === 0)
    && (!intent.category || drink.category === intent.category)
    && (intent.sweet === undefined || drink.sweetness <= intent.sweet)
    && (!intent.budget || drink.price_fen <= intent.budget)
    && !avoid.some((word) => text.includes(word))
}
function cart(state) {
  const items = state.cart.map((item) => {
    const drink = drinks.find((d) => d.id === item.drink_id)
    return { ...item, drink, valid: !!drink && allowed(drink, state) }
  })
  return { revision: state.revision, items, total_fen: items.reduce((sum, i) => sum + (i.valid ? i.drink.price_fen * i.quantity : 0), 0) }
}
function validItems(items) {
  if (!Array.isArray(items) || items.length > 30 || new Set(items.map((i) => i.drink_id)).size !== items.length
    || items.some((i) => !drinks.some((d) => d.id === i.drink_id) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 20)) {
    throw new Error('酒款或数量无效，每款最多 20 杯')
  }
}
async function mockApi(path, method = 'GET', body = {}) {
  const state = read()
  if (path === '/config') return { demo_mode: true, mock_mode: true, checkout_enabled: false }
  if (path === '/menu') return { items: drinks.filter((d) => allowed(d, state)) }
  if (path === '/me') return { preferences: state.preferences, revision: state.revision, usual_source: 'completed_orders', completed_order_count: inferUsual(state.orders).order_count }
  if (path === '/cart' && method === 'GET') return cart(state)
  if (path === '/recommend') {
    const message = body.message || ''
    const intent = body.reset || /老样子/.test(message) ? {} : { ...state.intent }
    if (/无酒精|开车|不喝酒/.test(message)) intent.zero = true
    if (/微甜|不要太甜|不太甜/.test(message)) intent.sweet = 1
    if (/精酿|啤酒/.test(message)) intent.category = '精酿'
    if (/鸡尾酒/.test(message)) intent.category = '鸡尾酒'
    const budget = message.match(/(\d+(?:\.\d+)?)\s*元/)
    if (budget) intent.budget = Number(budget[1]) * 100
    const avoid = [...message.matchAll(/(?:不要|不加|忌口)\s*([^，。；、\s]+)/g)].map((m) => m[1]).filter((s) => !['太甜', '太苦'].includes(s))
    if (avoid.length) intent.avoid = [...(intent.avoid || []), ...avoid]
    const usual = /老样子/.test(message)
    let items
    let reply
    let inference = null
    if (usual) {
      inference = inferUsual(state.orders)
      const drink = drinks.find((d) => d.id === inference.drink_id)
      if (inference.status === 'ready' && (!drink || !allowed(drink, state, intent))) inference.status = 'unavailable'
      items = inference.status === 'ready' ? [{ drink, quantity: inference.quantity,
        reason: `最近${inference.order_count}笔已完成订单中点了${inference.occurrences}次，通常${inference.quantity}杯` }] : []
      reply = inference.status === 'ready' ? `${items[0].reason}。我猜你想喝${drink.name}，这次也来这杯吗？`
        : inference.status === 'ambiguous' ? '你最近的口味比较分散，暂时不能确定老样子。今晚更想喝哪一杯？'
          : inference.status === 'unavailable' ? '从历史订单推测的老样子已下架或不符合本次要求，今晚重新选一杯吧。'
            : '近期已完成订单还不足以判断老样子，今晚想喝什么口味？'
    } else {
      items = drinks.filter((d) => allowed(d, state, intent)).slice(0, 2).map((drink) => ({ drink, quantity: 1, reason: '符合你这次的口味。' }))
      reply = !items.length ? '这份酒单暂时没有符合全部条件的酒。换个需求，或点「重新聊聊」。'
        : `懂了。${items.map((i) => i.drink.name).join('，或者一杯')}。${intent.zero ? '这一轮只选 0.0% 酒精度。' : '今晚慢慢选。'}`
    }
    state.intent = intent
    save(state)
    return { message: reply, items, intent: { usual }, usual_inference: inference }
  }
  if (!['/cart', '/preferences'].includes(path)) throw new Error('本地演示暂不支持此操作')
  if (body.revision !== state.revision) throw new Error('内容已变化，请刷新后重试')
  if (path === '/cart' && method === 'PUT') {
    validItems(body.items)
    if (body.items.some((i) => !allowed(drinks.find((d) => d.id === i.drink_id), state))) throw new Error('酒款不符合当前口味，请先移除')
    state.cart = body.items
  }  else if (path === '/preferences' && method === 'PUT') state.preferences = { zero_alcohol: !!body.zero_alcohol, avoid: body.avoid }
  else throw new Error('本地演示暂不支持此操作')
  state.revision += 1
  save(state)
  return path === '/cart' ? cart(state) : { revision: state.revision }
}
module.exports = { mockApi }
