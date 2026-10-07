/**
 * Static server for the acceptance app: serves the repo root (so the page can
 * import the built runtime through an import map) and falls back to the app's
 * index.html for extensionless paths (history-API routes, direct deep links).
 * `/slow` answers after 300ms (A-8: an in-flight fetch that outlives a page).
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '../../../..')
const index = join(root, 'tests/acceptance/app/index.html')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/slow') {
    await new Promise((r) => setTimeout(r, 300))
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  const ext = extname(url.pathname)
  const file = ext ? join(root, url.pathname) : index
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[ext || '.html'] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(4173, () => console.log('acceptance app on http://localhost:4173'))
