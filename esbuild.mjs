import http from 'node:http'

import JBrowseReExports from '@jbrowse/core/ReExports/list'
import { globalExternals } from '@fal-works/esbuild-plugin-global-externals'
import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')
const port = process.env.PORT ? Number(process.env.PORT) : 9000

function createGlobalMap(jbrowseGlobals) {
  const globalMap = {}
  for (const global of jbrowseGlobals) {
    globalMap[global] = {
      varName: `JBrowseExports["${global}"]`,
      type: 'cjs',
    }
  }
  globalMap['@jbrowse/mobx-state-tree'] = {
    varName: 'JBrowseExports["mobx-state-tree"]',
    type: 'cjs',
  }
  return globalMap
}

const buildConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  globalName: 'JBrowsePluginBlastTrackPlugin',
  plugins: [globalExternals(createGlobalMap(JBrowseReExports))],
  ...(watch
    ? { outfile: 'dist/out.js' }
    : {
        outfile: 'dist/jbrowse-plugin-blast-track.umd.production.min.js',
        sourcemap: true,
        minify: true,
      }),
}

if (watch) {
  const ctx = await context(buildConfig)
  const internalPort = port + 400
  const { hosts } = await ctx.serve({ servedir: '.', port: internalPort })
  http
    .createServer((req, res) => {
      const proxyReq = http.request(
        {
          hostname: hosts[0],
          port: internalPort,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        proxyRes => {
          res.writeHead(proxyRes.statusCode ?? 200, {
            ...proxyRes.headers,
            'Access-Control-Allow-Origin': '*',
          })
          proxyRes.pipe(res, { end: true })
        },
      )
      req.pipe(proxyReq, { end: true })
    })
    .listen(port)
  console.log(`Serving plugin at http://${hosts[0]}:${port}`)
  await ctx.watch()
} else {
  await build(buildConfig)
}
