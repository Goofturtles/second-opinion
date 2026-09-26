import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEMO, TTL_MS, createApi, createStore } from './api.ts'

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer(createApi(createStore(), { requestsPerMinute: 10_000, createsPerMinute: 10_000 }))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`
})
afterAll(() => server.close())

const call = async (path: string, body?: unknown) => {
  const res = await fetch(base + path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })
  // Responses are checked field by field below, so a loose shape is enough here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

// Answers distinctive enough that finding one in a response can only mean it leaked.
const MINE = ['x = 5', '3/4', '12', '2', 'zebra-mine']
const THEIRS = ['5', '0.75', '10', 'quokka-theirs', 'zebra-mine']

describe('a set between two friends', () => {
  let code = ''
  let creatorToken = ''
  let friendToken = ''

  it('is created with the creator’s answers and never echoes them', async () => {
    const { status, body } = await call('/sets', { title: 'Ch. 7', answers: MINE })
    expect(status).toBe(201)
    expect(body).toMatchObject({ title: 'Ch. 7', count: 5, full: false })
    expect(body.code).toMatch(/^[A-Z2-9]{5}$/)
    expect(JSON.stringify(body)).not.toContain('zebra')
    code = body.code
    creatorToken = body.token
  })

  it('can be looked up without revealing answers', async () => {
    const { status, body } = await call(`/sets/${code.toLowerCase()}`)
    expect(status).toBe(200)
    expect(body).toEqual({ code, title: 'Ch. 7', count: 5, full: false, demo: false })
  })

  it('tells the creator to wait until the friend has answered', async () => {
    const { body } = await call(`/sets/${code}/result?token=${creatorToken}`)
    expect(body.ready).toBe(false)
  })

  it('gives the friend only question-level verdicts', async () => {
    const { status, body } = await call(`/sets/${code}/join`, { answers: THEIRS })
    expect(status).toBe(200)
    expect(body.verdicts).toEqual(['agree', 'agree', 'differ', 'differ', 'agree'])
    expect(JSON.stringify(body)).not.toMatch(/zebra|quokka/)
    friendToken = body.token
  })

  it('gives the creator the same verdicts, still without answers', async () => {
    const { body } = await call(`/sets/${code}/result?token=${creatorToken}`)
    expect(body).toMatchObject({ ready: true, verdicts: ['agree', 'agree', 'differ', 'differ', 'agree'] })
    expect(JSON.stringify(body)).not.toMatch(/zebra|quokka/)
  })

  it('lets the friend check again with their own token', async () => {
    const { body } = await call(`/sets/${code}/result?token=${friendToken}`)
    expect(body.ready).toBe(true)
  })

  it('refuses a third person, so answers can’t be probed by joining again', async () => {
    const { status } = await call(`/sets/${code}/join`, { answers: ['1', '2', '3', '4', '5'] })
    expect(status).toBe(409)
  })

  it('refuses a result request without the right token', async () => {
    expect((await call(`/sets/${code}/result?token=nope`)).status).toBe(403)
    expect((await call(`/sets/${code}/result`)).status).toBe(403)
  })
})

describe('the demo set', () => {
  it('shows its questions so it can be tried alone', async () => {
    const { body } = await call(`/sets/${DEMO.code}`)
    expect(body).toMatchObject({ demo: true, count: 6, friendName: 'Maya' })
    expect(body.prompts).toHaveLength(6)
    expect(JSON.stringify(body)).not.toContain('0.75')
  })

  it('compares against the pretend friend, as many times as anyone likes', async () => {
    for (let i = 0; i < 3; i++) {
      const { status, body } = await call(`/sets/${DEMO.code}/join`, { answers: ['5', '3/4', '12', '2', '9', '-24'] })
      expect(status).toBe(200)
      expect(body.verdicts).toEqual(['agree', 'agree', 'differ', 'agree', 'agree', 'differ'])
    }
  })
})

describe('a set with its questions written out', () => {
  it('shares the questions with both people, never the answers', async () => {
    const prompts = ['What is 7 × 8?', 'Capital of France?']
    const made = await call('/sets', { title: 'Practice', answers: ['56', 'otter-answer'], prompts })
    expect(made.body.prompts).toEqual(prompts)
    const looked = await call(`/sets/${made.body.code}`)
    expect(looked.body.prompts).toEqual(prompts)
    const joined = await call(`/sets/${made.body.code}/join`, { answers: ['54', 'Paris'] })
    expect(joined.body.verdicts).toEqual(['differ', 'differ'])
    const result = await call(`/sets/${made.body.code}/result?token=${made.body.token}`)
    expect(result.body.prompts).toEqual(prompts)
    expect(JSON.stringify([made.body, looked.body, joined.body, result.body])).not.toMatch(/otter|Paris|"56"|"54"/)
  })

  it('rejects question lists that don’t line up with the answers', async () => {
    expect((await call('/sets', { answers: ['1', '2'], prompts: ['only one'] })).status).toBe(400)
  })
})

describe('bad input', () => {
  it('answers a JSON null body with 400, not 500', async () => {
    const res = await fetch(base + '/sets', { method: 'POST', body: 'null' })
    expect(res.status).toBe(400)
  })

  it('rejects empty, oversized and mismatched answer lists', async () => {
    expect((await call('/sets', { answers: [] })).status).toBe(400)
    expect((await call('/sets', { answers: ['', ' '] })).status).toBe(400)
    expect((await call('/sets', { answers: Array(41).fill('1') })).status).toBe(400)
    const { body } = await call('/sets', { answers: ['1', '2'] })
    expect((await call(`/sets/${body.code}/join`, { answers: ['1'] })).status).toBe(400)
  })

  it('rejects unknown codes and malformed JSON', async () => {
    expect((await call('/sets/ZZZZZ')).status).toBe(404)
    const res = await fetch(base + '/sets', { method: 'POST', body: '{not json' })
    expect(res.status).toBe(400)
  })
})

describe('rate limiting behind a proxy', () => {
  it('can’t be dodged by writing a fake address into X-Forwarded-For', async () => {
    const { createServer: make } = await import('node:http')
    process.env.TRUST_PROXY = '1'
    const limited = make(createApi(createStore(), { requestsPerMinute: 3, createsPerMinute: 3 }))
    await new Promise<void>((resolve) => limited.listen(0, resolve))
    const url = `http://localhost:${(limited.address() as AddressInfo).port}/api/sets/4K2P9`
    const statuses = []
    for (let i = 0; i < 5; i++) {
      // A visitor rotating a fake address on the left; the proxy appends the real one on the right.
      const res = await fetch(url, { headers: { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` } })
      statuses.push(res.status)
    }
    delete process.env.TRUST_PROXY
    limited.close()
    expect(statuses).toEqual([200, 200, 200, 429, 429])
  })

  it('finds the visitor behind several proxies, and keeps visitors apart', async () => {
    process.env.TRUST_PROXY = '3'
    const limited = createServer(createApi(createStore(), { requestsPerMinute: 2, createsPerMinute: 2 }))
    await new Promise<void>((resolve) => limited.listen(0, resolve))
    const url = `http://localhost:${(limited.address() as AddressInfo).port}/api/sets/4K2P9`
    // Each proxy appends who it heard from: the CDN edge writes the visitor, then two internal
    // layers write the edge and each other, the same for everyone.
    const as = (visitor: string, fake = '') => fetch(url, { headers: { 'x-forwarded-for': `${fake}${visitor}, 172.70.1.1, 10.0.0.9` } })
    const one = [(await as('203.0.113.7')).status, (await as('203.0.113.7', '1.1.1.1, ')).status, (await as('203.0.113.7', '2.2.2.2, ')).status]
    const other = (await as('198.51.100.4')).status
    delete process.env.TRUST_PROXY
    limited.close()
    expect(one).toEqual([200, 200, 429])
    expect(other).toBe(200)
  })
})

describe('a store with a mirror', () => {
  it('loads the mirror’s live sets on start, skips expired ones, and copies every change', () => {
    const now = Date.now()
    const record = (code: string, created: number) => ({ code, title: 't', count: 1, created, creator: { token: 'x', answers: ['1'] } })
    const saved: string[] = []
    const store = createStore(undefined, {
      records: [record('LIVE2', now - 1000), record('OLD22', now - TTL_MS - 1000)],
      save: (r) => saved.push(r.code),
    })
    expect(store.get('LIVE2')?.title).toBe('t')
    expect(store.get('OLD22')).toBeUndefined()
    store.put(record('NEW22', now))
    expect(saved).toEqual(['NEW22'])
  })
})
