//! Bitmap → Bezier outline tracer.
//!
//! An independent Rust implementation of the algorithm described in
//! Peter Selinger, "Potrace: a polygon-based tracing algorithm" (2003):
//! path decomposition, optimal polygon, vertex adjustment, corner/curve
//! smoothing and curve optimisation.

use crate::geom::*;

#[derive(Clone)]
pub struct Bitmap {
    pub w: i32,
    pub h: i32,
    pub data: Vec<u8>,
}

impl Bitmap {
    pub fn new(w: i32, h: i32) -> Self {
        Bitmap { w, h, data: vec![0; (w.max(0) * h.max(0)) as usize] }
    }

    #[inline]
    pub fn at(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h && self.data[(y * self.w + x) as usize] != 0
    }

    #[inline]
    pub fn set(&mut self, x: i32, y: i32) {
        self.data[(y * self.w + x) as usize] = 1;
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TurnPolicy {
    Black,
    White,
    Left,
    Right,
    Minority,
    Majority,
}

#[derive(Clone, Copy, Debug)]
pub struct Params {
    /// Paths enclosing an area of at most this many pixels are dropped.
    pub turdsize: i64,
    pub turnpolicy: TurnPolicy,
    /// Corner threshold. 0 = all corners, 1.3334 = no corners.
    pub alphamax: f64,
    pub opticurve: bool,
    pub opttolerance: f64,
}

impl Default for Params {
    fn default() -> Self {
        Params { turdsize: 2, turnpolicy: TurnPolicy::Minority, alphamax: 1.0, opticurve: true, opttolerance: 0.2 }
    }
}

#[derive(Clone, Copy, Default)]
struct Sum {
    x: f64,
    y: f64,
    xy: f64,
    x2: f64,
    y2: f64,
}

#[derive(Clone, Default)]
pub struct Curve {
    pub n: usize,
    pub is_curve: Vec<bool>,
    pub c: Vec<[P; 3]>,
    pub vertex: Vec<P>,
    alpha: Vec<f64>,
    alpha0: Vec<f64>,
    beta: Vec<f64>,
}

impl Curve {
    fn new(n: usize) -> Self {
        Curve {
            n,
            is_curve: vec![false; n],
            c: vec![[P::default(); 3]; n],
            vertex: vec![P::default(); n],
            alpha: vec![0.0; n],
            alpha0: vec![0.0; n],
            beta: vec![0.0; n],
        }
    }
}

#[derive(Clone, Default)]
pub struct Path {
    pub pt: Vec<(i32, i32)>,
    /// true for an outer boundary, false for a hole.
    pub positive: bool,
    pub area: i64,
    pub minx: i32,
    pub miny: i32,
    pub maxx: i32,
    pub maxy: i32,
    sums: Vec<Sum>,
    x0: i32,
    y0: i32,
    lon: Vec<i64>,
    po: Vec<i64>,
    pub curve: Curve,
    /// Polygon vertices (after adjustment), for straight-line output.
    pub polygon: Vec<P>,
}

#[inline]
fn modi(a: i64, n: i64) -> i64 {
    if a >= n {
        a % n
    } else if a >= 0 {
        a
    } else {
        n - 1 - (-1 - a) % n
    }
}

#[inline]
fn sign(i: i64) -> i64 {
    (i > 0) as i64 - (i < 0) as i64
}

#[inline]
fn xprod(a: (i64, i64), b: (i64, i64)) -> i64 {
    a.0 * b.1 - a.1 * b.0
}

#[inline]
fn cyclic(a: i64, b: i64, c: i64) -> bool {
    if a <= c {
        a <= b && b < c
    } else {
        a <= b || b < c
    }
}

// ---------------------------------------------------------------------------
// Stage 1: path decomposition
// ---------------------------------------------------------------------------

fn majority(bm: &Bitmap, x: i32, y: i32) -> bool {
    for i in 2..5 {
        let mut ct = 0;
        for a in (-i + 1)..=(i - 1) {
            ct += if bm.at(x + a, y + i - 1) { 1 } else { -1 };
            ct += if bm.at(x + i - 1, y + a - 1) { 1 } else { -1 };
            ct += if bm.at(x + a - 1, y - i) { 1 } else { -1 };
            ct += if bm.at(x - i, y + a) { 1 } else { -1 };
        }
        if ct > 0 {
            return true;
        } else if ct < 0 {
            return false;
        }
    }
    false
}

fn find_path(orig: &Bitmap, bm: &Bitmap, x0: i32, y0: i32, policy: TurnPolicy) -> Path {
    let positive = orig.at(x0, y0);
    let (mut x, mut y) = (x0, y0);
    let (mut dirx, mut diry) = (0i32, 1i32);
    let mut path = Path { positive, minx: x0, maxx: x0, miny: y0, maxy: y0, ..Default::default() };
    loop {
        path.pt.push((x, y));
        path.minx = path.minx.min(x);
        path.maxx = path.maxx.max(x);
        path.miny = path.miny.min(y);
        path.maxy = path.maxy.max(y);
        x += dirx;
        y += diry;
        path.area -= (x as i64) * (diry as i64);
        if x == x0 && y == y0 {
            break;
        }
        let l = bm.at(x + (dirx + diry - 1) / 2, y + (diry - dirx - 1) / 2);
        let r = bm.at(x + (dirx - diry - 1) / 2, y + (diry + dirx - 1) / 2);
        if r && !l {
            let turn_right = match policy {
                TurnPolicy::Right => true,
                TurnPolicy::Left => false,
                TurnPolicy::Black => positive,
                TurnPolicy::White => !positive,
                TurnPolicy::Majority => majority(bm, x, y),
                TurnPolicy::Minority => !majority(bm, x, y),
            };
            if turn_right {
                let t = dirx;
                dirx = -diry;
                diry = t;
            } else {
                let t = dirx;
                dirx = diry;
                diry = -t;
            }
        } else if r {
            let t = dirx;
            dirx = -diry;
            diry = t;
        } else if !l {
            let t = dirx;
            dirx = diry;
            diry = -t;
        }
    }
    path
}

fn xor_path(bm: &mut Bitmap, path: &Path) {
    let mut y1 = path.pt[0].1;
    let maxx = path.maxx.min(bm.w);
    for &(x, y) in path.pt.iter().skip(1) {
        if y != y1 {
            let miny = y1.min(y);
            if miny >= 0 && miny < bm.h {
                let row = (miny * bm.w) as usize;
                for j in x.max(0)..maxx {
                    bm.data[row + j as usize] ^= 1;
                }
            }
            y1 = y;
        }
    }
}

/// Decomposes a bitmap into closed boundary paths (outer boundaries and holes).
pub fn decompose(bm: &Bitmap, params: &Params) -> Vec<Path> {
    let mut work = bm.clone();
    let mut paths = Vec::new();
    let size = work.data.len();
    let w = bm.w as usize;
    let mut idx = 0usize;
    loop {
        while idx < size && work.data[idx] == 0 {
            idx += 1;
        }
        if idx >= size {
            break;
        }
        let x = (idx % w) as i32;
        let y = (idx / w) as i32;
        let path = find_path(bm, &work, x, y, params.turnpolicy);
        xor_path(&mut work, &path);
        if path.area > params.turdsize {
            paths.push(path);
        }
    }
    paths
}

// ---------------------------------------------------------------------------
// Stage 2: optimal polygon
// ---------------------------------------------------------------------------

fn calc_sums(path: &mut Path) {
    path.x0 = path.pt[0].0;
    path.y0 = path.pt[0].1;
    let mut sums = Vec::with_capacity(path.pt.len() + 1);
    sums.push(Sum::default());
    for (i, &(px, py)) in path.pt.iter().enumerate() {
        let x = (px - path.x0) as f64;
        let y = (py - path.y0) as f64;
        let s = sums[i];
        sums.push(Sum { x: s.x + x, y: s.y + y, xy: s.xy + x * y, x2: s.x2 + x * x, y2: s.y2 + y * y });
    }
    path.sums = sums;
}

fn calc_lon(path: &mut Path) {
    let n = path.pt.len() as i64;
    let pt: Vec<(i64, i64)> = path.pt.iter().map(|&(x, y)| (x as i64, y as i64)).collect();
    let mut pivk = vec![0i64; n as usize];
    let mut nc = vec![0i64; n as usize];

    let mut k: i64 = 0;
    for i in (0..n).rev() {
        let (pi, pk) = (pt[i as usize], pt[k as usize]);
        if pi.0 != pk.0 && pi.1 != pk.1 {
            k = i + 1;
        }
        nc[i as usize] = k;
    }

    let dir_index = |dx: i64, dy: i64| -> usize { ((3 + 3 * dx + dy) / 2).clamp(0, 3) as usize };

    for i in (0..n).rev() {
        let mut ct = [0i32; 4];
        let ip1 = modi(i + 1, n) as usize;
        let iu = i as usize;
        ct[dir_index(pt[ip1].0 - pt[iu].0, pt[ip1].1 - pt[iu].1)] += 1;

        let mut c0 = (0i64, 0i64);
        let mut c1 = (0i64, 0i64);
        let mut k = nc[iu];
        let mut k1 = i;
        let mut found = false;
        loop {
            let (pk, pk1) = (pt[k as usize], pt[k1 as usize]);
            ct[dir_index(sign(pk.0 - pk1.0), sign(pk.1 - pk1.1))] += 1;
            if ct[0] != 0 && ct[1] != 0 && ct[2] != 0 && ct[3] != 0 {
                pivk[iu] = k1;
                found = true;
                break;
            }
            let cur = (pk.0 - pt[iu].0, pk.1 - pt[iu].1);
            if xprod(c0, cur) < 0 || xprod(c1, cur) > 0 {
                break;
            }
            if cur.0.abs() <= 1 && cur.1.abs() <= 1 {
                // no constraint
            } else {
                let off = (
                    cur.0 + if cur.1 >= 0 && (cur.1 > 0 || cur.0 < 0) { 1 } else { -1 },
                    cur.1 + if cur.0 <= 0 && (cur.0 < 0 || cur.1 < 0) { 1 } else { -1 },
                );
                if xprod(c0, off) >= 0 {
                    c0 = off;
                }
                let off = (
                    cur.0 + if cur.1 <= 0 && (cur.1 < 0 || cur.0 < 0) { 1 } else { -1 },
                    cur.1 + if cur.0 >= 0 && (cur.0 > 0 || cur.1 < 0) { 1 } else { -1 },
                );
                if xprod(c1, off) <= 0 {
                    c1 = off;
                }
            }
            k1 = k;
            k = nc[k1 as usize];
            if !cyclic(k, i, k1) {
                break;
            }
        }
        if !found {
            let (pk, pk1) = (pt[k as usize], pt[k1 as usize]);
            let dk = (sign(pk.0 - pk1.0), sign(pk.1 - pk1.1));
            let cur = (pk1.0 - pt[iu].0, pk1.1 - pt[iu].1);
            let a = xprod(c0, cur);
            let b = xprod(c0, dk);
            let c = xprod(c1, cur);
            let d = xprod(c1, dk);
            let mut j: i64 = 10_000_000;
            if b < 0 {
                j = a.div_euclid(-b);
            }
            if d > 0 {
                j = j.min((-c).div_euclid(d));
            }
            pivk[iu] = modi(k1 + j, n);
        }
    }

    let mut lon = vec![0i64; n as usize];
    let mut j = pivk[(n - 1) as usize];
    lon[(n - 1) as usize] = j;
    let mut i = n - 2;
    while i >= 0 {
        if cyclic(i + 1, pivk[i as usize], j) {
            j = pivk[i as usize];
        }
        lon[i as usize] = j;
        i -= 1;
    }
    let mut i = n - 1;
    while i >= 0 && cyclic(modi(i + 1, n), j, lon[i as usize]) {
        lon[i as usize] = j;
        i -= 1;
    }
    path.lon = lon;
}

fn penalty3(path: &Path, i: i64, j: i64) -> f64 {
    let n = path.pt.len() as i64;
    let sums = &path.sums;
    let pt = &path.pt;
    let (mut j, r) = (j, j >= n);
    if r {
        j -= n;
    }
    let (iu, ju) = (i as usize, j as usize);
    let (x, y, x2, xy, y2, k);
    if !r {
        x = sums[ju + 1].x - sums[iu].x;
        y = sums[ju + 1].y - sums[iu].y;
        x2 = sums[ju + 1].x2 - sums[iu].x2;
        xy = sums[ju + 1].xy - sums[iu].xy;
        y2 = sums[ju + 1].y2 - sums[iu].y2;
        k = (j + 1 - i) as f64;
    } else {
        let nu = n as usize;
        x = sums[ju + 1].x - sums[iu].x + sums[nu].x;
        y = sums[ju + 1].y - sums[iu].y + sums[nu].y;
        x2 = sums[ju + 1].x2 - sums[iu].x2 + sums[nu].x2;
        xy = sums[ju + 1].xy - sums[iu].xy + sums[nu].xy;
        y2 = sums[ju + 1].y2 - sums[iu].y2 + sums[nu].y2;
        k = (j + 1 - i + n) as f64;
    }
    let px = (pt[iu].0 + pt[ju].0) as f64 / 2.0 - pt[0].0 as f64;
    let py = (pt[iu].1 + pt[ju].1) as f64 / 2.0 - pt[0].1 as f64;
    let ey = (pt[ju].0 - pt[iu].0) as f64;
    let ex = -((pt[ju].1 - pt[iu].1) as f64);
    let a = (x2 - 2.0 * x * px) / k + px * px;
    let b = (xy - x * py - y * px) / k + px * py;
    let c = (y2 - 2.0 * y * py) / k + py * py;
    let s = ex * ex * a + 2.0 * ex * ey * b + ey * ey * c;
    s.max(0.0).sqrt()
}

fn best_polygon(path: &mut Path) {
    let n = path.pt.len() as i64;
    let nu = n as usize;
    let mut pen = vec![0.0f64; nu + 1];
    let mut prev = vec![0i64; nu + 1];
    let mut clip0 = vec![0i64; nu];
    let mut clip1 = vec![0i64; nu + 1];
    let mut seg0 = vec![0i64; nu + 1];
    let mut seg1 = vec![0i64; nu + 1];

    for i in 0..n {
        let mut c = modi(path.lon[modi(i - 1, n) as usize] - 1, n);
        if c == i {
            c = modi(i + 1, n);
        }
        clip0[i as usize] = if c < i { n } else { c };
    }
    let mut j: i64 = 1;
    for i in 0..n {
        while j <= clip0[i as usize] {
            clip1[j as usize] = i;
            j += 1;
        }
    }
    let mut i: i64 = 0;
    j = 0;
    while i < n {
        seg0[j as usize] = i;
        i = clip0[i as usize];
        j += 1;
    }
    seg0[j as usize] = n;
    let m = j;
    i = n;
    j = m;
    while j > 0 {
        seg1[j as usize] = i;
        i = clip1[i as usize];
        j -= 1;
    }
    seg1[0] = 0;
    pen[0] = 0.0;
    for j in 1..=m {
        let ju = j as usize;
        let mut i = seg1[ju];
        while i <= seg0[ju] {
            let mut best = -1.0f64;
            let mut k = seg0[ju - 1];
            while k >= clip1[i as usize] {
                let this = penalty3(path, k, i) + pen[k as usize];
                if best < 0.0 || this < best {
                    prev[i as usize] = k;
                    best = this;
                }
                k -= 1;
            }
            pen[i as usize] = best;
            i += 1;
        }
    }
    let mut po = vec![0i64; m as usize];
    let mut i = n;
    let mut j = m - 1;
    while i > 0 && j >= 0 {
        i = prev[i as usize];
        po[j as usize] = i;
        j -= 1;
    }
    path.po = po;
}

// ---------------------------------------------------------------------------
// Stage 3: vertex adjustment
// ---------------------------------------------------------------------------

fn pointslope(path: &Path, i: i64, j: i64) -> (P, P) {
    let n = path.pt.len() as i64;
    let sums = &path.sums;
    let (mut i, mut j, mut r) = (i, j, 0i64);
    while j >= n {
        j -= n;
        r += 1;
    }
    while i >= n {
        i -= n;
        r -= 1;
    }
    while j < 0 {
        j += n;
        r -= 1;
    }
    while i < 0 {
        i += n;
        r += 1;
    }
    let (iu, ju, nu, rf) = (i as usize, j as usize, n as usize, r as f64);
    let x = sums[ju + 1].x - sums[iu].x + rf * sums[nu].x;
    let y = sums[ju + 1].y - sums[iu].y + rf * sums[nu].y;
    let x2 = sums[ju + 1].x2 - sums[iu].x2 + rf * sums[nu].x2;
    let xy = sums[ju + 1].xy - sums[iu].xy + rf * sums[nu].xy;
    let y2 = sums[ju + 1].y2 - sums[iu].y2 + rf * sums[nu].y2;
    let k = (j + 1 - i + r * n) as f64;
    let ctr = P::new(x / k, y / k);
    let mut a = (x2 - x * x / k) / k;
    let b = (xy - x * y / k) / k;
    let mut c = (y2 - y * y / k) / k;
    let lambda2 = (a + c + ((a - c) * (a - c) + 4.0 * b * b).sqrt()) / 2.0;
    a -= lambda2;
    c -= lambda2;
    let mut dir = P::default();
    if a.abs() >= c.abs() {
        let l = (a * a + b * b).sqrt();
        if l != 0.0 {
            dir = P::new(-b / l, a / l);
        }
    } else {
        let l = (c * c + b * b).sqrt();
        if l != 0.0 {
            dir = P::new(-c / l, b / l);
        }
    }
    (ctr, dir)
}

type Quad = [[f64; 3]; 3];

fn quadform(q: &Quad, w: P) -> f64 {
    let v = [w.x, w.y, 1.0];
    let mut sum = 0.0;
    for i in 0..3 {
        for j in 0..3 {
            sum += v[i] * q[i][j] * v[j];
        }
    }
    sum
}

fn adjust_vertices(path: &mut Path) {
    let m = path.po.len() as i64;
    let n = path.pt.len() as i64;
    let (x0, y0) = (path.x0 as f64, path.y0 as f64);
    let mut ctr = vec![P::default(); m as usize];
    let mut dir = vec![P::default(); m as usize];
    let mut q: Vec<Quad> = vec![[[0.0; 3]; 3]; m as usize];

    for i in 0..m {
        let mut j = path.po[modi(i + 1, m) as usize];
        j = modi(j - path.po[i as usize], n) + path.po[i as usize];
        let (c, d) = pointslope(path, path.po[i as usize], j);
        ctr[i as usize] = c;
        dir[i as usize] = d;
    }
    for i in 0..m as usize {
        let d = dir[i].x * dir[i].x + dir[i].y * dir[i].y;
        if d != 0.0 {
            let v = [dir[i].y, -dir[i].x, 0.0];
            let v2 = -v[1] * ctr[i].y - v[0] * ctr[i].x;
            let v = [v[0], v[1], v2];
            for l in 0..3 {
                for k in 0..3 {
                    q[i][l][k] = v[l] * v[k] / d;
                }
            }
        }
    }

    let mut curve = Curve::new(m as usize);
    for i in 0..m {
        let iu = i as usize;
        let s = P::new(
            path.pt[path.po[iu] as usize].0 as f64 - x0,
            path.pt[path.po[iu] as usize].1 as f64 - y0,
        );
        let j = modi(i - 1, m) as usize;
        let mut qq: Quad = [[0.0; 3]; 3];
        for l in 0..3 {
            for k in 0..3 {
                qq[l][k] = q[j][l][k] + q[iu][l][k];
            }
        }
        let mut w = P::default();
        let mut guard = 0;
        loop {
            let det = qq[0][0] * qq[1][1] - qq[0][1] * qq[1][0];
            if det != 0.0 {
                w.x = (-qq[0][2] * qq[1][1] + qq[1][2] * qq[0][1]) / det;
                w.y = (qq[0][2] * qq[1][0] - qq[1][2] * qq[0][0]) / det;
                break;
            }
            let v = if qq[0][0] > qq[1][1] {
                [-qq[0][1], qq[0][0]]
            } else if qq[1][1] != 0.0 {
                [-qq[1][1], qq[1][0]]
            } else {
                [1.0, 0.0]
            };
            let d = v[0] * v[0] + v[1] * v[1];
            let v = [v[0], v[1], -v[1] * s.y - v[0] * s.x];
            for l in 0..3 {
                for k in 0..3 {
                    qq[l][k] += v[l] * v[k] / d;
                }
            }
            guard += 1;
            if guard > 4 {
                w = s;
                break;
            }
        }
        let dx = (w.x - s.x).abs();
        let dy = (w.y - s.y).abs();
        if dx <= 0.5 && dy <= 0.5 {
            curve.vertex[iu] = P::new(w.x + x0, w.y + y0);
            continue;
        }
        let mut min = quadform(&qq, s);
        let mut xmin = s.x;
        let mut ymin = s.y;
        if qq[0][0] != 0.0 {
            for z in 0..2 {
                let wy = s.y - 0.5 + z as f64;
                let wx = -(qq[0][1] * wy + qq[0][2]) / qq[0][0];
                let cand = quadform(&qq, P::new(wx, wy));
                if (wx - s.x).abs() <= 0.5 && cand < min {
                    min = cand;
                    xmin = wx;
                    ymin = wy;
                }
            }
        }
        if qq[1][1] != 0.0 {
            for z in 0..2 {
                let wx = s.x - 0.5 + z as f64;
                let wy = -(qq[1][0] * wx + qq[1][2]) / qq[1][1];
                let cand = quadform(&qq, P::new(wx, wy));
                if (wy - s.y).abs() <= 0.5 && cand < min {
                    min = cand;
                    xmin = wx;
                    ymin = wy;
                }
            }
        }
        for l in 0..2 {
            for k in 0..2 {
                let wp = P::new(s.x - 0.5 + l as f64, s.y - 0.5 + k as f64);
                let cand = quadform(&qq, wp);
                if cand < min {
                    min = cand;
                    xmin = wp.x;
                    ymin = wp.y;
                }
            }
        }
        curve.vertex[iu] = P::new(xmin + x0, ymin + y0);
    }
    path.curve = curve;
}

// ---------------------------------------------------------------------------
// Stage 4: smoothing and corner detection
// ---------------------------------------------------------------------------

fn smooth(curve: &mut Curve, alphamax: f64) {
    let m = curve.n;
    for i in 0..m {
        let j = (i + 1) % m;
        let k = (i + 2) % m;
        let p4 = interval(0.5, curve.vertex[k], curve.vertex[j]);
        let vi = curve.vertex[i];
        let vk = curve.vertex[k];
        let r = P::new(-(signf(vk.y - vi.y) as f64), signf(vk.x - vi.x) as f64);
        let denom = r.y * (vk.x - vi.x) - r.x * (vk.y - vi.y);
        let mut alpha = if denom != 0.0 {
            let dd = (dpara(vi, curve.vertex[j], vk) / denom).abs();
            let a = if dd > 1.0 { 1.0 - 1.0 / dd } else { 0.0 };
            a / 0.75
        } else {
            4.0 / 3.0
        };
        curve.alpha0[j] = alpha;
        if alpha >= alphamax {
            curve.is_curve[j] = false;
            curve.c[j][1] = curve.vertex[j];
            curve.c[j][2] = p4;
        } else {
            alpha = alpha.clamp(0.55, 1.0);
            let p2 = interval(0.5 + 0.5 * alpha, vi, curve.vertex[j]);
            let p3 = interval(0.5 + 0.5 * alpha, vk, curve.vertex[j]);
            curve.is_curve[j] = true;
            curve.c[j] = [p2, p3, p4];
        }
        curve.alpha[j] = alpha;
        curve.beta[j] = 0.5;
    }
}

// ---------------------------------------------------------------------------
// Stage 5: curve optimisation
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Default)]
struct Opti {
    pen: f64,
    c: [P; 2],
    t: f64,
    s: f64,
    alpha: f64,
}

