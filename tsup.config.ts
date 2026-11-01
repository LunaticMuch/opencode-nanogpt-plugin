import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/tui.tsx'],
  format: ['esm'],
  clean: true,
  outDir: 'dist',
  esbuildOptions(options) {
    options.jsx = 'automatic'
    options.jsxImportSource = 'solid-js'
  },
})
