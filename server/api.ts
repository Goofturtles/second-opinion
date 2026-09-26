// The Second Opinion API. Two people each submit their answers to the same set of homework
// questions; the server compares them and only ever sends back which question numbers differ.
//
// The rules that keep it from becoming an answer-sharing tool:
//   - no response ever contains anyone's answers, only per-question verdicts
//   - answers lock once submitted, so nobody can change one and re-check to fish for the other's
//   - a set holds exactly two people
//   - sets are deleted 48 hours after they're made
//
// A set may carry its questions' text (practice sets, and sets whose questions were written with
// AI). Questions are public; answers never are.
//
// Runs inside the Vite dev server (vite.config.ts) and in the standalone server (server/app.ts).

import { randomBytes, randomInt } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { compareSets, type Verdict } from '../src/lib/compare.ts'
import { DEMO } from '../src/lib/demo.ts'
import { MAX_ANSWER, MAX_PROMPT, MAX_QUESTIONS, MAX_TITLE } from '../src/lib/limits.ts'

export const TTL_MS = 48 * 60 * 60 * 1000
const MAX_BODY = 32 * 1024
const RATE_LIMIT = 90 // requests per minute per visitor (a tab waiting for a friend uses 15)
const CREATE_LIMIT = 10 // new sets per minute per visitor
const MAX_SETS = 20_000 // live sets at once; beyond this, creating waits for old ones to expire

// No 0/O or 1/I, so a code read out loud or copied by hand survives.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export { DEMO }

type Person = { token: string; answers: string[] }
export type SetRecord = {
  code: string
  title: string
  count: number
  prompts?: string[]
  created: number
  creator: Person
  friend?: Person
}

export type Store = {
  get(code: string): SetRecord | undefined
  put(record: SetRecord): void
  size(): number
}

/** Somewhere sets are copied so they outlive this process (see kv.ts). */
export type Mirror = { records: SetRecord[]; save(record: SetRecord): void }

/** In-memory sets, optionally saved to a JSON file or a mirror so a restart doesn't lose them. */
export function createStore(file?: string, mirror?: Mirror): Store {
  const sets = new Map<string, SetRecord>()
  for (const record of mirror?.records ?? []) {
    if (Date.now() - record.created <= TTL_MS) sets.set(record.code, record)
  }
  if (file) {
    try {
      for (const record of JSON.parse(readFileSync(file, 'utf8')) as SetRecord[]) sets.set(record.code, record)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Could not read saved sets:', error)
    }
  }
  // Saving is best-effort: a failed disk write must never lose a request, because the set in
  // memory is still right. Written to a temporary file then renamed, so a crash mid-write can't
  // leave a half-written file behind.
  const save = () => {
    if (!file) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(`${file}.tmp`, JSON.stringify([...sets.values()]))
      renameSync(`${file}.tmp`, file)
    } catch (error) {
      console.error('Could not save sets:', error)
    }
  }
  // Expired sets go from disk as well as memory: the privacy page promises they're deleted.
  const prune = () => {
    const now = Date.now()
    let removed = false
    for (const [code, record] of sets) {
      if (now - record.created > TTL_MS) {
        sets.delete(code)
        removed = true
      }
    }
    if (removed) save()
  }
  setInterval(prune, 60 * 60 * 1000).unref()
  return {
    get(code) {
      prune()
      return sets.get(code)
    },
    put(record) {
      sets.set(record.code, record)
      save()
      mirror?.save(record)
    },
    size: () => sets.size,
  }
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const newToken = () => randomBytes(16).toString('hex')

function newCode(store: Store) {
  for (;;) {
    let code = ''
    for (let i = 0; i < 5; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    if (code !== DEMO.code && !store.get(code)) return code
  }
}

function cleanAnswers(value: unknown, count?: number) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_QUESTIONS) {
    throw new HttpError(400, `Answers must be a list of 1 to ${MAX_QUESTIONS} entries.`)
  }
  if (count !== undefined && value.length !== count) {
    throw new HttpError(400, `This set has ${count} questions.`)
  }
  const answers = value.map((a) => String(a ?? '').trim().slice(0, MAX_ANSWER))
  if (answers.every((a) => a === '')) throw new HttpError(400, 'Answer at least one question.')
  return answers
}

function cleanPrompts(value: unknown, count: number) {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length !== count) {
    throw new HttpError(400, 'There must be one question for each answer.')
  }
  const prompts = value.map((p) => String(p ?? '').trim().slice(0, MAX_PROMPT))
  return prompts.some(Boolean) ? prompts : undefined
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'Too much data.')
    chunks.push(chunk as Buffer)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'That request was not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'Expected a JSON object.')
  return parsed as Record<string, unknown>
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}

/** What anyone may know about a set: its questions, never its answers. */
function describe(record: SetRecord) {
  return {
    code: record.code,
    title: record.title,
    count: record.count,
    full: Boolean(record.friend),
    demo: false,
    ...(record.prompts ? { prompts: record.prompts } : {}),
  }
}

