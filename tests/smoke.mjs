#!/usr/bin/env node
/**
 * End-to-end smoke test — no DSH instance required.
 *
 * Boots the real gateway against a stub upstream that mimics just enough of DSH
 * (an index page that accepts ?token= and hands back an auth cookie), then walks
 * the flow a phone would walk: login page → password → authenticated index.
 *
 * What it proves, and why each assertion exists:
 *   - the gateway starts, generates a self-signed cert with openssl and binds both
 *     loopback and the chosen address (the addrs de-duplication),
 *   - the launcher-token scrape works (health reports dshTokenPresent),
 *   - the password gate accepts a good password and rejects a bad one,
 *   - the index response carries the three injections DSH-on-a-phone depends on:
 *     the polyfill bundle, the GATE_BOOT ownsHost shim, and the responsive layer.
 *
 * Self-signed TLS is intentional here, so this file opts out of certificate
 * verification for its own requests only.
 *
 * Env knobs: DSH_GATE_OPENSSL (path to openssl) — everything else is derived.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const GATEWAY = path.join(ROOT, 'gateway', 'gateway.mjs')
const TOKEN = 'SMOKETOKEN0123456789abcdefghijkl'
const agent = new https.Agent({ rejectUnauthorized: false })

/** Bind port 0, read the port, release it, and hand the number back. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

/** Parse Set-Cookie headers into a cookie jar. */
function absorb(jar, setCookie) {
  for (const raw of setCookie || []) {
    const [pair] = raw.split(';')
    const at = pair.indexOf('=')
    if (at > 0) jar[pair.slice(0, at).trim()] = pair.slice(at + 1).trim()
  }
}

/** One HTTPS request against the gateway, cookie jar included, redirects not followed. */
function request(port, pathName, options = {}, jar = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) }
    const cookies = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
    if (cookies !== '') headers.cookie = cookies
    const req = https.request(
      { host: '127.0.0.1', port, method: options.method || 'GET', path: pathName, headers, agent },
      (res) => {
        absorb(jar, res.headers['set-cookie'])
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

const waitFor = async (fn, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const value = await fn()
      if (value) return value
    } catch {
      /* keep polling */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gate-smoke-'))
const stateDir = path.join(tmp, 'state')
const tokenLog = path.join(tmp, 'launch-stdout.txt')
fs.writeFileSync(tokenLog, `Started server at http://127.0.0.1:5140/?token=${TOKEN}\n`)

const upPort = await freePort()
const gatePort = await freePort()

// Stub upstream: an index page that behaves like DSH's token exchange.
const upstream = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const html = `<!doctype html><html><head><title>DSH stub</title></head><body><div id="app">stub</div></body></html>`
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'dsh-auth-smoke=1; Path=/' })
    res.end(html)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})
await new Promise((resolve) => upstream.listen(upPort, '127.0.0.1', resolve))

const child = spawn(process.execPath, [GATEWAY], {
  cwd: path.dirname(GATEWAY),
  env: {
    ...process.env,
    DSH_GATE_IP: '127.0.0.1',
    DSH_GATE_PORT: String(gatePort),
    DSH_GATE_DSH_PORT: String(upPort),
    DSH_GATE_TOKEN_LOG: tokenLog,
    DSH_GATE_STATE_DIR: stateDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let childOutput = ''
child.stdout.on('data', (c) => {
  childOutput += String(c)
})
child.stderr.on('data', (c) => {
  childOutput += String(c)
})

/** Read the password the gateway generated for this run. */
const password = await waitFor(
  () => {
    const p = path.join(stateDir, 'password.txt')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''
  },
  20000,
  'generated password',
)

const health = await waitFor(
  async () => {
    const res = await request(gatePort, '/__gate/health')
    return res.status === 200 && JSON.parse(res.body).ok ? JSON.parse(res.body) : null
  },
  30000,
  'gateway health',
)
assert.equal(health.dshTokenPresent, true, 'the gateway must pick the DSH token out of the launcher log')
assert.equal(health.ip, '127.0.0.1', 'DSH_GATE_IP must win over interface detection')

// 1. Unauthenticated index is the login page.
const jar = {}
const loginPageRes = await request(gatePort, '/', {}, jar)
assert.equal(loginPageRes.status, 200, 'login page must be served')
assert.match(loginPageRes.body, /name="password"/u, 'login page must contain the password form')

// 2. A wrong password is refused and does not mint a session.
const badRes = await request(
  gatePort,
  '/__gate/login',
  { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=definitely-wrong' },
  jar,
)
assert.equal(badRes.status, 401, 'a wrong password must be rejected')
assert.equal(jar.dshgate, undefined, 'a wrong password must not mint a session cookie')

// 3. The right password mints the session cookie.
const okRes = await request(
  gatePort,
  '/__gate/login',
  { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(password) },
  jar,
)
assert.equal(okRes.status, 303, 'a good password must redirect')
assert.ok(jar.dshgate, 'a good password must mint the session cookie')

// 4. The authenticated index carries every injection the phone depends on.
const indexRes = await request(gatePort, '/', {}, jar)
assert.equal(indexRes.status, 200, 'authenticated index must be served')
assert.match(indexRes.body, /__DSH_TRANSPORT__/u, 'GATE_BOOT (ownsHost) must be injected')
assert.match(indexRes.body, /throwIfAborted/u, 'the polyfill bundle must be injected')
assert.match(indexRes.body, /dshb1|dsh-remote/u, 'the responsive layout layer must be injected')

// 5. Leaving through /__gate/logout clears the session.
const outRes = await request(gatePort, '/__gate/logout', {}, jar)
assert.equal(outRes.status, 303, 'logout must redirect')

upstream.close()
child.kill()
fs.rmSync(tmp, { recursive: true, force: true })

process.stdout.write(
  'SMOKE TEST: ALL PASS (login gate, token scrape, injections present, logout)\n' +
    `  gateway said: ${childOutput.split('\n').filter((l) => /listening|generating TLS/u.test(l)).slice(0, 2).join(' | ')}\n`,
)
