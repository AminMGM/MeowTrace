<p align="center"><img src="docs/icon.png" width="96" alt="MeowTrace icon"/></p>

<h1 align="center">MeowTrace</h1>

<p align="center"><b>Open-source bitmap → vector tracer for Windows.</b><br/>
Logos, photos, scans and line art become clean, layered, editable vectors. Every Vector Magic feature, plus a node editor, batch mode, brand-palette locking, centerline tracing and Send-to-Illustrator/Photoshop.</p>

<p align="center"><img src="docs/screenshot.png" alt="MeowTrace tracing an illustration" width="900"/></p>

## Features

| | Vector Magic | MeowTrace |
| --- | :---: | :---: |
| Auto-detect image type and colours | ✓ | ✓ |
| B&W, grayscale, colour, custom colour count | ✓ | ✓ |
| Low / medium / high detail | ✓ | ✓ |
| Stacked or cut-out shapes | ✓ | ✓ |
| Curve types (curves or straight lines only), corner control | ✓ | ✓ |
| Edit segmentation (paint, fill, zap, pick, merge, recolour) | ✓ | ✓ |
| Original / vector / split / overlay / outline / segment views | ✓ | ✓ |
| SVG, EPS, PDF, PNG export | ✓ | ✓ |
| **Centerline tracing** (single strokes, no doubled outlines) | – | ✓ |
| **Pixel-art mode** (exact squares) | – | ✓ |
| **Brand-palette locking** (snap to exact hex values) | – | ✓ |
| **Node editor**: move anchors and handles, add/delete nodes, corner/smooth, line/curve, break apart | – | ✓ |
| **Layer panel**: rename, recolour, reorder, merge, hide, lock, move shapes | – | ✓ |
| **Batch mode**: images or folders in, any formats out, parallel workers | – | ✓ |
| **AI, DXF and layered PSD export**; PDF with real layers | – | ✓ |
| **Send to Illustrator / Photoshop** (+ optional live UXP bridge) | – | ✓ |
| Pre-processing: despeckle, edge-preserving smoothing, 2× upscale | – | ✓ |
| Unlimited undo/redo, presets, copy SVG/PNG to clipboard | – | ✓ |
| Delta auto-updates, offline, no account, open source | – | ✓ |

<p align="center">
  <img src="docs/split-view.png" width="440" alt="Split view comparing original and vector"/>
  <img src="docs/node-editor.png" width="440" alt="Node editor"/>
</p>

## How it works

The tracing engine is a dependency-free **Rust** crate ([`core-rs`](core-rs)) compiled to a ~185 KB **WebAssembly** module. It runs in Web Workers, so the UI never blocks, and batch jobs run in parallel.

1. **Segment**: alpha mask → optional denoise / 2× upscale → colour quantization (weighted k-means++ in OKLab with automatic colour count, palette locking or Otsu thresholding) → majority smoothing → speckle merging. The result is a label map you can edit by hand.
2. **Vectorize**: each colour becomes a layer. Outlines are fitted with a Rust implementation of the potrace algorithm (optimal polygon → vertex adjustment → corner detection → Bezier optimisation). Stacked mode draws each layer over the union of the layers above it, so there are no hairline gaps. Holes stay attached to their shapes.
3. **Centerline**: Zhang–Suen thinning → skeleton graph with merged junctions → spur pruning → corner reconstruction → smoothed Bezier strokes, with widths measured from a distance transform.

The Electron + React app (TypeScript) handles the editor, the exporters (SVG/EPS/PDF/AI/DXF/PSD/PNG, all written from scratch with no dependencies) and the Adobe hand-off.

A 1440 × 1440 illustration traces in about 0.3 s.

## Install

Download `MeowTrace-Setup-x.y.z.exe` from [Releases](https://github.com/AminMGM/MeowTrace/releases). Updates are differential: only the changed blocks are downloaded, never the whole installer again.

## Use

- **Open**: Ctrl+O, drag and drop, paste with Ctrl+V, or *Open with → MeowTrace*.
- **Tune**: pick an image type, colours and detail. Changes re-trace live.
- **Fix**: in **Segments** view (6), paint (B), fill (G), zap (X) or pick (I) colours. In **Vector** view, select (V) or edit nodes (A).
- **Export**: choose a format and size, then *Save* (Ctrl+S), *Copy* (Ctrl+Shift+C), or *Send to Illustrator / Photoshop*.
- **Batch**: switch to the Batch tab and drop images or folders. The current settings apply to every file.

Optional live push into Photoshop: see [`adobe-plugin/`](adobe-plugin).

## Develop

Requirements: Node 22+; Rust stable is needed only to rebuild the engine. The prebuilt `meowtrace_core.wasm` is committed.

```bash
npm install
npm run dev            # app with hot reload
npm test               # TypeScript unit tests (path, nodes, exporters, engine)
npm run core:test      # rebuild the WASM engine + run Rust tests (WASI, no MSVC needed)
npm run build          # typecheck + production build
npm run e2e            # Playwright drives the built app end to end
npm run trace -- in.png out.svg --kind logo --colors 6   # command-line tracer
npm run dist           # NSIS installer in dist/
```

Releasing: bump `version` in `package.json`, commit, then `git tag vX.Y.Z && git push --tags`. GitHub Actions builds the engine from source, runs all tests, and publishes the installer, blockmap and `latest.yml` that auto-update needs.

```
core-rs/        Rust tracing engine (crate + WASM ABI)
src/main/       Electron main: files, dialogs, updater, Adobe send, local bridge
src/preload/    IPC bridge
src/renderer/   React UI, worker pool, rasteriser
src/shared/     Engine wrapper, settings, document model, path geometry, exporters
adobe-plugin/   Photoshop UXP panel (live bridge client)
```

## License

MIT © AminMGM

<p align="center">Made with ❤ by <a href="https://github.com/AminMGM">AminMGM</a></p>
