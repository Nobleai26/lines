/* lines 2.0 — two-phase gag with real pushing.
 *
 * MODE 1 "ARRANGE": all the powder starts as one dense pile in the middle of
 *                   the screen. Nothing moves on its own and nothing snaps to
 *                   a target — grains only go where your finger shoves them.
 * MODE 2 "WIPE":    the layout is frozen/baked; swiping smears it away,
 *                   revealing black underneath.
 *
 * Long-press LOWER-RIGHT -> lock + switch to WIPE.
 * Long-press TOP-RIGHT   -> reset back to the centre pile.
 */
(function () {
  "use strict";

  /* ======================================================================
   * TUNABLES
   * ==================================================================== */

  var CFG = {
    // --- The pile ---
    PARTICLE_COUNT: 4000,
    PILE_RADIUS: 0.12,        // of screen height — visible extent of the mound
    PILE_FALLOFF: 0.42,       // gaussian sigma as a fraction of PILE_RADIUS px;
                              // lower = tighter, denser core
    PARTICLE_MIN_SIZE: 0.6,   // px (CSS)
    PARTICLE_MAX_SIZE: 2.0,   // px (CSS)
    PARTICLE_MIN_ALPHA: 0.5,
    PARTICLE_MAX_ALPHA: 1.0,
    ALPHA_BUCKETS: 6,         // grains batched by alpha for fast drawing

    // --- Pushing physics (MODE 1) ---
    BRUSH_RADIUS: 0.08,       // of screen height
    PUSH_STRENGTH: 2.6,       // impulse added to grains under the finger
    // Positional "plow": the fingertip also physically carries grains it
    // overlaps, so powder keeps up with the drag instead of stalling under
    // friction. 0 = pure impulse (powder lags badly), 1 = grains are shoved
    // clear of the fingertip every frame.
    PLOW: 0.4,
    SPREAD: 0.55,             // sideways fan-out, as a fraction of the push
    FRICTION: 0.86,           // velocity kept per frame (grains settle)
    MAX_SPEED: 26,            // px/frame velocity clamp
    SETTLE_EPSILON: 0.02,     // below this speed a grain is parked
    // A drag event this long counts as a full-strength shove; shorter drags
    // push proportionally less, longer ones a bit more (capped).
    REF_DRAG_LEN: 12,         // px
    MAX_SPEED_FACTOR: 2.0,

    // --- Optional aiming guides (off by default) ---
    SHOW_GUIDES: false,
    GUIDE_Y_FRACTIONS: [0.3, 0.5, 0.7],
    GUIDE_WIDTH_FRACTION: 0.64,
    GUIDE_ALPHA: 0.05,

    // --- Wipe feel (MODE 2) — unchanged ---
    WIPE_BRUSH_FRACTION: 0.06,
    WIPE_FEATHER_INNER: 0.45,
    WIPE_ELONGATION: 0.85,
    WIPE_STEP_FRACTION: 0.28,

    // --- Gestures ---
    HOLD_MS: 800,
    HOLD_MOVE_TOLERANCE: 12,
    CORNER_BOX: 90,
  };

  var MODE_ARRANGE = 1;
  var MODE_WIPE = 2;

  /* ======================================================================
   * State
   * ==================================================================== */

  var baseCanvas = document.getElementById("base");
  var topCanvas = document.getElementById("top");
  var baseCtx = baseCanvas.getContext("2d");
  var topCtx = topCanvas.getContext("2d");
  var flashEl = document.getElementById("flash");
  var fsBtn = document.getElementById("fs");

  var viewW = 0;
  var viewH = 0;
  var dpr = 1;

  var mode = MODE_ARRANGE;
  var particles = [];
  var buckets = [];
  var rafId = null;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // Standard normal via Box-Muller.
  function gaussian() {
    var u = 1 - Math.random();  // (0,1]
    var v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ======================================================================
   * The pile
   * ==================================================================== */

  function makePile() {
    particles = [];
    buckets = [];
    for (var b = 0; b < CFG.ALPHA_BUCKETS; b++) buckets.push([]);

    var cx = viewW / 2;
    var cy = viewH / 2;
    var sigma = viewH * CFG.PILE_RADIUS * CFG.PILE_FALLOFF;

    for (var i = 0; i < CFG.PARTICLE_COUNT; i++) {
      // Two independent gaussians -> a round mound, densest at the centre.
      var alpha = rand(CFG.PARTICLE_MIN_ALPHA, CFG.PARTICLE_MAX_ALPHA);
      var p = {
        x: cx + gaussian() * sigma,
        y: cy + gaussian() * sigma,
        vx: 0,
        vy: 0,
        size: rand(CFG.PARTICLE_MIN_SIZE, CFG.PARTICLE_MAX_SIZE),
        alpha: alpha,
      };
      // Keep the mound on screen.
      if (p.x < 0) p.x = 0;
      else if (p.x > viewW) p.x = viewW;
      if (p.y < 0) p.y = 0;
      else if (p.y > viewH) p.y = viewH;

      particles.push(p);
      var bi = Math.min(
        CFG.ALPHA_BUCKETS - 1,
        Math.floor(
          ((alpha - CFG.PARTICLE_MIN_ALPHA) /
            (CFG.PARTICLE_MAX_ALPHA - CFG.PARTICLE_MIN_ALPHA)) *
            CFG.ALPHA_BUCKETS
        )
      );
      buckets[bi].push(p);
    }
  }

  // Scale grains into the new viewport (used on resize/rotate).
  function rescaleParticles(oldW, oldH) {
    if (!oldW || !oldH) return;
    var sx = viewW / oldW;
    var sy = viewH / oldH;
    for (var i = 0; i < particles.length; i++) {
      particles[i].x *= sx;
      particles[i].y *= sy;
    }
  }

  /* ======================================================================
   * Pushing — the only thing that moves powder.
   *
   * Grains are tested against the whole finger *segment*, not just its end
   * point, so a fast swipe still catches everything it passed through.
   * ==================================================================== */

  // Squared distance from point p to segment ab, plus where along ab it fell.
  function distToSegment2(px, py, ax, ay, bx, by, segLen2) {
    var abx = bx - ax;
    var aby = by - ay;
    var t =
      segLen2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / segLen2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    var dx = px - (ax + abx * t);
    var dy = py - (ay + aby * t);
    return dx * dx + dy * dy;
  }

  function pushAlong(x0, y0, x1, y1) {
    var r = viewH * CFG.BRUSH_RADIUS;
    var r2 = r * r;

    var segX = x1 - x0;
    var segY = y1 - y0;
    var segLen2 = segX * segX + segY * segY;
    var segLen = Math.sqrt(segLen2);
    if (segLen < 0.0001) return;

    // Direction of travel, and the perpendicular used for sideways spread.
    var dirX = segX / segLen;
    var dirY = segY / segLen;
    var perpX = -dirY;
    var perpY = dirX;

    // Longer (faster) drags shove harder, within limits.
    var speedFactor = segLen / CFG.REF_DRAG_LEN;
    if (speedFactor > CFG.MAX_SPEED_FACTOR) speedFactor = CFG.MAX_SPEED_FACTOR;
    else if (speedFactor < 0.2) speedFactor = 0.2;

    var maxV = CFG.MAX_SPEED;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var d2 = distToSegment2(p.x, p.y, x0, y0, x1, y1, segLen2);
      if (d2 > r2) continue;

      // Closer to the finger = shoved harder.
      var falloff = 1 - Math.sqrt(d2) / r;
      var impulse = CFG.PUSH_STRENGTH * falloff * speedFactor;

      // Along the drag...
      p.vx += dirX * impulse;
      p.vy += dirY * impulse;

      // ...plus a little sideways scatter so it fans out like real powder.
      var sideways = (Math.random() * 2 - 1) * impulse * CFG.SPREAD;
      p.vx += perpX * sideways;
      p.vy += perpY * sideways;

      // Plow: displace grains the fingertip is actually sitting on, hardest at
      // the centre, so the pile is carried along rather than left behind.
      if (CFG.PLOW > 0) {
        var fdx = p.x - x1;
        var fdy = p.y - y1;
        var fd = Math.sqrt(fdx * fdx + fdy * fdy);
        if (fd < r) {
          var carry = (r - fd) * CFG.PLOW;
          p.x += dirX * carry;
          p.y += dirY * carry;
        }
      }

      // Clamp so a frantic swipe can't fling grains off to infinity.
      if (p.vx > maxV) p.vx = maxV;
      else if (p.vx < -maxV) p.vx = -maxV;
      if (p.vy > maxV) p.vy = maxV;
      else if (p.vy < -maxV) p.vy = -maxV;
    }
  }

  // Integrate + damp. No targets, no attraction: grains coast to a stop and
  // stay exactly where they were left.
  function stepParticles() {
    var eps = CFG.SETTLE_EPSILON;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (p.vx === 0 && p.vy === 0) continue;

      if (p.vx > eps || p.vx < -eps || p.vy > eps || p.vy < -eps) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= CFG.FRICTION;
        p.vy *= CFG.FRICTION;
      } else {
        p.vx = 0;
        p.vy = 0;
      }

      // Screen edges absorb most of the energy.
      if (p.x < 0) { p.x = 0; p.vx *= -0.25; }
      else if (p.x > viewW) { p.x = viewW; p.vx *= -0.25; }
      if (p.y < 0) { p.y = 0; p.vy *= -0.25; }
      else if (p.y > viewH) { p.y = viewH; p.vy *= -0.25; }
    }
  }

  /* ======================================================================
   * Drawing
   * ==================================================================== */

  function drawBase() {
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.fillStyle = "#000";
    baseCtx.fillRect(0, 0, viewW, viewH);

    if (!CFG.SHOW_GUIDES) return;
    // Barely-there hints of where the lines could go.
    var w = viewW * CFG.GUIDE_WIDTH_FRACTION;
    var left = (viewW - w) / 2;
    baseCtx.save();
    baseCtx.globalAlpha = CFG.GUIDE_ALPHA;
    baseCtx.strokeStyle = "#fff";
    baseCtx.lineWidth = 1;
    for (var i = 0; i < CFG.GUIDE_Y_FRACTIONS.length; i++) {
      var y = Math.round(viewH * CFG.GUIDE_Y_FRACTIONS[i]) + 0.5;
      baseCtx.beginPath();
      baseCtx.moveTo(left, y);
      baseCtx.lineTo(left + w, y);
      baseCtx.stroke();
    }
    baseCtx.restore();
  }

  function renderParticles() {
    topCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    topCtx.globalCompositeOperation = "source-over";
    topCtx.clearRect(0, 0, viewW, viewH);
    topCtx.fillStyle = "#f7f7f5";

    var span = CFG.PARTICLE_MAX_ALPHA - CFG.PARTICLE_MIN_ALPHA;
    for (var b = 0; b < buckets.length; b++) {
      var list = buckets[b];
      if (!list.length) continue;
      topCtx.globalAlpha =
        CFG.PARTICLE_MIN_ALPHA + (span * (b + 0.5)) / CFG.ALPHA_BUCKETS;
      topCtx.beginPath();
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        topCtx.rect(p.x, p.y, p.size, p.size);
      }
      topCtx.fill();
    }
    topCtx.globalAlpha = 1;
  }

  function loop() {
    if (mode !== MODE_ARRANGE) return;
    stepParticles();
    renderParticles();
    rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId === null) rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /* ======================================================================
   * Wipe: soft, directional "fingertip smear" (destination-out)
   * ==================================================================== */

  function smearDot(x, y, dirX, dirY) {
    var r = viewH * CFG.WIPE_BRUSH_FRACTION;
    var len = Math.sqrt(dirX * dirX + dirY * dirY);
    var angle = len > 0.0001 ? Math.atan2(dirY, dirX) : 0;
    var stretch = 1 + CFG.WIPE_ELONGATION * Math.min(1, len / (r * 0.75));

    topCtx.save();
    topCtx.globalCompositeOperation = "destination-out";
    topCtx.translate(x, y);
    if (len > 0.0001) topCtx.rotate(angle);
    topCtx.scale(stretch, 1);

    var g = topCtx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(CFG.WIPE_FEATHER_INNER, "rgba(0,0,0,0.92)");
    g.addColorStop(0.78, "rgba(0,0,0,0.38)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    topCtx.fillStyle = g;

    topCtx.beginPath();
    topCtx.arc(0, 0, r, 0, Math.PI * 2);
    topCtx.fill();
    topCtx.restore();
  }

  function smearStroke(x0, y0, x1, y1) {
    var r = viewH * CFG.WIPE_BRUSH_FRACTION;
    var dx = x1 - x0;
    var dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var step = Math.max(1, r * CFG.WIPE_STEP_FRACTION);
    var n = Math.max(1, Math.ceil(dist / step));
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      smearDot(x0 + dx * t, y0 + dy * t, dx, dy);
    }
  }

  /* ======================================================================
   * Mode switching
   * ==================================================================== */

  function flash() {
    flashEl.classList.add("on");
    setTimeout(function () {
      flashEl.classList.remove("on");
    }, 90);
  }

  function toWipeMode() {
    // Freeze: one last render, then stop the loop. What's left on the top
    // canvas *is* the baked layout we now erase.
    stepParticles();
    renderParticles();
    stopLoop();
    mode = MODE_WIPE;
    flash();
  }

  function toArrangeMode() {
    mode = MODE_ARRANGE;
    makePile();
    renderParticles();
    startLoop();
  }

  /* ======================================================================
   * Sizing
   * ==================================================================== */

  function applySize(canvas, ctx) {
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    var oldW = viewW;
    var oldH = viewH;

    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = window.devicePixelRatio || 1;

    applySize(baseCanvas, baseCtx);
    applySize(topCanvas, topCtx);

    if (!particles.length) makePile();
    else rescaleParticles(oldW, oldH);

    drawBase();
    // Resizing clears the canvas, so MODE 2 re-bakes the frozen layout
    // (any wiping already done is lost — a fair trade for staying sharp).
    renderParticles();
  }

  /* ======================================================================
   * Full screen
   * ==================================================================== */

  function isFullscreen() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
  }

  function requestFs() {
    var el = document.documentElement;
    var req =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;
    if (!req) return;
    try {
      var r = req.call(el);
      if (r && typeof r.catch === "function") r.catch(function () {});
    } catch (e) {
      /* not fatal */
    }
  }

  function exitFs() {
    var ex =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;
    if (!ex) return;
    try {
      var r = ex.call(document);
      if (r && typeof r.catch === "function") r.catch(function () {});
    } catch (e) {
      /* not fatal */
    }
  }

  fsBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (isFullscreen()) exitFs();
    else requestFs();
  });

  /* ======================================================================
   * Gestures — shared long-press + drag plumbing for both modes
   * ==================================================================== */

  var holdTimer = null;
  var holdAction = null;
  var holdStartX = 0;
  var holdStartY = 0;
  var holdFired = false;

  var dragging = false;
  var lastX = 0;
  var lastY = 0;

  function inTopRight(x, y) {
    return x >= viewW - CFG.CORNER_BOX && y <= CFG.CORNER_BOX;
  }

  function inBottomRight(x, y) {
    return x >= viewW - CFG.CORNER_BOX && y >= viewH - CFG.CORNER_BOX;
  }

  function holdActionFor(x, y) {
    if (mode === MODE_ARRANGE && inBottomRight(x, y)) return "wipe-mode";
    if (inTopRight(x, y)) return "reset";
    return null;
  }

  function armHold(action, x, y) {
    holdAction = action;
    holdFired = false;
    holdStartX = x;
    holdStartY = y;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () {
      holdFired = true;
      holdAction = null;
      if (action === "wipe-mode") toWipeMode();
      else if (action === "reset") toArrangeMode();
    }, CFG.HOLD_MS);
  }

  function cancelHold() {
    holdAction = null;
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  function applyDrag(x, y) {
    if (mode === MODE_ARRANGE) {
      pushAlong(lastX, lastY, x, y);
    } else {
      smearStroke(lastX, lastY, x, y);
    }
    lastX = x;
    lastY = y;
  }

  function onDown(x, y) {
    requestFs();

    var action = holdActionFor(x, y);
    if (action) {
      // Ambiguous: long-press, or the start of a drag? Wait and see.
      armHold(action, x, y);
      dragging = true;
      lastX = x;
      lastY = y;
      return;
    }

    dragging = true;
    holdFired = false;
    lastX = x;
    lastY = y;
    if (mode === MODE_WIPE) smearDot(x, y, 0, 0);
  }

  function onMove(x, y) {
    if (!dragging) return;

    if (holdAction) {
      var dx = x - holdStartX;
      var dy = y - holdStartY;
      if (
        dx * dx + dy * dy >
        CFG.HOLD_MOVE_TOLERANCE * CFG.HOLD_MOVE_TOLERANCE
      ) {
        // Moved too far — it's a drag, not a long-press.
        cancelHold();
        lastX = holdStartX;
        lastY = holdStartY;
        applyDrag(x, y);
      }
      return;
    }

    if (holdFired) return;
    applyDrag(x, y);
  }

  function onUp() {
    cancelHold();
    dragging = false;
    holdFired = false;
  }

  // --- Touch ---
  topCanvas.addEventListener(
    "touchstart",
    function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      onDown(t.clientX, t.clientY);
    },
    { passive: false }
  );

  topCanvas.addEventListener(
    "touchmove",
    function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      onMove(t.clientX, t.clientY);
    },
    { passive: false }
  );

  topCanvas.addEventListener(
    "touchend",
    function (e) {
      e.preventDefault();
      requestFs();
      onUp();
    },
    { passive: false }
  );

  topCanvas.addEventListener(
    "touchcancel",
    function (e) {
      e.preventDefault();
      onUp();
    },
    { passive: false }
  );

  // --- Mouse (desktop testing) ---
  topCanvas.addEventListener("mousedown", function (e) {
    e.preventDefault();
    onDown(e.clientX, e.clientY);
  });

  window.addEventListener("mousemove", function (e) {
    onMove(e.clientX, e.clientY);
  });

  window.addEventListener("mouseup", function () {
    onUp();
  });

  window.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  /* ======================================================================
   * Boot
   * ==================================================================== */

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

  resize();
  startLoop();
})();
