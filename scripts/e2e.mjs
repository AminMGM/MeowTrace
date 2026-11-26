// End-to-end smoke test of the built app (run `npm run build` first).
// Launches Electron via Playwright, traces an image, exercises views, tools,
// node editing, segmentation edits, undo/redo, every exporter and the batch
// pool, and saves screenshots to e2e-out/.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const out = resolve('e2e-out')
mkdirSync(out, { recursive: true })
const sample = resolve(process.argv[2] ?? 'Assets/5781932691421859893.jpg')
const errors = []
const log = (...a) => console.log('•', ...a)
const fail = (m) => {
  console.error('✗', m)
  process.exitCode = 1
}

// MEOW_EXE=dist/win-unpacked/MeowTrace.exe tests the packaged app instead of the dev build.
const exe = process.env.MEOW_EXE
const profile = mkdtempSync(resolve(tmpdir(), 'meowtrace-e2e-'))
const env = { ...process.env, MEOW_E2E: '1', MEOW_USER_DATA: profile }
const app = await electron.launch(
  exe
    ? { executablePath: resolve(exe), args: [sample], env }
    : { args: ['.', sample], env }
)
const win = await app.firstWindow()
win.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
win.on('pageerror', (e) => errors.push(String(e)))

const idle = () => win.waitForFunction(() => window.__meow?.store.getState().busy === 'idle', null, { timeout: 60000 })

