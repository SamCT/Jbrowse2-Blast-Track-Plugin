import { createReadStream, readFileSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
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
const blastDbRoot = path.resolve(
  process.env.BLASTDB_DIR ?? path.join(root, 'data', 'blastDB'),
)
const blastBinDir = process.env.BLAST_BIN_DIR
const blastTimeoutMs = Number(process.env.BLAST_TIMEOUT_MS ?? 15 * 60 * 1000)
const maxBlastQueryBytes = Number(process.env.BLAST_MAX_QUERY_BYTES ?? 5 * 1024 * 1024)
const allHitsMaxTargetSeqs = Number(
  process.env.BLAST_ALL_HITS_MAX_TARGET_SEQS ?? 1_000_000,
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

    if (url.pathname.startsWith('/api/blast/')) {
      await handleBlastApi(req, res, url)
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

async function handleBlastApi(req, res, url) {
  if (url.pathname === '/api/blast/dbs') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' })
      res.end('Method not allowed')
      return
    }
    const program = sanitizeBlastProgram(url.searchParams.get('program') ?? 'blastp')
    if (program !== 'blastp') {
      sendJson(res, { databases: [] }, req.method === 'HEAD')
      return
    }
    const databases = await listBlastDatabases(program)
    sendJson(res, { databases }, req.method === 'HEAD')
    return
  }

  if (url.pathname === '/api/blast/search') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST, OPTIONS' })
      res.end('Method not allowed')
      return
    }
    let request
    try {
      request = await readJsonBody(req)
    } catch (error) {
      res.writeHead(400)
      res.end(errorMessage(error))
      return
    }
    const program = sanitizeBlastProgram(request.program)
    if (program !== 'blastp') {
      res.writeHead(400)
      res.end('Local BLAST databases currently support BLASTP only')
      return
    }
    const query = String(request.query ?? '').trim()
    if (!query) {
      res.writeHead(400)
      res.end('Missing BLAST query')
      return
    }
    if (Buffer.byteLength(query, 'utf8') > maxBlastQueryBytes) {
      res.writeHead(413)
      res.end('BLAST query is too large')
      return
    }

    const database = await resolveBlastDatabase(program, String(request.database ?? ''))
    if (!database) {
      res.writeHead(400)
      res.end('Unknown local BLAST database')
      return
    }

    const allHits = request.allHits === true
    const hitLimit = sanitizePositiveInt(request.hitLimit, 3, 100)
    const hspLimit = sanitizePositiveInt(request.hspLimit, 1, 100)
    let result
    try {
      result = await runLocalBlast({
        allHits,
        database,
        hitLimit,
        hspLimit,
        program,
        query,
      })
    } catch (error) {
      res.writeHead(500)
      res.end(errorMessage(error))
      return
    }
    sendJson(res, result)
    return
  }

  res.writeHead(404)
  res.end('Not found')
}

async function listBlastDatabases(program) {
  const type = program === 'blastn' ? 'nucleotide' : 'protein'
  const candidates = await collectBlastDatabaseFiles(blastDbRoot)
  return [...candidates.values()]
    .filter(database => database.type === type)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name, title, type }) => ({ id, name, title, type }))
}

async function resolveBlastDatabase(program, id) {
  const databases = await collectBlastDatabaseFiles(blastDbRoot)
  const database = databases.get(id)
  if (!database) {
    return undefined
  }
  if (program === 'blastp' && database.type !== 'protein') {
    return undefined
  }
  if (program === 'blastn' && database.type !== 'nucleotide') {
    return undefined
  }
  return database
}

async function collectBlastDatabaseFiles(dir, depth = 3, seen = new Map()) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return seen
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth > 0 && !entry.name.startsWith('.')) {
        await collectBlastDatabaseFiles(fullPath, depth - 1, seen)
      }
      continue
    }
    if (!entry.isFile()) {
      continue
    }

    const parsed = parseBlastDatabaseFile(entry.name)
    if (!parsed) {
      continue
    }
    const basePath = path.join(dir, parsed.baseName)
    const id = path.relative(blastDbRoot, basePath).split(path.sep).join('/')
    if (!seen.has(id)) {
      seen.set(id, {
        id,
        name: parsed.baseName,
        path: id,
        title: id,
        type: parsed.type,
      })
    }
  }

  return seen
}

function parseBlastDatabaseFile(filename) {
  const match = /^(.*?)(?:\.\d+)?\.(pin|psq|phr|pal|pdb|pot|ptf|pto|nin|nsq|nhr|nal|ndb|not|ntf|nto)$/i.exec(filename)
  if (!match) {
    return undefined
  }
  const ext = match[2].toLowerCase()
  return {
    baseName: match[1],
    type: ['pin', 'psq', 'phr', 'pal', 'pdb', 'pot', 'ptf', 'pto'].includes(ext)
      ? 'protein'
      : 'nucleotide',
  }
}

async function runLocalBlast({
  allHits,
  database,
  hitLimit,
  hspLimit,
  program,
  query,
}) {
  const executable = blastExecutable(program)
  const targetSeqs = allHits ? allHitsMaxTargetSeqs : hitLimit
  const stdout = await runProcess({
    args: [
      '-db',
      database.path,
      '-query',
      '-',
      '-outfmt',
      '15',
      '-max_target_seqs',
      String(targetSeqs),
      '-max_hsps',
      String(hspLimit),
    ],
    input: query,
    name: executable,
  })
  const parsed = JSON.parse(stdout)
  return {
    rid: `local-${randomUUID()}`,
    reports: (parsed.BlastOutput2 ?? []).map(({ report }) => {
      const search = report?.results?.search ?? {}
      return {
        hits: search.hits ?? [],
        queryId: search.query_id,
        queryLength: search.query_len,
        queryTitle: search.query_title,
      }
    }),
  }
}

function blastExecutable(program) {
  const executable = program === 'blastn' ? 'blastn' : 'blastp'
  return blastBinDir ? path.join(blastBinDir, executable) : executable
}

function runProcess({ args, input, name }) {
  return new Promise((resolve, reject) => {
    const child = spawn(name, args, {
      cwd: blastDbRoot,
      env: {
        ...process.env,
        BLASTDB: '.',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`Local BLAST timed out after ${blastTimeoutMs} ms`))
    }, blastTimeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', error => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr || `Local BLAST exited with code ${code}`))
      }
    })
    child.stdin.end(input)
  })
}

function sanitizeBlastProgram(value) {
  if (value === 'blastn') {
    return 'blastn'
  }
  return 'blastp'
}

function sanitizePositiveInt(value, fallback, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return fallback
  }
  return Math.min(max, Math.max(1, Math.floor(number)))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > maxBlastQueryBytes + 4096) {
        reject(new Error('Request body is too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, body, headOnly = false) {
  const json = JSON.stringify(body)
  res.writeHead(200, {
    'Content-Length': Buffer.byteLength(json),
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(headOnly ? undefined : json)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
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
