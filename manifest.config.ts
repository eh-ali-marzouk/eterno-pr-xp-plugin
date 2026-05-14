import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'PR XP',
  description: pkg.description,
  version: pkg.version,
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'PR XP'
  },
  permissions: ['storage', 'identity', 'activeTab'],
  host_permissions: [
    'https://github.com/*',
    'https://api.github.com/*',
    'https://*.supabase.co/*'
  ],
  background: {
    service_worker: 'src/background/background.ts',
    scripts: ['src/background/background.ts'],
    type: 'module'
  } as chrome.runtime.ManifestV3['background'],
  content_scripts: [
    {
      matches: ['https://github.com/*/*/pull/*'],
      js: ['src/content/content.ts'],
      run_at: 'document_idle'
    }
  ],
  browser_specific_settings: {
    gecko: {
      id: 'pr-xp@eterno.health',
      strict_min_version: '121.0'
    }
  }
})
