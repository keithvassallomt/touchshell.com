// Touchshell website — interactive GNOME mock + feature grid.
// Vanilla JS, pointer events, no framework.

const shell = document.getElementById('shell');
const workspacesEl = document.getElementById('workspaces');
const popoverQs = document.getElementById('popoverQs');
const popoverCal = document.getElementById('popoverCal');
const hint = document.getElementById('hint');
const hintIcon = document.getElementById('hintIcon');
const hintLabel = document.getElementById('hintLabel');
const panelClock = document.getElementById('panelClock');
const wsPips = Array.from(document.querySelectorAll('.ws-pip'));

let WORKSPACE_COUNT = 2;
let currentWs = 0;

const EDGE_BOTTOM = 0.94;      // start zone: y > h * EDGE_BOTTOM
const EDGE_TOP = 0.06;          // start zone: y < h * EDGE_TOP
const RIGHT_BAND = 0.66;        // top-right: x > w * RIGHT_BAND
const CENTER_LEFT = 0.35;
const CENTER_RIGHT = 0.65;

const MOVE_THRESHOLD = 8;       // px before classifying

const state = {
  mode: 'idle',                 // 'idle' | 'overview' | 'qs' | 'cal'
  gesture: null,                // { type, startX, startY, dx, dy, w, h, pointerId, committed }
};

// ---------- gesture classification ----------
function classifyZone(x, y, w, h) {
  if (y < h * EDGE_TOP) {
    if (x > w * RIGHT_BAND) return 'TOP_RIGHT';
    if (x > w * CENTER_LEFT && x < w * CENTER_RIGHT) return 'TOP_CENTER';
    return 'TOP_OTHER';
  }
  if (y > h * EDGE_BOTTOM) return 'BOTTOM_EDGE';
  return 'BODY';
}

function classifyGesture(zone, dx, dy, ctx) {
  const absX = Math.abs(dx), absY = Math.abs(dy);
  // dismissible targets are classified first so popover-anchored gestures still work
  if (ctx?.dismissKind === 'banner' && absY > absX && dy < -MOVE_THRESHOLD) return 'BANNER_DISMISS';
  if (ctx?.dismissKind === 'notif'  && absX > absY && dx < -MOVE_THRESHOLD) return 'NOTIF_DISMISS';
  // app-grid: only swipe-down back to overview is meaningful
  if (state.mode === 'app-grid') {
    if (absY > absX && dy > MOVE_THRESHOLD) return 'APP_GRID_BACK';
    return null;
  }
  // overview: flick-up on a closable window
  if (state.mode === 'overview' && ctx?.closable && absY > absX && dy < -MOVE_THRESHOLD) {
    return 'FLICK_CLOSE';
  }
  if (zone === 'BOTTOM_EDGE' && dy < -MOVE_THRESHOLD) return 'OVERVIEW_FROM_BOTTOM';
  if (zone === 'TOP_RIGHT' && dy > MOVE_THRESHOLD) return 'QS';
  if (zone === 'TOP_CENTER' && dy > MOVE_THRESHOLD) return 'CAL';
  if (zone === 'BODY') {
    if (absY > absX && dy < -MOVE_THRESHOLD) return 'OVERVIEW_FROM_DESKTOP';
    if (absX > absY && absX > MOVE_THRESHOLD) return 'WORKSPACE_SWITCH';
  }
  return null;
}

// ---------- state transitions ----------
let modeChangedThisGesture = false;
function setMode(mode) {
  const oldMode = state.mode;
  state.mode = mode;
  // overview-related visual: both 'overview' and 'app-grid' use the scaled-down workspace
  if (mode === 'overview' || mode === 'app-grid') {
    shell.dataset.overview = 'full';
  } else {
    delete shell.dataset.overview;
    shell.style.removeProperty('--overview-progress');
  }
  shell.dataset.mode = mode;
  popoverQs.classList.toggle('open', mode === 'qs');
  popoverCal.classList.toggle('open', mode === 'cal');
  updateBannerVisibility();
  if (oldMode !== mode) {
    modeChangedThisGesture = true;
    if (typeof restartCycle === 'function') restartCycle();
  }
}

// Banner is temporarily hidden whenever an overlay is active (qs/cal/overview/app-grid)
// or the user is on the fullscreen TextEdit workspace. Dismissed banner stays gone.
function updateBannerVisibility() {
  const banner = document.getElementById('banner');
  if (!banner || banner.classList.contains('dismissed')) return;
  const onFullscreenWs = currentWs === 2;
  const inOverlay = state.mode !== 'idle';
  banner.classList.toggle('hidden', onFullscreenWs || inOverlay);
}

function setWorkspace(idx, animate = true) {
  currentWs = Math.max(0, Math.min(WORKSPACE_COUNT - 1, idx));
  shell.dataset.currentWs = String(currentWs);
  if (!animate) workspacesEl.style.transition = 'none';
  workspacesEl.style.transform = `translateX(${-100 * currentWs}%)`;
  if (!animate) requestAnimationFrame(() => workspacesEl.style.removeProperty('transition'));
  updateWorkspacePips();
  if (typeof updateBannerVisibility === 'function') updateBannerVisibility();
  if (typeof restartCycle === 'function') restartCycle();
}

function updateWorkspacePips() {
  const pips = document.querySelectorAll('.ws-pip');
  pips.forEach((pip, i) => pip.classList.toggle('active', i === currentWs));
  const thumbs = document.querySelectorAll('#overviewWorkspaces .thumb');
  thumbs.forEach((th, i) => th.classList.toggle('active', i === currentWs));
}
shell.dataset.currentWs = '0';
updateWorkspacePips();

