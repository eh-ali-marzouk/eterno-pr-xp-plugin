import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Review-Master',
  description: pkg.description,
  version: pkg.version,
  icons: {
    16: 'src/assets/icons/icon-16.png',
    32: 'src/assets/icons/icon-32.png',
    48: 'src/assets/icons/icon-48.png',
    128: 'src/assets/icons/icon-128.png'
  },
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'Review-Master',
    default_icon: {
      16: 'src/assets/icons/icon-16.png',
      32: 'src/assets/icons/icon-32.png',
      48: 'src/assets/icons/icon-48.png',
      128: 'src/assets/icons/icon-128.png'
    }
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
  web_accessible_resources: [
    {
      resources: [
        'src/assets/fonts/PressStart2P-Regular.woff2',
        'src/assets/fonts/VT323-Regular.woff2'
      ],
      matches: ['https://github.com/*']
    }
  ],
  browser_specific_settings: {
    gecko: {
      id: 'pr-xp@eterno.health',
      strict_min_version: '121.0'
    }
  }
})
