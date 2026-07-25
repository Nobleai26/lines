# lines

A tiny mobile web gag, in two phases. Plain static site: `index.html` +
`style.css` + `main.js`. No framework, no build step, all HTML5 Canvas.

## The flow

**MODE 1 — ARRANGE** (active on load)
The screen opens with ~2500 grains of white powder dusted randomly over black.
Swipe like you're working a card: grains inside the brush get shoved along your
finger *and* pulled toward the nearest of three invisible target lines, then
squeezed horizontally into that line's bounds. Repeated swipes accumulate the
mess into three neat, dense lines. Grains ease toward their target rather than
snapping, so it reads as powder settling.

**MODE SWITCH**
Long-press the **lower-right corner** (~90px box) for ~800ms, holding still.
The arrangement locks, a quick fade flash confirms, and you're in Mode 2.
Move more than ~12px during the hold and it's treated as a normal arrange
swipe instead.

**MODE 2 — WIPE**
The frozen arrangement is baked onto the top canvas layer. Now swiping erases
it with a soft directional "fingertip smear" — `destination-out` with a
feathered radial-gradient edge, elongated along the drag direction and
interpolated along the path so fast swipes stay continuous — revealing black
underneath.

**RESET**
Long-press the **top-right corner** (~800ms, held still) to rescatter the
powder and go back to Mode 1. Works in either mode.

## Full screen

Tap the low-opacity icon in the top-left to toggle full screen. It's also
requested automatically on your first tap.

On **iPhone**, Safari does not let a web page force full screen — the only true
full screen is to tap **Share → Add to Home Screen** and launch it from the
home-screen icon, which opens edge-to-edge with no Safari chrome. On Android
the automatic toggle works directly.

## Tuning

Every knob lives in the `CFG` block at the top of `main.js`:

| Constant | What it does |
| --- | --- |
| `PARTICLE_COUNT` | how much powder (~2500) |
| `PARTICLE_MIN/MAX_SIZE`, `..._ALPHA` | grain size / opacity variation |
| `LINE_Y_FRACTIONS` | where the three lines sit (0.3 / 0.5 / 0.7 of height) |
| `LINE_WIDTH_FRACTION` | line length (0.64 of width, centered) |
| `LINE_THICKNESS_FRACTION` | how fat a finished line looks |
| `ARRANGE_BRUSH_FRACTION` | swipe radius in Mode 1 (0.08 of height) |
| `PUSH_STRENGTH`, `EASING`, `FRICTION`, `COMPACT` | the settling feel |
| `BALANCE_SLACK` | keeps the three lines evenly dense (raise for pure nearest-line) |
| `WIPE_BRUSH_FRACTION` | smear radius in Mode 2 (0.06 of height) |
| `WIPE_FEATHER_INNER`, `WIPE_ELONGATION`, `WIPE_STEP_FRACTION` | smear softness / stretch / continuity |
| `HOLD_MS`, `HOLD_MOVE_TOLERANCE`, `CORNER_BOX` | the long-press gestures |

## Run locally

Serve it over HTTP (opening `index.html` as a `file://` URL can misbehave):

```bash
npx serve
```

or

```bash
python3 -m http.server 8080
```

Then open the printed URL. To test on a real phone, use your computer's LAN IP
(e.g. `http://192.168.1.20:8080`) with both devices on the same Wi-Fi.

## Notes

- Everything is generated at runtime — no photos required. The `public/*.jpg`
  files are leftovers from the original photo-based version and are unused.
- Canvas sizing accounts for `devicePixelRatio`, so it stays sharp on retina
  phones and survives rotation. Resizing while in Mode 2 re-bakes the frozen
  arrangement (any wiping already done is lost).
- The only visible control is the low-opacity full-screen toggle.

## Deploy

Static site — deploy the folder as-is. It's currently served by GitHub Pages
straight from `main`, so any `git push` redeploys it automatically:

```bash
git add -A
git commit -m "your message"
git push
```

For Vercel instead:

```bash
npx vercel --prod
```
