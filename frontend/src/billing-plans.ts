import type { BillingPlan } from './api'

export const PREMIUM_PRICING: Record<
  BillingPlan,
  { amount: string; period: string; accountLabel: string }
> = {
  monthly: { amount: 'MX$69', period: 'al mes', accountLabel: 'MX$69/mes' },
  yearly: { amount: 'MX$690', period: 'al año', accountLabel: 'MX$690' },
}

export const PREMIUM_YEARLY_EQUIVALENT = 'MX$57.50 al mes'
export const PREMIUM_YEARLY_SAVINGS = 'MX$138'
export const PREMIUM_STORAGE = '10 GB'
export const PREMIUM_AUDIO_LIMIT = 500
