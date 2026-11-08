import { drinkById, type BarDrink } from './catalog'

export type CartLine = { id: string; qty: number }
export type CoasterStamp = { id: string; drinkId: string; name: string; stampedAt: string }

const CART_KEY = 'slow-side-cart'
const COASTER_KEY = 'slow-side-coasters'

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 浏览器禁用存储时，本次会话仍可使用。 */
  }
}

export function readCart(): CartLine[] {
  const value = readJson(CART_KEY)
  if (!Array.isArray(value)) return []
  const lines: CartLine[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const id = (item as CartLine).id
    const qty = (item as CartLine).qty
    if (!drinkById[id] || !Number.isInteger(qty) || qty < 1) continue
    lines.push({ id, qty: Math.min(20, qty) })
  }
  return lines.slice(0, 12)
}

export function writeCart(lines: CartLine[]) {
  writeJson(CART_KEY, lines)
}

export function readCoasters(): CoasterStamp[] {
  const value = readJson(COASTER_KEY)
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is CoasterStamp => {
      if (!item || typeof item !== 'object') return false
      const stamp = item as CoasterStamp
      return (
        typeof stamp.id === 'string' &&
        typeof stamp.drinkId === 'string' &&
        typeof stamp.name === 'string' &&
        typeof stamp.stampedAt === 'string' &&
        !!drinkById[stamp.drinkId]
      )
    })
    .slice(0, 40)
}

export function writeCoasters(stamps: CoasterStamp[]) {
  writeJson(COASTER_KEY, stamps)
}

export function cartCount(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + line.qty, 0)
}

export function cartTotal(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + line.qty * (drinkById[line.id]?.price || 0), 0)
}

export function addToCart(lines: CartLine[], id: string, qty = 1) {
  const drink = drinkById[id]
  if (!drink || qty < 1) return { lines, note: '酒单里没有这杯。' }
  const next = lines.map((line) => ({ ...line }))
  const found = next.find((line) => line.id === id)
  if ((found?.qty || 0) + qty > 20) return { lines, note: '每款最多先记 20 杯。' }
  if (found) found.qty += qty
  else next.push({ id, qty })
  return { lines: next, note: `已把${drink.name}记入今晚的单。这还不是订单。` }
}

export function changeQty(lines: CartLine[], id: string, delta: number) {
  const drink = drinkById[id]
  if (!drink) return { lines, note: '' }
  const current = lines.find((line) => line.id === id)
  if (delta > 0 && current && current.qty >= 20) return { lines, note: '每款最多先记 20 杯。' }
  const next = lines.flatMap((line) => {
    if (line.id !== id) return [line]
    const qty = line.qty + delta
    return qty > 0 ? [{ ...line, qty }] : []
  })
  return { lines: next, note: '今晚的单已更新。这还不是订单。' }
}

export function localDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function formatStampDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

export function stampCoaster(stamps: CoasterStamp[], drink: BarDrink, at = new Date()) {
  const day = localDay(at)
  if (
    stamps.some(
      (stamp) => stamp.drinkId === drink.id && localDay(new Date(stamp.stampedAt)) === day,
    )
  ) {
    return { stamps, note: `${drink.name}今天已经在杯垫上了。`, created: false }
  }
  const stamp: CoasterStamp = {
    id: `${drink.id}-${at.getTime()}`,
    drinkId: drink.id,
    name: drink.name,
    stampedAt: at.toISOString(),
  }
  return {
    stamps: [stamp, ...stamps].slice(0, 40),
    note: `已把${drink.name}印上杯垫。杯垫只作纪念，不会下单。`,
    created: true,
  }
}
