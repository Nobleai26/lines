/* lines — two-phase gag.
 *
 * MODE 1 "ARRANGE": powder is scattered as particles; swiping herds it into
 *                   three neat lines (like a card).
 * MODE 2 "WIPE":    the arrangement is frozen/baked; swiping smears it away,
 *                   revealing black underneath.
 *
 * Long-press LOWER-RIGHT  -> lock + switch to WIPE.
 * Long-press TOP-RIGHT    -> reset back to ARRANGE (rescatter).
 */
(function () {
  "use strict";

  /* ======================================================================
   * TUNABLES — everything worth fiddling with lives here.
   * ==================================================================== */

  var CFG = {
    // --- Particles ---
    PARTICLE_COUNT: 2500,
    PARTICLE_MIN_SIZE: 1.0,       // px (CSS), smallest grain
    PARTICLE_MAX_SIZE: 2.6,       // px (CSS), largest grain
    PARTICLE_MIN_ALPHA: 0.35,
    PARTICLE_MAX_ALPHA: 1.0,
    ALPHA_BUCKETS: 6,             // grains batched by alpha for fast drawing

    // --- Target lines (MODE 1) ---
    LINE_Y_FRACTIONS: [0.3, 0.5, 0.7],  // of screen height
    LINE_WIDTH_FRACTION: 0.64,          // of screen width, centered
    LINE_THICKNESS_FRACTION: 0.016,     // of screen height (line "fatness")

    // --- Arrange feel ---
    ARRANGE_BRUSH_FRACTION: 0.08, // of screen height
    PUSH_STRENGTH: 3.4,           // how hard a swipe shoves grains along
    EASING: 0.12,                 // 0..1 pull toward target (powder settling)
    FRICTION: 0.82,               // velocity decay per frame
    COMPACT: 0.1,                 // per-swipe horizontal squeeze toward center
    SETTLE_EPSILON: 0.05,         // below this speed, stop integrating
    // Lines at 30/50/70% have unequal catchment areas, so "nearest line" alone
    // leaves the middle one thin. A grain overflows to the next-nearest line
    // once its first choice exceeds this multiple of an even share.
    // Raise toward 99 to get pure nearest-line behaviour.
    BALANCE_SLACK: 1.0,

    // --- Wipe feel (MODE 2) ---
    WIPE_BRUSH_FRACTION: 0.06,    // of screen height
    WIPE_FEATHER_INNER: 0.45,     // solid core of the brush (0..1 of radius)
    WIPE_ELONGATION: 0.85,        // extra stretch along the drag direction
    WIPE_STEP_FRACTION: 0.28,     // interpolation step, as a fraction of radius

    // --- Gestures ---
    HOLD_MS: 800,                 // long-press duration
    HOLD_MOVE_TOLERANCE: 12,      // px of movement that cancels a long-press
    CORNER_BOX: 90,               // px square hot corner
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
  var buckets = [];      // particles grouped by alpha bucket, for batched fills
  var rafId = null;

  /* ======================================================================
   * Geometry helpers
   * ==================================================================== */

  function lineGeometry() {
    var w = viewW * CFG.LINE_WIDTH_FRACTION;
    var left = (viewW - w) / 2;
    var lines = [];
    for (var i = 0; i < CFG.LINE_Y_FRACTIONS.length; i++) {
      lines.push({
        y: viewH * CFG.LINE_Y_FRACTIONS[i],
        left: left,
        right: left + w,
        center: viewW / 2,
      });
    }
    return lines;
  }

  var lines = [];

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  /* ======================================================================
   * Particles
   * ==================================================================== */

  function makeParticles() {
    particles = [];
    buckets = [];
    resetLineCounts();
    for (var b = 0; b < CFG.ALPHA_BUCKETS; b++) buckets.push([]);

    for (var i = 0; i < CFG.PARTICLE_COUNT; i++) {
      var alpha = rand(CFG.PARTICLE_MIN_ALPHA, CFG.PARTICLE_MAX_ALPHA);
      var p = {
        x: Math.random() * viewW,
        y: Math.random() * viewH,
        vx: 0,
        vy: 0,
        size: rand(CFG.PARTICLE_MIN_SIZE, CFG.PARTICLE_MAX_SIZE),
        alpha: alpha,
        // Stable per-grain offset so settled lines look grainy, not jittery.
        jitterY: Math.random() - 0.5,
        assigned: false,  // has a swipe claimed this grain for a line?
        lineIndex: -1,    // which line owns it (-1 = still loose)
        tx: 0,
        ty: 0,
      };
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

  // Scale existing grains into the new viewport (used on resize/rotate).
  function rescaleParticles(oldW, oldH) {
    if (!oldW || !oldH) return;
    var sx = viewW / oldW;
    var sy = viewH / oldH;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x *= sx;
      p.y *= sy;
      if (p.assigned) {
        p.tx *= sx;
        p.ty *= sy;
      }
    }
  }

  /* ======================================================================
   * Arrange: push grains along the swipe and pull them onto the nearest line
   * ==================================================================== */

  // How many grains are currently claimed by each line (keeps lines even).
  var lineCounts = [];

  function resetLineCounts() {
    lineCounts = [];
    for (var i = 0; i < CFG.LINE_Y_FRACTIONS.length; i++) lineCounts.push(0);
  }

  // Pick a line for a grain at y: nearest first, but overflow to the next
  // nearest if that line already has more than its fair share.
  function pickLine(y, currentIndex) {
    var capacity =
      (CFG.PARTICLE_COUNT / lines.length) * CFG.BALANCE_SLACK;

    // Lines sorted by distance from this grain.
    var order = [];
    for (var i = 0; i < lines.length; i++) {
      order.push({ i: i, d: Math.abs(y - lines[i].y) });
    }
    order.sort(function (a, b) {
      return a.d - b.d;
    });

    for (var k = 0; k < order.length; k++) {
      var idx = order[k].i;
      // Staying put is always allowed — don't shuffle already-placed grains.
      if (idx === currentIndex) return idx;
      if (lineCounts[idx] < capacity) return idx;
    }
    return order[0].i;  // everything is full: fall back to nearest
  }

  function arrangeAt(x, y, dirX, dirY) {
    var r = viewH * CFG.ARRANGE_BRUSH_FRACTION;
    var r2 = r * r;
    var thickness = viewH * CFG.LINE_THICKNESS_FRACTION;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var dx = p.x - x;
      var dy = p.y - y;
      var d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;

      // Falloff: grains at the centre of the brush get shoved hardest.
      var falloff = 1 - Math.sqrt(d2) / r;

      // 1) Push along the direction of motion.
      p.vx += dirX * CFG.PUSH_STRENGTH * falloff;
      p.vy += dirY * CFG.PUSH_STRENGTH * falloff;

      // 2) Claim it for a line and compute where it should land.
      var idx = pickLine(p.y, p.lineIndex);
      if (idx !== p.lineIndex) {
        if (p.lineIndex >= 0) lineCounts[p.lineIndex]--;
        lineCounts[idx]++;
        p.lineIndex = idx;
      }
      var ln = lines[idx];
      p.assigned = true;
      p.ty = ln.y + p.jitterY * thickness;

      // Horizontal: clamp inside the line's bounds, then squeeze toward the
      // centre a little so repeated swipes make the line denser.
      var tx = p.x;
      if (tx < ln.left) tx = ln.left;
      else if (tx > ln.right) tx = ln.right;
      tx += (ln.center - tx) * CFG.COMPACT * falloff;
      p.tx = tx;
    }
  }

  function stepParticles() {
    var eps = CFG.SETTLE_EPSILON;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];

      // Integrate the shove.
      if (p.vx > eps || p.vx < -eps || p.vy > eps || p.vy < -eps) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= CFG.FRICTION;
        p.vy *= CFG.FRICTION;
      } else {
        p.vx = 0;
        p.vy = 0;
      }

      // Ease toward the assigned target so powder "settles" instead of snapping.
      if (p.assigned) {
        p.x += (p.tx - p.x) * CFG.EASING;
        p.y += (p.ty - p.y) * CFG.EASING;
      }

      // Keep grains on screen.
      if (p.x < 0) { p.x = 0; p.vx *= -0.3; }
      else if (p.x > viewW) { p.x = viewW; p.vx *= -0.3; }
      if (p.y < 0) { p.y = 0; p.vy *= -0.3; }
      else if (p.y > viewH) { p.y = viewH; p.vy *= -0.3; }
    }
  }

  /* ======================================================================
   * Drawing
   * ==================================================================== */

  function drawBase() {
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.fillStyle = "#000";
    baseCtx.fillRect(0, 0, viewW, viewH);
  }

  // Render every grain onto the top canvas, batched by alpha bucket.
  function renderParticles() {
    topCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    topCtx.globalCompositeOperation = "source-over";
    topCtx.clearRect(0, 0, viewW, viewH);
    topCtx.fillStyle = "#f7f7f5";

    var span = CFG.PARTICLE_MAX_ALPHA - CFG.PARTICLE_MIN_ALPHA;
    for (var b = 0; b < buckets.length; b++) {
      var list = buckets[b];
      if (!list.length) continue;
      // Representative alpha for the bucket (mid-point).
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
    if (mode !== MODE_ARRANGE) return;   // MODE 2 leaves the bitmap frozen
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
    // Stretch along the drag, scaled by how fast the finger is moving.
    var stretch =
      1 + CFG.WIPE_ELONGATION * Math.min(1, len / (r * 0.75));

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

  // Interpolate along the path so fast swipes still erase a continuous smear.
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
    // Let the "on" transition paint, then fade back out.
    setTimeout(function () {
      flashEl.classList.remove("on");
    }, 90);
  }

  function toWipeMode() {
    // Freeze: render one last time, stop the loop. The bitmap left on the top
    // canvas *is* the baked arrangement we now erase.
    stepParticles();
    renderParticles();
    stopLoop();
    mode = MODE_WIPE;
    flash();
  }

  function toArrangeMode() {
    mode = MODE_ARRANGE;
    makeParticles();
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
    lines = lineGeometry();

    if (!particles.length) {
      makeParticles();
    } else {
      rescaleParticles(oldW, oldH);
    }

    drawBase();
    // Resizing clears the canvas, so MODE 2 re-bakes the frozen arrangement
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

  function toggleFullscreen() {
    if (isFullscreen()) exitFs();
    else requestFs();
  }

  fsBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleFullscreen();
  });

  /* ======================================================================
   * Gestures — shared long-press + drag plumbing for both modes
   * ==================================================================== */

  var holdTimer = null;
  var holdAction = null;   // "wipe-mode" | "reset" | null
  var holdStartX = 0;
  var holdStartY = 0;
  var holdFired = false;   // long-press completed; ignore movement until lift

  var dragging = false;
  var lastX = 0;
  var lastY = 0;

  function inTopRight(x, y) {
    return x >= viewW - CFG.CORNER_BOX && y <= CFG.CORNER_BOX;
  }

  function inBottomRight(x, y) {
    return x >= viewW - CFG.CORNER_BOX && y >= viewH - CFG.CORNER_BOX;
  }

  // Which long-press (if any) does this starting point arm?
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

  // Apply a drag segment to whichever mode is active.
  function applyDrag(x, y) {
    var dx = x - lastX;
    var dy = y - lastY;
    if (mode === MODE_ARRANGE) {
      arrangeAt(x, y, dx, dy);
    } else {
      smearStroke(lastX, lastY, x, y);
    }
    lastX = x;
    lastY = y;
  }

  function onDown(x, y) {
    requestFs();  // first gesture is our only chance at auto-fullscreen

    var action = holdActionFor(x, y);
    if (action) {
      // Ambiguous: could be a long-press or the start of a swipe. Wait.
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
        // Moved too far — it's a swipe, not a long-press.
        cancelHold();
        lastX = holdStartX;
        lastY = holdStartY;
        applyDrag(x, y);
      }
      return;
    }

    if (holdFired) return;  // finger still down after a mode change
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
