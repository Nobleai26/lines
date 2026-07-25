# lines 2.0

Same gag, but Mode 1 now behaves like real powder you physically push around.
Self-contained: this folder deploys on its own.

## What changed from v1

**Start state.** No more faint dusting across the whole screen (which read as
stars). All 4000 grains spawn as a single dense mound in the centre — two
independent gaussians, so it's solid in the core and thins toward the rim.

**Pushing.** Every line of "attract the grain toward a target line" is gone.
Grains have position and velocity and nothing else acts on them:

- On drag, grains within `BRUSH_RADIUS` of the finger's **path segment** (not
  just its end point, so fast swipes don't skip anything) get an impulse along
  the direction of travel, scaled by how close they are to the brush centre.
- A little perpendicular `SPREAD` fans the powder out naturally.
- `PLOW` additionally displaces the grains the fingertip is sitting on, so the
  pile is *carried* along instead of stalling under friction. Without it,
  powder lags badly behind your finger (a 280px drag moved powder only ~115px;
  with it, ~245px).
- `FRICTION` damps velocity every frame, so grains coast to a stop and stay
  exactly where you left them. Nothing drifts on its own.

Net effect: you drag powder out of the pile and smear it into three lines
yourself. Nothing auto-arranges.

**Guides.** Optional barely-visible hints at 30/50/70% height to aim for.
Off by default — set `SHOW_GUIDES: true`.

## Unchanged from v1

- Long-press **lower-right** (~800ms, held still) locks the layout and switches
  to Wipe mode. Moving >12px during the hold counts as a push instead.
- **Wipe mode**: the soft directional smear brush (`destination-out`, feathered
  radial-gradient edge, elongated along the drag, interpolated along the path)
  erases powder to reveal black.
- Long-press **top-right** (~800ms) resets back to the centre pile.
- Touch + mouse, `touch-action: none`, `preventDefault`, device-pixel-ratio
  sharpness, resize/rotate handling, low-opacity fullscreen toggle.

## Tunables

All at the top of `main.js`:

| Constant | Default | What it does |
| --- | --- | --- |
| `PARTICLE_COUNT` | 4000 | how much powder |
| `PILE_RADIUS` | 0.12 | mound size, as a fraction of screen height |
| `PILE_FALLOFF` | 0.42 | lower = tighter, denser core |
| `PARTICLE_MIN/MAX_SIZE` | 0.6 / 2.0 | grain size range (px) |
| `PARTICLE_MIN/MAX_ALPHA` | 0.5 / 1.0 | grain opacity range (texture) |
| `BRUSH_RADIUS` | 0.08 | push radius, as a fraction of screen height |
| `PUSH_STRENGTH` | 2.6 | impulse imparted to grains under the finger |
| `PLOW` | 0.4 | how strongly the fingertip carries grains along |
| `SPREAD` | 0.55 | sideways fan-out |
| `FRICTION` | 0.86 | velocity kept per frame (lower = settles sooner) |
| `MAX_SPEED` | 26 | velocity clamp, px/frame |
| `SHOW_GUIDES` | false | faint 30/50/70% aiming guides |
| `HOLD_MS` | 800 | long-press duration |
| `HOLD_MOVE_TOLERANCE` | 12 | px of movement that cancels a long-press |
| `CORNER_BOX` | 90 | px hot-corner size |
| `WIPE_*` | — | Mode 2 smear radius / softness / stretch / continuity |

## Run locally

From this folder:

```bash
npx serve
```

Then open the printed URL (use your LAN IP to test on a phone).
