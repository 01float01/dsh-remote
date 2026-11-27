#!/usr/bin/env node
/**
 * Repository self-check.
 *
 * Guards the things that must never reach a public repository for this project:
 * a committed TLS key, a password file, a logged access token, a real private IP
 * address in the docs, or a path from the author's machine. It also checks that
 * the files the gateway depends on at runtime are present, and that every
 * JavaScript file parses.
 *
 * No dependencies: `node scripts/check.mjs` works in a bare checkout and in CI.
 *
 * Usage: node scripts/check.mjs [--strict]
 *   --strict  treat warnings as failures (CI and prepublish use this)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const STRICT = process.argv.includes('--strict')

const SKIP_DIRS = new Set(['node_modules', '.git', 'state', '__pycache__', '.venv', 'venv'])
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.pdf'])

const problems = []
const warnings = []
const fail = (check, message) => problems.push(`[${check}] ${message}`)
const warn = (check, message) => warnings.push(`[${check}] ${message}`)

/** Walk the tree, returning repository-relative POSIX paths. */
function walk(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.git')) continue
      found.push(...walk(full))
      continue
    }
    if (entry.isFile()) found.push(relative(ROOT, full).split('\\').join('/'))
  }
  return found
}

const files = walk(ROOT)

// 1. Nothing secret may be tracked at all.
for (const file of files) {
  const base = file.split('/').pop()
  if (/\.(pem|key)$/iu.test(base)) fail('secret', `key material would be committed: ${file}`)
  if (base === 'password.txt' || base === 'auth.json') fail('secret', `runtime credential would be committed: ${file}`)
  if (/^t_cookies\.txt$|\.log$/iu.test(base)) fail('artifact', `probe/log artifact would be committed: ${file}`)
  if (/\.bak($|-)/u.test(base)) fail('artifact', `backup file would be committed: ${file}`)
}
if (existsSync(join(ROOT, 'gateway', 'state'))) {
  process.stdout.write('note  gateway/state exists locally (git-ignored); no action needed\n')
}

// 2. Text scans. Docs must be free of real addresses; code may legitimately mention
//    private ranges inside patterns, so those only warn.
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u
const PRIVATE_IP = /\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/u
const AUTHOR_PATH = /[A-Za-z]:[\\/](?:Deepseek[_-][Hh]arness|Dev[\\/]node)/iu
/** Any drive-rooted path is machine-specific once it lands in prose. */
const DRIVE_PATH = /[A-Za-z]:[\\/][A-Za-z0-9_.-]/gu
const TOKEN_LEAK = /\btoken=[A-Za-z0-9_-]{20,}/u

for (const file of files) {
  if (BINARY_EXT.has(extname(file).toLowerCase())) continue
  if (file === 'scripts/check.mjs') continue
  let text
  try {
    text = readFileSync(join(ROOT, file), 'utf8')
  } catch {
    continue
  }
  if (PEM.test(text)) fail('secret', `private key material in ${file}`)
  if (AUTHOR_PATH.test(text)) fail('path', `authoring-machine path in ${file}`)
  if (TOKEN_LEAK.test(text) && !/TOKEN\s*=\s*'SMOKETOKEN/u.test(text)) fail('secret', `access token literal in ${file}`)
  const ip = text.match(PRIVATE_IP)
  if (ip !== null) {
    const isDoc = /\.(md|txt)$/iu.test(file) || file === 'README.md'
    // Loopback, the Android emulator alias, and mock addresses inside tests/ are fine:
    // a fixture that proves the virtual-NIC filter has to contain a virtual NIC address.
    const allowed = ip[0] === '127.0.0.1' || ip[0] === '10.0.2.2' || file.startsWith('tests/')
    if (!allowed) {
      if (isDoc) fail('evidence', `real private address "${ip[0]}" in ${file} — redact it`)
      else warn('code', `private address "${ip[0]}" in ${file}`)
    }
  }
  // Prose is public: a drive-rooted path from the authoring machine does not belong in it.
  // Documented placeholders such as `C:\path\to\...` are allowed on purpose.
  if (/\.(md|txt)$/iu.test(file)) {
    for (const match of text.matchAll(DRIVE_PATH)) {
      const around = text.slice(match.index, match.index + 24)
      if (/^[A-Za-z]:[\\/](?:path|to|<)/iu.test(around)) continue
      fail('path', `machine path "${around.split(/\s/u)[0]}" in ${file}`)
    }
  }
}

// 3. JSON validity.
for (const file of files) {
  if (extname(file).toLowerCase() !== '.json') continue
  try {
    JSON.parse(readFileSync(join(ROOT, file), 'utf8'))
  } catch (error) {
    fail('json', `${file}: ${error.message}`)
  }
}

// 4. JavaScript syntax, checked by the interpreter already running this script.
for (const file of files) {
  if (!['.js', '.mjs'].includes(extname(file).toLowerCase())) continue
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, file)], { stdio: 'pipe' })
  } catch (error) {
    fail('js', `${file}: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
  }
}

// 5. Files the gateway reads at runtime must exist where it looks for them.
for (const required of ['gateway/gateway.mjs', 'gateway/polyfill.js', 'gateway/vendor/qrcode.js', 'ui/responsive.css', 'ui/responsive.js']) {
  if (!existsSync(join(ROOT, required))) fail('layout', `missing runtime file: ${required}`)
}

// 6. The gateway must not carry an absolute default for its own directories.
const gateway = readFileSync(join(ROOT, 'gateway', 'gateway.mjs'), 'utf8')
if (!gateway.includes('path.join(__dirname, "..", "ui")')) {
  fail('layout', 'gateway.mjs must resolve the responsive layer relative to the repository')
}
if (/tokenLog:\s*"[A-Za-z]:/u.test(gateway)) fail('layout', 'gateway.mjs must not ship a machine-specific token log default')

for (const line of warnings) process.stdout.write(`warn  ${line}\n`)
for (const line of problems) process.stdout.write(`error ${line}\n`)
const failed = problems.length > 0 || (STRICT && warnings.length > 0)
process.stdout.write(
  `\n${failed ? 'FAILED' : 'OK'}: ${problems.length} error(s), ${warnings.length} warning(s) across ${files.length} files\n`,
)
process.exit(failed ? 1 : 0)
