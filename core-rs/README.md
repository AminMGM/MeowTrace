# meowtrace-core

The raster → vector engine behind [MeowTrace](https://github.com/AminMGM/MeowTrace). It has no dependencies, runs on stable Rust, and builds to `wasm32-unknown-unknown`.

```rust
use meowtrace_core::{trace, Options, Mode};

let opts = Options { mode: Mode::Color, colors: 0 /* auto */, ..Options::default() };
let result = trace(&rgba, width, height, &opts, &[] /* locked palette */);
std::fs::write("out.svg", result.to_svg())?;
```

Two stages, so a UI can edit the label map in between:

- `segment(rgba, w, h, &opts, &palette) -> Segmentation`: denoise, halo-free sharpening, upscale, OKLab k-means++ (automatic colour count, palette locking, Otsu B&W), anti-alias edge snapping, stray-pixel smoothing, speckle merging.
- `vectorize(&segmentation, &opts) -> TraceResult`: potrace-style Bezier outlines with corner restoration per colour layer (stacked or cut-out, holes kept), or centerline strokes.

Modes: `Color`, `Gray`, `Bw`, `Centerline`, `Pixel`.

The WASM build exposes a small C ABI (`mt_alloc`, `mt_analyze`, `mt_segment`, `mt_vectorize`, `mt_result_ptr/len`). See `src/wasm.rs` and the TypeScript wrapper in `../src/shared/engine.ts`.

```bash
cargo build --release --target wasm32-unknown-unknown
cargo test --release            # or, without MSVC: npm run core:test (runs tests under WASI)
```

The outline fitter is an independent implementation of the algorithm in Peter Selinger, *Potrace: a polygon-based tracing algorithm* (2003).

MIT licensed.
