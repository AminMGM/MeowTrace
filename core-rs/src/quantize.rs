//! Colour quantization in OKLab: weighted k-means++ over a 15-bit colour
//! histogram, automatic colour-count detection, palette locking and
//! Otsu binarisation.

use crate::preprocess::{luma, Rgb};
use std::sync::OnceLock;

pub const TRANSPARENT: u8 = 255;

fn lin_table() -> &'static [f32; 256] {
    static T: OnceLock<[f32; 256]> = OnceLock::new();
    T.get_or_init(|| {
        let mut t = [0f32; 256];
        for (i, v) in t.iter_mut().enumerate() {
            let c = i as f32 / 255.0;
            *v = if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
        }
        t
    })
}

pub fn oklab_f(r: f32, g: f32, b: f32) -> [f32; 3] {
    let l = 0.412_221_46 * r + 0.536_332_55 * g + 0.051_445_995 * b;
    let m = 0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b;
    let s = 0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b;
    let (l, m, s) = (l.cbrt(), m.cbrt(), s.cbrt());
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

pub fn oklab(r: u8, g: u8, b: u8) -> [f32; 3] {
    let t = lin_table();
    oklab_f(t[r as usize], t[g as usize], t[b as usize])
}

/// Mean sRGB of a 5-bit bin → OKLab.
fn oklab_mean(sum: [u64; 3], count: u32) -> [f32; 3] {
    let c = count as f64;
    oklab(
        (sum[0] as f64 / c).round() as u8,
        (sum[1] as f64 / c).round() as u8,
        (sum[2] as f64 / c).round() as u8,
    )
}

#[inline]
pub fn dist2(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    let (d0, d1, d2) = (a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    d0 * d0 + d1 * d1 + d2 * d2
}

#[inline]
fn bin_of(r: u8, g: u8, b: u8) -> usize {
    ((r as usize >> 3) << 10) | ((g as usize >> 3) << 5) | (b as usize >> 3)
}

pub struct Histogram {
    pub count: Vec<u32>,
    pub sum: Vec<[u64; 3]>,
    pub total: u64,
}

pub fn histogram(img: &Rgb) -> Histogram {
    let mut count = vec![0u32; 32768];
    let mut sum = vec![[0u64; 3]; 32768];
    let mut total = 0u64;
    for (i, p) in img.px.chunks_exact(3).enumerate() {
        if !img.opaque[i] {
            continue;
        }
        let b = bin_of(p[0], p[1], p[2]);
        count[b] += 1;
        sum[b][0] += p[0] as u64;
        sum[b][1] += p[1] as u64;
        sum[b][2] += p[2] as u64;
        total += 1;
    }
    Histogram { count, sum, total }
}

struct Points {
    bins: Vec<usize>,
    lab: Vec<[f32; 3]>,
    w: Vec<f32>,
}

fn points(h: &Histogram) -> Points {
    let mut bins = Vec::new();
    let mut lab = Vec::new();
    let mut w = Vec::new();
    for b in 0..32768 {
        if h.count[b] > 0 {
            bins.push(b);
            lab.push(oklab_mean(h.sum[b], h.count[b]));
            w.push(h.count[b] as f32);
        }
    }
    Points { bins, lab, w }
}

struct Rng(u64);
impl Rng {
    fn next_f32(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
}

fn nearest(c: &[[f32; 3]], p: &[f32; 3]) -> usize {
    let mut best = 0;
    let mut bd = f32::MAX;
    for (i, ci) in c.iter().enumerate() {
        let d = dist2(ci, p);
        if d < bd {
            bd = d;
            best = i;
        }
    }
    best
}

fn kmeans_pp(pts: &Points, k: usize) -> Vec<[f32; 3]> {
    let n = pts.lab.len();
    let mut centers = Vec::with_capacity(k);
    let first = (0..n).max_by(|&a, &b| pts.w[a].total_cmp(&pts.w[b])).unwrap_or(0);
    centers.push(pts.lab[first]);
    let mut d = vec![f32::MAX; n];
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    while centers.len() < k {
        let last = *centers.last().unwrap();
        let mut total = 0f64;
        for i in 0..n {
            d[i] = d[i].min(dist2(&pts.lab[i], &last));
            total += (d[i] * pts.w[i]) as f64;
        }
        if total <= 0.0 {
            break;
        }
        let target = rng.next_f32() as f64 * total;
        let mut acc = 0f64;
        let mut pick = n - 1;
        for i in 0..n {
            acc += (d[i] * pts.w[i]) as f64;
            if acc >= target {
                pick = i;
                break;
            }
        }
        centers.push(pts.lab[pick]);
    }
    centers
}

fn lloyd(pts: &Points, centers: &mut [[f32; 3]], iters: usize) -> Vec<f32> {
    let k = centers.len();
    let mut weight = vec![0f32; k];
    for _ in 0..iters {
        let mut acc = vec![[0f64; 3]; k];
        weight.iter_mut().for_each(|w| *w = 0.0);
        for (i, p) in pts.lab.iter().enumerate() {
            let c = nearest(centers, p);
            let w = pts.w[i];
            acc[c][0] += (p[0] * w) as f64;
            acc[c][1] += (p[1] * w) as f64;
            acc[c][2] += (p[2] * w) as f64;
            weight[c] += w;
        }
        let mut moved = 0f32;
        for c in 0..k {
            if weight[c] > 0.0 {
                let wc = weight[c] as f64;
                let nc = [(acc[c][0] / wc) as f32, (acc[c][1] / wc) as f32, (acc[c][2] / wc) as f32];
                moved = moved.max(dist2(&nc, &centers[c]));
                centers[c] = nc;
            }
        }
        if moved < 1e-7 {
            break;
        }
    }
    weight
}

/// Merges centres closer than `merge` (OKLab distance) and drops tiny ones.
fn reduce(centers: &mut Vec<[f32; 3]>, weight: &mut Vec<f32>, merge: f32, min_weight: f32) {
    let m2 = merge * merge;
    loop {
        let mut best: Option<(usize, usize, f32)> = None;
        for i in 0..centers.len() {
            for j in i + 1..centers.len() {
                let d = dist2(&centers[i], &centers[j]);
                if d < m2 && best.is_none_or(|b| d < b.2) {
                    best = Some((i, j, d));
                }
            }
        }
        let Some((i, j, _)) = best else { break };
        let (wi, wj) = (weight[i].max(1e-6), weight[j].max(1e-6));
        let t = wi + wj;
        for c in 0..3 {
            centers[i][c] = (centers[i][c] * wi + centers[j][c] * wj) / t;
        }
        weight[i] = t;
        centers.remove(j);
        weight.remove(j);
    }
    if centers.len() > 2 {
        let mut i = 0;
        while i < centers.len() && centers.len() > 2 {
            if weight[i] < min_weight {
                centers.remove(i);
                weight.remove(i);
            } else {
                i += 1;
            }
        }
    }
}

pub struct Quantized {
    pub palette: Vec<[u8; 3]>,
    pub labels: Vec<u8>,
}

/// Quantizes to `k` colours (`k == 0` → automatic), or snaps to `locked`.
/// `snap_edges`: 0 = off, otherwise the image's upscale factor (1 or 2) —
/// the width of a blended edge band in pixels.
pub fn quantize(img: &Rgb, k: u32, merge: f32, locked: &[[u8; 3]], snap_edges: usize) -> Quantized {
    let hist = histogram(img);
    let pts = points(&hist);
    let n_px = img.w * img.h;
    if pts.lab.is_empty() {
        return Quantized { palette: vec![], labels: vec![TRANSPARENT; n_px] };
    }

    let centers: Vec<[f32; 3]>;
    let fixed_palette: Option<Vec<[u8; 3]>>;
    if !locked.is_empty() {
        centers = locked.iter().map(|c| oklab(c[0], c[1], c[2])).collect();
        fixed_palette = Some(locked.to_vec());
    } else {
        let auto = k == 0;
        let target = if auto { 32 } else { (k as usize).clamp(1, 250) };
        let target = target.min(pts.lab.len());
        let mut c = kmeans_pp(&pts, target);
        let mut weight = lloyd(&pts, &mut c, 24);
        if auto {
            let total: f32 = weight.iter().sum();
            reduce(&mut c, &mut weight, merge.max(0.01), total * 0.0008);
            lloyd(&pts, &mut c, 8);
            reduce(&mut c, &mut weight, merge.max(0.01), 0.0);
        } else {
            // Drop empty clusters so the palette never contains unused colours.
            let mut i = 0;
            while i < c.len() {
                if weight[i] <= 0.0 && c.len() > 1 {
                    c.remove(i);
                    weight.remove(i);
                } else {
                    i += 1;
                }
            }
        }
        centers = c;
        fixed_palette = None;
    }

    // Bin → label lookup.
    let mut bin_label = vec![0u8; 32768];
    for (i, &b) in pts.bins.iter().enumerate() {
        bin_label[b] = nearest(&centers, &pts.lab[i]) as u8;
    }
    // Bins re-assigned by edge snapping; left out of the palette averages so
    // blended pixels do not wash out the colours.
    let mut snapped = vec![false; 32768];
    if snap_edges > 0 && fixed_palette.is_none() && centers.len() > 2 {
        snap_antialiasing(img, &hist, &pts, &mut bin_label, &mut snapped, centers.len(), snap_edges);
    }
    let mut labels = vec![TRANSPARENT; n_px];
    // [pure pixels, all pixels] per label.
    let mut sums = vec![[[0u64; 4]; 2]; centers.len()];
    for (i, p) in img.px.chunks_exact(3).enumerate() {
        if !img.opaque[i] {
            continue;
        }
        let b = bin_of(p[0], p[1], p[2]);
        let l = bin_label[b];
        labels[i] = l;
        for s in sums[l as usize].iter_mut().skip(snapped[b] as usize) {
            s[0] += p[0] as u64;
            s[1] += p[1] as u64;
            s[2] += p[2] as u64;
            s[3] += 1;
        }
    }
    let palette = match fixed_palette {
        Some(p) => p,
        None => sums
            .iter()
            .map(|both| {
                let s = if both[0][3] > 0 { both[0] } else { both[1] };
                if s[3] == 0 {
                    [0, 0, 0]
                } else {
                    let c = s[3] as f64;
                    [(s[0] as f64 / c).round() as u8, (s[1] as f64 / c).round() as u8, (s[2] as f64 / c).round() as u8]
                }
            })
            .collect(),
    };
    Quantized { palette, labels }
}

/// Removes anti-aliasing colours: clusters that are thin (few pixels with all
/// four neighbours, up to `radius` away, in the same cluster) and whose colour lies on the line
/// between two other clusters are blends produced by edge smoothing. Without
/// this they trace as hairline outlines around every shape and eat into thin
/// strokes such as text. Their pixels are re-assigned to whichever of the two
/// end colours covers more of the pixel, which puts the edge where it really is.
fn snap_antialiasing(img: &Rgb, hist: &Histogram, pts: &Points, bin_label: &mut [u8], snapped: &mut [bool], k: usize, radius: usize) {
    let (w, h) = (img.w, img.h);
    // Mean sRGB per cluster.
    let mut acc = vec![[0f64; 4]; k];
    for &b in &pts.bins {
        let a = &mut acc[bin_label[b] as usize];
        a[0] += hist.sum[b][0] as f64;
        a[1] += hist.sum[b][1] as f64;
        a[2] += hist.sum[b][2] as f64;
        a[3] += hist.count[b] as f64;
    }
    let rgb: Vec<[f32; 3]> = acc
        .iter()
        .map(|a| if a[3] > 0.0 { [(a[0] / a[3]) as f32, (a[1] / a[3]) as f32, (a[2] / a[3]) as f32] } else { [0.0; 3] })
        .collect();
    // Share of each cluster's pixels that sit inside a solid area.
    let label_at = |i: usize| -> u8 {
        let p = &img.px[i * 3..i * 3 + 3];
        bin_label[bin_of(p[0], p[1], p[2])]
    };
    let mut labels = vec![TRANSPARENT; w * h];
    for i in 0..w * h {
        if img.opaque[i] {
            labels[i] = label_at(i);
        }
    }
    let mut interior = vec![0u64; k];
    let mut total = vec![0u64; k];
    for y in 0..h {
        for x in 0..w {
            let l = labels[y * w + x];
            if l == TRANSPARENT {
                continue;
            }
            total[l as usize] += 1;
            let same = |xx: usize, yy: usize| labels[yy * w + xx] == l;
            let solid = (1..=radius).all(|r| {
                (x < r || same(x - r, y)) && (x + r >= w || same(x + r, y)) && (y < r || same(x, y - r)) && (y + r >= h || same(x, y + r))
            });
            if solid {
                interior[l as usize] += 1;
            }
        }
    }
    let frac: Vec<f32> = (0..k).map(|c| if total[c] == 0 { 1.0 } else { interior[c] as f32 / total[c] as f32 }).collect();

    let mut order: Vec<usize> = (0..k).filter(|&c| total[c] > 0 && frac[c] < 0.1).collect();
    order.sort_by(|&a, &b| frac[a].total_cmp(&frac[b]));
    let mut removed = vec![false; k];
    for &c in &order {
        let kept: Vec<usize> = (0..k).filter(|&j| j != c && !removed[j] && total[j] > 0).collect();
        if kept.len() < 2 {
            break;
        }
        let mut between = false;
        'pairs: for (ai, &a) in kept.iter().enumerate() {
            for &b in &kept[ai + 1..] {
                let (t, d, len) = seg_project(&rgb[c], &rgb[a], &rgb[b]);
                if (0.06..=0.94).contains(&t) && d <= 8.0 + 0.08 * len {
                    between = true;
                    break 'pairs;
                }
            }
        }
        if between {
            removed[c] = true;
        }
    }
    if !removed.iter().any(|&r| r) {
        return;
    }
    let kept: Vec<usize> = (0..k).filter(|&j| !removed[j] && total[j] > 0).collect();
    for &b in &pts.bins {
        if !removed[bin_label[b] as usize] {
            continue;
        }
        let c = hist.sum[b];
        let n = hist.count[b] as f32;
        let p = [c[0] as f32 / n, c[1] as f32 / n, c[2] as f32 / n];
        let mut best = (f32::MAX, kept[0]);
        for (ai, &a) in kept.iter().enumerate() {
            let da = dist_rgb(&p, &rgb[a]);
            if da < best.0 {
                best = (da, a);
            }
            for &bb in &kept[ai + 1..] {
                let (t, d, _) = seg_project(&p, &rgb[a], &rgb[bb]);
                if (0.0..=1.0).contains(&t) && d < best.0 {
                    best = (d, if t < 0.5 { a } else { bb });
                }
            }
        }
        bin_label[b] = best.1 as u8;
        snapped[b] = true;
    }
}

#[inline]
fn dist_rgb(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// Projects `p` on the segment a→b: (t, distance to the line, segment length).
fn seg_project(p: &[f32; 3], a: &[f32; 3], b: &[f32; 3]) -> (f32, f32, f32) {
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    if len2 < 1.0 {
        return (-1.0, f32::MAX, 0.0);
    }
    let ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2;
    let q = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]];
    (t, dist_rgb(p, &q), len2.sqrt())
}

/// Otsu threshold over the luma of opaque pixels.
pub fn otsu(img: &Rgb) -> u8 {
    let mut hist = [0u64; 256];
    let mut total = 0u64;
    for (i, p) in img.px.chunks_exact(3).enumerate() {
        if img.opaque[i] {
            hist[luma(p[0], p[1], p[2]) as usize] += 1;
            total += 1;
        }
    }
    if total == 0 {
        return 128;
    }
    let sum_all: f64 = hist.iter().enumerate().map(|(i, &c)| i as f64 * c as f64).sum();
    let (mut sum_b, mut w_b) = (0f64, 0f64);
    let (mut best, mut best_t) = (-1f64, 128u8);
    for t in 0..256 {
        w_b += hist[t] as f64;
        if w_b == 0.0 {
            continue;
        }
        let w_f = total as f64 - w_b;
        if w_f == 0.0 {
            break;
        }
        sum_b += t as f64 * hist[t] as f64;
        let m_b = sum_b / w_b;
        let m_f = (sum_all - sum_b) / w_f;
        let between = w_b * w_f * (m_b - m_f) * (m_b - m_f);
        if between > best {
            best = between;
            best_t = t as u8;
        }
    }
    best_t
}

/// Black & white: label 0 = ink (black), 1 = paper (white).
pub fn binarize(img: &Rgb, threshold: i32, invert: bool) -> Quantized {
    let t = if threshold < 0 { otsu(img) as i32 } else { threshold.min(255) };
    let mut labels = vec![TRANSPARENT; img.w * img.h];
    for (i, p) in img.px.chunks_exact(3).enumerate() {
        if !img.opaque[i] {
            continue;
        }
        let dark = (luma(p[0], p[1], p[2]) as i32) <= t;
        labels[i] = if dark != invert { 0 } else { 1 };
    }
    Quantized { palette: vec![[0, 0, 0], [255, 255, 255]], labels }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn two_tone() -> Rgb {
        let (w, h) = (40, 20);
        let mut px = vec![0u8; w * h * 3];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 3;
                let c: [u8; 3] = if x < 20 { [200, 30, 20] } else { [20, 20, 30] };
                px[i..i + 3].copy_from_slice(&c);
            }
        }
        Rgb { w, h, px, opaque: vec![true; w * h] }
    }

    #[test]
    fn auto_finds_two_colours() {
        let q = quantize(&two_tone(), 0, 0.05, &[], 1);
        assert_eq!(q.palette.len(), 2);
    }

    #[test]
    fn locked_palette_is_exact() {
        let q = quantize(&two_tone(), 0, 0.05, &[[255, 0, 0], [0, 0, 0]], 1);
        assert_eq!(q.palette, vec![[255, 0, 0], [0, 0, 0]]);
        assert_eq!(q.labels[0], 0);
        assert_eq!(q.labels[39], 1);
    }
}
