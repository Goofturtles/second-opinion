// Standalone server for hosting: the built site from dist/ plus the API, in one Node process.
//   npm run build && npm start
// Optional: PORT, DATA_FILE (keep sets across restarts), REDIS_URL (the same, for hosts whose disk
// is wiped on restart), TRUST_PROXY=1 (behind a host's proxy), ALLOWED_ORIGINS (a site hosted
// elsewhere). Node 24 runs this TypeScript file directly. Run one process: sets live in its memory.

import { createServer } from 'node:http'
import { TTL_MS, createStore } from './api.ts'
import { createApp } from './app.ts'
import { connectMirror } from './kv.ts'

const PORT = Number(process.env.PORT ?? 3533)
const REDIS_URL = process.env.REDIS_URL

const mirror = REDIS_URL
  ? await connectMirror(REDIS_URL, TTL_MS).catch((error: Error) => {
      console.error(`Key Value unavailable (${error.message}); sets are kept in memory only.`)
      return undefined
    })
  : undefined
if (mirror) console.log(`Loaded ${mirror.records.length} sets from Key Value`)

createServer(createApp(createStore(process.env.DATA_FILE, mirror))).listen(PORT, () =>
  console.log(`Second Opinion on http://localhost:${PORT}`),
)
