// Минимальный клиент Chrome DevTools Protocol: отдельный headless Chrome со своим профилем.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9337
export const SHOTS = join(fileURLToPath(new URL('.', import.meta.url)), 'shots')
mkdirSync(SHOTS, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch() {
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${join(tmpdir(), 'mini-crm-e2e-profile')}`,
      '--window-size=1280,900',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  let targets
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      if (targets.some((t) => t.type === 'page')) break
    } catch {}
    await sleep(200)
  }
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  const logs = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      logs.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      pending.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const goto = async (url) => {
    await send('Page.navigate', { url })
    await sleep(1500)
  }
  // Ждём, пока на странице появится текст (или истечёт время).
  const waitText = async (text, ms = 10000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)) return true
      await sleep(250)
    }
    throw new Error(`Не дождались текста: ${text}`)
  }
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'))
  }
  const text = () => evaluate('document.body.innerText')
  const close = async () => {
    try {
      await send('Browser.close')
    } catch {}
    proc.kill()
  }
  return { send, evaluate, goto, waitText, shot, text, close, logs, sleep }
}

// Хелперы для страницы (React-поля: ставим значение через нативный setter и шлём input).
export const helpers = `
window.__set = (el, v) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};
window.__click = (text, sel = 'button, a, summary') => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.innerText.trim().replace('+ ', '').startsWith(text));
  if (!el) throw new Error('Нет элемента: ' + text);
  el.click();
  return true;
};
window.confirm = () => true;
true
`
