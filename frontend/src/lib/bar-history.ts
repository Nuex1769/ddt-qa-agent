import fixtures from '../../../miniprogram/data/demo-orders.json'

export type OrderHistory = {
  id: string
  status: string
  completed_at: string
  items: { drink_id: string; quantity: number; refunded_quantity?: number }[]
}
export type UsualInference = {
  source: 'completed_orders'
  status: 'ready' | 'insufficient' | 'ambiguous'
  order_count: number
  drink_id?: string
  quantity?: number
  occurrences?: number
  last_order_at?: string
}
export function readMockOrders(): OrderHistory[] {
  try {
    const raw = localStorage.getItem('slow-side-order-history')
    if (raw !== null) {
      const records: unknown = JSON.parse(raw)
      return Array.isArray(records)
        ? records.filter(
            (r): r is OrderHistory =>
              r &&
              typeof r.id === 'string' &&
              typeof r.completed_at === 'string' &&
              Array.isArray(r.items),
          )
        : []
    }
  } catch {
    return []
  }
  return fixtures.map((r) => ({
    ...r,
    completed_at: new Date(Date.now() - r.days_ago * 86400000).toISOString(),
  }))
}
export function inferUsual(records: OrderHistory[], at = Date.now()): UsualInference {
  const seen = new Set<string>()
  const recent = [...records]
    .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at))
    .filter((r) => {
      const time = Date.parse(r.completed_at)
      if (
        r.status !== 'completed' ||
        seen.has(r.id) ||
        !Number.isFinite(time) ||
        time > at ||
        time < at - 90 * 86400000
      )
        return false
      seen.add(r.id)
      return true
    })
    .map((r) => {
      const lines = new Map<string, number>()
      for (const item of r.items) {
        const refunded = item.refunded_quantity || 0
        if (
          typeof item.drink_id === 'string' &&
          Number.isInteger(item.quantity) &&
          Number.isInteger(refunded) &&
          refunded >= 0 &&
          item.quantity > refunded &&
          item.quantity <= 20
        ) {
          lines.set(item.drink_id, (lines.get(item.drink_id) || 0) + item.quantity - refunded)
        }
      }
      return {
        ...r,
        items: [...lines]
          .filter(([, quantity]) => quantity <= 20)
          .map(([drink_id, quantity]) => ({ drink_id, quantity })),
      }
    })
    .filter((r) => r.items.length)
    .slice(0, 10)
  const counts = new Map<string, number>()
  for (const r of recent)
    for (const item of r.items) counts.set(item.drink_id, (counts.get(item.drink_id) || 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const result: UsualInference = {
    source: 'completed_orders',
    status: 'insufficient',
    order_count: recent.length,
  }
  if (!ranked.length || ranked[0][1] < 3) return result
  const [drink_id, occurrences] = ranked[0]
  if (occurrences / recent.length < 0.6 || (ranked[1] && ranked[1][1] === occurrences))
    return { ...result, status: 'ambiguous' }
  const matched = recent.filter((r) => r.items.some((i) => i.drink_id === drink_id))
  const quantities = new Map<number, number>()
  for (const r of matched) {
    const quantity = r.items.find((i) => i.drink_id === drink_id)!.quantity
    quantities.set(quantity, (quantities.get(quantity) || 0) + 1)
  }
  const quantity = [...quantities].sort((a, b) => b[1] - a[1])[0][0]
  return {
    ...result,
    status: 'ready',
    drink_id,
    occurrences,
    quantity,
    last_order_at: matched[0].completed_at,
  }
}
