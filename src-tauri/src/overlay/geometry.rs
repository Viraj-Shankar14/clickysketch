//! Pure geometry for selective click-through. No OS or Tauri types, so it is unit-testable anywhere.

use serde::Deserialize;

/// A rectangle in CSS pixels, relative to an overlay webview's viewport, as reported by the page.
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl CssRect {
    /// Rejects NaN/infinite/empty rectangles so a buggy page can never create a phantom hit area.
    pub fn is_usable(&self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width > 0.0
            && self.height > 0.0
    }
}

/// A rectangle in "hit-test space": physical pixels on Windows, points on macOS. This is the space
/// the native cursor APIs report in, so cursor and window frames can be compared directly.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SpaceRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl SpaceRect {
    pub fn contains(&self, px: f64, py: f64) -> bool {
        self.w > 0.0 && self.h > 0.0 && px >= self.x && py >= self.y && px < self.x + self.w && py < self.y + self.h
    }
}

/// Maps a CSS-pixel rectangle inside a window to hit-test space. `factor` converts CSS pixels to
/// space units (the display scale factor on Windows, 1.0 on macOS where space is already points).
pub fn css_to_space(frame: SpaceRect, factor: f64, rect: &CssRect) -> SpaceRect {
    SpaceRect {
        x: frame.x + rect.x * factor,
        y: frame.y + rect.y * factor,
        w: rect.width * factor,
        h: rect.height * factor,
    }
}

/// True when the cursor is inside the window and over at least one interactive region.
pub fn cursor_over_regions(frame: SpaceRect, factor: f64, regions: &[CssRect], cursor: (f64, f64)) -> bool {
    if !frame.contains(cursor.0, cursor.1) {
        return false;
    }
    regions
        .iter()
        .any(|region| css_to_space(frame, factor, region).contains(cursor.0, cursor.1))
}

/// Index of the first frame containing the cursor.
pub fn index_of_frame_containing(frames: &[SpaceRect], cursor: (f64, f64)) -> Option<usize> {
    frames.iter().position(|frame| frame.contains(cursor.0, cursor.1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> SpaceRect {
        SpaceRect { x: 1000.0, y: 0.0, w: 1920.0, h: 1080.0 }
    }

    fn region() -> CssRect {
        CssRect { x: 100.0, y: 10.0, width: 50.0, height: 20.0 }
    }

    #[test]
    fn regions_scale_with_display_dpi() {
        // At 150% the region covers x 1150..1225 and y 15..45 in space units.
        let regions = [region()];
        assert!(cursor_over_regions(frame(), 1.5, &regions, (1160.0, 20.0)));
        assert!(!cursor_over_regions(frame(), 1.5, &regions, (1100.0, 20.0)));
        assert!(!cursor_over_regions(frame(), 1.5, &regions, (1160.0, 50.0)));
    }

    #[test]
    fn macos_style_points_use_factor_one() {
        let regions = [region()];
        assert!(cursor_over_regions(frame(), 1.0, &regions, (1110.0, 20.0)));
        assert!(!cursor_over_regions(frame(), 1.0, &regions, (1160.0, 20.0)));
    }

    #[test]
    fn cursor_outside_the_window_never_hits() {
        let wide = [CssRect { x: -5000.0, y: -5000.0, width: 20000.0, height: 20000.0 }];
        assert!(!cursor_over_regions(frame(), 1.0, &wide, (500.0, 20.0)));
    }

    #[test]
    fn unusable_rectangles_are_rejected() {
        assert!(region().is_usable());
        assert!(!CssRect { width: 0.0, ..region() }.is_usable());
        assert!(!CssRect { x: f64::NAN, ..region() }.is_usable());
        assert!(!CssRect { height: f64::INFINITY, ..region() }.is_usable());
    }

    #[test]
    fn finds_the_display_under_the_cursor() {
        let frames = [
            SpaceRect { x: 0.0, y: 0.0, w: 1000.0, h: 800.0 },
            SpaceRect { x: 1000.0, y: 0.0, w: 1000.0, h: 800.0 },
        ];
        assert_eq!(index_of_frame_containing(&frames, (10.0, 10.0)), Some(0));
        assert_eq!(index_of_frame_containing(&frames, (1500.0, 400.0)), Some(1));
        assert_eq!(index_of_frame_containing(&frames, (-1.0, 10.0)), None);
    }
}
