// The production request handler: the built site from dist/ plus the API. Kept apart from
// index.ts (which only listens) so tests can throw hostile requests at it.

import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi, type Store } from './api.ts'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

function fail(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) return res.destroy()
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(message)
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  let path: string
  try {
    path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, '')
  } catch {
    return fail(res, 400, 'Bad address.') // "/%" and friends: malformed, not a crash
  }
  let file = join(DIST, path)
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  const stream = createReadStream(file)
  stream.on('error', () => fail(res, 404, 'Not found.')) // e.g. deleted mid-request by a rebuild
  stream.once('open', () => {
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      // Built assets have content hashes in their names, so they never change under one URL.
      'Cache-Control': file.includes(`${join(DIST, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    stream.pipe(res)
  })
}

export function createApp(store: Store) {
  const api = createApi(store)
  return (req: IncomingMessage, res: ServerResponse) => {
    api(req, res, () => serveStatic(req, res)).catch((error) => {
      console.error(error)
      fail(res, 500, 'Something went wrong.')
    })
  }
}
