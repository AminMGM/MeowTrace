# MeowTrace — Full Project Plan

*A branded, open-source Vector Magic clone with Illustrator/Photoshop send-to and more tracing options than the original*

## 1. Overview

Vector Magic auto-traces raster images into vector paths (SVG/EPS/PDF) with a simple slider-based UI. It's closed-source, subscription-gated, and limited to flat file export with no manual touch-up, no batch mode, and no direct Adobe integration.

MeowTrace is a Windows desktop app (following the same pattern as MeowPlayer and MeowSize) that does everything Vector Magic does, open source, plus: multiple tracing engines, AI pre-processing, manual node editing, batch processing, custom palette locking, layer-separated export, and a direct "send to Illustrator/Photoshop" pipeline.

## 2. Goals & Differentiators vs Vector Magic

| Capability | Vector Magic | MeowTrace |
| --- | --- | --- |
| Tracing modes | B&W, grayscale, color, max colors | + centerline mode for line art/logos |
| Pre-processing | None | Optional AI denoise/upscale before tracing |
| Touch-up | None (re-run only) | Manual node editor (add/remove/merge/split anchor points) |
| Batch processing | No | Yes — folder in, same preset, folder out |
| Palette control | Auto only | Lock to exact brand hex values |
| Export structure | Flat path soup | Named layers/groups per color/region |
| Export formats | SVG, EPS, PDF | + AI-native, DXF, PSD |
| Illustrator/Photoshop | None | File-based send + optional live UXP push |
| License | Closed, paid | Open source |

## 3. Feature Set (detailed)

- **Tracing engines**: potrace-style B&W/line-art; color quantization + region tracing for full-color photos; centerline tracing for logos and line art where Vector Magic's outline-only approach produces doubled strokes
- **AI pre-processing (optional toggle)**: lightweight ONNX-based denoise/upscale pass for low-res or noisy source images (useful for scanned logos, old photos, low-res product shots)
- **Manual node editor**: SVG canvas with draggable anchor points, path merge/split, delete/redraw regions — post-trace correction without re-running the whole algorithm
- **Batch mode**: drag a folder in, apply one preset/palette across all images, export all at once — critical for e-commerce catalog work
- **Custom palette locking**: snap quantization to exact brand hex codes instead of auto-detected colors — directly useful for client branding work (logos, product lines)
- **Layer-separated export**: each traced color/region becomes a named layer or group in the output file rather than one flat collection of paths
- **SVG optimization pass**: path simplification, duplicate-fill merging, target file-size control
- **Export format range**: SVG, EPS, PDF, native AI, DXF (laser/CNC-friendly, relevant to 3D Hub work), PSD (raster + smart object round-trip)

## 4. Send to Illustrator / Photoshop

**Phase 1 — file-based (ship first):** Export directly to EPS/PDF (Illustrator-compatible) or native PSD (Photoshop, smart-object round-trip), then launch the file with the OS default handler. No Adobe API needed, works immediately, zero integration risk.

**Phase 2 — live push (stretch goal):** Build a small Adobe **UXP plugin** (the current plugin platform for both Illustrator and Photoshop, replacing the older CEP/ExtendScript). The desktop app writes a temp file and signals the plugin (via a local file watch or a tiny local HTTP bridge the plugin polls), and the plugin imports the paths directly into the currently open document — true "send to" instead of "open file."

## 5. Architecture

```
/core-rs        → Rust crate: color quantization, contour tracing, Bezier curve fitting, SVG serialization
/core-rs/wasm   → optional wasm-bindgen target, for a future web/browser preview
/app            → Electron + React shell (UI, file I/O, batch queue, node editor canvas)
/adobe-plugin   → UXP plugin (JS/TS), separate package, only needed for Phase 2 of Adobe integration
```

Tracing engine in Rust, exposed to the Electron app via **napi-rs** (native Node addon — faster than WASM for a desktop-only app, no browser sandboxing overhead). Everything else (UI, editor, Adobe plugin) stays in TypeScript/React to match the existing MeowPlayer/MeowSize codebase style.

## 6. Tech Stack

- **Shell**: Electron + React (matches MeowPlayer)
- **Tracing core**: Rust, compiled as a native addon via napi-rs
- **Editor canvas**: SVG-based, likely built on fabric.js or a custom lightweight renderer for node manipulation
- **AI pre-processing**: ONNX Runtime (Node) running a small denoise/upscale model (e.g. a distilled Real-ESRGAN variant) — optional, togglable, so it doesn't bloat the base install
- **Packaging/updates**: same delta/differential auto-update approach planned for MeowSize, reused here

## 7. Build Order (prototype-then-port strategy)

Don't write the fast Rust version first — validate the algorithm visually in JS, then port the proven path to Rust.

1. Prototype tracing algorithms in JS/Node (potrace-style, color quantization, centerline) to confirm visual quality and pick final approach
2. Port the confirmed hot path to Rust (`/core-rs`), expose via napi-rs
3. Electron shell: single-image trace, 3 modes, SVG/EPS export, slider UI (MVP)
4. Batch processing + palette locking
5. Manual node-editing touch-up canvas
6. File-based Illustrator/Photoshop send (EPS/PSD launch via OS handler)
7. AI pre-processing toggle (denoise/upscale)
8. UXP plugin for live push-to-document (Phase 2 Adobe integration)
9. Public repo, README, first public release

## 8. Branding

Working name: **MeowTrace** (or MeowVector) — continues the existing Meow-prefixed naming convention used for MeowPlayer and MeowSize, same GitHub org (AminMGM), same general UI language as the existing apps.

## 9. Open Source Strategy

- `/core-rs` can be published as a standalone crate, usable outside the Electron app (CLI tool, future web version, or by other projects) — this is the most broadly useful open-source artifact and worth keeping decoupled from the Electron-specific code
- MIT or Apache-2.0 license, consistent with a permissive open-source positioning against Vector Magic's closed/paid model
- Public repo + issues from day one, same pattern as MeowSize
