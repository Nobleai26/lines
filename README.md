# lines

A tiny mobile web gag. Plain static site: `index.html` + `style.css` +
`main.js`. No framework, no build step, all HTML5 Canvas.

## Three builds live side by side

| | Where | What it is |
| --- | --- | --- |
| **photo** (this folder) | site root | The original. A real photo of three powder lines; drag a finger to wipe it away and reveal the clean plate underneath. Needs `public/powder.jpg` + `public/clean.jpg`. |
| **push** ([`v2/`](v2/)) | `/v2/` | Generated powder, no photos. Starts as one dense pile in the centre and **only** moves where you physically push it. You smear the three lines yourself, then long-press to lock and wipe. |
| **auto-arrange** ([`arrange/`](arrange/)) | `/arrange/` | Interim experiment: generated powder dusted over the screen that *snaps* itself onto three target lines as you swipe. Kept for reference. |

Each folder is self-contained, so the builds can't break each other.
`v2/` has its own [README](v2/README.md) covering the physics and tunables.
The rest of this file describes the **photo** build at the root.

## How the photo build works

Two stacked canvases:

- **Bottom layer** draws `public/clean.jpg` — the same scene *without* the
  powder (the "clean plate").
- **Top layer** draws `public/powder.jpg` — the scene *with* the powder,
  aligned pixel-for-pixel (both cover-fit to the viewport, like CSS
  `object-fit: cover`).

Wiping erases the top layer along your finger path with
`globalCompositeOperation = 'destination-out'`, so the clean plate below shows
through seamlessly — no visible patch.

### The wipe brush

A plain round eraser reads as a cartoon circle, so the brush is built to
behave like an actual fingertip smear:

- **Soft, feathered edge** — a radial-gradient alpha falloff, no hard rim.
- **Directional stretch** — the contact patch elongates along the drag and
  stretches further the faster you move (up to 2×).
- **Partial lift** — one pass only removes ~50%, leaving residue; going back
  over the same spot cleans it properly, like real powder.
- **Fingertip ridges** — a few smaller offset blobs perpendicular to travel
  give the swath streaky internal structure.
- **Interpolated path** — dabs are walked along the finger path so fast swipes
  smear continuously instead of leaving a dotted trail.

Tune it with the `WIPE_*` constants at the top of `main.js`
(`WIPE_STRENGTH` for how much a single pass lifts, `BRUSH_FRACTION` for
fingertip size, `WIPE_STREAKS` for ridge count — set it to `1` for a plain
smooth pad).

If `clean.jpg` is missing, the bottom layer falls back to the average colour of
`powder.jpg`'s four corners. It still works; `clean.jpg` just looks better.
Either `.jpg` or `.png` is accepted for both.

## Swapping the images

Drop your own photos into `public/`:

- `public/powder.jpg` — the photo **with** the powder lines (required).
- `public/clean.jpg` — the **same** scene, same camera position, **without**
  the powder (optional but recommended).

Shoot both from the same position so they line up when wiped. Any resolution
works — they're cover-fit automatically.

## Reset gesture

No buttons. **Press and hold the top-right corner** (~90px box) for ~0.8s
while holding still to redraw the powder. Moving more than ~12px during the
hold counts as a wipe instead.

## Full screen

Full screen is requested automatically on your first tap (Android/Chrome and
desktop). On **iPhone**, Safari won't let a page force it — tap **Share → Add
to Home Screen** and launch from the icon for a true edge-to-edge, chrome-free
window. That's the most convincing option for the gag.

## Run locally

Serve over HTTP (opening `index.html` as a `file://` URL can block image
loading):

```bash
npx serve
```

or

```bash
python3 -m http.server 8080
```

Then open the printed URL. To test on a real phone, use your computer's LAN IP
(e.g. `http://192.168.1.20:8080`) with both devices on the same Wi-Fi.

## Deploy

Static site — deploy the folder as-is. It's served by GitHub Pages straight
from `main`, so any push redeploys every build:

```bash
git add -A
git commit -m "your message"
git push
```
