import type { UsualInference } from '@/lib/bar-history'
import { sweetnessLabels } from '@/lib/tavern'

export type GlassKind = 'highball' | 'rocks' | 'pint' | 'coupe'
export type Garnish = 'lime' | 'orange' | 'yuzu' | 'berry' | 'none'
export type DrinkBody = 'sparkling' | 'spirit' | 'beer' | 'stout'

/** 浏览器 /bar 的代表性酒单。价格、容量、酒精度写在酒款上，推荐只引用这些字段。 */
export type BarDrink = {
  id: string
  name: string
  english: string
  kind: 'cocktail' | 'beer'
  price: number
  volumeMl: number
  abv: number
  sweetness: number
  flavors: string[]
  note: string
  ingredients: string
  glass: GlassKind
  liquid: string
  garnish: Garnish
  mint: boolean
  ice: boolean
  bubbles: boolean
  foam: boolean
  body: DrinkBody
}

export const barDrinks: BarDrink[] = [
  {
    id: 'lime',
    name: '青柠晚风',
    english: 'LIME & A LITTLE LIGHT',
    kind: 'cocktail',
    price: 38,
    volumeMl: 180,
    abv: 0,
    sweetness: 1,
    flavors: ['柑橘', '清爽', '气泡'],
    note: '微甜 · 柑橘 · 气泡',
    ingredients: '青柠、薄荷、苏打水、少量糖浆',
    glass: 'highball',
    liquid: '#d7e38a',
    garnish: 'lime',
    mint: true,
    ice: true,
    bubbles: true,
    foam: false,
    body: 'sparkling',
  },
  {
    id: 'pomelo',
    name: '柚子汽水',
    english: 'POMELO SODA',
    kind: 'cocktail',
    price: 36,
    volumeMl: 180,
    abv: 0,
    sweetness: 1,
    flavors: ['柑橘', '清爽', '气泡'],
    note: '微甜 · 柚子 · 气泡',
    ingredients: '柚子、苏打水、少量糖浆',
    glass: 'highball',
    liquid: '#f0d48a',
    garnish: 'yuzu',
    mint: false,
    ice: true,
    bubbles: true,
    foam: false,
    body: 'sparkling',
  },
  {
    id: 'berry',
    name: '莓果夜航',
    english: 'BERRY, SLOWLY',
    kind: 'cocktail',
    price: 46,
    volumeMl: 180,
    abv: 0,
    sweetness: 3,
    flavors: ['果香', '气泡'],
    note: '偏甜 · 莓果 · 气泡',
    ingredients: '草莓、柠檬、苏打水、糖浆',
    glass: 'coupe',
    liquid: '#d4537e',
    garnish: 'berry',
    mint: false,
    ice: false,
    bubbles: true,
    foam: false,
    body: 'sparkling',
  },
  {
    id: 'juniper',
    name: '慢拍金汤力',
    english: 'JUNIPER & TONIC',
    kind: 'cocktail',
    price: 52,
    volumeMl: 180,
    abv: 8.5,
    sweetness: 0,
    flavors: ['柑橘', '清爽'],
    note: '不甜 · 杜松 · 微苦',
    ingredients: '金酒、汤力水、青柠',
    glass: 'highball',
    liquid: '#d7ebe0',
    garnish: 'lime',
    mint: false,
    ice: true,
    bubbles: true,
    foam: false,
    body: 'sparkling',
  },
  {
    id: 'old',
    name: '橙色旧时光',
    english: 'A SLOW OLD FASHIONED',
    kind: 'cocktail',
    price: 58,
    volumeMl: 180,
    abv: 22,
    sweetness: 1,
    flavors: ['木质', '橙皮'],
    note: '橙皮 · 木质 · 醇厚',
    ingredients: '波本威士忌、方糖、苦精、橙皮',
    glass: 'rocks',
    liquid: '#c4621e',
    garnish: 'orange',
    mint: false,
    ice: true,
    bubbles: false,
    foam: false,
    body: 'spirit',
  },
  {
    id: 'wheat',
    name: '柚见小麦',
    english: 'YUZU WHEAT ALE',
    kind: 'beer',
    price: 42,
    volumeMl: 330,
    abv: 4.5,
    sweetness: 1,
    flavors: ['柑橘', '麦香', '清爽'],
    note: '柚子香 · 轻酒体 · 低苦度',
    ingredients: '水、小麦芽、大麦芽、啤酒花、柚子',
    glass: 'pint',
    liquid: '#e2a84a',
    garnish: 'yuzu',
    mint: false,
    ice: false,
    bubbles: false,
    foam: true,
    body: 'beer',
  },
  {
    id: 'hearth',
    name: '慢火波特',
    english: 'HEARTH PORTER',
    kind: 'beer',
    price: 44,
    volumeMl: 330,
    abv: 5.2,
    sweetness: 1,
    flavors: ['麦香', '木质'],
    note: '可可香 · 轻烘烤 · 顺口',
    ingredients: '水、大麦芽、烘烤麦芽、啤酒花',
    glass: 'pint',
    liquid: '#3e2418',
    garnish: 'none',
    mint: false,
    ice: false,
    bubbles: false,
    foam: true,
    body: 'stout',
  },
]

