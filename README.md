# lines

A tiny mobile web gag. The screen shows a full-screen photo of three lines of
white powder on a dark background. Drag a finger across the screen and the
powder "wipes" away, revealing the clean surface underneath — like an eraser.
No visible seams, no buttons.

Plain static site: `index.html` + `style.css` + `main.js`. No framework, no
build step. Deploys to Vercel as-is.

## How it works

Two stacked HTML5 canvases:

- **Bottom layer** draws `public/clean.jpg` — the same scene *without* the
  powder (the "clean plate").
- **Top layer** draws `public/powder.jpg` — the scene *with* the powder,
  aligned pixel-for-pixel (both are cover-fit to the viewport, like CSS
  `object-fit: cover`).

Wiping erases the top layer along your finger path using
`globalCompositeOperation = 'destination-out'` (a round brush ~6% of screen
height), so the clean plate below shows through seamlessly.

If `clean.jpg` is missing, the bottom layer falls back to the average colour of
`powder.jpg`'s four corners. It still works — `clean.jpg` just looks better.

## Swapping the images

Drop your own photos into `public/`:

- `public/powder.jpg` — the photo **with** the powder lines.
- `public/clean.jpg` — the **same** scene, same camera position, **without**
  the powder.

The two must be shot from the same position so they line up when wiped. Any
resolution works; they're cover-fit to the screen automatically. `clean.jpg` is
optional but recommended.

## Run locally

Opening `index.html` directly with `file://` can block image loading, so serve
it over HTTP. From the project folder, pick one:

```bash
npx serve
```

or

```bash
python3 -m http.server 8080
```

Then open the printed URL (e.g. `http://localhost:3000` or
`http://localhost:8080`) on your phone or in a browser. To test on a real phone,
use your computer's LAN IP instead of `localhost` (e.g.
`http://192.168.1.20:8080`) with both devices on the same Wi‑Fi.

## Reset gesture

There are no buttons. To redraw the powder, **press and hold the top-right
corner** (about a 90px box) for roughly **0.8 seconds while holding still**. If
your finger moves more than ~12px during the hold, it's treated as a wipe
instead of a reset.

## Full screen

The app goes full screen automatically on your first tap (Android/Chrome and
desktop). On **iPhone**, tap the Share button in Safari → **Add to Home Screen**,
then launch it from the home-screen icon — it opens edge-to-edge with no Safari
chrome (the most convincing option for the gag).

## Deploy

Static site — deploy the folder as-is to Vercel (or any static host):

```bash
npx vercel        # preview
npx vercel --prod # production
```

No configuration needed.