// Who's asking, for rate limits. Behind a host's proxy every request arrives from the proxy, so
// TRUST_PROXY=1 reads the forwarding header instead, and takes its LAST entry: hosts append the
// address they actually saw, while anything to its left was written by the visitor and can be
// faked to dodge the limits. CLIENT_IP_HEADER names a host's own header (e.g. cf-connecting-ip)
// when it has one. IPv6 addresses are grouped by /64, the block one household or phone gets.
function visitor(req: IncomingMessage) {
  const header = (name: string) => {
    const value = req.headers[name]
    return Array.isArray(value) ? value.join(',') : value
  }
  let address = req.socket.remoteAddress ?? 'unknown'
  if (process.env.CLIENT_IP_HEADER) address = header(process.env.CLIENT_IP_HEADER.toLowerCase())?.trim() || address
  else if (process.env.TRUST_PROXY) {
    const hops = (header('x-forwarded-for') ?? '').split(',').map((hop) => hop.trim()).filter(Boolean)
    address = hops[hops.length - 1] ?? address
  }
  return address.includes(':') ? address.split(':').slice(0, 4).join(':') : address
}

// The site can be served from somewhere other than the API (GitHub Pages, with the API on a
// Node host). ALLOWED_ORIGINS lists the sites allowed to call it from a browser.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)

function allowOrigin(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
}

function createLimiter(perMinute: number) {
  const hits = new Map<string, { count: number; windowStart: number }>()
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits) if (now - entry.windowStart > 60_000) hits.delete(key)
  }, 60_000).unref()
  return (key: string) => {
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || now - entry.windowStart > 60_000) {
      hits.set(key, { count: 1, windowStart: now })
      return false
    }
    entry.count += 1
    return entry.count > perMinute
  }
}

export function createApi(store: Store, limits = { requestsPerMinute: RATE_LIMIT, createsPerMinute: CREATE_LIMIT }) {
  const limitRequests = createLimiter(limits.requestsPerMinute)
  const limitCreates = createLimiter(limits.createsPerMinute)

  async function route(req: IncomingMessage, path: string, query: URLSearchParams, who: string) {
    const parts = path.split('/').filter(Boolean) // ['sets', code?, action?]
    if (parts[0] !== 'sets') throw new HttpError(404, 'Not found.')
    const code = parts[1]?.toUpperCase()

    // Make a set: the creator's answers (and, optionally, the questions' text) go in with it.
    if (req.method === 'POST' && parts.length === 1) {
      if (limitCreates(who)) throw new HttpError(429, 'That’s a lot of sets. Wait a minute and try again.')
      if (store.size() >= MAX_SETS) throw new HttpError(503, 'Second Opinion is very busy. Try again later.')
      const body = await readJson(req)
      const answers = cleanAnswers(body.answers)
      const prompts = cleanPrompts(body.prompts, answers.length)
      const title = String(body.title ?? '').trim().slice(0, MAX_TITLE) || 'Homework'
      const record: SetRecord = {
        code: newCode(store),
        title,
        count: answers.length,
        ...(prompts ? { prompts } : {}),
        created: Date.now(),
        creator: { token: newToken(), answers },
      }
      store.put(record)
      return [201, { ...describe(record), token: record.creator.token }] as const
    }

    if (!code) throw new HttpError(404, 'Not found.')
    const isDemo = code === DEMO.code
    const record = isDemo ? undefined : store.get(code)
    if (!isDemo && !record) throw new HttpError(404, 'No set with that code. Codes last 48 hours.')

    // Look a set up before joining it.
    if (req.method === 'GET' && parts.length === 2) {
      if (isDemo) {
        const { code, title, friendName, prompts } = DEMO
        return [200, { code, title, count: prompts.length, full: false, demo: true, friendName, prompts }] as const
      }
      return [200, describe(record!)] as const
    }

    // The friend joins with their answers and gets the comparison straight away. Checking for a
    // friend and taking the slot happen with no await in between, so two joins can't both win.
    if (req.method === 'POST' && parts[2] === 'join') {
      const body = await readJson(req)
      if (isDemo) {
        const answers = cleanAnswers(body.answers, DEMO.answers.length)
        return [200, { token: null, verdicts: compareSets(answers, DEMO.answers) }] as const
      }
      if (record!.friend) throw new HttpError(409, 'This set already has two people.')
      const answers = cleanAnswers(body.answers, record!.count)
      record!.friend = { token: newToken(), answers }
      store.put(record!)
      return [200, { token: record!.friend.token, verdicts: compareSets(record!.creator.answers, answers) }] as const
    }

    // Either person checks for the result later with their own token.
    if (req.method === 'GET' && parts[2] === 'result') {
      const token = query.get('token')
      if (isDemo || !token || (token !== record!.creator.token && token !== record!.friend?.token)) {
        throw new HttpError(403, 'That link is not for this set.')
      }
      if (!record!.friend) return [200, { ...describe(record!), ready: false }] as const
      const verdicts: Verdict[] = compareSets(record!.creator.answers, record!.friend.answers)
      return [200, { ...describe(record!), ready: true, verdicts }] as const
    }

    throw new HttpError(404, 'Not found.')
  }

  /** Connect-style middleware: handles /api/..., passes everything else on. Never throws. */
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return send(res, 400, { error: 'Bad address.' })
    }
    const at = url.pathname.indexOf('/api/')
    if (at === -1) return next ? next() : send(res, 404, { error: 'Not found.' })
    allowOrigin(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600' })
      return res.end()
    }
    const who = visitor(req)
    if (limitRequests(who)) return send(res, 429, { error: 'Slow down a little.' })
    try {
      const [status, body] = await route(req, url.pathname.slice(at + 4), url.searchParams, who)
      send(res, status, body)
    } catch (error) {
      if (error instanceof HttpError) send(res, error.status, { error: error.message })
      else {
        console.error(error)
        if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' })
      }
    }
  }
}
