//! Small geometry helpers shared by the tracers.

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct P {
    pub x: f64,
    pub y: f64,
}

impl P {
    #[inline]
    pub fn new(x: f64, y: f64) -> Self {
        P { x, y }
    }
}

#[inline]
pub fn interval(lambda: f64, a: P, b: P) -> P {
    P::new(a.x + lambda * (b.x - a.x), a.y + lambda * (b.y - a.y))
}

#[inline]
pub fn ddist(p: P, q: P) -> f64 {
    ((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)).sqrt()
}

/// Area of the parallelogram (p0,p1,p2).
#[inline]
pub fn dpara(p0: P, p1: P, p2: P) -> f64 {
    (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
}

#[inline]
pub fn cprod(p0: P, p1: P, p2: P, p3: P) -> f64 {
    (p1.x - p0.x) * (p3.y - p2.y) - (p3.x - p2.x) * (p1.y - p0.y)
}

#[inline]
pub fn iprod(p0: P, p1: P, p2: P) -> f64 {
    (p1.x - p0.x) * (p2.x - p0.x) + (p1.y - p0.y) * (p2.y - p0.y)
}

#[inline]
pub fn iprod1(p0: P, p1: P, p2: P, p3: P) -> f64 {
    (p1.x - p0.x) * (p3.x - p2.x) + (p1.y - p0.y) * (p3.y - p2.y)
}

#[inline]
pub fn signf(x: f64) -> i32 {
    if x > 0.0 {
        1
    } else if x < 0.0 {
        -1
    } else {
        0
    }
}

#[inline]
pub fn bezier(t: f64, p0: P, p1: P, p2: P, p3: P) -> P {
    let s = 1.0 - t;
    let a = s * s * s;
    let b = 3.0 * s * s * t;
    let c = 3.0 * t * t * s;
    let d = t * t * t;
    P::new(
        a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    )
}

/// Formats a number with at most `prec` decimals, trimming trailing zeros.
pub fn fmt_num(out: &mut String, v: f64, prec: u8) {
    use std::fmt::Write;
    let factor = 10f64.powi(prec as i32);
    let mut r = (v * factor).round() / factor;
    if r == 0.0 {
        r = 0.0; // normalise -0
    }
    if r.fract() == 0.0 {
        let _ = write!(out, "{}", r as i64);
        return;
    }
    let mut s = format!("{:.*}", prec as usize, r);
    while s.ends_with('0') {
        s.pop();
    }
    if s.ends_with('.') {
        s.pop();
    }
    if let Some(rest) = s.strip_prefix("0.") {
        out.push('.');
        out.push_str(rest);
    } else if let Some(rest) = s.strip_prefix("-0.") {
        out.push_str("-.");
        out.push_str(rest);
    } else {
        out.push_str(&s);
    }
}

/// Appends "x y" to the path string with a separator suited to compact SVG.
pub fn push_pt(out: &mut String, p: P, prec: u8) {
    fmt_num(out, p.x, prec);
    out.push(' ');
    fmt_num(out, p.y, prec);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_numbers_compactly() {
        let mut s = String::new();
        fmt_num(&mut s, 1.5, 2);
        s.push(',');
        fmt_num(&mut s, -0.0001, 2);
        s.push(',');
        fmt_num(&mut s, 0.25, 2);
        s.push(',');
        fmt_num(&mut s, -0.333, 2);
        s.push(',');
        fmt_num(&mut s, 12.0, 2);
        assert_eq!(s, "1.5,0,.25,-.33,12");
    }
}
