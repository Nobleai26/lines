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

  // Brush radius as a fraction of screen height.
  var BRUSH_FRACTION = 0.06;

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

  function eraseDot(x, y) {
    var r = brushRadius();
    powderCtx.globalCompositeOperation = "destination-out";
    powderCtx.beginPath();
    powderCtx.arc(x, y, r, 0, Math.PI * 2);
    powderCtx.fill();
  }

  // Erase a continuous round-capped stroke from (x0,y0) to (x1,y1).
  function eraseStroke(x0, y0, x1, y1) {
    var r = brushRadius();
    powderCtx.globalCompositeOperation = "destination-out";
    powderCtx.lineWidth = r * 2;
    powderCtx.lineCap = "round";
    powderCtx.lineJoin = "round";
    powderCtx.beginPath();
    powderCtx.moveTo(x0, y0);
    powderCtx.lineTo(x1, y1);
    powderCtx.stroke();
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
