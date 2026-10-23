const fixtures = require('../data/demo-orders.json')
function demoOrders(at = Date.now()) {
  return fixtures.map((r) => ({ ...r, completed_at: new Date(at - r.days_ago * 86400000).toISOString() }))
}
function inferUsual(records, at = Date.now()) {
  const seen = new Set()
  const recent = [...records].sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at)).filter((r) => {
    const time = Date.parse(r.completed_at)
    if (r.status !== 'completed' || !r.id || seen.has(r.id) || !Number.isFinite(time) || time > at || time < at - 90 * 86400000) return false
    seen.add(r.id)
    return true
  }).map((r) => {
    const lines = new Map()
    for (const item of r.items || []) {
      const refunded = item.refunded_quantity || 0
      if (typeof item.drink_id === 'string' && Number.isInteger(item.quantity) && Number.isInteger(refunded) && refunded >= 0 && item.quantity > refunded && item.quantity <= 20) {
        lines.set(item.drink_id, (lines.get(item.drink_id) || 0) + item.quantity - refunded)
      }
    }
    return { ...r, items: [...lines].filter(([, quantity]) => quantity <= 20).map(([drink_id, quantity]) => ({ drink_id, quantity })) }
  }).filter((r) => r.items.length).slice(0, 10)
  const counts = new Map()
  for (const r of recent) for (const item of r.items) counts.set(item.drink_id, (counts.get(item.drink_id) || 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const result = { source: 'completed_orders', status: 'insufficient', order_count: recent.length }
  if (!ranked.length || ranked[0][1] < 3) return result
  const [drink_id, occurrences] = ranked[0]
  if (occurrences / recent.length < .6 || ranked[1] && ranked[1][1] === occurrences) return { ...result, status: 'ambiguous' }
  const matched = recent.filter((r) => r.items.some((i) => i.drink_id === drink_id))
  const quantities = new Map()
  for (const r of matched) {
    const quantity = r.items.find((i) => i.drink_id === drink_id).quantity
    quantities.set(quantity, (quantities.get(quantity) || 0) + 1)
  }
  const quantity = [...quantities].sort((a, b) => b[1] - a[1])[0][0]
  return { ...result, status: 'ready', drink_id, occurrences, quantity, last_order_at: matched[0].completed_at }
}
module.exports = { demoOrders, inferUsual }
