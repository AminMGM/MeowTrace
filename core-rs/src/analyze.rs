//! Automatic image classification (Vector Magic style "auto" settings).

use crate::preprocess::Rgb;
use crate::quantize::{dist2, histogram, oklab};

#[derive(Debug, Clone, PartialEq)]
pub struct Analysis {
    /// "photo", "logo", "logo-aa" (anti-aliased logo) or "lineart"
    pub kind: &'static str,
    pub colors: u32,
    pub gray: bool,
    pub transparent: bool,
    pub coverage: f32,
}

pub fn analyze(img: &Rgb) -> Analysis {
    let hist = histogram(img);
    let total = hist.total.max(1) as f32;
    let transparent = img.opaque.iter().any(|&o| !o);

    let mut bins: Vec<usize> = (0..32768).filter(|&b| hist.count[b] > 0).collect();
    bins.sort_by(|&a, &b| hist.count[b].cmp(&hist.count[a]));

    // Greedy clustering of the most common bins into dominant colours.
    const MERGE: f32 = 0.07;
    let mut centers: Vec<([f32; 3], f32)> = Vec::new();
    for &b in bins.iter().take(4096) {
        let c = hist.count[b] as f32;
        let s = hist.sum[b];
        let lab = oklab(
            (s[0] as f32 / c).round() as u8,
            (s[1] as f32 / c).round() as u8,
            (s[2] as f32 / c).round() as u8,
        );
        if let Some(e) = centers.iter_mut().find(|e| dist2(&e.0, &lab) < MERGE * MERGE) {
            e.1 += c;
        } else if centers.len() < 64 {
            centers.push((lab, c));
        }
    }
    centers.sort_by(|a, b| b.1.total_cmp(&a.1));
    let dominant: Vec<&([f32; 3], f32)> = centers.iter().filter(|c| c.1 / total >= 0.004).collect();

    // How many pixels lie very close to a dominant colour?
    let tight = 0.035f32 * 0.035;
    let mut near = 0f32;
    for &b in &bins {
        let c = hist.count[b] as f32;
        let s = hist.sum[b];
        let lab = oklab((s[0] as f32 / c) as u8, (s[1] as f32 / c) as u8, (s[2] as f32 / c) as u8);
        if dominant.iter().any(|d| dist2(&d.0, &lab) < tight) {
            near += c;
        }
    }
    let coverage = near / total;
    let gray = dominant.iter().all(|d| (d.0[1] * d.0[1] + d.0[2] * d.0[2]).sqrt() < 0.03);
    let n = dominant.len() as u32;

    let (kind, colors) = if coverage > 0.985 && n <= 24 {
        if gray && n <= 2 {
            ("lineart", 2)
        } else {
            ("logo", n.max(2))
        }
    } else if coverage > 0.86 && n <= 24 {
        if gray && n <= 2 {
            ("lineart", 2)
        } else {
            ("logo-aa", n.max(2))
        }
    } else {
        ("photo", 0)
    };
    Analysis { kind, colors, gray, transparent, coverage }
}
