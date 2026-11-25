//! Centerline tracing: skeletonise a mask (Zhang–Suen), walk the skeleton
//! graph into polylines, prune spurs, simplify, and fit smooth strokes.

use crate::geom::*;
use std::collections::HashMap;

pub struct Stroke {
    pub d: String,
    pub width: f64,
}

pub struct CenterlineParams {
    pub tolerance: f64,
    pub curves: bool,
    pub min_length: usize,
    pub scale: f64,
    pub precision: u8,
}

/// Chamfer (3-4) distance to the nearest background pixel, in pixels.
fn distance(mask: &[u8], w: usize, h: usize) -> Vec<f32> {
    const INF: u32 = u32::MAX / 4;
    let mut d: Vec<u32> = mask.iter().map(|&m| if m != 0 { INF } else { 0 }).collect();
    let get = |d: &Vec<u32>, x: i64, y: i64| -> u32 {
        if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
            0
        } else {
            d[y as usize * w + x as usize]
        }
    };
    for y in 0..h as i64 {
        for x in 0..w as i64 {
            let i = y as usize * w + x as usize;
            if d[i] == 0 {
                continue;
            }
            d[i] = d[i]
                .min(get(&d, x - 1, y) + 3)
                .min(get(&d, x, y - 1) + 3)
                .min(get(&d, x - 1, y - 1) + 4)
                .min(get(&d, x + 1, y - 1) + 4);
        }
    }
    for y in (0..h as i64).rev() {
        for x in (0..w as i64).rev() {
            let i = y as usize * w + x as usize;
            if d[i] == 0 {
                continue;
            }
            d[i] = d[i]
                .min(get(&d, x + 1, y) + 3)
                .min(get(&d, x, y + 1) + 3)
                .min(get(&d, x + 1, y + 1) + 4)
                .min(get(&d, x - 1, y + 1) + 4);
        }
    }
    d.iter().map(|&v| v as f32 / 3.0).collect()
}

/// Zhang–Suen thinning on a padded copy of the mask.
fn thin(mask: &[u8], w: usize, h: usize) -> (Vec<u8>, usize) {
    let pw = w + 2;
    let ph = h + 2;
    let mut img = vec![0u8; pw * ph];
    let mut active: Vec<usize> = Vec::new();
    for y in 0..h {
        for x in 0..w {
            if mask[y * w + x] != 0 {
                let i = (y + 1) * pw + x + 1;
                img[i] = 1;
                active.push(i);
            }
        }
    }
    let mut del = Vec::new();
    loop {
        let mut changed = false;
        for step in 0..2 {
            del.clear();
            for &i in &active {
                if img[i] == 0 {
                    continue;
                }
                let p2 = img[i - pw];
                let p3 = img[i - pw + 1];
                let p4 = img[i + 1];
                let p5 = img[i + pw + 1];
                let p6 = img[i + pw];
                let p7 = img[i + pw - 1];
                let p8 = img[i - 1];
                let p9 = img[i - pw - 1];
                let b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                if !(2..=6).contains(&b) {
                    continue;
                }
                let seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
                let a = seq.windows(2).filter(|s| s[0] == 0 && s[1] == 1).count();
                if a != 1 {
                    continue;
                }
                let ok = if step == 0 {
                    p2 * p4 * p6 == 0 && p4 * p6 * p8 == 0
                } else {
                    p2 * p4 * p8 == 0 && p2 * p6 * p8 == 0
                };
                if ok {
                    del.push(i);
                }
            }
            if !del.is_empty() {
                changed = true;
                for &i in &del {
                    img[i] = 0;
                }
            }
        }
        active.retain(|&i| img[i] != 0);
        if !changed {
            break;
        }
    }
    // Remove staircase corners (a pixel whose only neighbours are two
    // perpendicular 4-neighbours) so diagonals become clean 8-connected runs.
    for &i in &active {
        let n = img[i - pw];
        let e = img[i + 1];
        let s = img[i + pw];
        let wv = img[i - 1];
        let diag = img[i - pw + 1] + img[i + pw + 1] + img[i + pw - 1] + img[i - pw - 1];
        let four = n + e + s + wv;
        if four == 2 && diag == 0 && ((n == 1 && e == 1) || (e == 1 && s == 1) || (s == 1 && wv == 1) || (wv == 1 && n == 1)) {
            img[i] = 0;
        }
    }
    (img, pw)
}

