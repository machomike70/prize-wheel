(() => {
  'use strict';

  function apiBase() {
    if (window.PrizeWheelAdminSession && window.PrizeWheelAdminSession.apiBase) {
      return window.PrizeWheelAdminSession.apiBase();
    }
    const path = location.pathname || '';
    if (path.startsWith('/wheel-staging')) return '/wheel-staging';
    if (path.startsWith('/wheel')) return '/wheel';
    return '';
  }

  /** Staging: admin token from shared localStorage session (no Xaman / wallet SignIn). */
  function spinHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (window.PrizeWheelAdminSession && window.PrizeWheelAdminSession.readAdminToken) {
      const t = window.PrizeWheelAdminSession.readAdminToken();
      if (t) h['X-Admin-Token'] = t;
    }
    return h;
  }

  function hasAdminSession() {
    if (ticketCode) return !ticketSpent;
    if (window.PrizeWheelAdminSession && window.PrizeWheelAdminSession.hasAdminToken) {
      return window.PrizeWheelAdminSession.hasAdminToken();
    }
    if (window.PrizeWheelAdminSession && window.PrizeWheelAdminSession.readAdminToken) {
      return Boolean(window.PrizeWheelAdminSession.readAdminToken());
    }
    return false;
  }

  function ensureViewerSpinHint() {
    let hint = document.getElementById('viewerSpinHint');
    if (!hint && els.spinBtn && els.spinBtn.parentElement) {
      hint = document.createElement('p');
      hint.id = 'viewerSpinHint';
      hint.className = 'viewer-spin-hint';
      hint.setAttribute('role', 'status');
      els.spinBtn.parentElement.insertAdjacentElement('afterend', hint);
    }
    return hint;
  }

  function syncViewerSpinMessage() {
    const hint = ensureViewerSpinHint();
    const label = els.spinBtn && els.spinBtn.querySelector('.spin-label');
    if (ticketCode) {
      if (hint) {
        hint.hidden = false;
        hint.textContent = ticketSpent
          ? 'This spin code has been used. Your prize code: ' + ticketCode
          : 'Spin code ' + ticketCode + ' — one spin. Your prize code appears when the wheel stops.';
      }
      if (label) label.textContent = ticketSpent ? 'USED' : 'SPIN';
      return;
    }
    if (hasAdminSession()) {
      if (hint) {
        hint.hidden = true;
        hint.textContent = '';
      }
      if (label) label.textContent = 'SPIN';
      return;
    }
    if (hint) {
      hint.hidden = false;
      hint.textContent =
        'View only — watch the wheel and results. Only admins can spin (sign in via /wheel-staging/admin).';
    }
    if (label) label.textContent = 'VIEW ONLY';
  }


  // Casino roulette palette: red / black alternating; gold for odd leftover
  const RED = '#c41e3a';
  const BLACK = '#1a1a1a';
  const GOLD = '#d4af37';
  const GOLD_BRIGHT = '#f0d78c';
  const CREAM = '#f5f0e6';
  const DARK_INK = '#1a1204';

  const CONFETTI_COLORS = [
    GOLD,
    GOLD_BRIGHT,
    RED,
    '#ffffff',
    '#8b0000',
    '#c9a227',
    '#ffe9a8',
    '#fff8dc',
  ];

  const SAMPLE_NAMES = ['Alice', 'Blake', 'Casey', 'Drew', 'Ellis', 'Finn'];
  const SAMPLE_PRIZES = ['Jackpot', 'Free Spin', 'Bonus', 'Lucky 7', 'Try Again', 'Mystery'];
  const DEFAULT_PRIZES = ['10% Off', 'Free Shipping', 'Mystery Gift', 'Try Again'];
  const STORAGE_KEY = 'prize-wheel:v1';

  // Vegas roulette: wheel clockwise; ball races anti-clockwise on the rim track for
  // most of the wall-clock spin, then slows and drops into the winning pocket.
  // Master ball progress is LINEAR so DROP_START is real time (not easeOut-skewed).
  const SPIN_DURATION = 8.5;
  const SPIN_TURNS = 9;          // wheel clockwise — milder ease keeps it visibly turning
  const BALL_ORBIT_TURNS = 20;   // many opposite revolutions on the outer track
  const DROP_START = 0.76;       // ~76% of spin still on the rim racing opposite
  const LOCK_START = 0.92;       // fully pocket-locked near the end
  const MUTE_KEY = 'prize-wheel:mute';

  const params = new URLSearchParams(location.search);
  const embed = params.get('embed') === '1';
  const autoclose = params.get('autoclose') === '1';
  const controlsOff = params.get('controls') === '0';
  const modeParam = params.get('mode');
  // Spin-ticket mode: /?code=XXXX-XXXX-XX&mode=prizes[&site=shop] — customer spends one ticket,
  // server spins over the configured prize list (GET /api/prizes) and returns the prize code.
  const ticketCode = (params.get('code') || '').trim();
  const ticketSite = params.get('site') === 'shop' || params.get('site') === 'goml' ? params.get('site') : '';
  let ticketSpent = false;

  const els = {
    app: document.getElementById('app'),
    itemInput: document.getElementById('itemInput'),
    addBtn: document.getElementById('addBtn'),
    itemList: document.getElementById('itemList'),
    spinBtn: document.getElementById('spinBtn'),
    modeTabs: document.getElementById('modeTabs'),
    winnerOverlay: document.getElementById('winnerOverlay'),
    winnerLabel: document.getElementById('winnerLabel'),
    sigPreview: document.getElementById('sigPreview'),
    prizeCodeInfo: document.getElementById('prizeCodeInfo'),
    closeOverlay: document.getElementById('closeOverlay'),
    emptyHint: document.getElementById('emptyHint'),
    listEmpty: document.getElementById('listEmpty'),
    pointer: document.getElementById('pointer'),
    wheelWrap: document.getElementById('wheelWrap'),
    ball: document.getElementById('rouletteBall'),
    muteBtn: document.getElementById('muteBtn'),
  };

  if (embed) document.body.classList.add('embed');
  if (controlsOff) document.body.classList.add('controls-hidden');
  if (ticketCode) {
    // Ticket mode: keep SPIN, hide the list editor + mode tabs (server owns the prize list).
    document.body.classList.add('ticket-mode');
    const editor = document.querySelector('.input-panel');
    if (editor) editor.style.display = 'none';
    if (els.modeTabs) els.modeTabs.style.display = 'none';
  }

  /** @type {{ names: string[], prizes: string[], mode: 'names'|'prizes' }} */
  let state = loadState();
  if (modeParam === 'names' || modeParam === 'prizes') {
    state.mode = modeParam;
  }
  if (ticketCode) state.mode = 'prizes';

  let theWheel = null;
  let spinning = false;
  /** @type {{ result: object, signature: string } | null} */
  let lastProof = null;
  /** True when wheel is showing decorative sample segments (not real items) */
  let showingSamples = false;
  let tickCooldown = 0;

  /** @type {gsap.core.Tween | null} */
  let ballTween = null;
  let ballStopAngle = 0;
  let ballOrbitStart = 0;
  let lastFretBucket = -1;

  /** @type {AudioContext | null} */
  let audioCtx = null;
  let soundMuted = false;
  try { soundMuted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* ignore */ }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          names: Array.isArray(parsed.names) ? parsed.names.map(String) : [],
          prizes: Array.isArray(parsed.prizes) && parsed.prizes.length
            ? parsed.prizes.map(String)
            : DEFAULT_PRIZES.slice(),
          mode: parsed.mode === 'prizes' ? 'prizes' : 'names',
        };
      }
    } catch { /* ignore */ }
    return { names: [], prizes: DEFAULT_PRIZES.slice(), mode: 'names' };
  }

  function saveState() {
    if (ticketCode) return; // ticket mode shows the server prize list; never overwrite local lists
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        names: state.names,
        prizes: state.prizes,
        mode: state.mode,
      }));
    } catch { /* ignore */ }
  }

  function currentItems() {
    return state.mode === 'names' ? state.names : state.prizes;
  }

  function setCurrentItems(items) {
    if (state.mode === 'names') state.names = items;
    else state.prizes = items;
  }

  function parentOrigin() {
    try {
      if (document.referrer) return new URL(document.referrer).origin;
    } catch { /* ignore */ }
    return '*';
  }

  function postToParent(msg) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(msg, parentOrigin());
    }
  }

  function segmentColor(i, total) {
    if (total % 2 === 1 && i === total - 1) return GOLD;
    return i % 2 === 0 ? RED : BLACK;
  }

  function textColorForFill(fill) {
    return fill === GOLD ? DARK_INK : CREAM;
  }

  function updateTabs() {
    els.modeTabs.querySelectorAll('.tab').forEach((btn) => {
      const active = btn.dataset.mode === state.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    els.itemInput.placeholder =
      state.mode === 'names' ? 'Add a name…' : 'Add a prize…';
    if (els.listEmpty) {
      els.listEmpty.textContent =
        state.mode === 'names'
          ? 'No entries yet — the wheel shows a sample layout until you add names.'
          : 'No prizes yet — the wheel shows a sample layout until you add prizes.';
    }
  }

  function updateList() {
    const items = currentItems();
    els.itemList.innerHTML = items
      .map((label, i) => {
        const fill = segmentColor(i, items.length || 1);
        return (
          `<li style="--seg-dot:${fill}"><span>${escapeHtml(label)}</span>` +
          `<button type="button" class="remove" data-i="${i}" aria-label="Remove">Remove</button></li>`
        );
      })
      .join('');
    if (els.listEmpty) {
      els.listEmpty.hidden = items.length > 0;
    }
    if (els.emptyHint) {
      els.emptyHint.hidden = items.length >= 2;
    }
    updateSpinEnabled();
    if (window.PrizeWheelTG) window.PrizeWheelTG.sync();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updateSpinEnabled() {
    const admin = hasAdminSession();
    const ok = admin && !spinning && currentItems().length >= 2 && !showingSamples;
    els.spinBtn.disabled = !ok;
    if (els.spinBtn) {
      els.spinBtn.title = admin
        ? 'Spin the wheel'
        : 'Admin session required to spin — viewers can watch only';
    }
    syncViewerSpinMessage();
  }

  function segmentTexts() {
    const items = currentItems();
    if (items.length === 0) {
      showingSamples = true;
      return state.mode === 'names' ? SAMPLE_NAMES.slice() : SAMPLE_PRIZES.slice();
    }
    showingSamples = false;
    return items.slice();
  }

  function ensureAudio() {
    if (typeof window.AudioContext === 'undefined' &&
        typeof window.webkitAudioContext === 'undefined') {
      return null;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  /** Soft fret / rim click via Web Audio (optional; respects mute). */
  function playTick(intensity) {
    if (soundMuted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1650 + Math.random() * 450, t0);
      osc.frequency.exponentialRampToValueAtTime(900, t0 + 0.035);
      filt.type = 'bandpass';
      filt.frequency.value = 2200;
      filt.Q.value = 1.4;
      const amp = Math.max(0.02, Math.min(0.14, intensity == null ? 0.07 : intensity));
      g.gain.setValueAtTime(amp, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
      osc.connect(filt);
      filt.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.05);
    } catch { /* ignore audio failures */ }
  }

  function syncMuteUi() {
    if (!els.muteBtn) return;
    els.muteBtn.setAttribute('aria-pressed', soundMuted ? 'true' : 'false');
    els.muteBtn.title = soundMuted ? 'Unmute tick sounds' : 'Mute tick sounds';
    els.muteBtn.setAttribute('aria-label', els.muteBtn.title);
    const ico = els.muteBtn.querySelector('.mute-ico');
    if (ico) ico.textContent = soundMuted ? '🔇' : '🔊';
  }

  function toggleMute() {
    soundMuted = !soundMuted;
    try { localStorage.setItem(MUTE_KEY, soundMuted ? '1' : '0'); } catch { /* ignore */ }
    syncMuteUi();
    if (!soundMuted) {
      ensureAudio();
      playTick(0.05);
    }
  }

  function nudgePointerTick() {
    if (!els.pointer) return;
    const now = performance.now();
    if (now - tickCooldown < 48) return;
    tickCooldown = now;
    els.pointer.classList.remove('tick', 'land');
    void els.pointer.offsetWidth;
    els.pointer.classList.add('tick');
    playTick(0.065);
  }

  function bouncePointerLand() {
    if (!els.pointer) return;
    els.pointer.classList.remove('tick', 'land');
    void els.pointer.offsetWidth;
    els.pointer.classList.add('land');
  }

  /* —— Ball geometry / animation ——
   * Winwheel: stopAngle S is a local wheel angle inside the winning segment.
   * At rest, rotationPosition ≡ (360 - S) (pointer at 0), so the pocket at S
   * sits under the pointer. CSS world angle of that pocket while spinning:
   *   world = rotationAngle + S  →  ends at 0 (top). Ball locks to that.
   * Orbit phase runs the opposite direction (decreasing angle).
   */
  function ballRadii() {
    const w = (els.wheelWrap && els.wheelWrap.clientWidth) || 440;
    // px from center — track sits in the recessed rim groove (inside wrap, outside face);
    // pocket inset on the wheel face. Leave margin so the marble never clips.
    const ballHalf = Math.max(7.5, (els.ball ? els.ball.offsetWidth : 20) / 2);
    const maxTrack = w * 0.5 - ballHalf - 4; // keep whole marble inside .wheel-wrap
    const track = Math.min(w * 0.445, maxTrack);
    const pocket = Math.min(w * 0.390, track - 8);
    return { track, pocket, maxTrack, ballHalf, w };
  }

  function positionBall(deg, radiusPx) {
    if (!els.ball) return;
    const w = (els.wheelWrap && els.wheelWrap.clientWidth) || 440;
    const ballHalf = Math.max(7.5, (els.ball.offsetWidth || 20) / 2);
    const maxTrack = w * 0.5 - ballHalf - 4;
    // Clamp so orbit/bounce never pushes the marble outside the visible stage
    const r = Math.max(12, Math.min(radiusPx, maxTrack));
    // Drive orbit via CSS custom properties so no stylesheet transform can override
    // the live spin (inline transform alone was easy to clobber / ignore).
    els.ball.style.setProperty('--ball-angle', deg + 'deg');
    els.ball.style.setProperty('--ball-r', r + 'px');
    els.ball.style.opacity = '1';
    els.ball.style.visibility = 'visible';
    els.ball.style.transform =
      'rotate(' + deg + 'deg) translateY(-' + r + 'px)';
  }

  function norm360(a) {
    a = a % 360;
    if (a < 0) a += 360;
    return a;
  }

  /** Shortest-path interpolation between angles (degrees). */
  function lerpAngle(from, to, t) {
    let d = ((to - from + 540) % 360) - 180;
    return from + d * t;
  }

  function killBallTween() {
    if (ballTween) {
      try { ballTween.kill(); } catch { /* ignore */ }
      ballTween = null;
    }
  }

  function parkBall() {
    killBallTween();
    if (!els.ball) return;
    const { pocket } = ballRadii();
    // Sit in the pocket under the pointer (top)
    positionBall(0, pocket);
    els.ball.classList.remove('rolling');
    els.ball.classList.add('dropped');
  }

  /**
   * Drive the ball opposite the wheel, then drop/lock into the forced pocket.
   * @param {number} stopAngle Winwheel local angle (same value passed to animation.stopAngle)
   */
  /** Fall radius with a slight Vegas bounce when settling into the pocket. */
  function dropRadius(track, pocket, u) {
    const t = u * u * (3 - 2 * u); // smoothstep
    let r = track + (pocket - track) * t;
    // Damped overshoot: small bounce that stays inside the rim track
    if (u > 0.45) {
      const b = (u - 0.45) / 0.55;
      const amp = 4 * Math.pow(1 - b, 1.35);
      r += Math.sin(b * Math.PI * 2.15) * amp;
    }
    return r;
  }

  /**
   * Orbit progress inside the track phase: long fast cruise opposite the wheel,
   * then decelerate in the last ~28% so the ball visibly slows before the drop.
   * Returns 0..1 of BALL_ORBIT_TURNS completed.
   */
  function orbitPhaseProgress(u) {
    // u = 0..1 through the pre-drop phase (linear wall-clock)
    if (u <= 0.72) {
      return (u / 0.72) * 0.88; // cruise: most revolutions at speed
    }
    const v = (u - 0.72) / 0.28;
    const decelerate = 1 - Math.pow(1 - v, 2.4);
    return 0.88 + 0.12 * decelerate;
  }

  function startBallAnimation(stopAngle) {
    if (!els.ball || typeof TweenMax === 'undefined') {
      parkBall();
      return;
    }
    killBallTween();
    ballStopAngle = stopAngle;
    // Start away from the pointer so the first frame already shows track motion
    ballOrbitStart = 40 + Math.random() * 280;
    lastFretBucket = -1;

    const { track, pocket } = ballRadii();
    const stateObj = { p: 0 };
    // Continuous unwrapped orbit angle (DECREASING = anti-clockwise, opposite wheel)
    let orbitAngle = ballOrbitStart;
    /** Angular offset from pocket at the moment of drop; closed out during fall. */
    let dropOffset = 0;
    let dropping = false;
    let bouncePlayed = false;

    els.ball.classList.add('rolling');
    els.ball.classList.remove('dropped');
    // Clear any stale inline leftovers; positionBall owns transform + CSS vars
    els.ball.style.removeProperty('animation');
    positionBall(orbitAngle, track);

    ballTween = TweenMax.to(stateObj, SPIN_DURATION, {
      p: 1,
      // LINEAR master clock — easeOut here made DROP_START hit at ~2s, so the ball
      // looked glued to a pocket (co-rotating) for most of the spin.
      ease: Linear.easeNone,
      onUpdate() {
        if (!theWheel) return;
        const p = stateObj.p;
        const lockedWorld = theWheel.rotationAngle + ballStopAngle;

        if (p < DROP_START) {
          const u = p / DROP_START;
          const o = orbitPhaseProgress(u);
          orbitAngle = ballOrbitStart - BALL_ORBIT_TURNS * 360 * o;
          positionBall(orbitAngle, track);
          maybeFretTick(orbitAngle);
        } else if (p < LOCK_START) {
          if (!dropping) {
            dropping = true;
            // Keep travelling opposite a bit while closing toward the moving pocket
            dropOffset = ((orbitAngle - lockedWorld + 540) % 360) - 180;
            // Prefer continuing the anti-clockwise approach (negative residual)
            if (dropOffset > 0) dropOffset -= 360;
            els.ball.classList.add('dropped');
            playTick(0.1);
            nudgePointerTick();
          }
          const u = (p - DROP_START) / (LOCK_START - DROP_START);
          const easeU = u * u * (3 - 2 * u); // smoothstep for angle close
          orbitAngle = lockedWorld + dropOffset * (1 - easeU);
          const r = dropRadius(track, pocket, u);
          positionBall(orbitAngle, r);
          if (!bouncePlayed && u > 0.55) {
            bouncePlayed = true;
            playTick(0.08);
          }
          maybeFretTick(orbitAngle);
        } else {
          dropping = true;
          els.ball.classList.add('dropped');
          els.ball.classList.remove('rolling');
          positionBall(lockedWorld, pocket);
        }
      },
      onComplete() {
        if (!theWheel) return;
        positionBall(theWheel.rotationAngle + ballStopAngle, pocket);
        els.ball.classList.remove('rolling');
        els.ball.classList.add('dropped');
      },
    });
  }

  function maybeFretTick(worldAngle) {
    // Tick pointer when ball crosses a fret (segment boundary)
    const n = theWheel && theWheel.numSegments ? theWheel.numSegments : 0;
    if (n < 2) return;
    const bucket = Math.floor(norm360(worldAngle) / (360 / n));
    if (bucket !== lastFretBucket) {
      lastFretBucket = bucket;
      if (spinning) nudgePointerTick();
    }
  }

  function buildWheel() {
    const texts = segmentTexts();
    const n = texts.length;
    const segments = texts.map((text, i) => {
      const fill = segmentColor(i, n);
      return {
        fillStyle: fill,
        text: text.length > 18 ? text.slice(0, 16) + '…' : text,
        textFillStyle: textColorForFill(fill),
        textFontSize: n > 10 ? 12 : n > 8 ? 14 : 15,
        textFontWeight: 'bold',
        // Raised metal pocket frets between segments
        strokeStyle: '#e8c96a',
        lineWidth: 4,
      };
    });

    if (theWheel) {
      try { theWheel.stopAnimation(false); } catch { /* ignore */ }
    }
    killBallTween();

    theWheel = new Winwheel({
      canvasId: 'wheelcanvas',
      numSegments: segments.length,
      outerRadius: 198,
      innerRadius: 48,
      textFontFamily: 'Inter, Segoe UI, Arial, sans-serif',
      textAlignment: 'outer',
      textMargin: 14,
      strokeStyle: '#e8c96a',
      lineWidth: 4,
      clearTheCanvas: true,
      segments,
      // Metal frets / studs on the spinning face (pocket edges + mid-pocket)
      pins: {
        visible: true,
        number: Math.max(n * 4, 28),
        outerRadius: 5.5,
        fillStyle: GOLD_BRIGHT,
        strokeStyle: '#3d2e0a',
        lineWidth: 1.35,
        margin: 1,
      },
      animation: {
        type: 'spinToStop',
        duration: SPIN_DURATION,
        spins: SPIN_TURNS,
        // Milder easeOut so the wheel keeps clockwise motion visible longer
        // (Power4 froze the face early → opposite-ball race looked sedentary)
        easing: 'Power2.easeOut',
        direction: 'clockwise',
        callbackFinished: onSpinFinished,
        // Tick + soft click when wheel frets pass the pointer
        callbackSound: nudgePointerTick,
        soundTrigger: 'pin',
      },
    });

    parkBall();
  }

  function onSpinFinished() {
    spinning = false;
    updateSpinEnabled();
    bouncePointerLand();
    // Snap ball to final pocket under pointer (rotation + stopAngle → top)
    if (theWheel && els.ball) {
      const { pocket } = ballRadii();
      positionBall(theWheel.rotationAngle + ballStopAngle, pocket);
      els.ball.classList.remove('rolling');
      els.ball.classList.add('dropped');
    }
    if (!lastProof) return;

    const { result, signature } = lastProof;
    setTimeout(() => {
      showWinner(result.label, signature, prizeInfoText(lastProof));
      fireConfetti();
    }, 220);

    postToParent({ type: 'prize-wheel:win', result, signature });

    if (window.PrizeWheelTG) {
      window.PrizeWheelTG.onWin(result, signature, autoclose);
    }

    if (window.PrizeWheelTG) window.PrizeWheelTG.sync();
  }

  function prizeInfoText(proof) {
    if (!proof) return '';
    const p = proof.prize || {};
    if (proof.redeemCode) {
      return 'XRP prize! Redeem code: ' + proof.redeemCode + '\nRedeem with your XRPL address at ' +
        location.origin + apiBase() + '/redeem.html';
    }
    if (p.type === 'none') return 'No prize this time — thanks for playing!';
    if (proof.prizeCode) {
      let how = 'Use this code at checkout.';
      if (p.fulfillment === 'manual' || p.fulfillment === 'shop_checkout_or_manual') how = 'Keep this code — we will use it to deliver your prize.';
      return 'Your prize code: ' + proof.prizeCode + '\n' + how;
    }
    return '';
  }

  function showWinner(label, signature, info) {
    els.winnerLabel.textContent = label;
    if (els.prizeCodeInfo) {
      els.prizeCodeInfo.textContent = info || '';
      els.prizeCodeInfo.classList.toggle('hidden', !info);
    }
    const trunc =
      signature.length > 20
        ? signature.slice(0, 10) + '…' + signature.slice(-8)
        : signature;
    els.sigPreview.textContent = trunc;
    els.winnerOverlay.classList.remove('hidden');
  }

  function hideWinner() {
    els.winnerOverlay.classList.add('hidden');
  }

  function fireConfetti() {
    if (typeof confetti !== 'function') return;

    confetti({
      particleCount: 70,
      spread: 78,
      startVelocity: 42,
      origin: { x: 0.5, y: 0.42 },
      colors: CONFETTI_COLORS,
      ticks: 220,
      scalar: 1.05,
    });

    const end = Date.now() + 2200;
    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 58,
        startVelocity: 38,
        origin: { x: 0, y: 0.68 },
        colors: CONFETTI_COLORS,
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 58,
        startVelocity: 38,
        origin: { x: 1, y: 0.68 },
        colors: CONFETTI_COLORS,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();

    setTimeout(() => {
      confetti({
        particleCount: 36,
        spread: 100,
        startVelocity: 22,
        gravity: 0.85,
        origin: { x: 0.5, y: 0.2 },
        colors: [GOLD, GOLD_BRIGHT, '#ffe9a8', '#ffffff'],
        ticks: 260,
        scalar: 0.9,
      });
    }, 700);
  }

  async function requestSpin() {
    const items = currentItems();
    if (items.length < 2 || spinning) return;
    if (showingSamples) return;
    if (!hasAdminSession()) {
      syncViewerSpinMessage();
      alert(ticketCode
        ? 'This spin code has already been used.'
        : 'Admin access required to spin. Open /wheel-staging/admin and enter the admin token.');
      return;
    }

    spinning = true;
    updateSpinEnabled();
    if (window.PrizeWheelTG) window.PrizeWheelTG.sync();
    hideWinner();
    lastProof = null;
    if (els.pointer) els.pointer.classList.remove('tick', 'land');
    try {
      const res = ticketCode
        ? await fetch(apiBase() + '/api/tickets/spin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ code: ticketCode, site: ticketSite || undefined }),
        })
        : await fetch(apiBase() + '/api/spin', {
          method: 'POST',
          headers: spinHeaders(),
          credentials: 'same-origin',
          body: JSON.stringify({ mode: state.mode, items }),
        });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (ticketCode && res.status === 409) { ticketSpent = true; }
        throw new Error(data.error || 'Spin failed');
      }
      if (ticketCode) {
        ticketSpent = true;
        // Server spins over its own prize list; make sure the wheel shows exactly those segments.
        if (Array.isArray(data.result && data.result.items) &&
            JSON.stringify(data.result.items) !== JSON.stringify(state.prizes)) {
          state.prizes = data.result.items.slice();
          updateList();
          buildWheel();
        }
      }
      if (
        !data.result ||
        typeof data.result.index !== 'number' ||
        typeof data.signature !== 'string'
      ) {
        throw new Error('Bad spin response');
      }

      lastProof = {
        result: data.result,
        signature: data.signature,
        prize: data.prize || null,
        prizeCode: data.prizeCode || null,
        redeemCode: data.redeemCode || null,
      };

      // Force wheel to server-chosen segment (Winwheel segments are 1-based)
      const prizeNumber = data.result.index + 1;
      const stopAngle = theWheel.getRandomForSegment(prizeNumber);
      theWheel.animation.duration = SPIN_DURATION;
      theWheel.animation.spins = SPIN_TURNS;
      theWheel.animation.easing = 'Power2.easeOut';
      theWheel.animation.direction = 'clockwise';
      theWheel.animation.stopAngle = stopAngle;

      // Ball opposite-orbit then drop into the SAME stopAngle pocket
      startBallAnimation(stopAngle);
      theWheel.startAnimation();
    } catch (err) {
      spinning = false;
      killBallTween();
      parkBall();
      updateSpinEnabled();
      if (window.PrizeWheelTG) window.PrizeWheelTG.sync();
      alert(err.message || 'Could not spin');
    }
  }

  function addItem() {
    const value = els.itemInput.value.trim();
    if (!value) return;
    const items = currentItems().slice();
    items.push(value);
    setCurrentItems(items);
    els.itemInput.value = '';
    saveState();
    updateList();
    buildWheel();
  }

  function removeItem(index) {
    if (spinning) return;
    const items = currentItems().slice();
    items.splice(index, 1);
    setCurrentItems(items);
    saveState();
    updateList();
    buildWheel();
  }

  function setMode(mode) {
    if (spinning || (mode !== 'names' && mode !== 'prizes')) return;
    state.mode = mode;
    saveState();
    updateTabs();
    updateList();
    buildWheel();
  }

  // Events
  els.addBtn.addEventListener('click', addItem);
  els.itemInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem();
  });
  els.spinBtn.addEventListener('click', () => {
    ensureAudio();
    requestSpin();
  });
  if (els.muteBtn) {
    els.muteBtn.addEventListener('click', toggleMute);
  }
  els.closeOverlay.addEventListener('click', hideWinner);
  els.winnerOverlay.addEventListener('click', (e) => {
    if (e.target === els.winnerOverlay) hideWinner();
  });

  els.modeTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) setMode(btn.dataset.mode);
  });

  els.itemList.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove');
    if (!btn) return;
    removeItem(Number(btn.dataset.i));
  });

  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'prize-wheel:spin') {
      requestSpin();
    }
  });

  window.addEventListener('resize', () => {
    if (!spinning) parkBall();
  });

  // Public API for tg.js
  window.PrizeWheel = {
    spin: requestSpin,
    canSpin: () => hasAdminSession() && !spinning && currentItems().length >= 2 && !showingSamples,
    isSpinning: () => spinning,
  };

  syncMuteUi();
  updateTabs();
  updateList();
  buildWheel();

  /** Configured prize list (admin-managed). Used in ticket mode, and in prizes mode when the
   *  local list was never customised (still the built-in defaults). */
  async function loadServerPrizes() {
    const untouched = JSON.stringify(state.prizes) === JSON.stringify(DEFAULT_PRIZES);
    if (!ticketCode && !untouched) return;
    try {
      const res = await fetch(apiBase() + '/api/prizes', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.labels) || data.labels.length < 2) return;
      state.prizes = data.labels.slice();
      if (ticketCode) {
        const lk = await fetch(apiBase() + '/api/tickets/lookup?code=' + encodeURIComponent(ticketCode));
        const t = await lk.json().catch(() => ({}));
        if (lk.ok && t.used) {
          ticketSpent = true;
          if (t.prizeResult && Array.isArray(t.prizeResult.items)) state.prizes = t.prizeResult.items;
          setTimeout(() => showWinner(t.prizeResult ? t.prizeResult.label : 'Used', t.prizeResult && t.prizeResult.signature || '',
            t.prizeType === 'none' ? 'This spin code was already used (no prize).' :
              t.ledgerRedeemCode ? 'XRP prize — redeem code: ' + t.ledgerRedeemCode :
                'This spin code was already used. Your prize code: ' + t.code), 300);
        } else if (!lk.ok) {
          ticketSpent = true;
          alert('Unknown spin code. Check the link or contact support.');
        }
      }
      if (!spinning) {
        updateTabs();
        updateList();
        buildWheel();
        updateSpinEnabled();
      }
    } catch { /* offline: keep local list */ }
  }
  loadServerPrizes();
})();
