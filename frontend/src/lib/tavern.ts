export interface Drink {
  id: string
  name: string
  description: string
  category: string
  price_fen: number
  alcohol_percent: number
  sweetness: number
  tags: string[]
  ingredients: string[]
  allergens: string[]
  private_recipe: string
  available: boolean
  revision: string
}

export const sweetnessLabels = ['不甜', '微甜', '适中', '偏甜', '很甜']
export const money = (fen: number) => `¥${(fen / 100).toFixed(2)}`
