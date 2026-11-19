//! Windows screen capture through plain GDI: copy the display's pixels into an off-screen bitmap and
//! read them back as BGRA. Works on every Windows version Tauri supports and needs no permission.
//! (The Windows.Graphics.Capture route in the spec is a zero-copy optimisation for continuous
//! capture; one picture per question does not need it.)
//!
//! The handful of GDI functions are declared by hand to stay independent of `windows-rs` versions.

use super::{Frame, PixelFormat};
use crate::overlay::MonitorRect;
use std::ffi::c_void;
use std::ptr::null_mut;

type Hwnd = *mut c_void;
type Hdc = *mut c_void;
type Hgdiobj = *mut c_void;

#[repr(C)]
struct BitmapInfoHeader {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bit_count: u16,
    compression: u32,
    size_image: u32,
    x_pels_per_meter: i32,
    y_pels_per_meter: i32,
    clr_used: u32,
    clr_important: u32,
}

#[repr(C)]
struct BitmapInfo {
    header: BitmapInfoHeader,
    colors: [u32; 1],
}

const SRCCOPY: u32 = 0x00CC_0020;
/// Include layered (transparent) windows in the copy.
const CAPTUREBLT: u32 = 0x4000_0000;
const DIB_RGB_COLORS: u32 = 0;
const BI_RGB: u32 = 0;

#[link(name = "user32")]
extern "system" {
    fn GetDC(hwnd: Hwnd) -> Hdc;
    fn ReleaseDC(hwnd: Hwnd, hdc: Hdc) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleDC(hdc: Hdc) -> Hdc;
    fn CreateCompatibleBitmap(hdc: Hdc, width: i32, height: i32) -> Hgdiobj;
    fn SelectObject(hdc: Hdc, object: Hgdiobj) -> Hgdiobj;
    fn BitBlt(dest: Hdc, x: i32, y: i32, cx: i32, cy: i32, src: Hdc, src_x: i32, src_y: i32, rop: u32) -> i32;
    fn GetDIBits(hdc: Hdc, bitmap: Hgdiobj, start: u32, lines: u32, bits: *mut c_void, info: *mut BitmapInfo, usage: u32) -> i32;
    fn DeleteObject(object: Hgdiobj) -> i32;
    fn DeleteDC(hdc: Hdc) -> i32;
}

/// Copies a rectangle of the virtual desktop (physical pixels) as top-down BGRA.
fn grab(rect: MonitorRect) -> Result<Vec<u8>, String> {
    let width = rect.width as i32;
    let height = rect.height as i32;
    if width <= 0 || height <= 0 {
        return Err("the display has no size".to_string());
    }
    // SAFETY: standard GDI screen copy. Every handle created here is released on every path, and the
    // pixel buffer is exactly width * height * 4 bytes, which is what GetDIBits is told to fill.
    unsafe {
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return Err("GetDC failed".to_string());
        }
        let memory = CreateCompatibleDC(screen);
        if memory.is_null() {
            ReleaseDC(null_mut(), screen);
            return Err("CreateCompatibleDC failed".to_string());
        }
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        if bitmap.is_null() {
            DeleteDC(memory);
            ReleaseDC(null_mut(), screen);
            return Err("CreateCompatibleBitmap failed".to_string());
        }

        let previous = SelectObject(memory, bitmap);
        let copied = BitBlt(memory, 0, 0, width, height, screen, rect.x, rect.y, SRCCOPY | CAPTUREBLT);
        // GetDIBits requires that the bitmap is not selected into a device context.
        SelectObject(memory, previous);

        let mut info = BitmapInfo {
            header: BitmapInfoHeader {
                size: std::mem::size_of::<BitmapInfoHeader>() as u32,
                width,
                height: -height, // negative: top-down rows
                planes: 1,
                bit_count: 32,
                compression: BI_RGB,
                size_image: 0,
                x_pels_per_meter: 0,
                y_pels_per_meter: 0,
                clr_used: 0,
                clr_important: 0,
            },
            colors: [0],
        };
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        let lines = if copied != 0 {
            GetDIBits(memory, bitmap, 0, height as u32, pixels.as_mut_ptr() as *mut c_void, &mut info, DIB_RGB_COLORS)
        } else {
            0
        };

        DeleteObject(bitmap);
        DeleteDC(memory);
        ReleaseDC(null_mut(), screen);

        if copied == 0 {
            return Err("BitBlt failed (the display may be protected or asleep)".to_string());
        }
        if lines == 0 {
            return Err("GetDIBits failed".to_string());
        }
        Ok(pixels)
    }
}

