//! # meowtrace-core
//!
//! Raster → vector tracing engine behind MeowTrace.
//!
//! Pipeline: [`segment`] turns RGBA pixels into a label map plus palette
//! (alpha mask → denoise → optional 2× upscale → OKLab k-means / palette lock /
//! Otsu → majority smoothing → speckle removal). [`vectorize`] turns a label map
//! into layers of Bezier outlines (potrace-style fitting, stacked or cut-out
//! shapes) or centerline strokes. The two stages are separate so a UI can let
//! people edit the segmentation before vectorizing.
//!
//! No dependencies; compiles to `wasm32-unknown-unknown` (see `wasm.rs` for
//! the C ABI used by the MeowTrace app).

pub mod analyze;
pub mod centerline;
pub mod cleanup;
pub mod geom;
pub mod potrace;
pub mod preprocess;
pub mod quantize;

#[cfg(target_arch = "wasm32")]
mod wasm;

use potrace::{Bitmap, Params, Render, Transform, TurnPolicy};
use quantize::TRANSPARENT;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Color,
    Gray,
    Bw,
    Centerline,
    Pixel,
}

/// All tracing settings. `from_slice` reads the flat numeric layout used over
/// the WASM boundary; see the `IDX_*` constants for the order.
#[derive(Clone, Debug)]
pub struct Options {
    pub mode: Mode,
    /// Number of colours; 0 = automatic.
    pub colors: u32,
    /// B&W threshold 0..255; negative = automatic (Otsu).
    pub threshold: i32,
    pub invert: bool,
    /// 0 none, 1 median, 2 bilateral.
    pub denoise: u8,
    /// 1 or 2.
    pub upscale: u8,
    pub smooth_passes: u32,
    /// Minimum region area in source pixels.
    pub speckle: u32,
    pub alphamax: f64,
    pub opttolerance: f64,
    pub optimize: bool,
    pub curves: bool,
    pub stacked: bool,
    pub remove_bg: bool,
    pub precision: u8,
    pub merge: f32,
    pub alpha_threshold: u8,
    /// Output coordinate multiplier (e.g. when the source was downscaled).
    pub scale: f64,
    pub line_tolerance: f64,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            mode: Mode::Color,
            colors: 0,
            threshold: -1,
            invert: false,
            denoise: 0,
            upscale: 1,
            smooth_passes: 1,
            speckle: 4,
            alphamax: 1.0,
            opttolerance: 0.2,
            optimize: true,
            curves: true,
            stacked: true,
            remove_bg: false,
            precision: 2,
            merge: 0.06,
            alpha_threshold: 128,
            scale: 1.0,
            line_tolerance: 1.0,
        }
    }
}

impl Options {
    pub fn from_slice(v: &[f64]) -> Options {
        let d = Options::default();
        let g = |i: usize, def: f64| -> f64 {
            match v.get(i) {
                Some(x) if x.is_finite() => *x,
                _ => def,
            }
        };
        let b = |i: usize, def: bool| g(i, if def { 1.0 } else { 0.0 }) != 0.0;
        Options {
            mode: match g(0, 0.0) as i32 {
                1 => Mode::Gray,
                2 => Mode::Bw,
                3 => Mode::Centerline,
                4 => Mode::Pixel,
                _ => Mode::Color,
            },
            colors: g(1, 0.0).clamp(0.0, 250.0) as u32,
            threshold: g(2, -1.0) as i32,
            invert: b(3, false),
            denoise: g(4, 0.0).clamp(0.0, 2.0) as u8,
            upscale: if g(5, 1.0) >= 2.0 { 2 } else { 1 },
            smooth_passes: g(6, d.smooth_passes as f64).clamp(0.0, 4.0) as u32,
            speckle: g(7, d.speckle as f64).clamp(0.0, 1e7) as u32,
            alphamax: g(8, d.alphamax).clamp(0.0, 1.3334),
            opttolerance: g(9, d.opttolerance).clamp(0.0, 5.0),
            optimize: b(10, true),
            curves: b(11, true),
            stacked: b(12, true),
            remove_bg: b(13, false),
            precision: g(14, 2.0).clamp(0.0, 4.0) as u8,
            merge: g(15, d.merge as f64).clamp(0.0, 1.0) as f32,
            alpha_threshold: g(16, 128.0).clamp(1.0, 255.0) as u8,
            scale: { let s = g(17, 1.0); if s > 0.0 { s } else { 1.0 } },
            line_tolerance: g(18, d.line_tolerance).clamp(0.05, 20.0),
        }
    }
}