export const drinkById: Record<string, BarDrink> = Object.fromEntries(
  barDrinks.map((drink) => [drink.id, drink]),
)

export type SweetnessFilter = 'any' | '0' | '1' | '2' | '3'
export type FlavorFilter = 'any' | '柑橘' | '果香' | '木质' | '清爽' | '麦香'
export type AlcoholFilter = 'any' | 'none' | 'low' | 'high'
export type CategoryFilter = 'all' | 'cocktail' | 'beer'

export type BarFilters = {
  sweetness: SweetnessFilter
  flavor: FlavorFilter
  alcohol: AlcoholFilter
  category: CategoryFilter
}

export const defaultFilters: BarFilters = {
  sweetness: 'any',
  flavor: 'any',
  alcohol: 'any',
  category: 'all',
}

export const sweetnessChoices: { value: SweetnessFilter; label: string }[] = [
  { value: 'any', label: '不限' },
  { value: '0', label: sweetnessLabels[0] },
  { value: '1', label: sweetnessLabels[1] },
  { value: '2', label: sweetnessLabels[2] },
  { value: '3', label: sweetnessLabels[3] },
]

export const flavorChoices: { value: FlavorFilter; label: string }[] = [
  { value: 'any', label: '不限' },
  { value: '柑橘', label: '柑橘' },
  { value: '果香', label: '果香' },
  { value: '木质', label: '木质' },
  { value: '清爽', label: '清爽' },
  { value: '麦香', label: '麦香' },
]

export const alcoholChoices: { value: AlcoholFilter; label: string }[] = [
  { value: 'any', label: '不限' },
  { value: 'none', label: '无酒精' },
  { value: 'low', label: '低度' },
  { value: 'high', label: '高度' },
]

export const categoryChoices: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'cocktail', label: '鸡尾酒' },
  { value: 'beer', label: '精酿' },
]

export const alcoholHint: Record<AlcoholFilter, string> = {
  any: '不限酒精度',
  none: '只看酒精度 0.0%',
  low: '低度指高于 0、低于 10%',
  high: '高度指 10% 及以上',
}

export function formatAbv(abv: number) {
  if (abv === 0) return '0.0%'
  return Number.isInteger(abv) ? `${abv}%` : `${abv}%`
}

export function formatVolume(drink: BarDrink) {
  return `${drink.volumeMl} ml`
}

export type Constraint = { budget?: number; avoids: string[] }

export function parseConstraint(text: string): Constraint {
  const budget = text.match(/(\d+(?:\.\d+)?)\s*元/)
  const avoids = [...text.matchAll(/(?:不要|不加|忌口)\s*([^，。；、\s]+)/g)].map(
    (match) => match[1],
  )
  return { budget: budget ? Number(budget[1]) : undefined, avoids }
}

