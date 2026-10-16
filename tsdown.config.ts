import { defineConfig } from 'tsdown'

/**
 * Module-table specifiers the browser resolves from the shell's frozen platform seed
 * table. Everything else — including every relative import — is inlined, because the
 * lazy-CJS factory protocol cannot answer a relative `require`.
 */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** Package id: the client-bundle registration key and its `__ModuleLoader__.load` id. Must equal the package name. */
const ID = '@zzxxxxxx/dsh-balance-lite'

/**
 * Reproduce the artifact contract of the unpublished `clientBundle` tsdown preset
 * (packages/client/tsdown.client.ts): a single classic CJS script whose registration id
 * equals the package name, wrapped so the browser module loader can register it as a lazy
 * factory.
 */
export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: id => CLIENT_EXTERNALS.has(id),
    // Stated alongside neverBundle for the same reason the preset does: without it,
    // tsdown's getProductionDeps fallback would keep this package's own peerDependencies
    // (schemastery and the host packages) as bare requires the browser module table
    // cannot answer. Only the client externals above stay imports.
    alwaysBundle: id => !CLIENT_EXTERNALS.has(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    // Function form, as the preset: a non-entry chunk must carry its own `chunk` key
    // or it would re-register the package id. (A dynamic import would additionally need
    // the preset's chunk-require rewrite; nothing here emits one today.)
    banner: chunk => `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