/// A label map: `labels[y*w+x]` indexes `palette`, 255 = transparent.
#[derive(Clone, Debug)]
pub struct Segmentation {
    pub w: usize,
    pub h: usize,
    pub palette: Vec<[u8; 3]>,
    pub labels: Vec<u8>,
    /// Pixel scale of this map relative to the source (2 after upscaling).
    pub upscale: u8,
}

#[derive(Clone, Debug)]
pub struct Layer {
    pub color: [u8; 3],
    /// true = stroked centerlines, false = filled shapes.
    pub stroke: bool,
    pub stroke_width: f64,
    /// Pixel area of the colour in the label map.
    pub area: usize,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct TraceResult {
    pub width: f64,
    pub height: f64,
    pub layers: Vec<Layer>,
}

/// Stage 1: pixels → label map.
pub fn segment(rgba: &[u8], w: usize, h: usize, o: &Options, locked: &[[u8; 3]]) -> Segmentation {
    let mut img = preprocess::from_rgba(rgba, w, h, o.alpha_threshold);
    match o.denoise {
        1 => img = preprocess::median3(&img),
        2 => img = preprocess::bilateral(&img, 24.0),
        _ => {}
    }
    let up = if o.upscale >= 2 && w * h <= 6_000_000 { 2 } else { 1 };
    if up == 2 {
        img = preprocess::upscale2(&img);
    }
    let q = match o.mode {
        Mode::Bw | Mode::Centerline if locked.is_empty() && o.colors <= 2 => {
            quantize::binarize(&img, o.threshold, o.invert)
        }
        Mode::Gray => {
            preprocess::to_gray(&mut img);
            quantize::quantize(&img, o.colors, o.merge, locked)
        }
        _ => quantize::quantize(&img, o.colors, o.merge, locked),
    };
    let mut labels = q.labels;
    let (sw, sh) = (img.w, img.h);
    if o.mode != Mode::Pixel {
        cleanup::majority_filter(&mut labels, sw, sh, o.smooth_passes);
        let min_area = (o.speckle as usize) * (up * up);
        cleanup::remove_small_regions(&mut labels, sw, sh, min_area);
    }
    let palette = if locked.is_empty() { cleanup::compact(&mut labels, &q.palette) } else { q.palette };
    Segmentation { w: sw, h: sh, palette, labels, upscale: up as u8 }
}

fn potrace_params(o: &Options) -> Params {
    Params {
        turdsize: 0,
        turnpolicy: TurnPolicy::Minority,
        alphamax: if o.mode == Mode::Pixel { 0.0 } else { o.alphamax },
        opticurve: o.optimize && o.mode != Mode::Pixel,
        opttolerance: o.opttolerance,
    }
}

/// Builds a cropped bitmap of pixels for which `pred(label)` holds.
fn layer_bitmap(seg: &Segmentation, pred: &dyn Fn(u8) -> bool) -> Option<(Bitmap, usize, usize)> {
    let (w, h) = (seg.w, seg.h);
    let (mut minx, mut miny, mut maxx, mut maxy) = (usize::MAX, usize::MAX, 0usize, 0usize);
    for y in 0..h {
        let row = &seg.labels[y * w..(y + 1) * w];
        for (x, &l) in row.iter().enumerate() {
            if pred(l) {
                minx = minx.min(x);
                maxx = maxx.max(x);
                miny = miny.min(y);
                maxy = maxy.max(y);
            }
        }
    }
    if minx == usize::MAX {
        return None;
    }
    let (bw, bh) = (maxx - minx + 1, maxy - miny + 1);
    let mut bm = Bitmap::new(bw as i32, bh as i32);
    for y in 0..bh {
        let src = &seg.labels[(y + miny) * w + minx..(y + miny) * w + minx + bw];
        let dst = &mut bm.data[y * bw..(y + 1) * bw];
        for (d, &l) in dst.iter_mut().zip(src) {
            *d = pred(l) as u8;
        }
    }
    Some((bm, minx, miny))
}

/// Stage 2: label map → vector layers (bottom layer first).
pub fn vectorize(seg: &Segmentation, o: &Options) -> TraceResult {
    let n = seg.palette.len();
    let out_scale = o.scale / seg.upscale.max(1) as f64;
    let mut area = vec![0usize; n];
    for &l in &seg.labels {
        if (l as usize) < n {
            area[l as usize] += 1;
        }
    }
    let mut excluded = vec![false; n];
    let bg = cleanup::background_label(&seg.labels, seg.w, seg.h, n);
    let drop_bg = o.remove_bg || o.mode == Mode::Centerline || (o.mode == Mode::Bw && !o.stacked);
    if drop_bg {
        if let Some(b) = bg {
            excluded[b] = true;
        }
    }
    let mut order: Vec<usize> = (0..n).filter(|&i| area[i] > 0 && !excluded[i]).collect();
    order.sort_by(|&a, &b| area[b].cmp(&area[a]));

    let result_w = seg.w as f64 * out_scale;
    let result_h = seg.h as f64 * out_scale;
    let mut layers = Vec::with_capacity(order.len());

    if o.mode == Mode::Centerline {
        for &lab in &order {
            let mask: Vec<u8> = seg.labels.iter().map(|&l| (l as usize == lab) as u8).collect();
            let strokes = centerline::trace(
                &mask,
                seg.w,
                seg.h,
                &centerline::CenterlineParams {
                    tolerance: o.line_tolerance * seg.upscale as f64,
                    curves: o.curves,
                    min_length: (o.speckle as usize).max(2) * seg.upscale as usize,
                    scale: out_scale,
                    precision: o.precision,
                },
            );
            if strokes.is_empty() {
                continue;
            }
            let mut widths: Vec<f64> = strokes.iter().map(|s| s.width).collect();
            widths.sort_by(|a, b| a.total_cmp(b));
            let sw = widths[widths.len() / 2];
            layers.push(Layer {
                color: seg.palette[lab],
                stroke: true,
                stroke_width: (sw * 100.0).round() / 100.0,
                area: area[lab],
                paths: strokes.into_iter().map(|s| s.d).collect(),
            });
        }
        return TraceResult { width: result_w, height: result_h, layers };
    }

    let mut rank = vec![usize::MAX; 256];
    for (pos, &lab) in order.iter().enumerate() {
        rank[lab] = pos;
    }
    let params = potrace_params(o);
    let render = if o.mode == Mode::Pixel {
        Render::Pixels
    } else if o.curves {
        Render::Curves
    } else {
        Render::Polygon
    };
    for (pos, &lab) in order.iter().enumerate() {
        let stacked = o.stacked;
        let pred = |l: u8| -> bool {
            if l == TRANSPARENT {
                return false;
            }
            if stacked {
                rank[l as usize] != usize::MAX && rank[l as usize] >= pos
            } else {
                l as usize == lab
            }
        };
        let Some((bm, ox, oy)) = layer_bitmap(seg, &pred) else { continue };
        let paths = potrace::trace(&bm, &params);
        let tf = Transform { ox: ox as f64, oy: oy as f64, scale: out_scale, precision: o.precision };
        let d = potrace::to_compound_paths(&paths, render, &tf);
        if d.is_empty() {
            continue;
        }
        layers.push(Layer { color: seg.palette[lab], stroke: false, stroke_width: 0.0, area: area[lab], paths: d });
    }
    TraceResult { width: result_w, height: result_h, layers }
}

/// Convenience: segment + vectorize.
pub fn trace(rgba: &[u8], w: usize, h: usize, o: &Options, locked: &[[u8; 3]]) -> TraceResult {
    vectorize(&segment(rgba, w, h, o, locked), o)
}

fn hex(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

impl TraceResult {
    /// Compact JSON consumed by the MeowTrace app.
    pub fn to_json(&self) -> String {
        let mut s = String::with_capacity(1024 + self.layers.iter().map(|l| l.paths.iter().map(|p| p.len() + 3).sum::<usize>()).sum::<usize>());
        s.push_str("{\"w\":");
        geom::fmt_num(&mut s, self.width, 3);
        s.push_str(",\"h\":");
        geom::fmt_num(&mut s, self.height, 3);
        s.push_str(",\"layers\":[");
        for (i, l) in self.layers.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            s.push_str("{\"c\":\"");
            s.push_str(&hex(l.color));
            s.push_str("\",\"k\":");
            s.push_str(if l.stroke { "1" } else { "0" });
            s.push_str(",\"sw\":");
            geom::fmt_num(&mut s, l.stroke_width, 2);
            s.push_str(",\"a\":");
            s.push_str(&l.area.to_string());
            s.push_str(",\"p\":[");
            for (j, p) in l.paths.iter().enumerate() {
                if j > 0 {
                    s.push(',');
                }
                s.push('"');
                s.push_str(p);
                s.push('"');
            }
            s.push_str("]}");
        }
        s.push_str("]}");
        s
    }

    /// Standalone SVG document with one group per colour layer.
    pub fn to_svg(&self) -> String {
        let mut s = String::new();
        s.push_str("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ");
        geom::fmt_num(&mut s, self.width, 3);
        s.push(' ');
        geom::fmt_num(&mut s, self.height, 3);
        s.push_str("\">");
        for (i, l) in self.layers.iter().enumerate() {
            let c = hex(l.color);
            if l.stroke {
                s.push_str(&format!(
                    "<g id=\"layer-{}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{}\" stroke-linecap=\"round\" stroke-linejoin=\"round\">",
                    i + 1, c, l.stroke_width
                ));
            } else {
                s.push_str(&format!("<g id=\"layer-{}\" fill=\"{}\" fill-rule=\"evenodd\">", i + 1, c));
            }
            for p in &l.paths {
                s.push_str("<path d=\"");
                s.push_str(p);
                s.push_str("\"/>");
            }
            s.push_str("</g>");
        }
        s.push_str("</svg>");
        s
    }
}

impl analyze::Analysis {
    pub fn to_json(&self) -> String {
        format!(
            "{{\"kind\":\"{}\",\"colors\":{},\"gray\":{},\"transparent\":{},\"coverage\":{:.4}}}",
            self.kind, self.colors, self.gray, self.transparent, self.coverage
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logo(w: usize, h: usize) -> Vec<u8> {
        let mut px = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let (dx, dy) = (x as f64 - w as f64 / 2.0, y as f64 - h as f64 / 2.0);
                let r = (dx * dx + dy * dy).sqrt();
                let c: [u8; 3] = if r < 12.0 {
                    [255, 255, 255]
                } else if r < 30.0 {
                    [200, 20, 10]
                } else {
                    [255, 255, 255]
                };
                px[(y * w + x) * 4..(y * w + x) * 4 + 3].copy_from_slice(&c);
            }
        }
        px
    }

