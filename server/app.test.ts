import { request as httpRequest, createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createStore } from './api.ts'
import { createApp } from './app.ts'

// Hostile addresses that crashed the first version of the production server. fetch() would tidy
// them up before sending, so these go out raw.
let server: Server
let port = 0

beforeAll(async () => {
  server = createServer(createApp(createStore()))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(() => server.close())

const rawGet = (path: string) =>
  new Promise<number>((resolve, reject) => {
    const req = httpRequest({ host: 'localhost', port, path, method: 'GET' }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })

describe('the production server', () => {
  it.each(['/%', '/%E0%A4%A', '//', '//evil.example/x', '/api/%', '/api//sets'])('survives GET %s', async (path) => {
    const status = await rawGet(path)
    expect(status).toBeGreaterThanOrEqual(200)
    // Still up and answering afterwards.
    expect(await rawGet('/api/sets/4K2P9')).toBe(200)
  })

  it('never serves files from outside the built site', async () => {
    for (const path of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/..\\..\\package.json']) {
      const res = await fetch(`http://localhost:${port}${path}`)
      expect(await res.text()).not.toContain('"devDependencies"')
    }
  })
})