fn tangent(p0: P, p1: P, p2: P, p3: P, q0: P, q1: P) -> f64 {
    let a_ = cprod(p0, p1, q0, q1);
    let b_ = cprod(p1, p2, q0, q1);
    let c_ = cprod(p2, p3, q0, q1);
    let a = a_ - 2.0 * b_ + c_;
    let b = -2.0 * a_ + 2.0 * b_;
    let c = a_;
    let d = b * b - 4.0 * a * c;
    if a == 0.0 || d < 0.0 {
        return -1.0;
    }
    let s = d.sqrt();
    let r1 = (-b + s) / (2.0 * a);
    let r2 = (-b - s) / (2.0 * a);
    if (0.0..=1.0).contains(&r1) {
        r1
    } else if (0.0..=1.0).contains(&r2) {
        r2
    } else {
        -1.0
    }
}

#[allow(clippy::too_many_arguments)]
fn opti_penalty(curve: &Curve, i: usize, j: usize, res: &mut Opti, tol: f64, convc: &[i32], areac: &[f64]) -> bool {
    let m = curve.n;
    let v = &curve.vertex;
    if i == j {
        return true;
    }
    let i1 = (i + 1) % m;
    let k1 = i1;
    let conv = convc[k1];
    if conv == 0 {
        return true;
    }
    let d = ddist(v[i], v[i1]);
    let mut k = k1;
    while k != j {
        let k1 = (k + 1) % m;
        let k2 = (k + 2) % m;
        if convc[k1] != conv {
            return true;
        }
        if signf(cprod(v[i], v[i1], v[k1], v[k2])) != conv {
            return true;
        }
        if iprod1(v[i], v[i1], v[k1], v[k2]) < d * ddist(v[k1], v[k2]) * -0.999847695156 {
            return true;
        }
        k = k1;
    }

    let p0 = curve.c[i % m][2];
    let mut p1 = v[(i + 1) % m];
    let mut p2 = v[j % m];
    let p3 = curve.c[j % m][2];

    let mut area = areac[j] - areac[i];
    area -= dpara(v[0], curve.c[i][2], curve.c[j][2]) / 2.0;
    if i >= j {
        area += areac[m];
    }
    let a1 = dpara(p0, p1, p2);
    let a2 = dpara(p0, p1, p3);
    let a3 = dpara(p0, p2, p3);
    let a4 = a1 + a3 - a2;
    if a2 == a1 {
        return true;
    }
    let t = a3 / (a3 - a4);
    let s = a2 / (a2 - a1);
    let a = a2 * t / 2.0;
    if a == 0.0 {
        return true;
    }
    let r = area / a;
    let alpha = 2.0 - (4.0 - r / 0.3).sqrt();
    if !alpha.is_finite() {
        return true;
    }
    res.c[0] = interval(t * alpha, p0, p1);
    res.c[1] = interval(s * alpha, p3, p2);
    res.alpha = alpha;
    res.t = t;
    res.s = s;
    p1 = res.c[0];
    p2 = res.c[1];
    res.pen = 0.0;

    let mut k = (i + 1) % m;
    while k != j {
        let k1 = (k + 1) % m;
        let t = tangent(p0, p1, p2, p3, v[k], v[k1]);
        if t < -0.5 {
            return true;
        }
        let pt = bezier(t, p0, p1, p2, p3);
        let d = ddist(v[k], v[k1]);
        if d == 0.0 {
            return true;
        }
        let d1 = dpara(v[k], v[k1], pt) / d;
        if d1.abs() > tol {
            return true;
        }
        if iprod(v[k], v[k1], pt) < 0.0 || iprod(v[k1], v[k], pt) < 0.0 {
            return true;
        }
        res.pen += d1 * d1;
        k = k1;
    }
    let mut k = i;
    while k != j {
        let k1 = (k + 1) % m;
        let t = tangent(p0, p1, p2, p3, curve.c[k][2], curve.c[k1][2]);
        if t < -0.5 {
            return true;
        }
        let pt = bezier(t, p0, p1, p2, p3);
        let d = ddist(curve.c[k][2], curve.c[k1][2]);
        if d == 0.0 {
            return true;
        }
        let mut d1 = dpara(curve.c[k][2], curve.c[k1][2], pt) / d;
        let mut d2 = dpara(curve.c[k][2], curve.c[k1][2], v[k1]) / d;
        d2 *= 0.75 * curve.alpha[k1];
        if d2 < 0.0 {
            d1 = -d1;
            d2 = -d2;
        }
        if d1 < d2 - tol {
            return true;
        }
        if d1 < d2 {
            res.pen += (d1 - d2) * (d1 - d2);
        }
        k = k1;
    }
    false
}

