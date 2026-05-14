import browser from 'webextension-polyfill'
import type { Message, Response } from '../lib/messages'

browser.runtime.onMessage.addListener(
  (msg: Message): Promise<Response> => {
    switch (msg.type) {
      case 'PING':
        return Promise.resolve({ ok: true, data: 'pong' })
      default:
        return Promise.resolve({ ok: false, error: 'unknown message' })
    }
  }
)

browser.runtime.onInstalled.addListener(() => {
  console.log('[pr-xp] background installed')
})