    #[test]
    fn traces_ring_logo_in_colour() {
        let (w, h) = (80, 80);
        let r = trace(&logo(w, h), w, h, &Options::default(), &[]);
        assert_eq!(r.layers.len(), 2, "white background + red ring");
        assert_eq!(r.layers[1].color, [200, 20, 10]);
        assert!(r.to_svg().starts_with("<svg"));
        assert!(r.to_json().contains("\"#c8140a\""));
    }

    #[test]
    fn remove_background_drops_white() {
        let (w, h) = (80, 80);
        let o = Options { remove_bg: true, ..Options::default() };
        let r = trace(&logo(w, h), w, h, &o, &[]);
        assert_eq!(r.layers.len(), 1);
        // The ring keeps its hole.
        assert_eq!(r.layers[0].paths[0].matches('M').count(), 2);
    }

    #[test]
    fn centerline_mode_returns_strokes() {
        let (w, h) = (80, 80);
        let o = Options { mode: Mode::Centerline, ..Options::default() };
        let r = trace(&logo(w, h), w, h, &o, &[]);
        assert!(!r.layers.is_empty());
        assert!(r.layers[0].stroke);
    }

    #[test]
    fn options_round_trip_defaults() {
        let o = Options::from_slice(&[]);
        assert_eq!(o.mode, Mode::Color);
        assert!(o.stacked && o.curves);
    }
}
