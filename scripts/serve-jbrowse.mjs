import { createReadStream, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'jbrowse-local',
)
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 3000)

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
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const pathname = decodeURIComponent(url.pathname)
    const requested = pathname === '/' ? '/index.html' : pathname
    const filePath = path.resolve(root, `.${requested}`)

    if (!filePath.startsWith(root)) {
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
    res.setHeader('Access-Control-Allow-Origin', '*')

    const range = req.headers.range
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match) {
        res.writeHead(416)
        res.end()
        return
      }
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2]
        ? Number(match[2])
        : Math.max(0, finalStat.size - 1)

      res.writeHead(206, {
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${finalStat.size}`,
      })
      createReadStream(finalPath, { start, end }).pipe(res)
      return
    }

    res.writeHead(200, { 'Content-Length': finalStat.size })
    createReadStream(finalPath).pipe(res)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}).listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}`)
})