export function filtersFromText(text: string, current: BarFilters): BarFilters {
  const next: BarFilters = { ...current }
  if (/无酒精|零酒精|开车|不喝酒/.test(text)) next.alcohol = 'none'
  else if (/高度|烈酒|威士忌/.test(text)) next.alcohol = 'high'
  else if (/低度/.test(text)) next.alcohol = 'low'
  if (/不甜|不要甜|微苦/.test(text)) next.sweetness = '0'
  else if (/偏甜|甜口|很甜/.test(text)) next.sweetness = '3'
  else if (/微甜/.test(text)) next.sweetness = '1'
  if (/精酿|啤酒/.test(text)) next.category = 'beer'
  else if (/鸡尾酒/.test(text)) next.category = 'cocktail'
  if (/木质|威士忌|橙皮/.test(text)) next.flavor = '木质'
  else if (/麦香|小麦|波特/.test(text)) next.flavor = '麦香'
  else if (/莓|果香/.test(text)) next.flavor = '果香'
  else if (/柑橘|青柠|柚子|柠檬/.test(text)) next.flavor = '柑橘'
  else if (/清爽/.test(text)) next.flavor = '清爽'
  return next
}

export function matchesDrink(drink: BarDrink, filters: BarFilters, constraint: Constraint) {
  if (filters.category !== 'all' && drink.kind !== filters.category) return false
  if (filters.sweetness !== 'any' && drink.sweetness !== Number(filters.sweetness)) return false
  if (filters.flavor !== 'any' && !drink.flavors.includes(filters.flavor)) return false
  if (filters.alcohol === 'none' && drink.abv !== 0) return false
  if (filters.alcohol === 'low' && !(drink.abv > 0 && drink.abv < 10)) return false
  if (filters.alcohol === 'high' && drink.abv < 10) return false
  if (constraint.budget !== undefined && drink.price > constraint.budget) return false
  if (constraint.avoids.some((word) => word && drink.ingredients.includes(word))) return false
  return true
}

export type Recommendation = {
  drink: BarDrink
  reason: string
  usual: boolean
  quantity: number
}

export type Advice = {
  answer: string
  recommendations: Recommendation[]
  usualBlocked: boolean
  showEvidence: boolean
}

const OPENING = ['lime', 'wheat', 'old']

function sameFilters(filters: BarFilters) {
  return (
    filters.sweetness === 'any' &&
    filters.flavor === 'any' &&
    filters.alcohol === 'any' &&
    filters.category === 'all'
  )
}

function reasonFor(drink: BarDrink, filters: BarFilters, constraint: Constraint) {
  const bits: string[] = []
  if (filters.alcohol === 'none') bits.push('酒精度 0.0%')
  else if (filters.alcohol === 'low') bits.push(`酒精度 ${formatAbv(drink.abv)}，低于 10%`)
  else if (filters.alcohol === 'high') bits.push(`酒精度 ${formatAbv(drink.abv)}，10% 及以上`)
  if (filters.sweetness !== 'any') bits.push(sweetnessLabels[drink.sweetness] || '')
  if (filters.flavor !== 'any') bits.push(filters.flavor)
  if (filters.category === 'beer') bits.push('精酿')
  if (filters.category === 'cocktail') bits.push('鸡尾酒')
  if (constraint.budget !== undefined) bits.push(`不超过 ${constraint.budget} 元`)
  const because = bits.filter(Boolean).join('、')
  const fit = because ? `对得上你要的${because}。` : ''
  return `${drink.note}。${fit}${formatVolume(drink)} · ${formatAbv(drink.abv)} vol · ¥${drink.price}。`
}

function plain(
  drinks: BarDrink[],
  filters: BarFilters,
  constraint: Constraint,
  prefix = '',
): Recommendation[] {
  return drinks.slice(0, 3).map((drink) => ({
    drink,
    usual: false,
    quantity: 1,
    reason: `${prefix}${reasonFor(drink, filters, constraint)}`,
  }))
}

