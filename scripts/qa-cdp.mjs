const url = process.argv[2]
const tabs = await fetch('http://127.0.0.1:9223/json').then(response => response.json())
const tab = tabs.find(item => item.type === 'page')
const ws = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const callId = ++id
  const listener = event => {
    const message = JSON.parse(event.data)
    if (message.id !== callId) return
    ws.removeEventListener('message', listener)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  }
  ws.addEventListener('message', listener)
  ws.send(JSON.stringify({ id: callId, method, params }))
})
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.navigate', { url })
await new Promise(resolve => setTimeout(resolve, 5000))
const before = await send('Runtime.evaluate', { expression: `JSON.stringify({innerWidth,scrollWidth:document.documentElement.scrollWidth,cardCount:document.querySelectorAll('.panic-card').length,historyDays:document.querySelectorAll('.history-day').length,details:document.querySelectorAll('.panic-details').length,text:document.querySelector('.panic-panel')?.innerText.slice(0,240)})`, returnByValue: true })
await send('Runtime.evaluate', { expression: `document.querySelector('.panic-card > button')?.click()` })
await new Promise(resolve => setTimeout(resolve, 250))
const after = await send('Runtime.evaluate', { expression: `JSON.stringify({details:document.querySelectorAll('.panic-details').length,expanded:document.querySelector('.panic-card > button')?.getAttribute('aria-expanded'),errors:window.__qaErrors||[]})`, returnByValue: true })
await send('Runtime.evaluate', { expression: `document.querySelector('.history-day > button')?.click()` })
await new Promise(resolve => setTimeout(resolve, 250))
const history = await send('Runtime.evaluate', { expression: `JSON.stringify({historyExpanded:!!document.querySelector('.history-trades'),rejectedResearchPresent:!!document.querySelector('.research-verdict'),historyText:document.querySelector('.history-section')?.innerText.slice(0,180),portfolioText:document.querySelector('.portfolio-sim')?.innerText})`, returnByValue: true })
await send('Runtime.evaluate', { expression: `(() => { const input = document.querySelector('.portfolio-sim input'); if (!input) return; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '50'); input.dispatchEvent(new Event('input', { bubbles: true })); })()` })
await new Promise(resolve => setTimeout(resolve, 250))
const portfolioChanged = await send('Runtime.evaluate', { expression: `JSON.stringify({capital:document.querySelector('.portfolio-sim input')?.value,portfolioText:document.querySelector('.portfolio-sim')?.innerText})`, returnByValue: true })
console.log(before.result.value)
console.log(after.result.value)
console.log(history.result.value)
console.log(portfolioChanged.result.value)
await send('Browser.close')
