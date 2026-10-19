// License rules. Pure: the network call itself lives in register.tsx.
//
// Never put the app's HMAC secret here: a plugin's source is plain text on
// the user's disk. The server alone decides whether a key is good.

import type { Period } from '../types'

/** On: after the shared trial (trial.ts), 5h, 24h, Month and skill edits need a key. */
export const PAYWALL = true

export const ACTIVATE_URL = 'https://fadercraft.com/api/skillkeeper-activate'
export const RECHECK_MS = 7 * 86_400_000

// Order number and 16 hex – the server alone checks the rest (2026-10-05).
const KEY = /^SKKP-[0-9]+-[0-9a-fA-F]{16}$/

export function isKeyShaped(key: string): boolean {
  return KEY.test(key.trim())
}

/** A Pro feature is open while the paywall is off or the key is good. */
export function isProOpen(isPro: boolean): boolean {
  return !PAYWALL || isPro
}

/** The server's reason for refusing a key, for the person to read. */
export function activationError(text: string): string | undefined {
  try {
    const error = (JSON.parse(text) as { error?: unknown }).error
    return typeof error === 'string' ? error : undefined
  } catch {
    return undefined
  }
}

export function isPeriodOpen(period: Period, isPro: boolean): boolean {
  if (!PAYWALL || isPro) return true
  // Only Week stays free (owner, 2026-10-19; 24h was free from 2026-10-15); 5h, 24h and Month need a license.
  return period === 'week'
}

/** What the store keeps about a key: its hash and the last verdict, never the key. */
export type StoredLicense = { hash: string; isPro: boolean; checkedAt: number; expiresAt?: number }

export function needsRecheck(stored: StoredLicense | undefined, hash: string, now: number): boolean {
  return (
    stored === undefined ||
    stored.hash !== hash ||
    now - stored.checkedAt >= RECHECK_MS ||
    isExpired(stored.expiresAt, now)
  )
}

/** A gift key's end date (ms) from the activation answer; undefined for a paid key. */
export function parseExpiry(text: string): number | undefined {
  try {
    const at = (JSON.parse(text) as { expires_at?: unknown }).expires_at
    const ms = typeof at === 'string' ? Date.parse(at) : NaN
    return Number.isNaN(ms) ? undefined : ms
  } catch {
    return undefined
  }
}

export function isExpired(expiresAt: number | undefined, now: number): boolean {
  return expiresAt !== undefined && now >= expiresAt
}

/** The verdict from the activation answer: 200 with `ok: true` is Pro. */
export function isActivated(status: number, text: string): boolean {
  if (status !== 200) return false
  try {
    return (JSON.parse(text) as { ok?: unknown }).ok === true
  } catch {
    return false
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function newDeviceId(): string {
  return `cc-${crypto.randomUUID()}`
}
