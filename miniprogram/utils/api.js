const { apiBase, mockMode } = require('../config')
const { mockApi } = require('./mock')
const tokenKey = 'tavern_customer_token'
let pendingLogin = null

function transport(path, method = 'GET', data, token) {
  if (mockMode) return mockApi(path.replace(/^\/tavern/, ''), method, data)
  return new Promise((resolve, reject) => {
    wx.request({
      url: apiBase + path, method, data, timeout: 35000,
      header: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data)
        if (response.statusCode === 401) wx.removeStorageSync(tokenKey)
        const error = new Error(typeof response.data.detail === 'string' ? response.data.detail : '提交内容无效，请检查后重试')
        error.status = response.statusCode
        reject(error)
      },
      fail() { reject(new Error('无法连接酒馆，请检查网络和服务地址后重试')) },
    })
  })
}

async function login() {
  if (mockMode) return { demo_mode: true, mock_mode: true }
  if (pendingLogin) return pendingLogin
  pendingLogin = (async () => {
    const config = await transport('/tavern/config')
    const existingToken = wx.getStorageSync(tokenKey)
    if (existingToken) {
      try {
        await transport('/tavern/me', 'GET', undefined, existingToken)
        return config
      } catch (error) {
        if (error.status !== 401) throw error
      }
    }
    let body = { mode: 'demo' }
    if (!config.demo_mode) {
      const code = await new Promise((resolve, reject) => wx.login({
        success(result) { result.code ? resolve(result.code) : reject(new Error('微信登录失败，请重试')) },
        fail() { reject(new Error('微信登录失败，请重试')) },
      }))
      body = { mode: 'wechat', code }
    }
    const result = await transport('/tavern/login', 'POST', body)
    wx.setStorageSync(tokenKey, result.token)
    return config
  })()
  try { return await pendingLogin } finally { pendingLogin = null }
}

async function api(path, method = 'GET', data) {
  if (mockMode) return mockApi(path, method, data)
  let token = wx.getStorageSync(tokenKey)
  if (!token) { await login(); token = wx.getStorageSync(tokenKey) }
  return transport('/tavern' + path, method, data, token)
}

function errorMessage(error) {
  return error.status === 401 ? '登录已过期，请点击重新登录后再试。' : error.message
}

function decorate(drink) {
  if (!drink) return null
  return { ...drink, price: (drink.price_fen / 100).toFixed(2),
    sweetness_text: ['不甜', '微甜', '适中', '偏甜', '很甜'][drink.sweetness],
    alcohol_text: drink.alcohol_percent === 0 ? '无酒精' : drink.alcohol_percent + '% vol',
    ingredients_text: drink.ingredients.join(' · '),
    allergens_text: drink.allergens.length ? '过敏原：' + drink.allergens.join('、') : '无已标注过敏原',
  }
}

async function addItems(items) {
  const cart = await api('/cart')
  if (cart.items.some((item) => !item.valid)) throw new Error('购物车中有失效酒款，请先在购物车移除')
  const quantities = new Map(cart.items.map((item) => [item.drink_id, item.quantity]))
  for (const item of items) quantities.set(item.drink_id, (quantities.get(item.drink_id) || 0) + item.quantity)
  if (quantities.size > 30 || [...quantities.values()].some((v) => v > 20)) throw new Error('每款最多 20 杯，购物车最多 30 款')
  return api('/cart', 'PUT', { revision: cart.revision,
    items: [...quantities].map(([drink_id, quantity]) => ({ drink_id, quantity })),
  })
}

module.exports = { api, login, transport, errorMessage, decorate, addItems }