fn opti_curve(curve: &Curve, tol: f64) -> Curve {
    let m = curve.n;
    let v = &curve.vertex;
    let mut pt = vec![0i64; m + 1];
    let mut pen = vec![0.0f64; m + 1];
    let mut len = vec![0usize; m + 1];
    let mut opt = vec![Opti::default(); m + 1];
    let mut convc = vec![0i32; m];
    let mut areac = vec![0.0f64; m + 1];

    for i in 0..m {
        convc[i] = if curve.is_curve[i] { signf(dpara(v[(i + m - 1) % m], v[i], v[(i + 1) % m])) } else { 0 };
    }
    let mut area = 0.0;
    let p0 = v[0];
    for i in 0..m {
        let i1 = (i + 1) % m;
        if curve.is_curve[i1] {
            let alpha = curve.alpha[i1];
            area += 0.3 * alpha * (4.0 - alpha) * dpara(curve.c[i][2], v[i1], curve.c[i1][2]) / 2.0;
            area += dpara(p0, curve.c[i][2], curve.c[i1][2]) / 2.0;
        }
        areac[i + 1] = area;
    }
    pt[0] = -1;
    let mut o = Opti::default();
    for j in 1..=m {
        pt[j] = j as i64 - 1;
        pen[j] = pen[j - 1];
        len[j] = len[j - 1] + 1;
        let mut i = j as i64 - 2;
        while i >= 0 {
            let iu = i as usize;
            if opti_penalty(curve, iu, j % m, &mut o, tol, &convc, &areac) {
                break;
            }
            if len[j] > len[iu] + 1 || (len[j] == len[iu] + 1 && pen[j] > pen[iu] + o.pen) {
                pt[j] = i;
                pen[j] = pen[iu] + o.pen;
                len[j] = len[iu] + 1;
                opt[j] = o;
            }
            i -= 1;
        }
    }
    let om = len[m];
    let mut oc = Curve::new(om);
    let mut s = vec![0.0f64; om];
    let mut t = vec![0.0f64; om];
    let mut j = m;
    for i in (0..om).rev() {
        let jm = j % m;
        if pt[j] == j as i64 - 1 {
            oc.is_curve[i] = curve.is_curve[jm];
            oc.c[i] = curve.c[jm];
            oc.vertex[i] = curve.vertex[jm];
            oc.alpha[i] = curve.alpha[jm];
            oc.alpha0[i] = curve.alpha0[jm];
            oc.beta[i] = curve.beta[jm];
            s[i] = 1.0;
            t[i] = 1.0;
        } else {
            oc.is_curve[i] = true;
            oc.c[i] = [opt[j].c[0], opt[j].c[1], curve.c[jm][2]];
            oc.vertex[i] = interval(opt[j].s, curve.c[jm][2], v[jm]);
            oc.alpha[i] = opt[j].alpha;
            oc.alpha0[i] = opt[j].alpha;
            s[i] = opt[j].s;
            t[i] = opt[j].t;
        }
        j = pt[j].max(0) as usize;
    }
    for i in 0..om {
        let i1 = (i + 1) % om;
        oc.beta[i] = s[i] / (s[i] + t[i1]);
    }
    oc
}

