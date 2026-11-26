//! Automatic image classification (Vector Magic style "auto" settings).

use crate::preprocess::Rgb;
use crate::quantize::{dist2, histogram, oklab, Histogram};

#[derive(Debug, Clone, PartialEq)]
pub struct Analysis {
    /// "photo", "logo", "logo-aa" (anti-aliased logo) or "lineart"
    pub kind: &'static str,
    pub colors: u32,
    pub gray: bool,
    pub transparent: bool,
    pub coverage: f32,
    /// Share of pixels inside flat (near-uniform) areas.
    pub flat: f32,
}

/// Opaque pixels whose 3×3 neighbourhood is nearly uniform. Colour statistics
/// are taken from these only, so anti-aliased edges and JPEG ringing around
/// them do not make a flat-colour graphic look like a photo.
fn flat_only(img: &Rgb) -> (Rgb, f32) {
    let (w, h) = (img.w, img.h);
    let mut out = img.clone();
    let (mut flat, mut opaque) = (0usize, 0usize);
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if !img.opaque[i] {
                continue;
            }
            opaque += 1;
            let mut range = 0i32;
            for yy in y.saturating_sub(1)..(y + 2).min(h) {
                for xx in x.saturating_sub(1)..(x + 2).min(w) {
                    let j = yy * w + xx;
                    let d: i32 = (0..3).map(|c| (img.px[j * 3 + c] as i32 - img.px[i * 3 + c] as i32).abs()).sum();
                    range = range.max(d);
                }
            }
            let is_flat = range <= 30;
            out.opaque[i] = is_flat;
            flat += is_flat as usize;
        }
    }
    (out, if opaque == 0 { 0.0 } else { flat as f32 / opaque as f32 })
}

/// Greedy clustering of the most common histogram bins into dominant
/// colours, plus the share of pixels within `tight` (OKLab) of one of them.
fn dominant(hist: &Histogram, tight: f32) -> (Vec<[f32; 3]>, f32) {
    let total = hist.total.max(1) as f32;
    let mut bins: Vec<usize> = (0..32768).filter(|&b| hist.count[b] > 0).collect();
    bins.sort_by(|&a, &b| hist.count[b].cmp(&hist.count[a]));
    let lab_of = |b: usize| {
        let c = hist.count[b] as f32;
        let s = hist.sum[b];
        oklab((s[0] as f32 / c).round() as u8, (s[1] as f32 / c).round() as u8, (s[2] as f32 / c).round() as u8)
    };
    const MERGE: f32 = 0.07;
    let mut centers: Vec<([f32; 3], f32)> = Vec::new();
    for &b in bins.iter().take(4096) {
        let lab = lab_of(b);
        let c = hist.count[b] as f32;
        if let Some(e) = centers.iter_mut().find(|e| dist2(&e.0, &lab) < MERGE * MERGE) {
            e.1 += c;
        } else if centers.len() < 64 {
            centers.push((lab, c));
        }
    }
    centers.sort_by(|a, b| b.1.total_cmp(&a.1));
    let dom: Vec<[f32; 3]> = centers.iter().filter(|c| c.1 / total >= 0.004).map(|c| c.0).collect();
    let near: f32 = bins
        .iter()
        .filter(|&&b| {
            let lab = lab_of(b);
            dom.iter().any(|d| dist2(d, &lab) < tight * tight)
        })
        .map(|&b| hist.count[b] as f32)
        .sum();
    (dom, near / total)
}

pub fn analyze(img: &Rgb) -> Analysis {
    let transparent = img.opaque.iter().any(|&o| !o);
    // Flat-colour vs photo is judged on the flat areas only; the colour count
    // and greyness on every pixel, so thin coloured details (text) count.
    let (flat_img, flat_share) = flat_only(img);
    let (_, coverage) = if flat_share >= 0.25 { dominant(&histogram(&flat_img), 0.05) } else { (vec![], 0.0) };
    let (all, _) = dominant(&histogram(img), 0.035);
    let gray = all.iter().all(|d| (d[1] * d[1] + d[2] * d[2]).sqrt() < 0.03);
    let n = all.len() as u32;

    let (kind, colors) = if coverage > 0.97 && n <= 24 {
        if gray && n <= 2 {
            ("lineart", 2)
        } else {
            ("logo", n.max(2))
        }
    } else if coverage > 0.85 && n <= 32 {
        if gray && n <= 2 {
            ("lineart", 2)
        } else {
            ("logo-aa", n.clamp(2, 24))
        }
    } else {
        ("photo", 0)
    };
    Analysis { kind, colors, gray, transparent, coverage, flat: flat_share }
}
