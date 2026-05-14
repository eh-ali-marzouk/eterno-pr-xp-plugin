import browser from 'webextension-polyfill'

/**
 * Supabase requires a storage adapter for PKCE + session persistence.
 * Service workers have no localStorage, so we back it with browser.storage.local.
 * Shape matches Supabase's SupportedStorage interface (async get/set/remove).
 */
export const extStorage = {
  async getItem(key: string): Promise<string | null> {
    const result = await browser.storage.local.get(key)
    const value = result[key]
    return typeof value === 'string' ? value : null
  },
  async setItem(key: string, value: string): Promise<void> {
    await browser.storage.local.set({ [key]: value })
  },
  async removeItem(key: string): Promise<void> {
    await browser.storage.local.remove(key)
  }
}