// ---------- live clock ----------
let lastRenderedDay = null;
function tickClock() {
  if (!panelClock) return;
  const now = new Date();
  const day = now.getDate();
  const month = now.toLocaleDateString([], { month: 'short' });
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  panelClock.textContent = `${day} ${month} ${hh}:${mm}`;
  // re-render the calendar if the day rolled over
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${day}`;
  if (dayKey !== lastRenderedDay) {
    lastRenderedDay = dayKey;
    renderCalendar();
  }
}
// ---------- calendar (rendered into the notifications popover) ----------
const calHeader = document.getElementById('calHeader');
const calGrid = document.getElementById('calGrid');

function renderCalendar() {
  if (!calHeader || !calGrid) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();

  calHeader.textContent = now.toLocaleDateString([], { month: 'long', year: 'numeric' });

  const firstWeekday = new Date(year, month, 1).getDay();        // 0=Sun..6=Sat
  let leading = firstWeekday - 1;                                 // shift to Monday-start
  if (leading < 0) leading = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells = [];
  cells.push(...['M','T','W','T','F','S','S'].map((d) => ({ text: d, cls: 'cal-dow' })));
  for (let i = leading - 1; i >= 0; i--) cells.push({ text: daysInPrev - i, cls: 'cal-day other-month' });
  for (let d = 1; d <= daysInMonth; d++) {
    const cls = 'cal-day' + (d === today ? ' today' : '');
    cells.push({ text: d, cls });
  }
  const filled = leading + daysInMonth;
  const trailing = (7 - (filled % 7)) % 7;
  for (let i = 1; i <= trailing; i++) cells.push({ text: i, cls: 'cal-day other-month' });

  calGrid.innerHTML = cells
    .map((c) => `<span class="${c.cls}">${c.text}</span>`)
    .join('');
}
renderCalendar();

tickClock();
// align next update to the next minute boundary, then tick every minute
const msToNextMinute = 60_000 - (Date.now() % 60_000);
setTimeout(() => {
  tickClock();
  setInterval(tickClock, 60_000);
}, msToNextMinute);

// ---------- partial-gesture rendering ----------
function applyOverviewProgress(p) {
  shell.dataset.overview = 'partial';
  shell.style.setProperty('--overview-progress', p.toFixed(3));
  // also fade in dash/workspaces overlay proportionally — handled by CSS [data-overview]
}

function applyWorkspaceDrag(dx, w) {
  workspacesEl.style.transition = 'none';
  workspacesEl.style.transform = `translateX(calc(${-100 * currentWs}% + ${dx}px))`;
}

function clearWorkspaceDrag(snap = false) {
  workspacesEl.style.removeProperty('transition');
  workspacesEl.style.transform = `translateX(${-100 * currentWs}%)`;
}

// ---------- pointer handlers ----------
function onPointerDown(e) {
  // ignore secondary pointers
  if (state.gesture) return;

  // Editable content (the FAB-demo textedit) needs the browser's native
  // text-selection drag — bail before we steal the pointer.
  if (e.target.closest('[contenteditable="true"]')) return;

  // FAB UI handles its own pointer events; keep the gesture system out.
  if (e.target.closest('#tsFab, #tsFabBar, #tsOsk')) return;

  // dismissible elements (banner, shade-entry, closable window) bypass the popover-skip rule
  const closable    = e.target.closest('[data-closable]');
  const dismissEl   = e.target.closest('[data-dismiss]');
  const dismissKind = dismissEl?.dataset.dismiss || null;  // 'banner' | 'notif' | null

  // taps inside popovers / dash should NOT start a gesture — unless on a dismissible element
  if (!closable && !dismissEl) {
    if (e.target.closest('.popover') || e.target.closest('.dash') || e.target.closest('.overview-workspaces')) return;
  }

  const rect = shell.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const zone = classifyZone(x, y, rect.width, rect.height);

  state.gesture = {
    type: null,
    zone,
    startX: x,
    startY: y,
    dx: 0,
    dy: 0,
    w: rect.width,
    h: rect.height,
    pointerId: e.pointerId,
    committed: false,
    closable,
    dismissEl,
    dismissKind,
    samples: [{ t: e.timeStamp || performance.now(), x: e.clientX - rect.left, y: e.clientY - rect.top }],
  };
  modeChangedThisGesture = false;
  shell.setPointerCapture(e.pointerId);
  stopCycle();
}

function onPointerMove(e) {
  const g = state.gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  const rect = shell.getBoundingClientRect();
  g.dx = (e.clientX - rect.left) - g.startX;
  g.dy = (e.clientY - rect.top) - g.startY;
  // record up to last 6 samples for velocity computation on release
  g.samples.push({ t: e.timeStamp || performance.now(), x: e.clientX - rect.left, y: e.clientY - rect.top });
  if (g.samples.length > 6) g.samples.shift();

  if (!g.type) {
    g.type = classifyGesture(g.zone, g.dx, g.dy, g);
    if (g.type) shell.classList.add('dragging');
  }
  if (!g.type) return;

  switch (g.type) {
    case 'OVERVIEW_FROM_BOTTOM':
    case 'OVERVIEW_FROM_DESKTOP': {
      // only apply the partial-progress visual if we are entering overview from idle
      if (state.mode !== 'overview' && state.mode !== 'app-grid') {
        const progress = Math.max(0, Math.min(1, -g.dy / (g.h * 0.5)));
        applyOverviewProgress(progress);
      }
      break;
    }
    case 'QS':
    case 'CAL': {
      break;
    }
    case 'WORKSPACE_SWITCH': {
      shell.classList.add('dragging-h');
      let dx = g.dx;
      if (currentWs === 0 && dx > 0) dx = dx * 0.3;
      if (currentWs === WORKSPACE_COUNT - 1 && dx < 0) dx = dx * 0.3;
      applyWorkspaceDrag(dx, g.w);
      break;
    }
    case 'FLICK_CLOSE': {
      // 1:1 vertical tracking of the closable window
      g.closable.classList.add('dragging');
      g.closable.style.transform = `translateY(${Math.min(0, g.dy)}px)`;
      g.closable.style.opacity = String(Math.max(0.3, 1 + g.dy / 200));
      break;
    }
    case 'BANNER_DISMISS': {
      g.dismissEl.classList.add('dragging');
      const dy = Math.min(0, g.dy);
      g.dismissEl.style.transform = `translateX(-50%) translateY(${dy}px)`;
      g.dismissEl.style.opacity = String(Math.max(0.3, 1 + dy / 100));
      break;
    }
    case 'NOTIF_DISMISS': {
      g.dismissEl.classList.add('dragging');
      const dx = Math.min(0, g.dx);
      g.dismissEl.style.transform = `translateX(${dx}px)`;
      g.dismissEl.style.opacity = String(Math.max(0.2, 1 + dx / 200));
      break;
    }
    case 'APP_GRID_BACK': {
      break;
    }
  }
}

// Dismiss both representations of the "Dismiss me" notification.
function dismissNotification() {
  const banner = document.getElementById('banner');
  const entry  = document.getElementById('bannerShadeEntry');
  if (banner) { banner.classList.remove('dragging'); banner.classList.add('dismissed'); }
  if (entry)  { entry.classList.remove('dragging');  entry.classList.add('dismissed'); }
  // hide entirely after the slide-out animation to keep their bounding rects out of layout
  setTimeout(() => {
    if (banner) banner.style.display = 'none';
    if (entry)  entry.style.display = 'none';
  }, 350);
}

function onPointerUp(e) {
  const g = state.gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  shell.classList.remove('dragging', 'dragging-h');

  if (g.type) {
    switch (g.type) {
      case 'OVERVIEW_FROM_BOTTOM':
      case 'OVERVIEW_FROM_DESKTOP': {
        // entering overview from idle: progress threshold
        // already in overview: this swipe-up commits to app-grid
        if (state.mode === 'overview') {
          if (g.dy < -60) setMode('app-grid');
          else setMode('overview'); // no-op (stay)
        } else {
          const progress = Math.max(0, Math.min(1, -g.dy / (g.h * 0.5)));
          if (progress > 0.4) setMode('overview');
          else setMode('idle');
        }
        break;
      }
      case 'QS': {
        if (g.dy > 30) setMode('qs');
        else setMode('idle');
        break;
      }
      case 'CAL': {
        if (g.dy > 30) setMode('cal');
        else setMode('idle');
        break;
      }
      case 'WORKSPACE_SWITCH': {
        const threshold = g.w * 0.25;
        if (g.dx < -threshold && currentWs < WORKSPACE_COUNT - 1) setWorkspace(currentWs + 1);
        else if (g.dx > threshold && currentWs > 0) setWorkspace(currentWs - 1);
        else setWorkspace(currentWs);
        break;
      }
      case 'FLICK_CLOSE': {
        // compute velocity over the recent samples (px/ms, negative = up)
        const samples = g.samples;
        const last = samples[samples.length - 1];
        let first = samples[0];
        for (let i = samples.length - 1; i >= 0; i--) {
          if (last.t - samples[i].t > 80) { first = samples[i]; break; }
        }
        const dt = Math.max(1, last.t - first.t);
        const vy = (last.y - first.y) / dt; // px/ms
        const commit = (vy < -0.4) || (g.dy < -60);
        if (commit) {
          g.closable.classList.remove('dragging');
          g.closable.classList.add('closing');
          // hide after the CSS transition completes
          setTimeout(() => { g.closable.style.display = 'none'; }, 350);
        } else {
          // spring back
          g.closable.classList.remove('dragging');
          g.closable.style.transform = '';
          g.closable.style.opacity = '';
        }
        break;
      }
      case 'APP_GRID_BACK': {
        if (g.dy > 60) setMode('overview');
        break;
      }
      case 'BANNER_DISMISS': {
        // velocity-aware commit on upward fling
        const samples = g.samples;
        const last = samples[samples.length - 1];
        let first = samples[0];
        for (let i = samples.length - 1; i >= 0; i--) {
          if (last.t - samples[i].t > 80) { first = samples[i]; break; }
        }
        const dt = Math.max(1, last.t - first.t);
        const vy = (last.y - first.y) / dt;
        const commit = (vy < -0.35) || (g.dy < -30);
        if (commit) {
          dismissNotification();
        } else {
          g.dismissEl.classList.remove('dragging');
          g.dismissEl.style.transform = '';
          g.dismissEl.style.opacity = '';
        }
        break;
      }
      case 'NOTIF_DISMISS': {
        const samples = g.samples;
        const last = samples[samples.length - 1];
        let first = samples[0];
        for (let i = samples.length - 1; i >= 0; i--) {
          if (last.t - samples[i].t > 80) { first = samples[i]; break; }
        }
        const dt = Math.max(1, last.t - first.t);
        const vx = (last.x - first.x) / dt;
        const widthThresh = g.dismissEl.getBoundingClientRect().width * 0.35;
        const commit = (vx < -0.35) || (g.dx < -widthThresh);
        if (commit) {
          dismissNotification();
        } else {
          g.dismissEl.classList.remove('dragging');
          g.dismissEl.style.transform = '';
          g.dismissEl.style.opacity = '';
        }
        break;
      }
    }
  } else {
    // no gesture classified — treat as a tap. dismiss overlays / step back.
    if (state.mode === 'qs' || state.mode === 'cal') setMode('idle');
    else if (state.mode === 'overview') setMode('idle');
    else if (state.mode === 'app-grid') setMode('overview');
  }

  state.gesture = null;
  if (!modeChangedThisGesture) {
    pauseCycle(5000);
  }
}

shell.addEventListener('pointerdown', onPointerDown);
shell.addEventListener('pointermove', onPointerMove);
shell.addEventListener('pointerup', onPointerUp);
shell.addEventListener('pointercancel', onPointerUp);

// ---------- Flick to tile (titlebar drag) ----------
// Touch-drag a desktop window by its titlebar; a fast flick at release snaps
// it — left/right tile to that half, up maximizes, down minimizes — while a
// slow drag springs back. Mirrors the extension's WindowTilingFlickGesture
// (velocity on the dominant axis, distance fallback). Only active on the
// desktop (idle, workspace 0); in any other mode the pointerdown is left to
// bubble to the shell gesture system above. After a snap the window
// auto-restores so the looping demo can repeat.
const TILE_FLICK_V = 0.8;       // px/ms on the dominant axis to count as a flick
const TILE_FLICK_WINDOW = 120;  // ms window the release velocity is measured over
const TILE_FLICK_MIN_DIST = 24; // px of travel required before a flick can register
const TILE_PANEL_H = 28;        // matches .panel height / .window-maximized top
const TILE_TRANSITION =
  'transform .3s cubic-bezier(.2,.7,.2,1), left .3s cubic-bezier(.2,.7,.2,1),' +
  ' top .3s cubic-bezier(.2,.7,.2,1), width .3s cubic-bezier(.2,.7,.2,1),' +
  ' height .3s cubic-bezier(.2,.7,.2,1), opacity .3s ease';
let tileDrag = null;
let tileRestoreTimer = null;

function tileTargets() {
  return Array.from(document.querySelectorAll('.workspace[data-ws="0"] .window:not([data-closable])'));
}

// Revert to the window's original (CSS-var %) geometry, optionally animated.
function restoreTiledWindow(el) {
  el.style.transition = TILE_TRANSITION;
  el.style.transform = '';
  el.style.opacity = '';
  el.style.removeProperty('left');
  el.style.removeProperty('top');
  el.style.removeProperty('width');
  el.style.removeProperty('height');
}

function snapWindow(el, kind) {
  const r = shell.getBoundingClientRect();
  const w = r.width, h = r.height;
  el.style.transition = TILE_TRANSITION;
  el.style.transform = '';
  el.style.zIndex = '4';
  if (kind === 'minimize') {
    el.style.transform = `translateY(${h}px) scale(.6)`;
    el.style.opacity = '0';
  } else {
    let left = 0, width = w;
    if (kind === 'left')  { width = Math.round(w / 2); }
    if (kind === 'right') { left = Math.round(w / 2); width = w - left; }
    // 'maximize' keeps the full-width defaults
    el.style.left = `${left}px`;
    el.style.top = `${TILE_PANEL_H}px`;
    el.style.width = `${width}px`;
    el.style.height = `${h - TILE_PANEL_H}px`;
  }
  if (tileRestoreTimer) clearTimeout(tileRestoreTimer);
  tileRestoreTimer = setTimeout(() => { restoreTiledWindow(el); }, 2600);
}

function onTileDown(e) {
  // Only the desktop view drives flick-to-tile; otherwise let it bubble.
  if (state.mode !== 'idle' || currentWs !== 0 || tileDrag) return;
  const el = e.currentTarget.closest('.window');
  if (!el) return;
  e.stopPropagation();
  e.preventDefault();
  if (tileRestoreTimer) { clearTimeout(tileRestoreTimer); tileRestoreTimer = null; }
  e.currentTarget.setPointerCapture(e.pointerId);
  tileDrag = {
    el,
    header: e.currentTarget,
    pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    dx: 0, dy: 0,
    samples: [{ t: e.timeStamp || performance.now(), x: e.clientX, y: e.clientY }],
  };
  // Grabbing a tiled/snapped window restores it to its original floating size
  // first (mirrors GNOME), so the drag starts clean and a non-flick release
  // doesn't leave it stuck tiled. Done without a transition so the subsequent
  // translate tracks from the restored box.
  el.style.transition = 'none';
  el.style.transform = '';
  el.style.opacity = '';
  el.style.removeProperty('left');
  el.style.removeProperty('top');
  el.style.removeProperty('width');
  el.style.removeProperty('height');
  void el.offsetWidth; // reflow so the restore lands before tracking begins
  el.style.zIndex = '4';
  stopCycle();
}

function onTileMove(e) {
  const g = tileDrag;
  if (!g || e.pointerId !== g.pointerId) return;
  g.dx = e.clientX - g.startX;
  g.dy = e.clientY - g.startY;
  g.samples.push({ t: e.timeStamp || performance.now(), x: e.clientX, y: e.clientY });
  if (g.samples.length > 12) g.samples.shift();
  g.el.style.transform = `translate(${g.dx}px, ${g.dy}px)`;
}

function onTileUp(e) {
  const g = tileDrag;
  if (!g || e.pointerId !== g.pointerId) return;
  tileDrag = null;
  try { g.header.releasePointerCapture(g.pointerId); } catch {}

  // Record the release point so a move-then-pause-then-lift reads as a slow
  // drag (velocity ~0 over the final window) rather than a stale fast flick.
  const tUp = e.timeStamp || performance.now();
  g.samples.push({ t: tUp, x: e.clientX, y: e.clientY });

  // Release velocity over the final TILE_FLICK_WINDOW ms (px/ms): first is the
  // oldest sample still inside that window.
  const s = g.samples;
  const last = s[s.length - 1];
  let first = last;
  for (let i = s.length - 2; i >= 0; i--) {
    if (last.t - s[i].t <= TILE_FLICK_WINDOW) first = s[i];
    else break;
  }
  const dt = Math.max(1, last.t - first.t);
  const vx = (last.x - first.x) / dt;
  const vy = (last.y - first.y) / dt;
  const absVX = Math.abs(vx), absVY = Math.abs(vy);

  // Flick = fast on release AND some real travel. A slow drag-and-drop — at any
  // distance — leaves the window where it lands (matches the extension; there
  // is deliberately no distance-only trigger).
  const moved = Math.hypot(g.dx, g.dy) >= TILE_FLICK_MIN_DIST;
  let kind = null;
  if (moved && (absVX >= TILE_FLICK_V || absVY >= TILE_FLICK_V)) {
    kind = absVX >= absVY ? (vx < 0 ? 'left' : 'right') : (vy < 0 ? 'maximize' : 'minimize');
  }

  if (kind) {
    snapWindow(g.el, kind);
    pauseCycle(6000);
  } else {
    // Slow drag — spring back to where it started.
    g.el.style.transition = 'transform .25s cubic-bezier(.2,.7,.2,1)';
    g.el.style.transform = '';
    pauseCycle(5000);
  }
}

tileTargets().forEach((win) => {
  const header = win.querySelector('.window-header');
  if (!header) return;
  header.style.touchAction = 'none';
  header.style.userSelect = 'none';
  header.style.cursor = 'grab';
  header.addEventListener('pointerdown', onTileDown);
  header.addEventListener('pointermove', onTileMove);
  header.addEventListener('pointerup', onTileUp);
  header.addEventListener('pointercancel', onTileUp);
});

// ---------- hint overlay (state-aware) ----------
// HINT_SETS is keyed by state.mode. When mode changes, the active set switches
// and the cycle restarts from index 0. `at` is either {x,y} fractions of the shell
// OR a string token resolved at runtime (e.g. 'first-notif').
const HINT_SETS = {
  idle: [
    { icon: 'assets/swipe_down.svg',  label: 'Quick Settings',   at: { x: 0.85, y: 0.10 } },
    { icon: 'assets/swipe_down.svg',  label: 'Notifications',    at: { x: 0.50, y: 0.10 } },
    // Bottom-edge overview: caption above the icon so the icon sits at the very bottom
    { icon: 'assets/swipe_up.svg',    label: 'Overview',         at: { x: 0.50, y: 0.96 }, flip: true },
    // Switch workspace anchors in the bottom-LEFT empty area (left of Terminal, below Files).
    // Icon swipes LEFT — the next workspace is on the right, so the finger swipes leftward to advance.
    { icon: 'assets/swipe_left.svg', label: 'Switch workspace', at: { x: 0.20, y: 0.88 } },
    // Desktop swipe-up anchors in the bottom-right (right of Files, below Terminal)
    { icon: 'assets/swipe_up.svg',    label: 'Overview',         at: { x: 0.78, y: 0.90 }, flip: true },
    // Flick a window by its titlebar to tile/maximize/minimize. One hint only —
    // four directional hints would be overkill — anchored on a window's titlebar.
    { icon: 'assets/swipe_right.svg', label: 'Flick to tile',    at: 'tile-window-header' },
  ],
  overview: [
    { icon: 'assets/swipe_right.svg', label: 'Switch workspace', at: { x: 0.50, y: 0.55 } },
    { icon: 'assets/swipe_up.svg',    label: 'App grid',         at: { x: 0.50, y: 0.55 } },
    { icon: 'assets/swipe_up.svg',    label: 'Flick to close',   at: 'closable-window' },
  ],
  'app-grid': [
    { icon: 'assets/swipe_down.svg',  label: 'Back to Overview', at: { x: 0.50, y: 0.50 } },
  ],
  cal: [
    { icon: 'assets/swipe_left.svg',  label: 'Dismiss', at: 'first-notif', emphasis: true },
  ],
  qs: [],
};

function resolveAnchor(anchorSpec, rect) {
  if (typeof anchorSpec !== 'string') return anchorSpec;
  if (anchorSpec === 'first-notif') {
    const el = document.querySelector('.popover-cal .notif.dismissible');
    if (!el) return null;
    if (el.style.display === 'none' || el.classList.contains('closing') || el.classList.contains('dismissed')) return null;
    const nr = el.getBoundingClientRect();
    if (nr.width === 0 || nr.height === 0) return null;
    // center-right of the notif, shifted slightly down so the icon sits visibly on the body
    return {
      x: (nr.left + nr.width * 0.72 - rect.left) / rect.width,
      y: ((nr.top + nr.bottom) / 2 + 14 - rect.top) / rect.height,
    };
  }
  if (anchorSpec === 'tile-window-header') {
    // Point at the first desktop window's titlebar — the flick-to-tile target.
    const el = document.querySelector('.workspace[data-ws="0"] .window:not([data-closable]) .window-header');
    if (!el) return null;
    const nr = el.getBoundingClientRect();
    if (nr.width === 0 || nr.height === 0) return null;
    return {
      x: ((nr.left + nr.right) / 2 - rect.left) / rect.width,
      y: ((nr.top  + nr.bottom) / 2 - rect.top)  / rect.height,
    };
  }
  if (anchorSpec === 'closable-window') {
    const el = document.querySelector('[data-closable]');
    if (!el) return null;
    if (el.style.display === 'none' || el.classList.contains('closing')) return null;
    const nr = el.getBoundingClientRect();
    if (nr.width === 0 || nr.height === 0) return null;
    return {
      x: ((nr.left + nr.right) / 2 - rect.left) / rect.width,
      y: ((nr.top  + nr.bottom) / 2 - rect.top)  / rect.height,
    };
  }
  return null;
}

// Hint cycle uses a single timer handle so external triggers can clear it cleanly.
// (The previous nested-setTimeout chain wasn't tracked and started parallel chains
// every time scheduleIdleDemo() was called, causing the visible acceleration over time.)
let cycleTimer = null;
let cycleIndex = 0;
const HINT_SHOW_MS = 2500;
const HINT_GAP_MS = 800;
const INITIAL_DELAY_MS = 1000;

function clearCycleTimer() {
  if (cycleTimer) { clearTimeout(cycleTimer); cycleTimer = null; }
}

function showHint(item) {
  hintIcon.src = item.icon;
  hintLabel.textContent = item.label;
  hint.classList.toggle('flip', !!item.flip);
  hint.classList.toggle('emphasis', !!item.emphasis);
  // derive pulse direction from the icon filename so all hints animate
  const dir = item.icon.match(/swipe_(up|down|left|right)/)?.[1] || 'up';
  hint.dataset.direction = dir;

  // anchor in pixels, clamped so the wrapper never overflows the shell
  const rect = shell.getBoundingClientRect();
  const halfW = 70;   // half the hint wrapper's width (140px)
  const halfH = 48;   // approx half its visual height (icon + label)
  const ax = item.at.x * rect.width;
  const ay = item.at.y * rect.height;
  const cx = Math.max(halfW, Math.min(rect.width  - halfW, ax));
  const cy = Math.max(halfH, Math.min(rect.height - halfH, ay));
  hint.style.left = `${cx}px`;
  hint.style.top  = `${cy}px`;
  hint.classList.add('show');
}
function hideHint() { hint.classList.remove('show'); }

function cycleShow() {
  cycleTimer = null;
  if (state.gesture) return;
  // Suppress hints while the maximised TextEdit workspace is in view — the FAB /
  // fullscreen-apps / panel-auto-hide demos need an uncluttered canvas.
  if (currentWs === 2) {
    hideHint();
    cycleTimer = setTimeout(cycleShow, HINT_GAP_MS);
    return;
  }
  const set = HINT_SETS[state.mode] || [];
  if (set.length === 0) {
    // nothing for this mode; do not show, but re-poll in case mode changes shortly
    cycleTimer = setTimeout(cycleShow, HINT_GAP_MS);
    return;
  }
  const item = set[cycleIndex % set.length];
  cycleIndex++;
  const rect = shell.getBoundingClientRect();
  const at = resolveAnchor(item.at, rect);
  if (!at) {
    // anchor cannot resolve right now (e.g. shade closed); skip and advance fast
    cycleTimer = setTimeout(cycleShow, 50);
    return;
  }
  showHint({ ...item, at });
  cycleTimer = setTimeout(cycleHide, HINT_SHOW_MS);
}

function cycleHide() {
  cycleTimer = null;
  hideHint();
  // single-item sets repeat the same hint over and over — slow down so it doesn't pester
  const setLen = (HINT_SETS[state.mode] || []).length;
  const gap = setLen <= 1 ? 4500 : HINT_GAP_MS;
  cycleTimer = setTimeout(cycleShow, gap);
}

function startCycle() {
  clearCycleTimer();
  hideHint();
  cycleTimer = setTimeout(cycleShow, INITIAL_DELAY_MS);
}

function stopCycle() {
  clearCycleTimer();
  hideHint();
}

// restart with the set for the current state.mode (called when mode changes)
function restartCycle() {
  cycleIndex = 0;
  clearCycleTimer();
  hideHint();
  cycleTimer = setTimeout(cycleShow, 500);
}

// pause the cycle for `ms` then resume from the current index
function pauseCycle(ms) {
  clearCycleTimer();
  hideHint();
  cycleTimer = setTimeout(cycleShow, ms);
}

startCycle();

// ---------- feature grid ----------
// Lazy-load the same demo webms used in the README, hosted on the demos-v1 GitHub release.
const FEATURES = [
  { group: 'Edges', title: 'Bottom edge → Overview', file: 'bottom-edge.webm', def: 'Always',
    desc: 'Swipe up from the bottom edge to open Activities. 1:1 finger-tracked — pull part-way and let go to cancel.' },
  { group: 'Edges', title: 'Top-right → Quick Settings', file: 'top-right.webm', def: 'Always',
    desc: 'Swipe down from the top-right to open Quick Settings. Works over fullscreen apps too.' },
  { group: 'Edges', title: 'Top-center → Notifications', file: 'top-center.webm', def: 'Always',
    desc: 'Swipe down from the top-center to open the date menu (notifications and calendar).' },
  { group: 'Workspaces', title: 'Desktop horizontal swipe', file: 'desktop-workspace.webm', def: 'Always',
    desc: 'Single-finger horizontal swipe on the desktop background switches workspaces. RTL locales flip automatically.' },
  { group: 'Workspaces', title: 'In-overview horizontal swipe', file: 'overview-workspace.webm', def: 'Always',
    desc: 'Single-finger horizontal swipe over the overview background switches workspaces.' },
  { group: 'Workspaces', title: 'Bottom action bar', file: 'action-bar.webm', def: 'Auto',
    desc: 'A thin strip pinned to the bottom. Swipe inside to switch workspaces — even over fullscreen apps. Taps pass through.' },
  { group: 'Overview', title: 'Desktop swipe up → Overview', file: 'desktop-vertical.webm', def: 'Always',
    desc: 'Single-finger upward swipe on the desktop background opens the overview, 1:1 finger-tracked.' },
  { group: 'Overview', title: 'In-overview vertical swipe', file: 'overview-vertical.webm', def: 'Always',
    desc: 'Swipe up over the overview to reveal the app grid; swipe down to return to windows view.' },
  { group: 'Overview', title: 'Flick to close', file: 'flick-to-close.webm', def: 'Always',
    desc: 'Flick a window thumbnail upward in the overview to close that window.' },
  { group: 'Windows', title: 'Fullscreen Apps mode', file: 'fullscreen-apps.webm', def: 'Auto',
    desc: 'Open new windows maximized by default. Two-finger downward swipe inside a maximized window restores it.' },
  { group: 'Windows', title: 'Flick to tile', file: 'window-tiling-flick.webm', def: 'Always',
    desc: 'Touch-drag a window by its titlebar and flick to snap it: left or right tiles it to that half, up maximizes, down minimizes. A fast flick triggers it; a slow drag-and-drop leaves the window where it lands. Mouse drags are unaffected.' },
  { group: 'Windows', title: 'Top panel auto-hide', file: 'panel-auto-hide.webm', def: 'Auto',
    desc: 'Hides the top panel when a window is maximized. Reveals on top-edge proximity or panel menu interaction.' },
  { group: 'Touch helpers', title: 'Swipe to dismiss notifications', file: 'notif-dismiss.webm', def: 'Always',
    desc: 'Swipe up on a notification banner, or left on a notification in the date menu, to dismiss it.' },
  { group: 'Touch helpers', title: 'Text-action FAB', file: 'text-action-fab.webm', def: 'Auto',
    desc: 'Floating Cut / Copy / Paste / Select All / Keyboard bar. Works wherever Ctrl+X/C/V/A would — including GTK4.' },
];

const DEMO_BASE = 'https://github.com/keithvassallomt/touchshell/releases/download/demos-v1/';

function renderFeatures() {
  const grid = document.getElementById('featureGrid');
  if (!grid) return;
  const frag = document.createDocumentFragment();
  FEATURES.forEach((f, i) => {
    const card = document.createElement('article');
    card.className = 'feature-card';
    card.innerHTML = `
      <video muted loop playsinline preload="none" data-src="${DEMO_BASE}${f.file}" data-index="${i}"></video>
      <div class="feature-meta">
        <h3>${f.title}</h3>
        <p>${f.desc}</p>
      </div>
    `;
    frag.appendChild(card);
  });
  grid.appendChild(frag);

  // Lazy-load videos when scrolled into view, play in view, pause out of view.
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const v = entry.target;
      if (entry.isIntersecting) {
        if (!v.src && v.dataset.src) {
          v.src = v.dataset.src;
        }
        v.play().catch(() => { /* autoplay may be blocked; ignore */ });
      } else {
        v.pause();
      }
    }
  }, { rootMargin: '200px 0px', threshold: 0.25 });

  grid.querySelectorAll('video').forEach((v) => {
    io.observe(v);
    v.addEventListener('click', () => openLightbox(Number(v.dataset.index)));
  });
}

renderFeatures();

// ---------- lightbox ----------
const lightbox = document.getElementById('lightbox');
const lightboxVideo = document.getElementById('lightboxVideo');
const lightboxTitle = document.getElementById('lightboxTitle');
const lightboxDesc = document.getElementById('lightboxDesc');
const lightboxClose = document.getElementById('lightboxClose');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');
let lightboxIndex = 0;

function openLightbox(index) {
  lightboxIndex = index;
  showLightboxItem();
  lightbox.hidden = false;
  document.body.classList.add('lightbox-open');
}
function closeLightbox() {
  lightbox.hidden = true;
  document.body.classList.remove('lightbox-open');
  lightboxVideo.pause();
  lightboxVideo.removeAttribute('src');
  lightboxVideo.load();
  const stage = document.querySelector('.lightbox-stage');
  stage.classList.remove('slide-out-left', 'slide-out-right', 'slide-in-left', 'slide-in-right', 'slide-settle');
}
function showLightboxItem() {
  const f = FEATURES[lightboxIndex];
  lightboxVideo.src = `${DEMO_BASE}${f.file}`;
  lightboxVideo.play().catch(() => { /* autoplay block; user can press play */ });
  lightboxTitle.textContent = f.title;
  lightboxDesc.textContent = f.desc;
}
const lightboxStage = document.querySelector('.lightbox-stage');
function lightboxStep(delta) {
  // animate current video out in the direction of motion, then swap and slide in
  const outClass  = delta > 0 ? 'slide-out-left'  : 'slide-out-right';
  const inClass   = delta > 0 ? 'slide-in-right'  : 'slide-in-left';
  lightboxStage.classList.remove('slide-settle', 'slide-out-left', 'slide-out-right', 'slide-in-left', 'slide-in-right');
  lightboxStage.classList.add(outClass);
  setTimeout(() => {
    lightboxIndex = (lightboxIndex + delta + FEATURES.length) % FEATURES.length;
    showLightboxItem();
    lightboxStage.classList.remove(outClass);
    lightboxStage.classList.add(inClass);
    // next frame: settle into final position with the transition
    requestAnimationFrame(() => {
      lightboxStage.classList.remove(inClass);
      lightboxStage.classList.add('slide-settle');
    });
  }, 200);
}

lightboxClose.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click', () => lightboxStep(-1));
lightboxNext.addEventListener('click', () => lightboxStep(1));
lightbox.addEventListener('click', (e) => {
  // close when clicking the backdrop itself, not the video/caption/controls
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (lightbox.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lightboxStep(-1);
  else if (e.key === 'ArrowRight') lightboxStep(1);
});

// ---------- copy-to-clipboard buttons ----------
document.querySelectorAll('.code-copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const target = document.getElementById(btn.dataset.copyTarget);
    if (!target) return;
    const text = target.innerText;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: select + execCommand
      const range = document.createRange();
      range.selectNodeContents(target);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      sel.removeAllRanges();
    }
    const label = btn.querySelector('.code-copy-label');
    const originalText = label.textContent;
    btn.classList.add('copied');
    label.textContent = 'Copied';
    setTimeout(() => {
      btn.classList.remove('copied');
      label.textContent = originalText;
    }, 1600);
  });
});

// ---------- simulation control bar ----------
const simState = {
  fullscreenApps: false,
  panelHide: false,
  actionBar: false,
  fab: false,
};

function applySimState() {
  shell.classList.toggle('action-bar-visible', simState.actionBar);
  shell.classList.toggle('panel-auto-hide', simState.panelHide);
  if (simState.fullscreenApps) {
    addFullscreenWorkspace();
  } else {
    removeFullscreenWorkspace();
  }
  applyFabState();
}

function syncToggleUI(name, on) {
  // sync the bottom control bar toggle
  const ctrlBtn = document.querySelector(`.sim-toggle[data-toggle="${name}"]`);
  if (ctrlBtn) ctrlBtn.setAttribute('aria-checked', on ? 'true' : 'false');
  // sync the Quick Settings sub-panel toggle
  const qsBtn = document.querySelector(`.qs-sub-toggle[data-qs-toggle="${name}"]`);
  if (qsBtn) qsBtn.setAttribute('aria-checked', on ? 'true' : 'false');
}

function setToggle(name, on) {
  const key = ({ 'fullscreen-apps': 'fullscreenApps', 'panel-hide': 'panelHide', 'action-bar': 'actionBar', 'fab': 'fab' })[name];
  if (!key) return;
  // panel-hide can only be toggled when fullscreen-apps is on
  if (name === 'panel-hide' && on && !simState.fullscreenApps) return;
  // Turning fab on cascades fullscreen-apps on (shares the TextEdit workspace)
  if (name === 'fab' && on && !simState.fullscreenApps) {
    simState.fullscreenApps = true;
    syncToggleUI('fullscreen-apps', true);
  }
  simState[key] = on;
  syncToggleUI(name, on);
  // Turning fullscreen-apps off implicitly turns off panel-hide and fab
  if (name === 'fullscreen-apps' && !on) {
    if (simState.panelHide) { simState.panelHide = false; syncToggleUI('panel-hide', false); }
    if (simState.fab) { simState.fab = false; syncToggleUI('fab', false); }
  }
  syncTogglesEnabled();
  applySimState();
}

function syncTogglesEnabled() {
  const ph = document.querySelector('.sim-toggle[data-toggle="panel-hide"]');
  if (ph) ph.disabled = !simState.fullscreenApps;
  const qsPh = document.querySelector('.qs-sub-toggle[data-qs-toggle="panel-hide"]');
  if (qsPh) qsPh.disabled = !simState.fullscreenApps;
}

function addFullscreenWorkspace() {
  if (document.getElementById('wsFullscreen')) return;
  const ws = document.createElement('div');
  ws.className = 'workspace';
  ws.dataset.ws = '2';
  ws.id = 'wsFullscreen';
  ws.innerHTML = `
    <div class="wallpaper"></div>
    <div class="window window-maximized" id="fullscreenApp">
      <div class="window-header">
        <span class="window-title">TextEdit</span>
        <span class="window-close" aria-hidden="true">×</span>
      </div>
      <div class="window-body fullscreen-textedit">
        <p>Saturday afternoon.</p>
        <p>&nbsp;</p>
        <p>Pick up groceries on the way home. Milk, bread, two avocados.</p>
        <p>Call mum tomorrow.</p>
        <p>&nbsp;</p>
        <p>The quick brown fox jumps over the lazy dog.</p>
      </div>
    </div>
  `;
  workspacesEl.appendChild(ws);

  const panelWs = document.getElementById('panelWorkspaces');
  if (panelWs && !document.getElementById('wsPip2')) {
    const pip = document.createElement('span');
    pip.className = 'ws-pip';
    pip.dataset.ws = '2';
    pip.id = 'wsPip2';
    panelWs.appendChild(pip);
  }
  // also add a 3rd overview thumbnail (with a maximized TextEdit mini-window)
  const ovWs = document.getElementById('overviewWorkspaces');
  if (ovWs && !document.getElementById('thumb2')) {
    const th = document.createElement('div');
    th.className = 'thumb';
    th.dataset.ws = '2';
    th.id = 'thumb2';
    th.innerHTML = '<div class="thumb-win" style="--x:0%; --y:6%; --w:100%; --h:94%; --c:#fafafa"></div>';
    ovWs.appendChild(th);
  }
  WORKSPACE_COUNT = 3;
  setWorkspace(2);
}

function removeFullscreenWorkspace() {
  const ws = document.getElementById('wsFullscreen');
  if (ws) ws.remove();
  const pip = document.getElementById('wsPip2');
  if (pip) pip.remove();
  const th = document.getElementById('thumb2');
  if (th) th.remove();
  WORKSPACE_COUNT = 2;
  if (currentWs >= WORKSPACE_COUNT) setWorkspace(1);
  else updateWorkspacePips();
}

document.querySelectorAll('.sim-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.toggle;
    const on = btn.getAttribute('aria-checked') !== 'true';
    setToggle(name, on);
  });
});

// Quick Settings sub-panel toggles mirror the control bar
document.querySelectorAll('.qs-sub-toggle').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    const name = btn.dataset.qsToggle;
    const on = btn.getAttribute('aria-checked') !== 'true';
    setToggle(name, on);
  });
});

// Touchshell tile in Quick Settings expands its sub-panel
const qsTouchshellBtn = document.getElementById('qsTouchshell');
const qsTouchshellPanel = document.getElementById('qsTouchshellPanel');
if (qsTouchshellBtn && qsTouchshellPanel) {
  qsTouchshellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = qsTouchshellPanel.classList.toggle('open');
    qsTouchshellBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

// Other QS tiles: tap is a no-op (decorative — they reflect a frozen "on/off" state)
// We still swallow the click so it doesn't bubble out and dismiss the popover.
document.querySelectorAll('.qs-tile').forEach((btn) => {
  if (btn.dataset.tile === 'touchshell') return;
  btn.addEventListener('click', (e) => { e.stopPropagation(); });
});

syncTogglesEnabled();

// ---------- Touch text-action FAB ----------
const tsFab = document.getElementById('tsFab');
const tsFabBar = document.getElementById('tsFabBar');
const tsOsk = document.getElementById('tsOsk');

const FAB_SIZE = 36;
const FAB_EDGE = 14;
const FAB_BAR_GAP = 8;
const FAB_BAR_EDGE = 8;
const DRAG_THRESHOLD = 5;

// In-demo clipboard — the textedit is the only thing the FAB acts on, so we
// don't need the real system clipboard (which has permission / cross-browser
// quirks anyway).
let internalClipboard = '';
let fabPos = null; // {x, y} in shell-local px; null until first apply

// Track the last selection inside the editable textedit, so we can restore
// it before running an action even if focus/selection collapsed in between.
let savedEditRange = null;
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const ed = getEditableTextedit();
  if (!ed) return;
  const range = sel.getRangeAt(0);
  if (ed.contains(range.commonAncestorContainer) || ed === range.commonAncestorContainer) {
    savedEditRange = range.cloneRange();
  }
});

function getEditableTextedit() {
  return document.querySelector('#wsFullscreen .fullscreen-textedit');
}

function shellSize() {
  const r = shell.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function defaultFabPos() {
  const { w, h } = shellSize();
  return { x: w - FAB_SIZE - FAB_EDGE, y: h - FAB_SIZE - FAB_EDGE };
}

function clampFabPos(p) {
  const { w, h } = shellSize();
  return {
    x: Math.max(FAB_EDGE, Math.min(w - FAB_SIZE - FAB_EDGE, p.x)),
    y: Math.max(FAB_EDGE, Math.min(h - FAB_SIZE - FAB_EDGE, p.y)),
  };
}

function applyFabPos() {
  if (!tsFab) return;
  fabPos = clampFabPos(fabPos || defaultFabPos());
  tsFab.style.left = `${fabPos.x}px`;
  tsFab.style.top = `${fabPos.y}px`;
  tsFab.style.right = 'auto';
  tsFab.style.bottom = 'auto';
}

// Place the action bar relative to the FAB: above by default, fall back to
// below, then to the side, clamped to the shell. Mirrors the extension's
// edge-aware logic so a dragged FAB near any edge still shows a sane menu.
function positionFabBar() {
  if (!tsFabBar || !fabPos) return;
  // Measure bar size off-screen-ish (visible:hidden keeps layout).
  const prev = { display: tsFabBar.style.display, visibility: tsFabBar.style.visibility };
  tsFabBar.style.visibility = 'hidden';
  tsFabBar.style.display = 'inline-flex';
  const bw = tsFabBar.offsetWidth;
  const bh = tsFabBar.offsetHeight;
  tsFabBar.style.display = prev.display;
  tsFabBar.style.visibility = prev.visibility;

  const { w, h } = shellSize();
  const cx = fabPos.x + FAB_SIZE / 2;
  const cy = fabPos.y + FAB_SIZE / 2;

  // Default: above, horizontally centred on the FAB.
  let bx = Math.round(cx - bw / 2);
  let by = fabPos.y - bh - FAB_BAR_GAP;

  if (by < FAB_BAR_EDGE) {
    const belowY = fabPos.y + FAB_SIZE + FAB_BAR_GAP;
    if (belowY + bh <= h - FAB_BAR_EDGE) {
      by = belowY;
    } else {
      // Vertically constrained — flank the FAB.
      by = Math.round(cy - bh / 2);
      const leftX = fabPos.x - bw - FAB_BAR_GAP;
      bx = leftX >= FAB_BAR_EDGE ? leftX : fabPos.x + FAB_SIZE + FAB_BAR_GAP;
    }
  }
  bx = Math.max(FAB_BAR_EDGE, Math.min(w - bw - FAB_BAR_EDGE, bx));
  by = Math.max(FAB_BAR_EDGE, Math.min(h - bh - FAB_BAR_EDGE, by));

  tsFabBar.style.left = `${bx}px`;
  tsFabBar.style.top = `${by}px`;
  tsFabBar.style.right = 'auto';
  tsFabBar.style.bottom = 'auto';
}

function applyFabState() {
  const on = simState.fab && simState.fullscreenApps;
  shell.classList.toggle('fab-visible', on);
  const ed = getEditableTextedit();
  if (ed) {
    if (on) ed.setAttribute('contenteditable', 'true');
    else ed.removeAttribute('contenteditable');
  }
  if (on) {
    if (typeof setWorkspace === 'function' && currentWs !== 2) setWorkspace(2);
    if (tsFab) tsFab.setAttribute('aria-hidden', 'false');
    applyFabPos();
  } else {
    closeFabBar();
    closeOsk();
    if (tsFab) tsFab.setAttribute('aria-hidden', 'true');
  }
}

function openFabBar() {
  if (!tsFabBar) return;
  positionFabBar();
  shell.classList.add('fab-bar-open');
  tsFabBar.setAttribute('aria-hidden', 'false');
}
function closeFabBar() {
  if (!tsFabBar) return;
  shell.classList.remove('fab-bar-open');
  tsFabBar.setAttribute('aria-hidden', 'true');
}
function openOsk() {
  if (!tsOsk) return;
  shell.classList.add('osk-open');
  tsOsk.setAttribute('aria-hidden', 'false');
}
function closeOsk() {
  if (!tsOsk) return;
  shell.classList.remove('osk-open');
  tsOsk.setAttribute('aria-hidden', 'true');
}

// FAB drag + tap. Pointer events; a tap (no movement past threshold) opens
// the bar, a drag past threshold relocates the FAB and suppresses the click
// that the browser fires on pointerup.
let fabDrag = null;
let fabSuppressClick = false;

if (tsFab) {
  tsFab.addEventListener('mousedown', (e) => e.preventDefault());
  tsFab.addEventListener('pointerdown', (e) => {
    if (!shell.classList.contains('fab-visible')) return;
    e.stopPropagation();
    const r = shell.getBoundingClientRect();
    fabDrag = {
      pointerId: e.pointerId,
      startSx: e.clientX, startSy: e.clientY,
      origX: fabPos.x, origY: fabPos.y,
      shellLeft: r.left, shellTop: r.top,
      moved: false,
    };
    tsFab.setPointerCapture(e.pointerId);
  });
  tsFab.addEventListener('pointermove', (e) => {
    if (!fabDrag || e.pointerId !== fabDrag.pointerId) return;
    const dx = e.clientX - fabDrag.startSx;
    const dy = e.clientY - fabDrag.startSy;
    if (!fabDrag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!fabDrag.moved) {
      fabDrag.moved = true;
      // Starting a drag dismisses an open bar.
      closeFabBar();
    }
    fabPos = clampFabPos({ x: fabDrag.origX + dx, y: fabDrag.origY + dy });
    applyFabPos();
  });
  const endFabDrag = (e) => {
    if (!fabDrag || e.pointerId !== fabDrag.pointerId) return;
    if (fabDrag.moved) fabSuppressClick = true;
    try { tsFab.releasePointerCapture(fabDrag.pointerId); } catch {}
    fabDrag = null;
  };
  tsFab.addEventListener('pointerup', endFabDrag);
  tsFab.addEventListener('pointercancel', endFabDrag);
  tsFab.addEventListener('click', (e) => {
    e.stopPropagation();
    if (fabSuppressClick) { fabSuppressClick = false; return; }
    if (shell.classList.contains('fab-bar-open')) closeFabBar();
    else openFabBar();
  });
}

function showFabToast(label) {
  let t = document.getElementById('tsFabToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'tsFabToast';
    t.className = 'ts-fab-toast';
    shell.appendChild(t);
  }
  t.textContent = label;
  t.classList.remove('show');
  // force reflow so the next class change triggers transition
  // eslint-disable-next-line no-unused-expressions
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(showFabToast._timer);
  showFabToast._timer = setTimeout(() => t.classList.remove('show'), 1200);
}

function runFabAction(action) {
  const ed = getEditableTextedit();
  if (!ed) return;
  ed.focus();
  const sel = window.getSelection();
  // Restore the last known selection inside the editable. If the user clicked
  // the FAB and the selection collapsed (browser quirk), this brings it back.
  if (savedEditRange && (ed.contains(savedEditRange.commonAncestorContainer) || ed === savedEditRange.commonAncestorContainer)) {
    sel.removeAllRanges();
    sel.addRange(savedEditRange);
  }
  switch (action) {
    case 'selectAll': {
      const range = document.createRange();
      range.selectNodeContents(ed);
      sel.removeAllRanges();
      sel.addRange(range);
      showFabToast('Selected all');
      break;
    }
    case 'copy': {
      const text = sel.toString();
      if (text) {
        internalClipboard = text;
        showFabToast('Copied');
      } else {
        showFabToast('Nothing selected');
      }
      break;
    }
    case 'cut': {
      const text = sel.toString();
      if (text) {
        internalClipboard = text;
        sel.deleteFromDocument();
        showFabToast('Cut');
      } else {
        showFabToast('Nothing selected');
      }
      break;
    }
    case 'paste': {
      if (!internalClipboard) { showFabToast('Clipboard empty'); break; }
      if (!sel.rangeCount) {
        ed.appendChild(document.createTextNode(internalClipboard));
        showFabToast('Pasted');
        break;
      }
      if (!sel.isCollapsed) sel.deleteFromDocument();
      const range = sel.getRangeAt(0);
      const node = document.createTextNode(internalClipboard);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
      showFabToast('Pasted');
      break;
    }
    case 'keyboard': {
      closeFabBar();
      openOsk();
      return;
    }
  }
  closeFabBar();
}

if (tsFabBar) {
  tsFabBar.addEventListener('mousedown', (e) => e.preventDefault());
  tsFabBar.querySelectorAll('.ts-fab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runFabAction(btn.dataset.action);
    });
  });
}

if (tsOsk) {
  tsOsk.addEventListener('mousedown', (e) => e.preventDefault());
  tsOsk.addEventListener('pointerdown', (e) => e.stopPropagation());
  tsOsk.querySelector('.ts-osk-hide')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeOsk();
  });
}

shell.addEventListener('pointerdown', (e) => {
  if (!shell.classList.contains('fab-bar-open')) return;
  if (e.target.closest('#tsFab, #tsFabBar')) return;
  closeFabBar();
});

// Keep the FAB inside the shell on resize.
window.addEventListener('resize', () => {
  if (!shell.classList.contains('fab-visible')) return;
  applyFabPos();
  if (shell.classList.contains('fab-bar-open')) positionFabBar();
});

// ---------- device fullscreen button ----------
// We fullscreen the .stage (not just .device) so the control bar comes along.
const deviceEl = document.getElementById('device');
const stageEl = document.getElementById('stage');
const deviceFullscreenBtn = document.getElementById('deviceFullscreenBtn');
if (deviceFullscreenBtn && stageEl) {
  deviceFullscreenBtn.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await stageEl.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      // some browsers / iframes block fullscreen — fail silently
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === stageEl;
    stageEl.classList.toggle('is-fullscreen', on);
    // keep the icon-swap class on .device so its CSS rule still works
    deviceEl.classList.toggle('is-fullscreen', on);
  });
}

// ---------- copyright year ----------
const copyrightYear = document.getElementById('copyrightYear');
if (copyrightYear) copyrightYear.textContent = String(new Date().getFullYear());