/// Area-averaging downscale from BGRA to opaque RGBA. GDI leaves the alpha channel at zero, which is
/// why it is rewritten here. Returns the pixels and their new size.
fn downscale(source: &[u8], src_w: usize, src_h: usize, max_width: usize) -> (Vec<u8>, usize, usize) {
    let dst_w = src_w.min(max_width).max(1);
    let dst_h = ((src_h * dst_w + src_w / 2) / src_w).max(1);
    let mut out = vec![0u8; dst_w * dst_h * 4];
    for dy in 0..dst_h {
        let y0 = dy * src_h / dst_h;
        let y1 = (((dy + 1) * src_h + dst_h - 1) / dst_h).clamp(y0 + 1, src_h);
        for dx in 0..dst_w {
            let x0 = dx * src_w / dst_w;
            let x1 = (((dx + 1) * src_w + dst_w - 1) / dst_w).clamp(x0 + 1, src_w);
            let (mut blue, mut green, mut red) = (0u32, 0u32, 0u32);
            for y in y0..y1 {
                let row = y * src_w * 4;
                for x in x0..x1 {
                    let i = row + x * 4;
                    blue += u32::from(source[i]);
                    green += u32::from(source[i + 1]);
                    red += u32::from(source[i + 2]);
                }
            }
            let count = ((y1 - y0) * (x1 - x0)) as u32;
            let o = (dy * dst_w + dx) * 4;
            out[o] = (red / count) as u8;
            out[o + 1] = (green / count) as u8;
            out[o + 2] = (blue / count) as u8;
            out[o + 3] = 255;
        }
    }
    (out, dst_w, dst_h)
}

pub fn capture(_index: usize, rect: MonitorRect, max_width: u32) -> Result<Frame, String> {
    let bgra = grab(rect)?;
    let (rgba, width, height) = downscale(&bgra, rect.width as usize, rect.height as usize, max_width as usize);
    Ok(Frame { format: PixelFormat::Rgba, width: width as u32, height: height as u32, data: rgba })
}

#[cfg(test)]
mod tests {
    use super::downscale;

    #[test]
    fn halves_a_checkerboard_into_flat_grey_and_makes_alpha_opaque() {
        // 4x2 BGRA: alternating black and white pixels, alpha 0 like GDI delivers.
        let mut source = Vec::new();
        for _y in 0..2 {
            for x in 0..4 {
                let v = if x % 2 == 0 { 0 } else { 255 };
                source.extend_from_slice(&[v, v, v, 0]);
            }
        }
        let (out, w, h) = downscale(&source, 4, 2, 2);
        assert_eq!((w, h), (2, 1));
        assert_eq!(out.len(), 2 * 1 * 4);
        for pixel in out.chunks(4) {
            assert_eq!(pixel[3], 255);
            assert!((126..=128).contains(&pixel[0]), "average of 0 and 255, got {}", pixel[0]);
        }
    }

    #[test]
    fn never_enlarges_and_swaps_blue_and_red() {
        let source = [10u8, 20, 30, 0]; // one BGRA pixel: b=10 g=20 r=30
        let (out, w, h) = downscale(&source, 1, 1, 1280);
        assert_eq!((w, h), (1, 1));
        assert_eq!(out, vec![30, 20, 10, 255]);
    }
}
