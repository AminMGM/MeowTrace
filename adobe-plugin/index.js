// MeowTrace Bridge — Photoshop UXP panel.
// Polls the MeowTrace app's local bridge (127.0.0.1) and opens each new
// "Send to Photoshop" PSD as a document with its colour layers intact.
const { app } = require('photoshop')
const { storage } = require('uxp')
const fs = storage.localFileSystem

const $ = (id) => document.getElementById(id)
let lastId = null

function base() {
  return `http://127.0.0.1:${Number($('port').value) || 47811}`
}

function status(text) {
  $('status').textContent = text
}

async function latest() {
  const res = await fetch(`${base()}/latest`)
  if (!res.ok) throw new Error(`bridge answered ${res.status}`)
  return res.json()
}

async function openItem(item) {
  const res = await fetch(`${base()}/file/${item.id}`)
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  const data = await res.arrayBuffer()
  const temp = await fs.getTemporaryFolder()
  const file = await temp.createFile(item.name, { overwrite: true })
  await file.write(data, { format: storage.formats.binary })
  await require('photoshop').core.executeAsModal(async () => app.open(file), { commandName: 'Open MeowTrace result' })
  lastId = item.id
  status(`Opened ${item.name}`)
}

async function pull() {
  try {
    const item = await latest()
    if (!item) return status('Nothing sent yet')
    await openItem(item)
  } catch (e) {
    status(`MeowTrace not reachable: ${e.message}`)
  }
}

async function poll() {
  try {
    const item = await latest()
    if (item && item.id !== lastId && item.target === 'photoshop' && $('auto').checked) await openItem(item)
    else if (!item) status('Connected — nothing sent yet')
    else if (item.id === lastId) status(`Connected · last: ${item.name}`)
  } catch {
    status('Waiting for MeowTrace (bridge off?)')
  }
  setTimeout(poll, 1500)
}

$('pull').addEventListener('click', pull)
// Do not auto-open whatever was sent before the panel was opened.
latest()
  .then((i) => {
    lastId = i ? i.id : null
  })
  .catch(() => {})
  .finally(() => setTimeout(poll, 1500))
