import { createReadStream, readFileSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'jbrowse-local',
)
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 3000)
const authDisabled = ['0', 'false', 'off'].includes(
  (process.env.JBROWSE_AUTH ?? '').toLowerCase(),
)
const authRealm = process.env.JBROWSE_AUTH_REALM ?? 'JBrowse'
const authUsername =
  process.env.JBROWSE_USERNAME ?? process.env.JBROWSE_USER ?? 'jbrowse'
const authPassword = loadPassword()
const corsOrigin = process.env.JBROWSE_CORS_ORIGIN
const maxAuthAttempts = Number(process.env.JBROWSE_AUTH_MAX_ATTEMPTS ?? 5)
const authWindowMs = Number(process.env.JBROWSE_AUTH_WINDOW_MS ?? 15 * 60 * 1000)
const authLockoutMs = Number(
  process.env.JBROWSE_AUTH_LOCKOUT_MS ?? 5 * 60 * 1000,
)
const authFailures = new Map()

if (!authDisabled && !authPassword) {
  console.error(
    [
      'Refusing to start without authentication.',
      'Set JBROWSE_PASSWORD or JBROWSE_PASSWORD_FILE before exposing JBrowse.',
      'Generate a strong password with: npm run generate:password',
      'For intentionally local-only testing, set JBROWSE_AUTH=off.',
    ].join('\n'),
  )
  process.exit(1)
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.fa', 'text/plain; charset=utf-8'],
  ['.fai', 'text/plain; charset=utf-8'],
  ['.gff3', 'text/plain; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
])

createServer(async (req, res) => {
  try {
    setSecurityHeaders(res)
    setCorsHeaders(req, res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (!authDisabled && !authenticate(req, res)) {
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' })
      res.end('Method not allowed')
      return
    }

    const pathname = decodeURIComponent(url.pathname)
    const requested = pathname === '/' ? '/index.html' : pathname
    const filePath = path.resolve(root, `.${requested}`)

    if (!isInsideRoot(filePath)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    const fileStat = await stat(filePath)
    const finalPath = fileStat.isDirectory()
      ? path.join(filePath, 'index.html')
      : filePath
    const finalStat = fileStat.isDirectory() ? statSync(finalPath) : fileStat

    res.setHeader(
      'Content-Type',
      contentTypes.get(path.extname(finalPath)) ?? 'application/octet-stream',
    )
    res.setHeader('Accept-Ranges', 'bytes')

    const range = req.headers.range
    if (range) {
      const parsedRange = parseRange(range, finalStat.size)
      if (!parsedRange) {
        res.writeHead(416, { 'Content-Range': `bytes */${finalStat.size}` })
        res.end('Requested range not satisfiable')
        return
      }
      const { start, end } = parsedRange

      res.writeHead(206, {
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${finalStat.size}`,
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(finalPath, { start, end }).pipe(res)
      return
    }

    res.writeHead(200, { 'Content-Length': finalStat.size })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(finalPath).pipe(res)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}).listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}`)
  console.log(
    authDisabled
      ? 'Authentication is disabled.'
      : `Authentication enabled for user "${authUsername}".`,
  )
})

function loadPassword() {
  if (process.env.JBROWSE_PASSWORD_FILE) {
    return readFileSync(process.env.JBROWSE_PASSWORD_FILE, 'utf8').trim()
  }
  return process.env.JBROWSE_PASSWORD
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (process.env.JBROWSE_FRAME_OPTIONS) {
    res.setHeader('X-Frame-Options', process.env.JBROWSE_FRAME_OPTIONS)
  }
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
}

function setCorsHeaders(req, res) {
  if (!corsOrigin || req.headers.origin !== corsOrigin) {
    return
  }

  res.setHeader('Access-Control-Allow-Origin', corsOrigin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range')
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Accept-Ranges, Content-Length, Content-Range',
  )
}

function authenticate(req, res) {
  const address = clientAddress(req)
  const failure = authFailures.get(address)
  const now = Date.now()

  if (failure?.lockedUntil && failure.lockedUntil > now) {
    res.writeHead(429, { 'Retry-After': secondsUntil(failure.lockedUntil) })
    res.end('Too many failed login attempts')
    return false
  }

  const credentials = parseBasicAuth(req.headers.authorization)
  const ok =
    credentials &&
    constantTimeEqual(credentials.username, authUsername) &&
    constantTimeEqual(credentials.password, authPassword)

  if (ok) {
    authFailures.delete(address)
    return true
  }

  recordAuthFailure(address)
  res.writeHead(401, {
    'WWW-Authenticate': `Basic realm="${authRealm}", charset="UTF-8"`,
  })
  res.end('Authentication required')
  return false
}

function parseBasicAuth(header) {
  if (!header?.startsWith('Basic ')) {
    return undefined
  }

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator === -1) {
      return undefined
    }
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    }
  } catch {
    return undefined
  }
}

function constantTimeEqual(actual, expected) {
  const actualHash = createHash('sha256').update(actual).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualHash, expectedHash)
}

function recordAuthFailure(address) {
  const now = Date.now()
  const current = authFailures.get(address)
  const failure =
    current && current.firstFailureAt + authWindowMs > now
      ? current
      : { count: 0, firstFailureAt: now, lockedUntil: 0 }

  failure.count += 1
  if (failure.count >= maxAuthAttempts) {
    failure.lockedUntil = now + authLockoutMs
  }
  authFailures.set(address, failure)
}

function clientAddress(req) {
  return req.socket.remoteAddress ?? 'unknown'
}

function secondsUntil(timestamp) {
  return Math.max(1, Math.ceil((timestamp - Date.now()) / 1000))
}

function isInsideRoot(filePath) {
  const relative = path.relative(root, filePath)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function parseRange(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || size < 1) {
    return undefined
  }

  if (!match[1] && !match[2]) {
    return undefined
  }

  let start
  let end
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return undefined
    }
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return undefined
  }

  return { start, end: Math.min(end, size - 1) }
}