const NB: [(i64, i64); 8] = [(0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (1, 1), (-1, 1), (-1, -1)];
const NONE: usize = usize::MAX;

/// A traced skeleton polyline. `ends` holds a node key per end: a junction
/// cluster id (< number of clusters) or `NONE - pixel` for free endpoints.
struct Line {
    px: Vec<usize>,
    closed: bool,
    ends: [usize; 2],
}

/// Walks the skeleton graph into polylines. Adjacent junction pixels are
/// merged into clusters so a crossing yields one node rather than a knot of
/// 1-pixel edges; returns the lines and each cluster's centre.
fn walk(img: &[u8], pw: usize) -> (Vec<Line>, Vec<(f64, f64)>) {
    let neighbours = |i: usize| -> Vec<usize> {
        let mut v = Vec::with_capacity(8);
        for &(dx, dy) in NB.iter() {
            let j = (i as i64 + dy * pw as i64 + dx) as usize;
            if img[j] != 0 {
                v.push(j);
            }
        }
        v
    };
    let mut deg = vec![0u8; img.len()];
    let mut pixels = Vec::new();
    for i in 0..img.len() {
        if img[i] != 0 {
            deg[i] = neighbours(i).len() as u8;
            pixels.push(i);
        }
    }

    let mut cluster = vec![NONE; img.len()];
    let mut centres: Vec<(f64, f64)> = Vec::new();
    for &s in &pixels {
        if deg[s] < 3 || cluster[s] != NONE {
            continue;
        }
        let id = centres.len();
        let (mut sx, mut sy, mut n) = (0f64, 0f64, 0f64);
        let mut stack = vec![s];
        cluster[s] = id;
        while let Some(p) = stack.pop() {
            sx += (p % pw) as f64;
            sy += (p / pw) as f64;
            n += 1.0;
            for q in neighbours(p) {
                if deg[q] >= 3 && cluster[q] == NONE {
                    cluster[q] = id;
                    stack.push(q);
                }
            }
        }
        centres.push((sx / n, sy / n));
    }
    let is_node = |i: usize| deg[i] != 2;
    let key = |i: usize| if cluster[i] != NONE { cluster[i] } else { NONE - i };

    let mut visited = vec![false; img.len()];
    let mut out = Vec::new();
    for &s in &pixels {
        if !is_node(s) {
            continue;
        }
        if deg[s] == 0 {
            out.push(Line { px: vec![s], closed: false, ends: [key(s), key(s)] });
            continue;
        }
        for first in neighbours(s) {
            if is_node(first) {
                if s < first && key(s) != key(first) {
                    out.push(Line { px: vec![s, first], closed: false, ends: [key(s), key(first)] });
                }
                continue;
            }
            if visited[first] {
                continue;
            }
            let mut line = vec![s, first];
            visited[first] = true;
            let (mut prev, mut cur) = (s, first);
            loop {
                let next = neighbours(cur).into_iter().find(|&n| n != prev && (is_node(n) || !visited[n]));
                match next {
                    Some(n) => {
                        line.push(n);
                        if is_node(n) {
                            break;
                        }
                        visited[n] = true;
                        prev = cur;
                        cur = n;
                    }
                    None => break,
                }
            }
            let end = *line.last().unwrap();
            out.push(Line { px: line, closed: false, ends: [key(s), key(end)] });
        }
    }
    // Closed loops without any node.
    for &s in &pixels {
        if visited[s] || is_node(s) {
            continue;
        }
        let mut line = vec![s];
        visited[s] = true;
        let (mut prev, mut cur) = (NONE, s);
        loop {
            let next = neighbours(cur).into_iter().find(|&n| n != prev && !visited[n]);
            match next {
                Some(n) => {
                    visited[n] = true;
                    line.push(n);
                    prev = cur;
                    cur = n;
                }
                None => break,
            }
        }
        out.push(Line { px: line, closed: true, ends: [NONE, NONE] });
    }
    (out, centres)
}

fn rdp(pts: &[P], tol: f64, out: &mut Vec<P>) {
    if pts.len() < 3 {
        out.extend_from_slice(pts);
        return;
    }
    let mut keep = vec![false; pts.len()];
    keep[0] = true;
    keep[pts.len() - 1] = true;
    let mut stack = vec![(0usize, pts.len() - 1)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (pa, pb) = (pts[a], pts[b]);
        let len = ddist(pa, pb);
        let mut best = (0.0, a);
        for (i, &q) in pts.iter().enumerate().take(b).skip(a + 1) {
            let d = if len == 0.0 { ddist(q, pa) } else { dpara(pa, pb, q).abs() / len };
            if d > best.0 {
                best = (d, i);
            }
        }
        if best.0 > tol {
            keep[best.1] = true;
            stack.push((a, best.1));
            stack.push((best.1, b));
        }
    }
    for (i, k) in keep.iter().enumerate() {
        if *k {
            out.push(pts[i]);
        }
    }
}

/// Moving-average smoothing (window 5); open ends stay fixed.
fn smooth_points(pts: &[P], closed: bool, passes: usize) -> Vec<P> {
    let n = pts.len();
    if n < 5 {
        return pts.to_vec();
    }
    let mut cur = pts.to_vec();
    for _ in 0..passes {
        let mut next = cur.clone();
        for i in 0..n {
            if !closed && (i < 2 || i + 2 >= n) {
                continue;
            }
            let mut s = P::default();
            for k in 0..5 {
                let j = (i + n + k - 2) % n;
                s.x += cur[j].x;
                s.y += cur[j].y;
            }
            next[i] = P::new(s.x / 5.0, s.y / 5.0);
        }
        cur = next;
    }
    cur
}

fn rdp_indices(pts: &[P], tol: f64) -> Vec<usize> {
    let n = pts.len();
    if n < 3 {
        return (0..n).collect();
    }
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;
    let mut stack = vec![(0usize, n - 1)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (pa, pb) = (pts[a], pts[b]);
        let len = ddist(pa, pb);
        let mut best = (0.0, a);
        for (i, &q) in pts.iter().enumerate().take(b).skip(a + 1) {
            let d = if len == 0.0 { ddist(q, pa) } else { dpara(pa, pb, q).abs() / len };
            if d > best.0 {
                best = (d, i);
            }
        }
        if best.0 > tol {
            keep[best.1] = true;
            stack.push((a, best.1));
            stack.push((best.1, b));
        }
    }
    (0..n).filter(|&i| keep[i]).collect()
}

/// Smooths a polyline while pinning sharp corners in place.
fn smooth_keep_corners(pts: &[P], closed: bool, tol: f64, min_arm: f64) -> (Vec<P>, Vec<bool>) {
    let n = pts.len();
    if n < 5 {
        return (pts.to_vec(), vec![false; n]);
    }
    let coarse = rdp_indices(pts, tol);
    let zone = min_arm * 1.5;
    // Group runs of coarse vertices that sit close together (a rounded-off
    // corner usually yields two or three), then measure the turn between the
    // arms entering and leaving the group.
    let mut found: Vec<(usize, usize, usize, usize)> = Vec::new(); // (prev, first, last, next)
    let mut j = 1;
    while j + 1 < coarse.len() {
        let mut g = j;
        while g + 2 < coarse.len() && ddist(pts[coarse[g]], pts[coarse[g + 1]]) < zone {
            g += 1;
        }
        let (ia, k0, k1, ic) = (coarse[j - 1], coarse[j], coarse[g], coarse[g + 1]);
        let (a, b0, b1, c) = (pts[ia], pts[k0], pts[k1], pts[ic]);
        let (l1, l2) = (ddist(a, b0), ddist(b1, c));
        if l1 >= min_arm && l2 >= min_arm {
            let cos = ((b0.x - a.x) * (c.x - b1.x) + (b0.y - a.y) * (c.y - b1.y)) / (l1 * l2);
            if cos < 0.5 {
                found.push((ia, k0, k1, ic));
            }
        }
        j = g + 1;
    }
    if found.is_empty() {
        return (smooth_points(pts, closed, 2), vec![false; n]);
    }
    // Thinning rounds acute corners off. Rebuild each corner as the
    // intersection of its two arms, replacing the rounded zone.
    let half = zone * 0.5;
    let mut plan: Vec<(usize, usize, P)> = Vec::new(); // replace pts[a..b] with one point
    for &(ia, k0, k1, ic) in &found {
        let mut i0 = k0;
        while i0 > ia && ddist(pts[i0], pts[k0]) < half {
            i0 -= 1;
        }
        let mut i1 = k1;
        while i1 < ic && ddist(pts[i1], pts[k1]) < half {
            i1 += 1;
        }
        let mid = (k0 + k1) / 2;
        let mut repl = (mid, mid + 1, pts[mid]);
        let (p0, q0, p1, q1) = (pts[ia], pts[i0], pts[ic], pts[i1]);
        let (d1, d2) = (P::new(q0.x - p0.x, q0.y - p0.y), P::new(q1.x - p1.x, q1.y - p1.y));
        let den = d1.x * d2.y - d1.y * d2.x;
        if i0 > ia && i1 < ic && den.abs() > 1e-9 {
            let t = ((p1.x - p0.x) * d2.y - (p1.y - p0.y) * d2.x) / den;
            let x = P::new(p0.x + d1.x * t, p0.y + d1.y * t);
            if t > 0.0 && ddist(x, pts[mid]) < zone * 2.0 {
                repl = (i0 + 1, i1, x);
            }
        }
        if plan.last().is_none_or(|l| repl.0 >= l.1) {
            plan.push(repl);
        }
    }
    let mut rebuilt: Vec<P> = Vec::with_capacity(n);
    let mut corners: Vec<usize> = Vec::new();
    let mut i = 0;
    for &(a, b, x) in &plan {
        rebuilt.extend_from_slice(&pts[i..a]);
        corners.push(rebuilt.len());
        rebuilt.push(x);
        i = b;
    }
    rebuilt.extend_from_slice(&pts[i..]);
    let pts = rebuilt;
    let n = pts.len();
    let mut out: Vec<P> = Vec::with_capacity(n);
    let mut flags: Vec<bool> = Vec::with_capacity(n);
    let mut bounds = vec![0usize];
    bounds.extend(corners.iter().copied().filter(|&c| c > 0 && c < n - 1));
    bounds.push(n - 1);
    for w in bounds.windows(2) {
        let piece = smooth_points(&pts[w[0]..=w[1]], false, 2);
        if !out.is_empty() {
            out.pop();
            flags.pop();
        }
        let len = piece.len();
        out.extend(piece);
        flags.extend((0..len).map(|k| k == 0 || k == len - 1));
    }
    // Only the reconstructed corners are hard corners; piece ends at the
    // polyline ends are handled by the caller.
    let last = flags.len() - 1;
    flags[0] = false;
    flags[last] = false;
    (out, flags)
}

/// Simplifies a polyline piecewise between hard corners and removes points
/// that crowd their neighbours; corners and ends are always kept.
fn simplify(pts: &[P], corner: &[bool], tol: f64, closed: bool) -> (Vec<P>, Vec<bool>) {
    let n = pts.len();
    if n < 3 {
        return (pts.to_vec(), corner.to_vec());
    }
    let mut cuts: Vec<usize> = (1..n - 1).filter(|&i| corner[i]).collect();
    cuts.insert(0, 0);
    cuts.push(n - 1);
    let mut out: Vec<P> = Vec::new();
    let mut flags: Vec<bool> = Vec::new();
    for w in cuts.windows(2) {
        let piece = &pts[w[0]..=w[1]];
        let mut simp: Vec<P> = Vec::new();
        if closed && cuts.len() == 2 && piece.len() > 3 {
            // A loop without corners: simplify as a ring.
            let mut ring = piece.to_vec();
            ring.push(piece[0]);
            rdp(&ring, tol, &mut simp);
            simp.pop();
        } else {
            rdp(piece, tol, &mut simp);
        }
        // Drop interior points crowding the previous point or the piece end.
        let min = tol * 1.5;
        let end = *simp.last().unwrap();
        let mut kept: Vec<P> = vec![simp[0]];
        for &q in &simp[1..simp.len() - 1] {
            if ddist(*kept.last().unwrap(), q) >= min && ddist(q, end) >= min {
                kept.push(q);
            }
        }
        if simp.len() > 1 {
            kept.push(end);
        }
        if !out.is_empty() {
            out.pop();
            flags.pop();
        }
        let len = kept.len();
        out.extend(kept);
        flags.extend((0..len).map(|k| (k == 0 && w[0] != 0) || (k == len - 1 && w[1] != n - 1)));
    }
    (out, flags)
}

fn write_smooth(out: &mut String, pts: &[P], hard: &[bool], closed: bool, curves: bool, scale: f64, prec: u8) {
    let s = |p: P| P::new(p.x * scale, p.y * scale);
    let n = pts.len();
    out.push('M');
    push_pt(out, s(pts[0]), prec);
    if n == 1 {
        out.push_str("h.01");
        return;
    }
    let segs = if closed { n } else { n - 1 };
    let corner = |i: usize| -> bool {
        if (!closed && (i == 0 || i == n - 1)) || hard.get(i).copied().unwrap_or(false) {
            return true;
        }
        let a = pts[(i + n - 1) % n];
        let b = pts[i];
        let c = pts[(i + 1) % n];
        let (v1, v2) = (P::new(b.x - a.x, b.y - a.y), P::new(c.x - b.x, c.y - b.y));
        let l = (v1.x.hypot(v1.y) * v2.x.hypot(v2.y)).max(1e-9);
        (v1.x * v2.x + v1.y * v2.y) / l < 0.5 // turns sharper than 60°
    };
    // Unit tangent: bisector of the incoming and outgoing directions.
    let tangent = |i: usize| -> P {
        if corner(i) {
            return P::default();
        }
        let a = pts[(i + n - 1) % n];
        let b = pts[i];
        let c = pts[(i + 1) % n];
        let l1 = ddist(a, b).max(1e-9);
        let l2 = ddist(b, c).max(1e-9);
        let t = P::new((b.x - a.x) / l1 + (c.x - b.x) / l2, (b.y - a.y) / l1 + (c.y - b.y) / l2);
        let l = t.x.hypot(t.y);
        if l < 1e-9 {
            P::default()
        } else {
            P::new(t.x / l, t.y / l)
        }
    };
    for k in 0..segs {
        let (i, j) = (k, (k + 1) % n);
        if !curves {
            out.push('L');
            push_pt(out, s(pts[j]), prec);
            continue;
        }
        let (ti, tj) = (tangent(i), tangent(j));
        if ti == P::default() && tj == P::default() {
            out.push('L');
            push_pt(out, s(pts[j]), prec);
            continue;
        }
        // Handle length: a third of this segment's chord.
        let h = ddist(pts[i], pts[j]) / 3.0;
        out.push('C');
        push_pt(out, s(P::new(pts[i].x + ti.x * h, pts[i].y + ti.y * h)), prec);
        out.push(' ');
        push_pt(out, s(P::new(pts[j].x - tj.x * h, pts[j].y - tj.y * h)), prec);
        out.push(' ');
        push_pt(out, s(pts[j]), prec);
    }
    if closed {
        out.push('Z');
    }
}

/// Joins lines meeting at a junction cluster that has exactly two arms left
/// (typically after spur pruning), so smooth strokes are not split.
fn join_through_degree2(lines: Vec<Line>, n_clusters: usize) -> Vec<Line> {
    let mut slots: Vec<Option<Line>> = lines.into_iter().map(Some).collect();
    loop {
        let mut at: Vec<Vec<(usize, usize)>> = vec![Vec::new(); n_clusters];
        for (i, l) in slots.iter().enumerate() {
            if let Some(l) = l {
                if l.closed || l.px.len() < 2 {
                    continue;
                }
                for (e, &k) in l.ends.iter().enumerate() {
                    if k < n_clusters {
                        at[k].push((i, e));
                    }
                }
            }
        }
        let mut merged_any = false;
        let mut touched = vec![false; slots.len()];
        for arms in at.iter() {
            if arms.len() != 2 {
                continue;
            }
            let (ia, ea) = arms[0];
            let (ib, eb) = arms[1];
            if touched[ia] || touched[ib] {
                continue;
            }
            if ia == ib {
                // Both ends of one line meet here: it is a loop.
                if let Some(l) = slots[ia].as_mut() {
                    l.closed = true;
                    l.ends = [NONE, NONE];
                }
                touched[ia] = true;
                merged_any = true;
                continue;
            }
            let mut a = slots[ia].take().unwrap();
            let mut b = slots[ib].take().unwrap();
            if ea == 0 {
                a.px.reverse();
                a.ends.swap(0, 1);
            }
            if eb == 1 {
                b.px.reverse();
                b.ends.swap(0, 1);
            }
            a.px.extend_from_slice(&b.px);
            a.ends[1] = b.ends[1];
            slots[ia] = Some(a);
            touched[ia] = true;
            touched[ib] = true;
            merged_any = true;
        }
        if !merged_any {
            break;
        }
    }
    slots.into_iter().flatten().collect()
}

/// Traces the centerlines of the set pixels in `mask`.
pub fn trace(mask: &[u8], w: usize, h: usize, p: &CenterlineParams) -> Vec<Stroke> {
    if w == 0 || h == 0 {
        return Vec::new();
    }
    let dist = distance(mask, w, h);
    let (skel, pw) = thin(mask, w, h);
    let (mut lines, centres) = walk(&skel, pw);
    let n_clusters = centres.len();
    let is_cluster = |k: usize| k < n_clusters;

    let to_xy = |i: usize| -> (usize, usize) { (i % pw - 1, i / pw - 1) };
    let width_at = |i: usize| -> f32 {
        let (x, y) = to_xy(i);
        dist[y * w + x]
    };

    // Spur pruning: short open branches hanging off a junction cluster.
    let mut node_deg = HashMap::<usize, usize>::new();
    for l in &lines {
        if !l.closed && l.px.len() > 1 {
            *node_deg.entry(l.ends[0]).or_default() += 1;
            *node_deg.entry(l.ends[1]).or_default() += 1;
        }
    }
    lines.retain(|l| {
        if l.closed || l.px.len() < 2 {
            return true;
        }
        let [a, b] = l.ends;
        let free = |k: usize| !is_cluster(k) && node_deg.get(&k).copied().unwrap_or(0) <= 1;
        let junction_deg = |k: usize| if is_cluster(k) { node_deg.get(&k).copied().unwrap_or(0) } else { 0 };
        let hanging = (free(a) && junction_deg(b) >= 3) || (free(b) && junction_deg(a) >= 3);
        if !hanging {
            return true;
        }
        let junction_px = if is_cluster(a) { l.px[0] } else { *l.px.last().unwrap() };
        let limit = (width_at(junction_px) * 2.5).max(p.min_length as f32);
        l.px.len() as f32 > limit
    });
    let mut lines = join_through_degree2(lines, n_clusters);
    // Ends that no longer sit in a real junction become free (no snapping).
    let mut cdeg = vec![0usize; n_clusters];
    for l in &lines {
        if !l.closed {
            for &e in &l.ends {
                if is_cluster(e) {
                    cdeg[e] += 1;
                }
            }
        }
    }
    for l in lines.iter_mut() {
        for e in l.ends.iter_mut() {
            if is_cluster(*e) && cdeg[*e] < 3 {
                *e = NONE - 1;
            }
        }
    }

    let mut strokes = Vec::new();
    for l in lines {
        let closed = l.closed;
        let isolated_dot = l.px.len() == 1;
        if isolated_dot && width_at(l.px[0]) < 1.5 {
            continue;
        }
        let mean_w = l.px.iter().map(|&i| width_at(i) as f64).sum::<f64>() / l.px.len() as f64;
        let width = (2.0 * mean_w - 1.0).max(1.0);
        let mut pts: Vec<P> = l
            .px
            .iter()
            .map(|&i| {
                let (x, y) = to_xy(i);
                P::new(x as f64 + 0.5, y as f64 + 0.5)
            })
            .collect();
        if !closed && pts.len() > 1 {
            let last = pts.len() - 1;
            for (end, idx) in [(l.ends[0], 0usize), (l.ends[1], last)] {
                if is_cluster(end) {
                    let (cx, cy) = centres[end];
                    pts[idx] = P::new(cx - 0.5, cy - 0.5);
                }
            }
        }
        let total_len: f64 = pts.windows(2).map(|s| ddist(s[0], s[1])).sum();
        let touches_junction = is_cluster(l.ends[0]) || is_cluster(l.ends[1]);
        if !closed && !isolated_dot && total_len < 0.5 {
            continue;
        }
        if !closed && !isolated_dot && !touches_junction && total_len < (p.min_length as f64).max(width * 0.5) {
            continue; // short isolated noise
        }
        // Skeletons of thick strokes wobble by about a pixel; smooth that out,
        // but keep genuine corners (found on a coarse simplification) sharp.
        let tol = p.tolerance.max(width * 0.12);
        let (pts, hard) = smooth_keep_corners(&pts, closed, tol * 2.0, width.max(3.0));
        let (simp, hard) = simplify(&pts, &hard, tol, closed);
        if simp.is_empty() {
            continue;
        }
        let mut d = String::new();
        write_smooth(&mut d, &simp, &hard, closed && simp.len() > 2, p.curves, p.scale, p.precision);
        strokes.push(Stroke { d, width: width * p.scale });
    }
    strokes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> CenterlineParams {
        CenterlineParams { tolerance: 1.0, curves: true, min_length: 3, scale: 1.0, precision: 2 }
    }

    #[test]
    fn thick_line_becomes_one_stroke() {
        let (w, h) = (60, 20);
        let mut m = vec![0u8; w * h];
        for y in 8..13 {
            for x in 5..55 {
                m[y * w + x] = 1;
            }
        }
        let s = trace(&m, w, h, &params());
        assert_eq!(s.len(), 1, "got {:?}", s.iter().map(|s| &s.d).collect::<Vec<_>>());
        assert!((s[0].width - 5.0).abs() < 1.6, "width {}", s[0].width);
    }

    #[test]
    fn cross_yields_four_arms() {
        let (w, h) = (61, 61);
        let mut m = vec![0u8; w * h];
        for y in 0..h {
            for x in 0..w {
                if (28..33).contains(&x) && (5..56).contains(&y) || (28..33).contains(&y) && (5..56).contains(&x) {
                    m[y * w + x] = 1;
                }
            }
        }
        let s = trace(&m, w, h, &params());
        assert_eq!(s.len(), 4, "got {:?}", s.iter().map(|s| &s.d).collect::<Vec<_>>());
    }

    #[test]
    fn v_shape_keeps_sharp_corner() {
        // Thick V with its tip at (60, 90).
        let (w, h) = (120, 110);
        let mut m = vec![0u8; w * h];
        let seg_dist = |px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64| -> f64 {
            let (dx, dy) = (bx - ax, by - ay);
            let t = (((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
            ((px - ax - t * dx).powi(2) + (py - ay - t * dy).powi(2)).sqrt()
        };
        for y in 0..h {
            for x in 0..w {
                let (px, py) = (x as f64 + 0.5, y as f64 + 0.5);
                let d = seg_dist(px, py, 0.0, -30.0, 60.0, 90.0).min(seg_dist(px, py, 60.0, 90.0, 120.0, -30.0));
                if d <= 3.5 {
                    m[y * w + x] = 1;
                }
            }
        }
        let s = trace(&m, w, h, &params());
        println!("V: {:?}", s.iter().map(|s| &s.d).collect::<Vec<_>>());
        assert_eq!(s.len(), 1);
        // The deepest point of the stroke must reach close to the tip.
        let nums: Vec<f64> = s[0].d.replace(['M', 'C', 'L'], " ").split_whitespace().filter_map(|t| t.parse().ok()).collect();
        let max_y = nums.chunks(2).map(|c| c[1]).fold(0.0, f64::max);
        assert!(max_y > 87.0, "tip too high: {} in {}", max_y, s[0].d);
    }

    #[test]
    fn diagonal_line_is_not_fragmented() {
        let (w, h) = (80, 80);
        let mut m = vec![0u8; w * h];
        for y in 0..h {
            for x in 0..w {
                let d = (x as f64 - y as f64 * 0.7 - 10.0).abs();
                if d < 3.0 && (5..75).contains(&y) {
                    m[y * w + x] = 1;
                }
            }
        }
        let s = trace(&m, w, h, &params());
        assert!(s.len() <= 2, "got {} strokes", s.len());
    }
}
