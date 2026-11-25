//! Image pre-processing: alpha handling, denoise and upscaling.

/// RGB image plus an opacity mask.
#[derive(Clone)]
pub struct Rgb {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
    /// true = opaque pixel that takes part in tracing.
    pub opaque: Vec<bool>,
}

/// Splits RGBA into RGB composited over white plus an opacity mask.
pub fn from_rgba(rgba: &[u8], w: usize, h: usize, alpha_threshold: u8) -> Rgb {
    let n = w * h;
    let mut px = vec![0u8; n * 3];
    let mut opaque = vec![true; n];
    for i in 0..n {
        let a = rgba[i * 4 + 3] as u32;
        for c in 0..3 {
            let v = rgba[i * 4 + c] as u32;
            px[i * 3 + c] = ((v * a + 255 * (255 - a) + 127) / 255) as u8;
        }
        opaque[i] = rgba[i * 4 + 3] >= alpha_threshold.max(1);
    }
    Rgb { w, h, px, opaque }
}

/// 3×3 median per channel — removes salt-and-pepper and JPEG speckle.
pub fn median3(img: &Rgb) -> Rgb {
    let (w, h) = (img.w, img.h);
    let mut out = img.clone();
    if w < 3 || h < 3 {
        return out;
    }
    let mut win = [0u8; 9];
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            for c in 0..3 {
                let mut k = 0;
                for dy in 0..3 {
                    let row = (y + dy - 1) * w;
                    for dx in 0..3 {
                        win[k] = img.px[(row + x + dx - 1) * 3 + c];
                        k += 1;
                    }
                }
                win.sort_unstable();
                out.px[(y * w + x) * 3 + c] = win[4];
            }
        }
    }
    out
}

/// Edge-preserving smoothing (5×5 bilateral filter).
pub fn bilateral(img: &Rgb, sigma_range: f32) -> Rgb {
    let (w, h) = (img.w as i32, img.h as i32);
    let mut out = img.clone();
    let mut spatial = [0f32; 25];
    for dy in -2i32..=2 {
        for dx in -2i32..=2 {
            spatial[((dy + 2) * 5 + dx + 2) as usize] = (-((dx * dx + dy * dy) as f32) / (2.0 * 1.6 * 1.6)).exp();
        }
    }
    let mut range = [0f32; 766];
    let inv = 1.0 / (2.0 * sigma_range * sigma_range);
    for (d, r) in range.iter_mut().enumerate() {
        let d = d as f32 / 3.0;
        *r = (-(d * d) * inv).exp();
    }
    for y in 0..h {
        for x in 0..w {
            let ci = ((y * w + x) * 3) as usize;
            let (r0, g0, b0) = (img.px[ci] as i32, img.px[ci + 1] as i32, img.px[ci + 2] as i32);
            let (mut sr, mut sg, mut sb, mut sw) = (0f32, 0f32, 0f32, 0f32);
            for dy in -2i32..=2 {
                let yy = y + dy;
                if yy < 0 || yy >= h {
                    continue;
                }
                for dx in -2i32..=2 {
                    let xx = x + dx;
                    if xx < 0 || xx >= w {
                        continue;
                    }
                    let i = ((yy * w + xx) * 3) as usize;
                    let (r, g, b) = (img.px[i] as i32, img.px[i + 1] as i32, img.px[i + 2] as i32);
                    let diff = ((r - r0).abs() + (g - g0).abs() + (b - b0).abs()) as usize;
                    let wgt = spatial[((dy + 2) * 5 + dx + 2) as usize] * range[diff];
                    sr += wgt * r as f32;
                    sg += wgt * g as f32;
                    sb += wgt * b as f32;
                    sw += wgt;
                }
            }
            out.px[ci] = (sr / sw).round() as u8;
            out.px[ci + 1] = (sg / sw).round() as u8;
            out.px[ci + 2] = (sb / sw).round() as u8;
        }
    }
    out
}

/// 2× bilinear upscale. Interpolated edges give the quantizer sub-pixel
/// boundary positions, which makes small or low-res sources trace smoother.
pub fn upscale2(img: &Rgb) -> Rgb {
    let (w, h) = (img.w, img.h);
    let (nw, nh) = (w * 2, h * 2);
    let mut px = vec![0u8; nw * nh * 3];
    let mut opaque = vec![false; nw * nh];
    for y in 0..nh {
        let sy = ((y as f32 + 0.5) / 2.0 - 0.5).max(0.0);
        let y0 = (sy as usize).min(h - 1);
        let y1 = (y0 + 1).min(h - 1);
        let fy = sy - y0 as f32;
        for x in 0..nw {
            let sx = ((x as f32 + 0.5) / 2.0 - 0.5).max(0.0);
            let x0 = (sx as usize).min(w - 1);
            let x1 = (x0 + 1).min(w - 1);
            let fx = sx - x0 as f32;
            let o = (y * nw + x) * 3;
            for c in 0..3 {
                let a = img.px[(y0 * w + x0) * 3 + c] as f32;
                let b = img.px[(y0 * w + x1) * 3 + c] as f32;
                let cc = img.px[(y1 * w + x0) * 3 + c] as f32;
                let d = img.px[(y1 * w + x1) * 3 + c] as f32;
                let top = a + (b - a) * fx;
                let bot = cc + (d - cc) * fx;
                px[o + c] = (top + (bot - top) * fy).round() as u8;
            }
            opaque[y * nw + x] = img.opaque[(y / 2) * w + x / 2];
        }
    }
    Rgb { w: nw, h: nh, px, opaque }
}

/// Replaces colours by their luma.
pub fn to_gray(img: &mut Rgb) {
    for p in img.px.chunks_exact_mut(3) {
        let l = luma(p[0], p[1], p[2]);
        p[0] = l;
        p[1] = l;
        p[2] = l;
    }
}

#[inline]
pub fn luma(r: u8, g: u8, b: u8) -> u8 {
    ((299 * r as u32 + 587 * g as u32 + 114 * b as u32 + 500) / 1000) as u8
}
