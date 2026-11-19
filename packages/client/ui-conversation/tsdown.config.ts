import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'

const bundle = clientBundle(import.meta.dirname, ['lib/types/index.js'])
const require = createRequire(import.meta.url)
const workerSpecifier = 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
const workerModule = '\0dsh-ui-conversation-pdf-worker.mjs'

/** The dynamic client factory has no module URL from which to resolve a Worker
 * file, so the same-version pdf.js Worker source ships inside the lazy pdf
 * chunk as text. */
const pdfWorker: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-ui-conversation-pdf-worker-source',
  resolveId(source) {
    return source === workerSpecifier ? workerModule : null
  },
  load(id) {
    if (id !== workerModule) return null
    const path = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    this.addWatchFile(path)
    return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`
  },
}]

export default (options: Parameters<typeof bundle>[0]): UserConfig[] => bundle(options).map(config =>
  config.name?.endsWith('/client') === true ? {
    ...config,
    // Same package-resolution order as ui-sidebar-documentpreview: the
    // `module` build of SheetJS before its CommonJS entry (whose `require`
    // probes a client chunk's module-table require cannot satisfy) and the
    // package `browser` field aliases.
    inputOptions: {
      ...config.inputOptions,
      resolve: { ...config.inputOptions?.resolve, mainFields: ['browser', 'module', 'main'], aliasFields: [['browser']] },
    },
    plugins: [config.plugins, pdfWorker],
  } : config,
)
