#!/usr/bin/env node
/**
 * Zip dist/ for distribution. Produces:
 *   releases/review-master-<version>-chrome.zip
 *   releases/review-master-<version>-firefox.zip
 *
 * The two artifacts share content (same dist/) and differ only in
 * extension. Chrome Web Store and Firefox AMO/web-ext both accept a
 * plain zip of the dist directory.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const distDir = join(root, 'dist')
const releasesDir = join(root, 'releases')

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error('package: dist/ not found. Run `npm run build` first.')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version

mkdirSync(releasesDir, { recursive: true })

const base = `review-master-${version}`
const chromeZip = join(releasesDir, `${base}-chrome.zip`)
const firefoxZip = join(releasesDir, `${base}-firefox.zip`)

for (const target of [chromeZip, firefoxZip]) {
  rmSync(target, { force: true })
  // `zip -r <target> .` from inside dist so paths are relative to the
  // extension root, not "dist/...". -X strips OS metadata that stores
  // sometimes reject.
  execFileSync('zip', ['-rqX', target, '.'], { cwd: distDir, stdio: 'inherit' })
  const size = (statSync(target).size / 1024).toFixed(1)
  console.log(`package: wrote ${target.replace(root + '/', '')} (${size} KB)`)
}

console.log(`\nNext steps:`)
console.log(`  Chrome — upload ${base}-chrome.zip to chrome://webstore/devconsole as an Unlisted item.`)
console.log(`  Firefox — sign ${base}-firefox.zip via AMO self-distribution to get a .xpi.`)