/** 本机规则。对照酒单字段和已完成订单推测，不调用模型，也不会写成已完成订单。 */
export function advise(options: {
  text: string
  filters: BarFilters
  usual: UsualInference
  submitted: boolean
}): Advice {
  const text = options.text.trim()
  const wantsUsual = options.submitted && /老样子/.test(text)
  const constraint = options.submitted ? parseConstraint(text) : { avoids: [] }
  const pool = barDrinks.filter((drink) => matchesDrink(drink, options.filters, constraint))
  const usualDrink = barDrinks.find((drink) => drink.id === options.usual.drink_id)
  const usualReady = options.usual.status === 'ready' && !!options.usual.drink_id
  const usualFits = !!usualDrink && pool.some((drink) => drink.id === usualDrink.id)
  const usualBlocked = wantsUsual && usualReady && !!usualDrink && !usualFits
  const missingUsual = wantsUsual && options.usual.status === 'ready' && !usualDrink

  if (!options.submitted) {
    const opening = OPENING.map((id) => drinkById[id]).filter((drink) =>
      matchesDrink(drink, options.filters, { avoids: [] }),
    )
    const list = sameFilters(options.filters)
      ? opening
      : [
          ...opening,
          ...pool.filter((drink) => !opening.some((item) => item.id === drink.id)),
        ].slice(0, 3)
    return {
      answer: list.length
        ? sameFilters(options.filters)
          ? '纸条还空着。先看着这几杯，写下心情或点一个说法，会按酒单把范围收窄。'
          : '按现在的筛选，先留下这几杯。'
        : '按现在的甜度、风味、酒精度和分类，没有同时符合的酒。放宽一项再看看。',
      recommendations: (list.length ? list : []).map((drink) => ({
        drink,
        usual: false,
        quantity: 1,
        reason: sameFilters(options.filters)
          ? `${drink.note}。今晚先摆上的心头好，还没按你的话收窄。${formatVolume(drink)} · ${formatAbv(drink.abv)} vol · ¥${drink.price}。`
          : reasonFor(drink, options.filters, { avoids: [] }),
      })),
      usualBlocked: false,
      showEvidence: false,
    }
  }

  if (wantsUsual && options.usual.status === 'insufficient') {
    return {
      answer: '近期已完成订单还不足以判断老样子，今晚想喝什么口味？',
      recommendations: plain(pool, options.filters, constraint, '先不猜老样子。'),
      usualBlocked: false,
      showEvidence: true,
    }
  }
  if (wantsUsual && options.usual.status === 'ambiguous') {
    return {
      answer: '你最近的口味比较分散，暂时不能确定老样子。今晚更想喝哪一杯？',
      recommendations: plain(pool, options.filters, constraint, '不算老样子，只是符合当前筛选。'),
      usualBlocked: false,
      showEvidence: true,
    }
  }
  if (missingUsual) {
    return {
      answer: '从历史订单推测的老样子已下架，今晚重新选一杯吧。',
      recommendations: plain(pool, options.filters, constraint),
      usualBlocked: false,
      showEvidence: true,
    }
  }
  if (usualBlocked) {
    return {
      answer: '从历史订单推测的老样子不符合本次口味或预算要求，今晚重新选一杯吧。',
      recommendations: plain(pool, options.filters, constraint, '不是老样子。'),
      usualBlocked: true,
      showEvidence: true,
    }
  }
  if (wantsUsual && usualFits && usualDrink) {
    const quantity = options.usual.quantity || 1
    const sentence = `最近${options.usual.order_count}笔已完成订单中点了${options.usual.occurrences}次，通常${quantity}杯。`
    const others = pool.filter((drink) => drink.id !== usualDrink.id).slice(0, 2)
    return {
      answer: `${sentence}我猜你想喝${usualDrink.name}，这次也来这杯吗？`,
      recommendations: [
        {
          drink: usualDrink,
          usual: true,
          quantity,
          reason: `${sentence}这是演示历史里的推测，确认后才放进今晚的单，不会变成已完成订单。`,
        },
        ...others.map((drink) => ({
          drink,
          usual: false,
          quantity: 1,
          reason: `如果想换一换：${reasonFor(drink, options.filters, constraint)}`,
        })),
      ],
      usualBlocked: false,
      showEvidence: true,
    }
  }

  const noBeerZero =
    options.filters.category === 'beer' && options.filters.alcohol === 'none' && pool.length === 0
  return {
    answer: noBeerZero
      ? '这份精酿酒单暂时没有 0.0% 的酒款。可以把分类改成鸡尾酒，看看无酒精的几杯。'
      : pool.length
        ? `按你写下的口味留了${Math.min(pool.length, 3)}杯，理由在每张纸条上。`
        : '按现在的甜度、风味、酒精度和分类，没有同时符合的酒。放宽一项筛选再看看。',
    recommendations: plain(pool, options.filters, constraint),
    usualBlocked: false,
    showEvidence: false,
  }
}
