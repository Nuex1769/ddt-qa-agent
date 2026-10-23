const { api, login, decorate, errorMessage } = require('../../utils/api')
const { mockMode } = require('../../config')

Page({
  data: { items: [], total: '0.00', revision: 0, loading: true, busy: false, error: '', hasInvalid: false,
    count: 0, countText: '00', mock: mockMode, statusHeight: 24, navHeight: 48 },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : { statusBarHeight: 24 }
    const capsule = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    this.setData({ statusHeight: info.statusBarHeight, navHeight: capsule ? (capsule.top - info.statusBarHeight) * 2 + capsule.height : 48 })
  },
  onShow() { this.load() },
  present(cart) {
    const count = cart.items.reduce((sum, item) => sum + item.quantity, 0)
    this.setData({ items: cart.items.map((item) => ({ ...item,
      photo: '/assets/bar/' + (item.drink && item.drink.photo || (item.drink && item.drink.category === '精酿' ? 'craft-beer.jpg' : 'cocktails.jpg')),
      label: item.drink && item.drink.category === '精酿' ? 'CRAFT BEER' : 'SIGNATURE COCKTAIL',
      lineTotal: item.drink ? (item.drink.price_fen * item.quantity / 100).toFixed(2) : '—',
      drink: decorate(item.drink) })), count, countText: String(count).padStart(2, '0'),
      total: (cart.total_fen / 100).toFixed(2), revision: cart.revision,
      hasInvalid: cart.items.some((item) => !item.valid) })
  },
  async load() {
    this.setData({ loading: true, error: '' })
    try { this.present(await api('/cart')) }
    catch (error) { this.setData({ error: errorMessage(error) }) }
    finally { this.setData({ loading: false }) }
  },
  async change(event) {
    if (this.data.busy || this.data.loading) return
    const { id, delta } = event.currentTarget.dataset
    const items = this.data.items.map((item) => ({ drink_id: item.drink_id, quantity: item.quantity + (item.drink_id === id ? Number(delta) : 0) }))
      .filter((item) => item.quantity > 0)
    if (items.some((item) => item.quantity > 20)) return
    this.setData({ busy: true, error: '' })
    try {
      this.present(await api('/cart', 'PUT', { items, revision: this.data.revision }))
      wx.showToast({ title: '杯垫已更新', icon: 'success' })
    } catch (error) { this.setData({ error: errorMessage(error) }); wx.showToast({ title: '更新失败，请刷新', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  remove(event) {
    const item = this.data.items.find((i) => i.drink_id === event.currentTarget.dataset.id)
    if (item) return this.change({ currentTarget: { dataset: { id: item.drink_id, delta: -item.quantity } } })
  },
  browse() { wx.switchTab({ url: '/pages/discover/index' }) },
  async relogin() {
    try { await login(); await this.load() } catch (error) { this.setData({ error: errorMessage(error) }) }
  },
})
