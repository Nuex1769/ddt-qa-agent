const { api, login, errorMessage } = require('../../utils/api')

Page({
  data: { zeroAlcohol: false, avoid: '', historyCount: 0, revision: 0, loading: true, busy: false, error: '' },
  onShow() { this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const result = await api('/me')
      this.setData({ zeroAlcohol: result.preferences.zero_alcohol, avoid: result.preferences.avoid.join('，'),
        historyCount: result.completed_order_count || 0, revision: result.revision })
    } catch (error) { this.setData({ error: errorMessage(error) }) }
    finally { this.setData({ loading: false }) }
  },
  toggle(event) { this.setData({ zeroAlcohol: event.detail.value }) },
  input(event) { this.setData({ avoid: event.detail.value }) },
  async save() {
    if (this.data.loading || this.data.busy) return
    const avoid = [...new Set(this.data.avoid.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean))]
    if (avoid.length > 20 || avoid.some((s) => s.length > 40)) {
      this.setData({ error: '忌口最多 20 项，每项最多 40 字，请修改后保存' }); return
    }
    this.setData({ busy: true, error: '' })
    try {
      const result = await api('/preferences', 'PUT', { revision: this.data.revision, zero_alcohol: this.data.zeroAlcohol, avoid })
      this.setData({ revision: result.revision })
      wx.showToast({ title: '口味偏好已保存', icon: 'success' })
    } catch (error) { this.setData({ error: errorMessage(error) }); wx.showToast({ title: '保存失败，请刷新', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  async relogin() {
    try { await login(); await this.load() } catch (error) { this.setData({ error: errorMessage(error) }) }
  },
})
