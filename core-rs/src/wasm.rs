//! Minimal C ABI for WebAssembly hosts (no wasm-bindgen needed).
//!
//! The host allocates input buffers with `mt_alloc`, calls an entry point,
//! then reads `mt_result_len()` bytes at `mt_result_ptr()`.
//! Entry points return the result length, or a negative error code.

use crate::{analyze, preprocess, segment, vectorize, Options, Segmentation};
use std::cell::RefCell;

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn set_result(bytes: Vec<u8>) -> i32 {
    let len = bytes.len() as i32;
    RESULT.with(|r| *r.borrow_mut() = bytes);
    len
}

#[no_mangle]
pub extern "C" fn mt_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr`/`len` must come from `mt_alloc`.
#[no_mangle]
pub unsafe extern "C" fn mt_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(unsafe { Vec::from_raw_parts(ptr, 0, len.max(1)) });
    }
}

#[no_mangle]
pub extern "C" fn mt_result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn mt_result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

/// Releases the last result buffer.
#[no_mangle]
pub extern "C" fn mt_result_clear() {
    RESULT.with(|r| *r.borrow_mut() = Vec::new());
}

unsafe fn slice<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}

unsafe fn palette(ptr: *const u8, n: usize) -> Vec<[u8; 3]> {
    let raw = unsafe { slice(ptr, n * 4) };
    raw.chunks_exact(4).map(|c| [c[0], c[1], c[2]]).collect()
}

/// Analyse an RGBA image. Result: JSON.
///
/// # Safety
/// Pointers must reference valid buffers of the stated sizes.
#[no_mangle]
pub unsafe extern "C" fn mt_analyze(img: *const u8, w: usize, h: usize) -> i32 {
    let rgba = unsafe { slice(img, w * h * 4) };
    if rgba.len() != w * h * 4 || w == 0 || h == 0 {
        return -1;
    }
    let rgb = preprocess::from_rgba(rgba, w, h, 128);
    set_result(analyze::analyze(&rgb).to_json().into_bytes())
}

/// Segment an RGBA image. Result: `u32 w, u32 h, u32 upscale, u32 n,
/// n×RGBA palette, w×h labels` (little endian).
///
/// # Safety
/// Pointers must reference valid buffers of the stated sizes.
#[no_mangle]
pub unsafe extern "C" fn mt_segment(
    img: *const u8,
    w: usize,
    h: usize,
    opts: *const f64,
    nopts: usize,
    pal: *const u8,
    npal: usize,
) -> i32 {
    let rgba = unsafe { slice(img, w * h * 4) };
    if w == 0 || h == 0 {
        return -1;
    }
    let o = Options::from_slice(unsafe { slice(opts, nopts) });
    let locked = unsafe { palette(pal, npal.min(250)) };
    let seg = segment(rgba, w, h, &o, &locked);
    let mut out = Vec::with_capacity(16 + seg.palette.len() * 4 + seg.labels.len());
    for v in [seg.w as u32, seg.h as u32, seg.upscale as u32, seg.palette.len() as u32] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for c in &seg.palette {
        out.extend_from_slice(&[c[0], c[1], c[2], 255]);
    }
    out.extend_from_slice(&seg.labels);
    set_result(out)
}

/// Vectorize a label map. Result: JSON (see `TraceResult::to_json`).
///
/// # Safety
/// Pointers must reference valid buffers of the stated sizes.
#[no_mangle]
pub unsafe extern "C" fn mt_vectorize(
    labels: *const u8,
    w: usize,
    h: usize,
    upscale: u32,
    pal: *const u8,
    npal: usize,
    opts: *const f64,
    nopts: usize,
) -> i32 {
    if w == 0 || h == 0 {
        return -1;
    }
    let seg = Segmentation {
        w,
        h,
        palette: unsafe { palette(pal, npal.min(255)) },
        labels: unsafe { slice(labels, w * h) }.to_vec(),
        upscale: upscale.clamp(1, 2) as u8,
    };
    let o = Options::from_slice(unsafe { slice(opts, nopts) });
    set_result(vectorize(&seg, &o).to_json().into_bytes())
}
