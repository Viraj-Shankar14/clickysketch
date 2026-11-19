# ClickySketch design analysis

Input: 14 reference screenshots. 1 to 4 are classic Windows (XP, 98, 3.1, 95). 5 to 14 are a pixel-art
desktop OS (browser, chats, CAPTCHA card, idle-game panels). Every value below was measured from the
pixels (dominant-colour quantisation plus single-row scans across buttons, inputs and title bars),
not guessed.

## Decision

A hybrid, "Pixel Windows", with a little glass:

| Layer | Taken from | What we keep |
|---|---|---|
| Structure | Windows 95/98 | title bar with three buttons, tab strip like a property sheet, group boxes with caption tabs, sunken status bar cells, Control-Panel style settings, yellow folders |
| Skin | The pixel-art desktop | light lavender faces, dark blue-grey outlines, coloured bevel edges, pixel type, chat bubbles with avatars, typing-dots bubble, coloured panel caption tabs |
| Modern touch | HeyClicky on macOS | translucent gloss on primary buttons and on the floating HUD |
| Rejected | Windows XP "Luna" | rounded glossy chrome fights the pixel skin; kept only its blue as an accent |
| Rejected | Excalidraw hand-drawn chrome (our Milestone 1 look) | charming, but reads as a whiteboard demo, not as a product students install. Rough.js stays for the screen-annotation canvas in Milestone 3 |

Original artwork only: every icon, the wallpaper and the app logo are drawn from scratch in this style.
The screenshots are studied, not copied, because this app will be shipped.

## Measured palette

| Role | Hex | Source |
|---|---|---|
| Window / panel face | `#f2eff2` | dominant colour of every pixel-UI screenshot (57-86 percent of pixels) |
| Title bar, taskbar | `#dcdcdc` / `#e1e1e3` | refs 8, 14 |
| Raised chat bubble | `#dfdcdf` | ref 12 |
| Outline (all controls) | `#4d4f55` | refs 6, 7, 12 (`#535557`, `#4c4f5a`, `#545255` average) |
| Sunken inner shade | `#a6a3a6` | ref 6 input, top and left |
| Bevel highlight | `#ffffff` | ref 6 input bottom/right, ref 12 bubble top/left |
| Primary blue | `#679cfd` | ref 6 button, ref 10 header/Verify, ref 13 Hire |
| Blue highlight edge | `#a9d6fb` | ref 6 button top/left |
| Blue shadow edge | `#2948e7` | ref 6 button bottom/right |
| Purple page / header | `#bfb4fd` / `#7271e3` / `#635fb2` | ref 8 |
| Green (own bubble, progress) | `#84cc6a` / `#48cd4d` | refs 14, 13 |
| Panel caption tabs | green `#4acf58`, yellow `#fbc046`, red `#e8402b`, blue `#84a9e3` | ref 13 |
| Slider knob | `#d1170f` | ref 13 |
| Text | `#474755` | refs 7, 12 |
| Sky / cloud / grass | `#a9cdd3` / `#e8e5e2` / `#97aa73` | ref 5 |
| Win95 teal / navy / grey | `#008080` / `#000080` / `#c0c0c0` | refs 2, 4 (reference only) |

## Anatomy, as measured

**Button (pixel UI).** From outside in, one "art pixel" (we render it as 2 CSS px) each:
dark outline `#4d4f55`, top-left highlight `#a9d6fb`, flat fill `#679cfd`, bottom-right shade `#2948e7`,
dark outline. Pressed swaps highlight and shade. A glyph (white arrow) is centred, drawn on the same grid.

**Text input.** Inverse bevel: dark outline, grey `#a6a3a6` along the top and left inside, near-white
`#fffdff` along the bottom and right, `#f5f3f5` fill. It reads as sunken.

**Chat bubble.** Dark outline, white top-left highlight, `#dfdcdf` fill, darker bottom-right. Own messages
turn green (`#84cc6a`). A round avatar with a thin light-blue ring sits beside the bubble. The typing
indicator is the same bubble holding three grey dots fading in sequence.

**Window.** Light grey title bar (`#dcdcdc`) with a small icon and label on the left and minimise / close
squares on the right, dark outline all round, body in face colour, optional taskbar strip with a raised
"Menu" button on the left and a clock/date cell on the right.

**Panel with caption tab.** A face-coloured box with a coloured label tab overlapping its top-left edge
("Upgrades" green, "Resources" yellow, "Research" red, "Workers" blue). We use the same device for the
Settings sections.

**Win95/98 patterns we keep.** Property-sheet tabs, group boxes, sunken status-bar cells, the Control
Panel icon-grid idea (Settings categories), and the yellow folder as the "history" metaphor.

## How the look is built (no images, no clip-path)

Every control is a plain box with a 2 px `box-shadow` outline on all four sides. Because the four shadows
do not meet, the corners are missing one pixel: that is what gives the stepped, pixel-rounded corner.
The bevel is two `inset` shadows. Glass is one extra gradient layer on top of the blue fill: a bright
upper half fading out, a thin white inner border and a soft blur of what is behind.

## Type

Pixelify Sans (OFL), 16 px for body and 13 px for captions, so each glyph pixel lands on a 2 px grid.

## Glass, honestly

Glass can only blur what is inside the same web page. The main window has a wallpaper behind its glass
buttons, so the blur is real there. The floating HUD sits over your desktop, which a web page cannot see,
so it fakes glass with translucency, a gloss gradient and a soft shadow.