/// Runs stages 2–5 on a decomposed path.
pub fn process_path(path: &mut Path, params: &Params) {
    calc_sums(path);
    calc_lon(path);
    best_polygon(path);
    adjust_vertices(path);
    if !path.positive {
        path.curve.vertex.reverse();
    }
    path.polygon = path.curve.vertex.clone();
    smooth(&mut path.curve, params.alphamax);
    if params.opticurve && path.curve.n > 1 {
        path.curve = opti_curve(&path.curve, params.opttolerance);
    }
}

/// Full pipeline: decompose the bitmap and fit curves to every path.
pub fn trace(bm: &Bitmap, params: &Params) -> Vec<Path> {
    let mut paths = decompose(bm, params);
    for p in paths.iter_mut() {
        process_path(p, params);
    }
    paths
}

/// How a traced path is turned into SVG path data.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Render {
    Curves,
    Polygon,
    /// Exact pixel staircase outline.
    Pixels,
}

pub struct Transform {
    pub ox: f64,
    pub oy: f64,
    pub scale: f64,
    pub precision: u8,
}

impl Transform {
    #[inline]
    fn apply(&self, p: P) -> P {
        P::new((p.x + self.ox) * self.scale, (p.y + self.oy) * self.scale)
    }
}

/// Appends one closed sub-path ("M…Z") for `path` to `out`.
pub fn write_path(out: &mut String, path: &Path, mode: Render, tf: &Transform) {
    let prec = tf.precision;
    match mode {
        Render::Pixels => {
            let pts = &path.pt;
            let n = pts.len();
            let mut corners: Vec<(i32, i32)> = Vec::with_capacity(n / 2);
            for i in 0..n {
                let a = pts[(i + n - 1) % n];
                let b = pts[i];
                let c = pts[(i + 1) % n];
                let collinear = (b.0 - a.0) * (c.1 - b.1) - (b.1 - a.1) * (c.0 - b.0) == 0;
                if !collinear {
                    corners.push(b);
                }
            }
            if !path.positive {
                corners.reverse();
            }
            for (i, &(x, y)) in corners.iter().enumerate() {
                out.push(if i == 0 { 'M' } else { 'L' });
                push_pt(out, tf.apply(P::new(x as f64, y as f64)), prec);
            }
            out.push('Z');
        }
        Render::Polygon => {
            for (i, &v) in path.polygon.iter().enumerate() {
                out.push(if i == 0 { 'M' } else { 'L' });
                push_pt(out, tf.apply(v), prec);
            }
            out.push('Z');
        }
        Render::Curves => {
            let c = &path.curve;
            let n = c.n;
            if n == 0 {
                return;
            }
            out.push('M');
            push_pt(out, tf.apply(c.c[n - 1][2]), prec);
            for i in 0..n {
                if c.is_curve[i] {
                    out.push('C');
                    push_pt(out, tf.apply(c.c[i][0]), prec);
                    out.push(' ');
                    push_pt(out, tf.apply(c.c[i][1]), prec);
                    out.push(' ');
                    push_pt(out, tf.apply(c.c[i][2]), prec);
                } else {
                    out.push('L');
                    push_pt(out, tf.apply(c.c[i][1]), prec);
                    out.push('L');
                    push_pt(out, tf.apply(c.c[i][2]), prec);
                }
            }
            out.push('Z');
        }
    }
}

