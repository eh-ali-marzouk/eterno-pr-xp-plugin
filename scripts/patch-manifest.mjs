#!/usr/bin/env node
/**
 * @crxjs/vite-plugin emits a Chrome-only manifest (service_worker via
 * service-worker-loader.js). Firefox MV3 needs background.scripts pointing
 * directly at the bundled ESM. We patch dist/manifest.json to include both.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(__dirname, '..', 'dist')
const manifestPath = resolve(distDir, 'manifest.json')
const loaderPath = resolve(distDir, 'service-worker-loader.js')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const loader = readFileSync(loaderPath, 'utf8')

const match = loader.match(/import\s+['"](.+?)['"]/)
if (!match) {
  console.error('patch-manifest: could not find background asset in service-worker-loader.js')
  process.exit(1)
}
const bgAsset = match[1].replace(/^\.\//, '')

manifest.background = {
  ...manifest.background,
  scripts: [bgAsset]
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`patch-manifest: added background.scripts = ["${bgAsset}"]`)
