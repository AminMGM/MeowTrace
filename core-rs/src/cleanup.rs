//! Label-map clean-up: majority smoothing, speckle removal and palette compaction.

use crate::quantize::TRANSPARENT;

/// Edge smoothing: re-labels stray pixels (at most one same-label neighbour
/// out of eight) that sit inside a clearly dominant label. Pixels that
/// continue a line — straight or diagonal — always have two same-label
/// neighbours, so thin strokes, text and sharp tips survive any number of passes.
pub fn majority_filter(labels: &mut [u8], w: usize, h: usize, passes: u32) {
    if w < 3 || h < 3 {
        return;
    }
    for _ in 0..passes {
        let src = labels.to_vec();
        let mut changed = false;
        for y in 1..h - 1 {
            for x in 1..w - 1 {
                let i = y * w + x;
                let cur = src[i];
                let nb = [src[i - w - 1], src[i - w], src[i - w + 1], src[i - 1], src[i + 1], src[i + w - 1], src[i + w], src[i + w + 1]];
                if nb.iter().filter(|&&l| l == cur).count() > 1 {
                    continue;
                }
                let mut best = cur;
                let mut best_count = 0;
                for &c in &nb {
                    let n = nb.iter().filter(|&&l| l == c).count();
                    if c != cur && n > best_count {
                        best_count = n;
                        best = c;
                    }
                }
                if best_count >= 5 {
                    labels[i] = best;
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
}

/// Merges regions smaller than `min_area` into the neighbouring label they
/// share the longest border with. Regions are 8-connected so diagonal strokes
/// (common in small text) count as one region instead of many specks.
pub fn remove_small_regions(labels: &mut [u8], w: usize, h: usize, min_area: usize) {
    if min_area <= 1 || w == 0 || h == 0 {
        return;
    }
    let n = w * h;
    for _pass in 0..3 {
        let mut comp = vec![u32::MAX; n];
        let mut order: Vec<u32> = Vec::with_capacity(n);
        let mut comps: Vec<(u32, u32)> = Vec::new(); // (start, len)
        let mut stack: Vec<u32> = Vec::new();
        for s in 0..n {
            if comp[s] != u32::MAX {
                continue;
            }
            let id = comps.len() as u32;
            let lab = labels[s];
            let start = order.len() as u32;
            comp[s] = id;
            stack.push(s as u32);
            while let Some(p) = stack.pop() {
                order.push(p);
                let p = p as usize;
                let (x, y) = (p % w, p / w);
                let mut visit = |q: usize| {
                    if comp[q] == u32::MAX && labels[q] == lab {
                        comp[q] = id;
                        stack.push(q as u32);
                    }
                };
                if x > 0 {
                    visit(p - 1);
                }
                if x + 1 < w {
                    visit(p + 1);
                }
                if y > 0 {
                    visit(p - w);
                }
                if y + 1 < h {
                    visit(p + w);
                }
                if y > 0 && x > 0 {
                    visit(p - w - 1);
                }
                if y > 0 && x + 1 < w {
                    visit(p - w + 1);
                }
                if y + 1 < h && x > 0 {
                    visit(p + w - 1);
                }
                if y + 1 < h && x + 1 < w {
                    visit(p + w + 1);
                }
            }
            comps.push((start, order.len() as u32 - start));
        }
        let mut small: Vec<usize> = (0..comps.len()).filter(|&c| (comps[c].1 as usize) < min_area).collect();
        if small.is_empty() || comps.len() == 1 {
            return;
        }
        small.sort_by_key(|&c| comps[c].1);
        let mut counts = [0u32; 256];
        let mut touched: Vec<u8> = Vec::with_capacity(16);
        let mut changed = false;
        for ci in small {
            let (start, len) = comps[ci];
            let own = labels[order[start as usize] as usize];
            for &p in &order[start as usize..(start + len) as usize] {
                let p = p as usize;
                let (x, y) = (p % w, p / w);
                let mut look = |q: usize| {
                    if comp[q] != ci as u32 {
                        let l = labels[q];
                        if counts[l as usize] == 0 {
                            touched.push(l);
                        }
                        counts[l as usize] += 1;
                    }
                };
                if x > 0 {
                    look(p - 1);
                }
                if x + 1 < w {
                    look(p + 1);
                }
                if y > 0 {
                    look(p - w);
                }
                if y + 1 < h {
                    look(p + w);
                }
            }
            let mut best = own;
            let mut best_count = 0;
            for &l in &touched {
                if counts[l as usize] > best_count {
                    best_count = counts[l as usize];
                    best = l;
                }
            }
            for &l in &touched {
                counts[l as usize] = 0;
            }
            touched.clear();
            if best != own {
                for &p in &order[start as usize..(start + len) as usize] {
                    labels[p as usize] = best;
                }
                changed = true;
            }
        }
        if !changed {
            return;
        }
    }
}

/// Drops unused palette entries and remaps labels; returns the new palette.
pub fn compact(labels: &mut [u8], palette: &[[u8; 3]]) -> Vec<[u8; 3]> {
    let mut used = vec![false; palette.len()];
    for &l in labels.iter() {
        if l != TRANSPARENT && (l as usize) < palette.len() {
            used[l as usize] = true;
        }
    }
    let mut remap = [TRANSPARENT; 256];
    let mut out = Vec::new();
    for (i, &u) in used.iter().enumerate() {
        if u {
            remap[i] = out.len() as u8;
            out.push(palette[i]);
        }
    }
    for l in labels.iter_mut() {
        if *l != TRANSPARENT {
            *l = remap[*l as usize];
        }
    }
    out
}

/// The label that dominates the image border, if it covers at least a quarter of it.
pub fn background_label(labels: &[u8], w: usize, h: usize, n: usize) -> Option<usize> {
    if w == 0 || h == 0 || n == 0 {
        return None;
    }
    let mut counts = vec![0usize; n];
    let mut total = 0usize;
    let mut add = |l: u8| {
        total += 1;
        if (l as usize) < n {
            counts[l as usize] += 1;
        }
    };
    for x in 0..w {
        add(labels[x]);
        add(labels[(h - 1) * w + x]);
    }
    for y in 1..h.saturating_sub(1) {
        add(labels[y * w]);
        add(labels[y * w + w - 1]);
    }
    let (best, &count) = counts.iter().enumerate().max_by_key(|(_, &c)| c)?;
    if count * 4 >= total {
        Some(best)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_speckles() {
        let (w, h) = (10, 10);
        let mut l = vec![0u8; w * h];
        l[55] = 1;
        remove_small_regions(&mut l, w, h, 4);
        assert!(l.iter().all(|&v| v == 0));
    }

    #[test]
    fn compacts_palette() {
        let mut l = vec![2u8, 2, 0, TRANSPARENT];
        let p = compact(&mut l, &[[1, 1, 1], [2, 2, 2], [3, 3, 3]]);
        assert_eq!(p, vec![[1, 1, 1], [3, 3, 3]]);
        assert_eq!(l, vec![1, 1, 0, TRANSPARENT]);
    }
}