/// Point-in-polygon test against a path's pixel-corner outline.
fn contains(path: &Path, px: f64, py: f64) -> bool {
    let pts = &path.pt;
    let n = pts.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (pts[i].0 as f64, pts[i].1 as f64);
        let (xj, yj) = (pts[j].0 as f64, pts[j].1 as f64);
        if (yi > py) != (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Groups holes with the smallest outer boundary that contains them and
/// returns one compound path per outer shape.
pub fn to_compound_paths(paths: &[Path], mode: Render, tf: &Transform) -> Vec<String> {
    let outers: Vec<usize> = (0..paths.len()).filter(|&i| paths[i].positive).collect();
    let mut holes_of: Vec<Vec<usize>> = vec![Vec::new(); paths.len()];
    for (hi, hole) in paths.iter().enumerate() {
        if hole.positive {
            continue;
        }
        let (px, py) = (hole.pt[0].0 as f64 + 0.5, hole.pt[0].1 as f64 + 0.5);
        let mut best: Option<usize> = None;
        for &oi in &outers {
            let o = &paths[oi];
            if hole.minx < o.minx || hole.maxx > o.maxx || hole.miny < o.miny || hole.maxy > o.maxy {
                continue;
            }
            if let Some(b) = best {
                if paths[b].area <= o.area {
                    continue;
                }
            }
            if contains(o, px, py) {
                best = Some(oi);
            }
        }
        if let Some(b) = best {
            holes_of[b].push(hi);
        }
    }
    let mut result = Vec::with_capacity(outers.len());
    for &oi in &outers {
        let mut d = String::with_capacity(paths[oi].pt.len() * 6);
        write_path(&mut d, &paths[oi], mode, tf);
        for &hi in &holes_of[oi] {
            write_path(&mut d, &paths[hi], mode, tf);
        }
        result.push(d);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square_with_hole() -> Bitmap {
        let mut bm = Bitmap::new(20, 20);
        for y in 2..18 {
            for x in 2..18 {
                if !(7..13).contains(&x) || !(7..13).contains(&y) {
                    bm.set(x, y);
                }
            }
        }
        bm
    }

    #[test]
    fn traces_square_with_hole() {
        let bm = square_with_hole();
        let paths = trace(&bm, &Params::default());
        assert_eq!(paths.len(), 2);
        assert!(paths[0].positive);
        assert!(!paths[1].positive);
        let tf = Transform { ox: 0.0, oy: 0.0, scale: 1.0, precision: 2 };
        let compound = to_compound_paths(&paths, Render::Curves, &tf);
        assert_eq!(compound.len(), 1);
        assert_eq!(compound[0].matches('M').count(), 2);
    }

    #[test]
    fn traces_circle_as_curves() {
        let mut bm = Bitmap::new(64, 64);
        for y in 0..64 {
            for x in 0..64 {
                let (dx, dy) = (x as f64 - 31.5, y as f64 - 31.5);
                if dx * dx + dy * dy < 25.0 * 25.0 {
                    bm.set(x, y);
                }
            }
        }
        let paths = trace(&bm, &Params::default());
        assert_eq!(paths.len(), 1);
        assert!(paths[0].curve.is_curve.iter().all(|&c| c));
        assert!(paths[0].curve.n <= 8, "circle should optimise to few segments, got {}", paths[0].curve.n);
    }
}
