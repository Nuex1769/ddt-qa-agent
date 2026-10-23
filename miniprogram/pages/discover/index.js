const { api, login, transport, decorate, addItems, errorMessage } = require('../../utils/api')
const { mockMode } = require('../../config')

function display(drink) {
  const value = decorate(drink)
  const beer = drink.category === '精酿'
  return { ...value, photo: '/assets/bar/' + (drink.photo || (beer ? 'craft-beer.jpg' : 'cocktails.jpg')),
    label: beer ? 'CRAFT BEER' : 'SIGNATURE COCKTAIL', number: beer ? 'TAP 02' : 'NO. 01',
    volume: drink.volume || (beer ? '330 ml' : '180 ml'), abv: drink.alcohol_percent === 0 ? '0.0' : drink.alcohol_percent,
    price: Number(value.price).toString() }
}

Page({
  data: { input: '', busy: false, loading: true, error: '', items: [], recommendations: [],
    history: [], demo: false, mock: mockMode, usual: false, reset: true, hasResult: false,
    filter: 'all', visible: [], selected: null, latest: null, welcome: '你说心情，我来替你翻翻酒单。', statusHeight: 24, navHeight: 48 },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : { statusBarHeight: 24 }
    const capsule = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    this.setData({ statusHeight: info.statusBarHeight, navHeight: capsule ? (capsule.top - info.statusBarHeight) * 2 + capsule.height : 48 })
    transport('/tavern/config').then((config) => this.setData({ demo: config.demo_mode })).catch(() => {})
  },
  onShow() { this.loadMenu() },
  async loadMenu() {
    this.setData({ loading: true, error: '' })
    try {
      const result = await api('/menu')
      // Old recommendation cards may no longer match changed preferences or the current menu.
      this.setData({ items: result.items.map(display), recommendations: [], hasResult: false, latest: null,
        welcome: result.items.length ? '懂了。一杯' + result.items.slice(0, 2).map((d) => d.name).join('，或者一杯') + '，今晚慢慢选。' : '这份酒单暂时没有符合你偏好的酒款，换个口味聊聊。' })
      this.updateDisplay()
    } catch (error) { this.setData({ error: errorMessage(error) }) }
    finally { this.setData({ loading: false }) }
  },
  onInput(event) { this.setData({ input: event.detail.value }) },
  updateDisplay() {
    const { filter, hasResult, recommendations, items } = this.data
    const source = filter === 'all' && hasResult ? recommendations.map((i) => ({ ...i.drink, quantity: i.quantity }))
      : filter === 'all' ? items.slice(0, 2) : items.filter((i) => i.category === filter)
    this.setData({ visible: source, count: String(source.length).padStart(2, '0') })
  },
  selectFilter(event) {
    this.setData({ filter: event.currentTarget.dataset.filter })
    this.updateDisplay()
  },
  openDrink(event) {
    const selected = this.data.visible.find((i) => i.id === event.currentTarget.dataset.id)
    if (selected) this.setData({ selected })
  },
  closeDrink() { this.setData({ selected: null }) },
  noop() {},
  openMenu() {
    this.setData({ filter: '鸡尾酒' }); this.updateDisplay()
    wx.pageScrollTo({ selector: '#tonight-menu', duration: 250 })
  },
  openCart() { wx.switchTab({ url: '/pages/cart/index' }) },
  quick(event) { this.setData({ input: event.currentTarget.dataset.message }); return this.ask() },
  async ask() {
    if (this.data.busy) return
    const message = this.data.input.trim()
    if (!message) { this.setData({ error: '先说说你想喝什么，例如：微甜、无酒精。' }); return }
    if (message.length > 1000) { this.setData({ error: '需求最多 1000 字，请缩短后重试' }); return }
    this.setData({ busy: true, error: '', recommendations: [], hasResult: false })
    this.updateDisplay()
    try {
      const result = await api('/recommend', 'POST', { message, reset: this.data.reset })
      const turn = { question: message, answer: result.message }
      this.setData({ recommendations: result.items.map((item) => ({ ...item, drink: display(item.drink) })),
        history: [...this.data.history, turn].slice(-6), latest: turn, filter: 'all', input: '', usual: result.intent.usual,
        reset: false, hasResult: true })
      this.updateDisplay()
      wx.pageScrollTo({ selector: '#bartender-note', duration: 250 })
    } catch (error) {
      this.setData({ error: errorMessage(error) })
      wx.showToast({ title: '推荐未完成，请重试', icon: 'none' })
    } finally { this.setData({ busy: false }) }
  },
  newConversation() {
    this.setData({ reset: true, history: [], latest: null, recommendations: [], input: '', error: '', hasResult: false, filter: 'all' })
    this.updateDisplay()
  },
  async add(event) {
    if (this.data.busy) return
    const { id, quantity } = event.currentTarget.dataset
    this.setData({ busy: true, error: '' })
    try {
      await addItems([{ drink_id: id, quantity: Number(quantity) || 1 }])
      this.setData({ selected: null })
      wx.showToast({ title: '已加入我的杯垫', icon: 'success' })
    } catch (error) { this.setData({ error: errorMessage(error) }); wx.showToast({ title: '加入失败，请重试', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  async addUsual() {
    if (this.data.busy || !this.data.recommendations.length) return
    this.setData({ busy: true, error: '' })
    try {
      await addItems(this.data.recommendations.map((i) => ({ drink_id: i.drink.id, quantity: i.quantity })))
      wx.showToast({ title: '组合已加入我的杯垫', icon: 'success' })
    } catch (error) { this.setData({ error: errorMessage(error) }); wx.showToast({ title: '加入失败，请重试', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  async relogin() {
    this.setData({ error: '' })
    try { await login(); await this.loadMenu() } catch (error) { this.setData({ error: errorMessage(error) }) }
  },
})
