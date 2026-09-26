import type { Verdict } from './compare'

// Relative, so it works wherever the site is served from; VITE_API_URL points it elsewhere when
// the site and the API are hosted separately.
const API = (import.meta.env.VITE_API_URL ?? 'api').replace(/\/$/, '')

export type SetInfo = {
  code: string
  title: string
  count: number
  full: boolean
  demo: boolean
  friendName?: string
  prompts?: string[]
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })
  } catch {
    throw new Error('Could not reach Second Opinion. Check your connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Something went wrong.'), { status: res.status })
  return data as T
}

export const api = {
  create: (title: string, answers: string[], prompts?: string[]) =>
    request<SetInfo & { token: string }>('/sets', { title, answers, ...(prompts ? { prompts } : {}) }),
  info: (code: string) => request<SetInfo>(`/sets/${encodeURIComponent(code)}`),
  join: (code: string, answers: string[]) =>
    request<{ token: string | null; verdicts: Verdict[] }>(`/sets/${encodeURIComponent(code)}/join`, { answers }),
  result: (code: string, token: string) =>
    request<SetInfo & ({ ready: false } | { ready: true; verdicts: Verdict[] })>(
      `/sets/${encodeURIComponent(code)}/result?token=${encodeURIComponent(token)}`,
    ),
}

// What this device remembers about a set: the person's token (to fetch the result again) and
// their own answers (shown back to them next to each question). Never the friend's.
// Storage can be blocked (private windows, strict settings); then it's kept for this visit only.
function remembered<T>(prefix: string) {
  const memory = new Map<string, T>()
  return {
    get(code: string): T | null {
      try {
        const saved = localStorage.getItem(prefix + code)
        if (saved !== null) return JSON.parse(saved) as T
      } catch {
        // blocked: fall back to memory
      }
      return memory.get(code) ?? null
    },
    set(code: string, value: T) {
      memory.set(code, value)
      try {
        localStorage.setItem(prefix + code, JSON.stringify(value))
      } catch {
        // blocked: memory only
      }
    },
  }
}

export const tokens = remembered<string>('so:token:')
export const mine = remembered<string[]>('so:mine:')
