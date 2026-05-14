import browser from 'webextension-polyfill'
import type { Message, Response } from '../lib/messages'

const status = document.getElementById('status')!

const ping: Message = { type: 'PING' }
browser.runtime
  .sendMessage(ping)
  .then((r: Response) => {
    status.textContent = r.ok ? `Background: ${String(r.data)}` : `Error: ${r.error}`
  })
  .catch((err) => {
    status.textContent = `Error: ${err.message ?? String(err)}`
  })
