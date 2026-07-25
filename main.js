/* lines — drag to wipe the powder away, revealing the clean plate underneath. */
(function () {
  "use strict";

  var cleanCanvas = document.getElementById("clean");
  var powderCanvas = document.getElementById("powder");
  var cleanCtx = cleanCanvas.getContext("2d");
  var powderCtx = powderCanvas.getContext("2d");

  // Loaded images (may be null if they fail to load).
  var powderImg = null;
  var cleanImg = null;
  // Fallback fill colour, computed from powder.jpg corners if clean.jpg is missing.
  var fallbackColor = "#12151a";

  // Current CSS-pixel size of the viewport and the device pixel ratio.
  var viewW = 0;
  var viewH = 0;
  var dpr = 1;

  /* --- Wipe brush ("fingertip smear") -----------------------------------
   * A hard round eraser reads as a cartoon circle. A real finger wipe is a
   * soft, directional smear: it stretches along the drag, has a feathered
   * edge, doesn't lift everything in one pass (residue lingers, and going
   * over the same spot again cleans it), and leaves faint streaks where the
   * fingertip ridges drag powder aside.
   * ------------------------------------------------------------------- */
  var BRUSH_FRACTION = 0.075;    // fingertip radius, fraction of screen height
  var WIPE_STRENGTH = 0.5;       // how much a single dab lifts (0..1)
  var WIPE_FEATHER_INNER = 0.3;  // 0..1 of radius held at full strength
  var WIPE_FEATHER_MID = 0.72;   // where the soft falloff sits
  var WIPE_ELONGATION = 1.0;     // extra stretch along the drag at speed
  var WIPE_STEP_FRACTION = 0.22; // path interpolation, as a fraction of radius
  var WIPE_MAX_DABS = 48;        // work cap per event, so a huge jump can't stall
  var WIPE_STREAKS = 3;          // parallel fingertip ridges (1 = plain pad)
  var WIPE_STREAK_EVERY = 2;     // ridges every Nth dab (texture, not coverage)
  var WIPE_STREAK_SPREAD = 0.5;  // ridge offset, as a fraction of radius
  var WIPE_STREAK_SIZE = 0.62;   // ridge size, relative to the main pad
  var WIPE_STREAK_JITTER = 0.18; // wobble so ridges aren't mechanical

  /* ----------------------------------------------------------------------
   * Image loading
   * -------------------------------------------------------------------- */

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = src;
    });
  }

  // Try a list of candidate paths in order; resolve with the first that loads
  // (or null if none do). Lets us accept either .png or .jpg without fuss.
  function loadFirst(srcs) {
    var i = 0;
    function next() {
      if (i >= srcs.length) return Promise.resolve(null);
      return loadImage(srcs[i++]).then(function (img) {
        return img || next();
      });
    }
    return next();
  }

  // Average the four corner pixels of an image to get a fallback plate colour.
  function sampleCornerColor(img) {
    try {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      var cx = c.getContext("2d");
      cx.drawImage(img, 0, 0);
      var pts = [
        [1, 1],
        [w - 2, 1],
        [1, h - 2],
        [w - 2, h - 2],
      ];
      var r = 0, g = 0, b = 0;
      for (var i = 0; i < pts.length; i++) {
        var d = cx.getImageData(pts[i][0], pts[i][1], 1, 1).data;
        r += d[0];
        g += d[1];
        b += d[2];
      }
      r = Math.round(r / pts.length);
      g = Math.round(g / pts.length);
      b = Math.round(b / pts.length);
      return "rgb(" + r + "," + g + "," + b + ")";
    } catch (e) {
      // Canvas may be tainted if served cross-origin without CORS; keep default.
      return fallbackColor;
    }
  }

  /* ----------------------------------------------------------------------
   * Sizing + drawing (object-fit: cover)
   * -------------------------------------------------------------------- */

  // Compute the cover-fit rectangle for an image inside w x h (CSS pixels).
  function coverRect(img, w, h) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var scale = Math.max(w / iw, h / ih);
    var dw = iw * scale;
    var dh = ih * scale;
    return {
      x: (w - dw) / 2,
      y: (h - dh) / 2,
      w: dw,
      h: dh,
    };
  }

  function sizeCanvas(canvas, ctx) {
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    // Work in CSS pixels; the DPR scale keeps it sharp on retina screens.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Draw the bottom (clean plate) layer.
  function drawClean() {
    cleanCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cleanCtx.clearRect(0, 0, viewW, viewH);
    if (cleanImg) {
      var r = coverRect(cleanImg, viewW, viewH);
      cleanCtx.drawImage(cleanImg, r.x, r.y, r.w, r.h);
    } else {
      cleanCtx.fillStyle = fallbackColor;
      cleanCtx.fillRect(0, 0, viewW, viewH);
    }
  }

  // Draw / redraw the top (powder) layer. This also resets any wiping.
  function drawPowder() {
    powderCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    powderCtx.globalCompositeOperation = "source-over";
    powderCtx.clearRect(0, 0, viewW, viewH);
    if (powderImg) {
      var r = coverRect(powderImg, viewW, viewH);
      powderCtx.drawImage(powderImg, r.x, r.y, r.w, r.h);
    }
    // If there's no powder image at all, the top layer stays transparent and
    // the clean plate shows through — nothing to wipe, but nothing breaks.
  }

  function resize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    sizeCanvas(cleanCanvas, cleanCtx);
    sizeCanvas(powderCanvas, powderCtx);
    drawClean();
    drawPowder();
  }

  /* ----------------------------------------------------------------------
   * Wiping (erase the top layer along the finger path)
   * -------------------------------------------------------------------- */

  function brushRadius() {
    return viewH * BRUSH_FRACTION;
  }

  var lastX = null;
  var lastY = null;

  // One soft, feathered, partially-erasing blob. Elongated along (dirX,dirY)
  // and scaled by `size`. Nothing here has a hard edge.
  function smearBlob(x, y, dirX, dirY, radius, strength) {
    var len = Math.sqrt(dirX * dirX + dirY * dirY);
    // Faster drags stretch the contact patch out into a smear.
    var stretch =
      1 + WIPE_ELONGATION * Math.min(1, len / (radius * 0.8));

    powderCtx.save();
    powderCtx.globalCompositeOperation = "destination-out";
    powderCtx.translate(x, y);
    if (len > 0.0001) powderCtx.rotate(Math.atan2(dirY, dirX));
    powderCtx.scale(stretch, 1);

    // destination-out removes in proportion to the alpha we paint, so the
    // gradient *is* the softness, and `strength` is how much one pass lifts.
    var g = powderCtx.createRadialGradient(0, 0, 0, 0, 0, radius);
    g.addColorStop(0, "rgba(0,0,0," + strength + ")");
    g.addColorStop(WIPE_FEATHER_INNER, "rgba(0,0,0," + strength * 0.94 + ")");
    g.addColorStop(WIPE_FEATHER_MID, "rgba(0,0,0," + strength * 0.42 + ")");
    g.addColorStop(1, "rgba(0,0,0,0)");
    powderCtx.fillStyle = g;

    powderCtx.beginPath();
    powderCtx.arc(0, 0, radius, 0, Math.PI * 2);
    powderCtx.fill();
    powderCtx.restore();
  }

  // The fingertip: a main pad plus a few offset ridges, so the swath has
  // streaky internal structure instead of being one uniform blob.
  function smearDab(x, y, dirX, dirY, withStreaks) {
    var r = brushRadius();
    smearBlob(x, y, dirX, dirY, r, WIPE_STRENGTH);

    if (WIPE_STREAKS < 2 || withStreaks === false) return;

    var len = Math.sqrt(dirX * dirX + dirY * dirY);
    // Ridges sit perpendicular to the direction of travel.
    var perpX, perpY;
    if (len > 0.0001) {
      perpX = -dirY / len;
      perpY = dirX / len;
    } else {
      perpX = 0;
      perpY = 1;
    }

    for (var i = 0; i < WIPE_STREAKS; i++) {
      // Spread ridges evenly across the pad, -1..+1.
      var t = WIPE_STREAKS === 1 ? 0 : (i / (WIPE_STREAKS - 1)) * 2 - 1;
      var jitter = (Math.random() * 2 - 1) * WIPE_STREAK_JITTER;
      var off = (t * WIPE_STREAK_SPREAD + jitter) * r;
      smearBlob(
        x + perpX * off,
        y + perpY * off,
        dirX,
        dirY,
        r * WIPE_STREAK_SIZE,
        WIPE_STRENGTH * (0.5 + Math.random() * 0.35)
      );
    }
  }

  // Walk the finger path in small steps so a fast swipe still smears
  // continuously instead of leaving a dotted trail.
  function eraseStroke(x0, y0, x1, y1) {
    var r = brushRadius();
    var dx = x1 - x0;
    var dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var step = Math.max(1, r * WIPE_STEP_FRACTION);
    var n = Math.max(1, Math.ceil(dist / step));
    // If a single event covers a huge distance (stalled frame, mouse jump),
    // spread the dabs instead of drawing hundreds of them.
    if (n > WIPE_MAX_DABS) n = WIPE_MAX_DABS;
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      smearDab(x0 + dx * t, y0 + dy * t, dx, dy, i % WIPE_STREAK_EVERY === 0);
    }
  }

  // A stationary touch: press without dragging, no direction to stretch along.
  function eraseDot(x, y) {
    smearDab(x, y, 0, 0);
  }

  function wipeStart(x, y) {
    lastX = x;
    lastY = y;
    eraseDot(x, y);
  }

  function wipeMove(x, y) {
    if (lastX === null) {
      wipeStart(x, y);
      return;
    }
    eraseStroke(lastX, lastY, x, y);
    lastX = x;
    lastY = y;
  }

  function wipeEnd() {
    lastX = null;
    lastY = null;
  }

  /* ----------------------------------------------------------------------
   * Reset gesture: press-and-hold the top-right corner, holding still.
   * -------------------------------------------------------------------- */

  var RESET_BOX = 90;   // px from the top-right corner
  var RESET_MS = 800;   // hold duration
  var RESET_MOVE = 12;  // px of movement that cancels the hold (treated as a wipe)

  var holdTimer = null;
  var holdActive = false;   // true while a candidate reset-hold is in progress
  var holdStartX = 0;
  var holdStartY = 0;
  var didReset = false;     // true if this gesture fired a reset (suppress wiping)

  function inResetCorner(x, y) {
    return x >= viewW - RESET_BOX && y <= RESET_BOX;
  }

  function startHoldCandidate(x, y) {
    holdActive = true;
    didReset = false;
    holdStartX = x;
    holdStartY = y;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () {
      // Held long enough and still enough — reset.
      didReset = true;
      holdActive = false;
      drawPowder();
    }, RESET_MS);
  }

  function cancelHold() {
    holdActive = false;
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  /* ----------------------------------------------------------------------
   * Pointer plumbing (touch + mouse)
   * -------------------------------------------------------------------- */

  /* ----------------------------------------------------------------------
   * Full screen: browsers only allow it from a user gesture, so we request
   * it on the first touch/click. Silently no-ops where unsupported (e.g.
   * iOS Safari, where "Add to Home Screen" gives true full screen instead).
   * -------------------------------------------------------------------- */

  var fullscreenTried = false;

  function enterFullscreen() {
    if (fullscreenTried) return;
    fullscreenTried = true;
    var el = document.documentElement;
    var req =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;
    if (req) {
      try {
        var r = req.call(el);
        if (r && typeof r.catch === "function") r.catch(function () {});
      } catch (e) {
        /* ignore — not fatal */
      }
    }
  }

  function onDown(x, y) {
    enterFullscreen();
    if (inResetCorner(x, y)) {
      // Ambiguous: could be a reset-hold or the start of a wipe.
      startHoldCandidate(x, y);
      // Don't wipe yet; wait to see if they move or hold.
      return;
    }
    wipeStart(x, y);
  }

  function onMove(x, y) {
    if (holdActive) {
      var dx = x - holdStartX;
      var dy = y - holdStartY;
      if (dx * dx + dy * dy > RESET_MOVE * RESET_MOVE) {
        // Moved too much — this is a wipe, not a reset.
        cancelHold();
        wipeStart(holdStartX, holdStartY);
        wipeMove(x, y);
      }
      return;
    }
    if (didReset) return; // finger still down after a reset; ignore until lifted
    wipeMove(x, y);
  }

  function onUp() {
    if (holdActive) {
      // Released before the hold completed and without moving much: a tap in
      // the corner. Treat as a small wipe so a stray tap still does something.
      cancelHold();
      if (!didReset) {
        eraseDot(holdStartX, holdStartY);
      }
    }
    didReset = false;
    wipeEnd();
  }

  // --- Touch ---
  function touchXY(t) {
    return [t.clientX, t.clientY];
  }

  powderCanvas.addEventListener(
    "touchstart",
    function (e) {
      e.preventDefault();
      var p = touchXY(e.changedTouches[0]);
      onDown(p[0], p[1]);
    },
    { passive: false }
  );

  powderCanvas.addEventListener(
    "touchmove",
    function (e) {
      e.preventDefault();
      // Use the primary touch; multi-touch is treated as one finger.
      var p = touchXY(e.changedTouches[0]);
      onMove(p[0], p[1]);
    },
    { passive: false }
  );

  powderCanvas.addEventListener(
    "touchend",
    function (e) {
      e.preventDefault();
      enterFullscreen(); // fallback: some browsers only allow it on touchend
      onUp();
    },
    { passive: false }
  );

  powderCanvas.addEventListener(
    "touchcancel",
    function (e) {
      e.preventDefault();
      onUp();
    },
    { passive: false }
  );

  // --- Mouse (for desktop testing) ---
  var mouseDown = false;

  powderCanvas.addEventListener("mousedown", function (e) {
    e.preventDefault();
    mouseDown = true;
    onDown(e.clientX, e.clientY);
  });

  window.addEventListener("mousemove", function (e) {
    if (!mouseDown) return;
    onMove(e.clientX, e.clientY);
  });

  window.addEventListener("mouseup", function () {
    if (!mouseDown) return;
    mouseDown = false;
    onUp();
  });

  // Block the context menu (long-press / right-click) so it never interrupts.
  window.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  /* ----------------------------------------------------------------------
   * Boot
   * -------------------------------------------------------------------- */

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

  Promise.all([
    loadFirst(["public/powder.jpg", "public/powder.png"]),
    loadFirst(["public/clean.jpg", "public/clean.png"]),
  ]).then(
    function (imgs) {
      powderImg = imgs[0];
      cleanImg = imgs[1];
      if (powderImg && !cleanImg) {
        fallbackColor = sampleCornerColor(powderImg);
      }
      resize();
    }
  );
})();
