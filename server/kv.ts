// Render's free web servers lose their disk every time they sleep (after 15 quiet minutes), so a
// set made tonight could be gone before the friend opens the link. With REDIS_URL set, every set
// is copied to a Key Value (Redis) instance under its own key, which expires when the set does,
// and loaded back in when the server wakes.

import { createClient } from 'redis'
import type { Mirror, SetRecord } from './api.ts'

const PREFIX = 'so:set:'

export async function connectMirror(url: string, ttlMs: number): Promise<Mirror> {
  const client = createClient({ url, socket: { connectTimeout: 10_000 } })
  client.on('error', (error: Error) => console.error('Key Value:', error.message))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Without a deadline a missing store would retry forever and the server would never start.
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timed out connecting')), 15_000))),
    ])
  } catch (error) {
    client.destroy()
    throw error
  } finally {
    clearTimeout(timer)
  }
  const keys = await client.sendCommand<string[]>(['KEYS', `${PREFIX}*`])
  const values = keys.length ? await client.sendCommand<(string | null)[]>(['MGET', ...keys]) : []
  return {
    records: values.flatMap((value) => (value ? [JSON.parse(value) as SetRecord] : [])),
    save(record) {
      // Best-effort, like the file: the set in memory is still right if this fails.
      client
        .sendCommand(['SET', PREFIX + record.code, JSON.stringify(record), 'PXAT', String(record.created + ttlMs)])
        .catch((error: Error) => console.error('Could not copy set to Key Value:', error.message))
    },
  }
}