try {
  await win.waitForSelector('.layer', { timeout: 60000 })
  await win.waitForFunction(() => window.__meow, null, { timeout: 10000 })
  await idle()
  await win.waitForTimeout(300)
  const info = await win.evaluate(() => {
    const s = window.__meow.store.getState()
    return { layers: s.doc.layers.length, kind: s.analysis.kind, timings: s.timings, w: s.doc.width, h: s.doc.height }
  })
  log('traced', JSON.stringify(info))
  if (info.layers < 2) fail('expected several layers')
  await win.screenshot({ path: `${out}/1-vector.png` })

  for (const [key, name] of [
    ['3', 'split'],
    ['5', 'outline'],
    ['6', 'segments'],
    ['4', 'overlay']
  ]) {
    await win.keyboard.press(key)
    await win.waitForTimeout(250)
    await win.screenshot({ path: `${out}/2-${name}.png` })
  }
  // Split view: zoom in off-centre, then the clip edge must sit under the handle.
  await win.keyboard.press('3')
  const vb = await win.locator('.viewer').boundingBox()
  await win.mouse.move(vb.x + vb.width * 0.3, vb.y + vb.height * 0.4)
  for (let i = 0; i < 4; i++) await win.mouse.wheel(0, -240)
  await win.waitForTimeout(250)
  const gap = await win.evaluate(() => {
    const handle = document.querySelector('.split-handle').getBoundingClientRect()
    const svg = document.querySelector('svg.vector')
    const r = svg.getBoundingClientRect()
    const inset = parseFloat(/([\d.]+)px\)$/.exec(svg.style.clipPath)?.[1] ?? 'NaN')
    const edge = r.left + inset * (r.width / svg.width.baseVal.value)
    return Math.abs(edge - (handle.left + handle.width / 2))
  })
  log('split misalignment px', gap.toFixed(2))
  if (!(gap < 2)) fail('split view clip does not line up with the handle')
  await win.screenshot({ path: `${out}/2-split-zoomed.png` })
  await win.keyboard.press('Control+0')
  await win.keyboard.press('1')
  await win.waitForTimeout(150)

  // Select a shape, then switch to node editing.
  const box = await win.locator('.viewer').boundingBox()
  await win.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.72)
  const sel = await win.evaluate(() => window.__meow.store.getState().selection)
  log('selection', JSON.stringify(sel))
  if (!sel) fail('click did not select a shape')
  await win.keyboard.press('a')
  await win.waitForTimeout(250)
  const anchors = await win.locator('.node-anchor').count()
  log('anchors shown', anchors)
  if (sel && anchors < 3) fail('node editor shows no anchors')
  await win.screenshot({ path: `${out}/3-nodes.png` })
  if (anchors) {
    const before = await win.evaluate(() => window.__meow.store.getState().past.length)
    const a = await win.locator('.node-anchor').nth(1).boundingBox()
    await win.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await win.mouse.down()
    await win.mouse.move(a.x + 40, a.y + 30, { steps: 6 })
    await win.mouse.up()
    const after = await win.evaluate(() => window.__meow.store.getState().past.length)
    log('history entries after node drag', before, '→', after)
    if (after !== before + 1) fail('node drag did not create one history step')
    await win.screenshot({ path: `${out}/3b-node-drag.png` })
    await win.keyboard.press('Control+z')
  }
  await win.keyboard.press('Escape')
  await win.keyboard.press('v')

  // Settings change → retrace with 3 colours.
  const n = await win.evaluate(async () => {
    const { actions, store } = window.__meow
    actions.tweak({ colors: 3 }, true)
    await new Promise((r) => setTimeout(r, 120))
    while (store.getState().busy !== 'idle') await new Promise((r) => setTimeout(r, 50))
    return store.getState().seg.palette.length / 4
  })
  log('colours after tweak(3)', n)
  if (n !== 3) fail(`expected 3 colours, got ${n}`)

  // Segmentation edit, undo, redo.
  const segEdit = await win.evaluate(async () => {
    const { actions, store } = window.__meow
    const s = store.getState()
    const seg = { ...s.seg, labels: s.seg.labels.slice(), palette: s.seg.palette.slice() }
    for (let i = 0; i < seg.labels.length / 4; i++) seg.labels[i] = 0
    await actions.commitSeg(seg)
    const edited = store.getState().segEdited
    actions.undo()
    const afterUndo = store.getState().segEdited
    actions.redo()
    return { edited, afterUndo, redo: store.getState().segEdited }
  })
  log('segmentation edit', JSON.stringify(segEdit))
  if (!segEdit.edited || segEdit.afterUndo || !segEdit.redo) fail('segmentation history broken')

  // Every exporter.
  const exportsRes = await win.evaluate(async () => {
    const { exporting, store } = window.__meow
    const doc = store.getState().doc
    const res = {}
    for (const f of ['svg', 'pdf', 'ai', 'eps', 'dxf', 'psd', 'png']) {
      const t = performance.now()
      const data = await exporting.exportDoc(doc, { ...exporting.DEFAULT_EXPORT, format: f, scale: f === 'png' ? 2 : 1 }, 'e2e')
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
      let bin = ''
      const n2 = Math.min(bytes.length, 3_000_000)
      for (let i = 0; i < n2; i++) bin += String.fromCharCode(bytes[i])
      res[f] = { size: bytes.length, ms: Math.round(performance.now() - t), b64: btoa(bin) }
    }
    return res
  })
  const magic = { svg: '<?xml', pdf: '%PDF', ai: '%PDF', eps: '%!PS', dxf: '0\nSECTION', psd: '8BPS', png: '\x89PNG' }
  for (const [f, r] of Object.entries(exportsRes)) {
    const buf = Buffer.from(r.b64, 'base64')
    const ok = buf.toString('latin1', 0, magic[f].length) === magic[f]
    log(`export ${f}: ${r.size} bytes in ${r.ms} ms ${ok ? 'ok' : 'BAD HEADER'}`)
    if (!ok || r.size < 100) fail(`export ${f} invalid`)
    writeFileSync(`${out}/export.${f}`, buf)
  }

  // Batch pool: two traces in parallel.
  const batch = await win.evaluate(async (path) => {
    const { pool, store } = window.__meow
    const f = await window.meow.readFile(path)
    const bmp = await createImageBitmap(new Blob([f.bytes]))
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    c.getContext('2d').drawImage(bmp, 0, 0)
    const p = new pool.BatchPool(2)
    const t = performance.now()
    const runs = await Promise.all(
      [0, 1].map(() => p.trace(c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height, store.getState().settings, 1))
    )
    p.dispose()
    return { layers: runs.map((r) => r.raw.layers.length), ms: Math.round(performance.now() - t) }
  }, sample)
  log('batch', JSON.stringify(batch))
  if (batch.layers.some((x) => x < 1)) fail('batch produced nothing')

  // Local Adobe bridge.
  await win.evaluate(() => window.meow.setSettings({ bridgeEnabled: true, bridgePort: 47899 }))
  const health = await fetch('http://127.0.0.1:47899/health').then((r) => r.json())
  const latest = await fetch('http://127.0.0.1:47899/latest').then((r) => r.json())
  log('bridge', JSON.stringify(health), JSON.stringify(latest))
  if (!health.ok) fail('bridge not reachable')
  await win.evaluate(() => window.meow.setSettings({ bridgeEnabled: false, bridgePort: 47811 }))
  const closed = await fetch('http://127.0.0.1:47899/health').then(() => false, () => true)
  if (!closed) fail('bridge did not stop')

  await win.evaluate(() => window.__meow.store.setState({ page: 'batch' }))
  await win.waitForTimeout(250)
  await win.screenshot({ path: `${out}/4-batch.png` })
  await win.evaluate(() => window.__meow.store.setState({ page: 'trace', showSettings: true }))
  await win.waitForTimeout(400)
  await win.screenshot({ path: `${out}/5-settings.png` })
  await win.evaluate(() => window.__meow.store.setState({ showSettings: false }))

  // Turn into anime: needs the models locally (MEOW_ANIME_MODELS=<folder>), so
  // the test never downloads them. Without it only the dialog is checked.
  await win.locator('.anime-btn').click()
  await win.waitForSelector('.anime-card', { timeout: 5000 })
  const cards = await win.locator('.anime-card').count()
  log('anime styles', cards)
  if (cards !== 4) fail('anime dialog should list 4 styles')
  await win.screenshot({ path: `${out}/6-anime.png` })
  if (process.env.MEOW_ANIME_MODELS) {
    const t0 = Date.now()
    await win.locator('.anime-card', { hasText: 'Hayao' }).locator('button.primary').click()
    await win.waitForFunction(() => window.__meow.store.getState().source?.name.includes('(Hayao)'), null, { timeout: 120000 })
    await idle()
    const res = await win.evaluate(() => {
      const s = window.__meow.store.getState()
      return { name: s.source.name, layers: s.doc?.layers.length ?? 0, back: !!s.animeOriginal }
    })
    log('anime', JSON.stringify(res), `${((Date.now() - t0) / 1000).toFixed(1)} s`)
    if (res.layers < 2 || !res.back) fail('anime conversion did not produce a traced image')
    await win.screenshot({ path: `${out}/6-anime-result.png` })
    await win.evaluate(() => window.__meow.store.setState({ view: 'original' }))
    await win.waitForTimeout(300)
    await win.screenshot({ path: `${out}/6-anime-original-view.png` })
    await win.evaluate(() => window.__meow.store.setState({ view: 'vector' }))
    // Switching style starts again from the original (no stacking), and the
    // fixed-size Face Paint model keeps the image's aspect ratio.
    const before = await win.evaluate(() => {
      const s = window.__meow.store.getState().source
      return { w: s.width, h: s.height }
    })
    await win.locator('.anime-btn').click()
    await win.locator('.anime-card', { hasText: 'Face Paint' }).locator('button.primary').click()
    await win.waitForFunction(() => window.__meow.store.getState().source?.name.includes('(Face Paint)'), null, { timeout: 120000 })
    await idle()
    const fp = await win.evaluate(() => {
      const s = window.__meow.store.getState()
      return { name: s.source.name, w: s.source.width, h: s.source.height, original: s.animeOriginal?.name }
    })
    log('anime face paint', JSON.stringify(fp))
    if (fp.name.includes('(Hayao)') || fp.w !== before.w || fp.h !== before.h || fp.original?.includes('(')) fail('switching anime styles should start from the original')
    await win.screenshot({ path: `${out}/6-anime-facepaint.png` })
    await win.locator('.anime-row button.ghost').click()
    await win.waitForFunction(() => !window.__meow.store.getState().source?.name.includes('(Hayao)'), null, { timeout: 30000 })
    await idle()
    log('back to original ok')
  } else {
    await win.keyboard.press('Escape')
  }
} catch (e) {
  fail(e.stack ?? String(e))
  await win.screenshot({ path: `${out}/error.png` }).catch(() => {})
} finally {
  const real = errors.filter((e) => !/Autofill|DevTools/.test(e))
  if (real.length) {
    console.error('console errors:\n  ' + real.join('\n  '))
    process.exitCode = 1
  }
  await app.close()
  rmSync(profile, { recursive: true, force: true })
}
console.log(process.exitCode ? 'E2E FAILED' : 'E2E OK')
