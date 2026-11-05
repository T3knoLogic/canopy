/* Spectra Loom — fictional grove ciphers. Not a depiction of physical hardware. */
(() => {
  const TAU = Math.PI * 2;
  const RING_R = [112, 158, 206];
  const RING_Y = 0.46;
  const RING_COLORS = ["#5ef2ff", "#ff3d8a", "#ffc14d"];
  const NAMES = ["Lantern", "Moss", "Crown", "Static", "Koi", "Relay"];
  const EDGES = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 0],
    [0, 3],
  ];
  const TARGET = new Set(EDGES.map(([a, b]) => edgeKey(a, b)));
  const KEYS = [
    "Click a ring · drag or A / D · Tab changes ring",
    "Click two nodes, drag between them, or press keys 1 to 6",
    "Click a plate · drag · arrows · keys 1 to 4",
    "Click or press Space while TAP is showing",
  ];
  const INTRO = [
    {
      text: "Agent Spot on comms. Black tactical kit, cyan visor lit. This atelier is ours.",
      advance: true,
      briefing: true,
    },
    {
      text: "The seals here are fiction: glyphs, filaments, glass, and a halo. Puzzles we invented. Not hardware.",
      advance: true,
      briefing: true,
    },
    {
      text: "We start with the chord rings.",
      advance: true,
      briefing: true,
    },
  ];
  const PLAY = [
    "Click a ring to take it. Drag to spin, or press A and D. Seat each living glyph on the bright north spoke.",
    "These names are places in a made-up night market. Join every ghost filament. Click a node, then its partner, or drag between them.",
    "Four glass plates float at four depths. Drag one until its aperture covers the core. Farther glass looks smaller. Arrows move the selected plate.",
    "A mote is orbiting. When it enters the halo, TAP appears. Click or press space while it shows. Five crossings finish the seal.",
  ];
  const NUDGE = [
    "That glyph is seated. Bring the other living marks up to the spoke.",
    "A filament held. Follow the remaining ghosts.",
    "That plate covers the core. The other depths still float wide.",
    "Cadence caught. Stay with the halo until five.",
  ];
  const PRAISE = [
    "Chord resolved. Three glyphs, one spoke. The color was the story.",
    "The night market is traced. Every name is tied in light.",
    "The apertures sit on the core. Depth was only distance, and you closed it.",
    "Cadence complete. The halo takes the last note.",
  ];
  const WIN_LINE =
    "The seal is read. A light bonsai opens where the core was. That is the whole prize. Agent Spot, signing off.";

  const canvas = document.getElementById("view");
  const ctx = canvas.getContext("2d", { alpha: false });
  const caption = document.getElementById("caption");
  const statusEl = document.getElementById("status");
  const chamberLabel = document.getElementById("chamberLabel");
  const pips = [...document.querySelectorAll("#pips span")];
  const tapEl = document.getElementById("tap");
  const titleCard = document.getElementById("titleCard");
  const winCard = document.getElementById("winCard");
  const continueBtn = document.getElementById("continue");
  const skipBtn = document.getElementById("skip");
  const repeatBtn = document.getElementById("repeat");
  const resetBtn = document.getElementById("reset");
  const keysEl = document.getElementById("keys");
  const voiceBtn = document.getElementById("voice");
  const soundBtn = document.getElementById("sound");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    rings: [2, 5, 7],
    plates: freshPlates(),
    edges: new Set(),
    hits: 0,
    cadenceAngle: -Math.PI / 2 - 1.15,
  };

  let mode = "title";
  let chamber = 0;
  let cleared = false;
  let pendingPraise = false;
  let nudged = false;
  let missCoach = false;
  let selectedRing = 2;
  let selectedPlate = 0;
  let armed = null;
  let drag = null;
  let queue = [];
  let line = null;
  let lastText = caption.textContent;
  let speaking = false;
  let speakGen = 0;
  let voiceOn = true;
  let soundOn = true;
  let advanceTimer = 0;
  let statusUntil = 0;
  let t = 0;
  let w = 1;
  let h = 1;
  let u = 1;
  let cx = 0;
  let cy = 0;
  let spotX = null;
  let spotY = null;
  let walk = 0;
  let hop = 0;
  let winT = 0;
  let lastTap = 0;
  let misses = 0;
  const mouse = { nx: 0.5, ny: 0.5, x: 0, y: 0 };
  const sparks = [];
  const trail = [];
  const drops = Array.from({ length: reduce ? 24 : 80 }, () => ({
    x: Math.random(),
    y: Math.random(),
    z: 0.3 + Math.random() * 0.7,
    v: 0.25 + Math.random() * 0.7,
  }));
  const buildings = makeCity();
  let audio = null;
  let drone = null;

  document.getElementById("begin").addEventListener("click", start);
  document.getElementById("again").addEventListener("click", () => {
    winCard.hidden = true;
    enter(0);
  });
  voiceBtn.addEventListener("click", () => {
    voiceOn = !voiceOn;
    voiceBtn.textContent = voiceOn ? "Voice on" : "Voice off";
    if (!voiceOn) {
      speakGen++;
      window.speechSynthesis?.cancel();
    } else repeat();
  });
  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? "Sound on" : "Sound off";
    if (soundOn) startAmbient();
    else stopAmbient();
  });
  continueBtn.addEventListener("click", skipLine);
  skipBtn.addEventListener("click", () => say([PLAY[chamber]]));
  repeatBtn.addEventListener("click", repeat);
  resetBtn.addEventListener("click", () => {
    if (mode !== "play") return;
    say([PLAY[chamber]]);
    resetPuzzle(chamber);
    cleared = false;
    pendingPraise = false;
    nudged = false;
  });
  caption.addEventListener("click", () => {
    if (line?.advance) skipLine();
  });

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey);
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => {});

  requestAnimationFrame(frame);

  function start() {
    titleCard.hidden = true;
    repeatBtn.hidden = false;
    resetBtn.hidden = false;
    canvas.focus();
    ensureAudio();
    startAmbient();
    enter(0);
  }

  function enter(index) {
    mode = "play";
    chamber = index;
    winCard.hidden = true;
    cleared = false;
    pendingPraise = false;
    nudged = false;
    missCoach = false;
    misses = 0;
    armed = null;
    drag = null;
    hop = 1;
    resetPuzzle(index);
    if (index === 0) say(INTRO.concat([PLAY[0]]));
    else say([PLAY[index]]);
  }

  function resetPuzzle(index) {
    if (index === 0) {
      state.rings = [2, 5, 7];
      selectedRing = 2;
    } else if (index === 1) {
      state.edges = new Set();
      armed = null;
    } else if (index === 2) {
      state.plates = freshPlates();
      selectedPlate = 0;
    } else if (index === 3) {
      state.hits = 0;
      state.cadenceAngle = -Math.PI / 2 - 1.15;
      trail.length = 0;
    }
  }

  function freshPlates() {
    return [
      { x: 110, y: -40, layer: 0 },
      { x: -90, y: 60, layer: 1 },
      { x: 70, y: 80, layer: 2 },
      { x: -120, y: -70, layer: 3 },
    ];
  }

  function say(lines) {
    queue = lines.map((item) => (typeof item === "string" ? { text: item, advance: false } : { ...item }));
    invalidateSpeech();
    pump();
  }

  function invalidateSpeech() {
    speakGen += 1;
    speaking = false;
    line = null;
    clearTimeout(advanceTimer);
    try {
      window.speechSynthesis?.cancel();
    } catch (err) {
      /* ignore */
    }
  }

  function pump() {
    if (speaking) return;
    const next = queue.shift();
    if (!next) return;
    line = next;
    lastText = next.text;
    caption.textContent = next.text;
    continueBtn.hidden = !next.advance;
    speaking = true;
    const token = speakGen;
    const finish = () => {
      if (token !== speakGen) return;
      speaking = false;
      finishLine();
    };
    if (voiceOn && window.speechSynthesis) utter(next.text, token, finish);
    else advanceTimer = setTimeout(finish, Math.min(7000, 900 + next.text.length * 34));
  }

  function utter(text, token, ondone) {
    let fired = false;
    const done = () => {
      if (fired || token !== speakGen) return;
      fired = true;
      clearTimeout(timer);
      ondone();
    };
    const timer = setTimeout(done, 2200 + text.length * 70);
    setTimeout(() => {
      if (token !== speakGen || !window.speechSynthesis) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.03;
      utterance.pitch = 1.06;
      utterance.lang = "en-US";
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => /en-US/i.test(v.lang) && /Jenny|Aria|Guy|Natural/i.test(v.name)) ||
        voices.find((v) => /^en/i.test(v.lang));
      if (preferred) utterance.voice = preferred;
      utterance.onend = done;
      utterance.onerror = (event) => {
        if (event.error === "interrupted" || event.error === "canceled") return;
        done();
      };
      window.speechSynthesis.speak(utterance);
    }, 60);
  }

  function finishLine() {
    const done = line;
    line = null;
    continueBtn.hidden = true;
    if (done?.then === "next") return nextChamber();
    if (done?.then === "win") return showWin();
    if (done?.advance) return pump();
    tryPraise();
  }

  function skipLine() {
    if (!line?.advance) return;
    speakGen += 1;
    speaking = false;
    clearTimeout(advanceTimer);
    try {
      window.speechSynthesis?.cancel();
    } catch (err) {
      /* ignore */
    }
    finishLine();
  }

  function repeat() {
    const text = line?.text || lastText;
    if (!text) return;
    caption.textContent = text;
    if (!voiceOn || !window.speechSynthesis) return;
    speakGen += 1;
    const token = speakGen;
    speaking = true;
    utter(text, token, () => {
      if (token !== speakGen) return;
      speaking = false;
      if (line?.advance) finishLine();
    });
  }

  function tryPraise() {
    if (!pendingPraise || speaking || queue.length) return;
    pendingPraise = false;
    const last = chamber >= 3;
    say([
      {
        text: PRAISE[chamber],
        advance: true,
        then: last ? "win" : "next",
      },
    ]);
  }

  function maybeNudge() {
    if (nudged || cleared || pendingPraise || speaking || queue.length) return;
    nudged = true;
    say([NUDGE[chamber]]);
  }

  function onSolved() {
    if (cleared || mode !== "play") return;
    cleared = true;
    armed = null;
    drag = null;
    hop = 1;
    chime();
    burstAt(origin().x, origin().y, "#ffc14d");
    pendingPraise = true;
    tryPraise();
  }

  function nextChamber() {
    if (chamber >= 3) return showWin();
    enter(chamber + 1);
  }

  function showWin() {
    mode = "win";
    winT = reduce ? 1 : 0;
    winCard.hidden = false;
    tapEl.hidden = true;
    say([WIN_LINE]);
  }

  function onDown(event) {
    const point = localPoint(event);
    mouse.x = point.x;
    mouse.y = point.y;
    if (mode === "title") return;
    if (hitSpot(point)) {
      repeat();
      return;
    }
    if (mode !== "play" || cleared) return;
    if (chamber === 0) {
      const ring = hitRing(point);
      if (ring >= 0) {
        selectedRing = ring;
        const originPoint = origin();
        drag = {
          type: "ring",
          ring,
          last: Math.atan2((point.y - originPoint.y) / RING_Y, point.x - originPoint.x),
          accum: 0,
        };
        try { canvas.setPointerCapture?.(event.pointerId); } catch (err) { /* untrusted pointer */ }
      }
    } else if (chamber === 1) {
      const node = hitNode(point);
      if (node >= 0) {
        drag = { type: "node", node, x: point.x, y: point.y, moved: false };
        try { canvas.setPointerCapture?.(event.pointerId); } catch (err) { /* untrusted pointer */ }
      }
    } else if (chamber === 2) {
      const plate = hitPlate(point);
      if (plate >= 0) {
        selectedPlate = plate;
        drag = { type: "plate", plate, x: point.x, y: point.y };
        try { canvas.setPointerCapture?.(event.pointerId); } catch (err) { /* untrusted pointer */ }
      }
    } else if (chamber === 3) {
      tapCadence();
    }
  }

  function onMove(event) {
    const point = localPoint(event);
    mouse.x = point.x;
    mouse.y = point.y;
    mouse.nx = point.x / Math.max(1, w);
    mouse.ny = point.y / Math.max(1, h);
    if (!drag || cleared) return;
    if (drag.type === "ring") {
      const originPoint = origin();
      const angle = Math.atan2((point.y - originPoint.y) / RING_Y, point.x - originPoint.x);
      let delta = angle - drag.last;
      if (delta > Math.PI) delta -= TAU;
      if (delta < -Math.PI) delta += TAU;
      drag.last = angle;
      drag.accum += delta;
      const step = TAU / 8;
      while (drag.accum > step / 2) {
        state.rings[drag.ring] += 1;
        drag.accum -= step;
        detent(drag.ring);
        checkRings();
      }
      while (drag.accum < -step / 2) {
        state.rings[drag.ring] -= 1;
        drag.accum += step;
        detent(drag.ring);
        checkRings();
      }
    } else if (drag.type === "plate") {
      movePlate(drag.plate, point.x - drag.x, point.y - drag.y);
      drag.x = point.x;
      drag.y = point.y;
    } else if (drag.type === "node") {
      if (Math.hypot(point.x - drag.x, point.y - drag.y) > 6) drag.moved = true;
      drag.x = point.x;
      drag.y = point.y;
    }
  }

  function onUp(event) {
    if (!drag) return;
    const point = localPoint(event);
    if (drag.type === "node" && !cleared) {
      const node = hitNode(point);
      if (!drag.moved) {
        armNode(drag.node);
      } else if (node >= 0 && node !== drag.node) {
        connect(drag.node, node);
        armed = null;
      }
    }
    drag = null;
  }

  function onKey(event) {
    const onButton = event.target instanceof HTMLButtonElement && !event.target.hidden;
    if (onButton) return;
    if (event.code === "Space" || event.code === "ArrowUp" || event.code === "ArrowDown") event.preventDefault();
    if (mode !== "play" || cleared) return;
    if (chamber === 0) {
      if (event.code === "Tab") {
        event.preventDefault();
        selectedRing = (selectedRing + (event.shiftKey ? 2 : 1)) % 3;
      } else if (event.code === "KeyA" || event.code === "ArrowLeft") {
        state.rings[selectedRing] -= 1;
        detent(selectedRing);
        checkRings();
      } else if (event.code === "KeyD" || event.code === "ArrowRight") {
        state.rings[selectedRing] += 1;
        detent(selectedRing);
        checkRings();
      }
    } else if (chamber === 1) {
      const nodeKey = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5 }[event.code];
      if (nodeKey != null) armNode(nodeKey);
    } else if (chamber === 2) {
      const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[event.code];
      if (digit != null) selectedPlate = digit;
      const amount = event.shiftKey ? 8 : 18;
      if (event.code === "ArrowLeft") movePlate(selectedPlate, -amount, 0);
      if (event.code === "ArrowRight") movePlate(selectedPlate, amount, 0);
      if (event.code === "ArrowUp") movePlate(selectedPlate, 0, -amount);
      if (event.code === "ArrowDown") movePlate(selectedPlate, 0, amount);
    } else if (chamber === 3 && event.code === "Space") {
      tapCadence();
    }
  }

  function checkRings() {
    const count = state.rings.reduce((sum, step) => sum + (normStep(step) === 0 ? 1 : 0), 0);
    if (count >= 3) onSolved();
    else if (count === 1) maybeNudge();
  }

  function armNode(index) {
    if (armed == null) armed = index;
    else if (armed === index) armed = null;
    else {
      connect(armed, index);
      armed = null;
    }
  }

  function connect(a, b) {
    const key = edgeKey(a, b);
    if (!TARGET.has(key)) {
      status("That link fades. It is not in the market story.");
      tone(150, 0.12, "sawtooth", 0.03);
      const first = nodePoint(a);
      const second = nodePoint(b);
      burstAt((first.x + second.x) / 2, (first.y + second.y) / 2, "#ff3d8a");
      return;
    }
    if (state.edges.has(key)) return;
    state.edges.add(key);
    tone(680, 0.08, "sine", 0.045);
    const mid = nodePoint(a);
    burstAt(mid.x, mid.y, "#5ef2ff");
    if (state.edges.size === 1) maybeNudge();
    if (state.edges.size === TARGET.size) onSolved();
  }

  function movePlate(index, dx, dy) {
    const plate = state.plates[index];
    const scale = plateScale(plate);
    plate.x = clamp(plate.x + dx / scale, -260, 260);
    plate.y = clamp(plate.y + dy / (scale * 0.82), -200, 200);
    checkPlates();
  }

  function checkPlates() {
    const count = state.plates.filter(plateAligned).length;
    if (count >= 4) onSolved();
    else if (count === 1) maybeNudge();
  }

  function tapCadence() {
    const now = performance.now();
    if (now - lastTap < 180) return;
    lastTap = now;
    if (gateOpen()) {
      state.hits += 1;
      tone(520 + state.hits * 40, 0.09, "triangle", 0.05);
      burstAt(motePoint().x, motePoint().y, "#ffc14d");
      if (state.hits === 1) maybeNudge();
      if (state.hits >= 5) onSolved();
    } else {
      misses += 1;
      tone(110, 0.08, "sine", 0.03);
      status("The halo is dark. Wait for TAP.");
      if (misses >= 2 && !missCoach && !speaking && !queue.length && !cleared) {
        missCoach = true;
        say(["Hold until TAP appears, then click or press space."]);
      }
    }
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - (frame.last || now)) / 1000);
    frame.last = now;
    if (!reduce) t += dt;
    else t += dt * 0.15;
    try {
      layout();
      update(dt);
      render();
    } catch (err) {
      window.__loomError = String(err && err.stack ? err.stack : err);
    }
    requestAnimationFrame(frame);
  }

  function update(dt) {
    const target = spotTarget();
    if (spotX == null) {
      spotX = target.x;
      spotY = target.y;
    }
    const dx = target.x - spotX;
    const dy = target.y - spotY;
    spotX += dx * Math.min(1, dt * 2.4);
    spotY += dy * Math.min(1, dt * 2.4);
    if (Math.hypot(dx, dy) > 4) walk += dt * 9;
    hop = Math.max(0, hop - dt * 1.6);
    if (mode === "win" && winT < 1) winT = Math.min(1, winT + dt * 0.35);
    if (mode === "play" && chamber === 3 && !cleared) {
      state.cadenceAngle += dt * (0.75 + state.hits * 0.13);
      trail.push(motePoint());
      if (trail.length > 12) trail.shift();
    }
    for (const drop of drops) {
      drop.y += drop.v * dt * (0.35 + drop.z);
      if (drop.y > 1.05) {
        drop.y = -0.05;
        drop.x = Math.random();
      }
    }
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.life -= dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      if (spark.life <= 0) sparks.splice(i, 1);
    }
    if (statusUntil && performance.now() > statusUntil) {
      statusEl.textContent = "";
      statusUntil = 0;
    }
    updateHud();
  }

  function updateHud() {
    if (mode === "title") chamberLabel.textContent = "Atelier";
    else if (mode === "win") chamberLabel.textContent = "Seal read";
    else if (chamber === 0) chamberLabel.textContent = `Chord Rings · ${countRings()}/3 seated`;
    else if (chamber === 1) chamberLabel.textContent = `Night Market · ${state.edges.size}/${TARGET.size} filaments`;
    else if (chamber === 2) chamberLabel.textContent = `Depth Plates · ${state.plates.filter(plateAligned).length}/4 aligned`;
    else chamberLabel.textContent = `Halo Cadence · ${state.hits}/5`;
    pips.forEach((pip, index) => {
      pip.className = "";
      if (mode === "win" || index < chamber) pip.classList.add("done");
      else if (mode === "play" && index === chamber) pip.classList.add("on");
    });
    const showTap = mode === "play" && chamber === 3 && !cleared && gateOpen();
    tapEl.hidden = !showTap;
    skipBtn.hidden = !(line?.briefing || queue.some((item) => item.briefing));
    keysEl.textContent = mode === "play" ? KEYS[chamber] : "";
  }

  function render() {
    const originPoint = origin();
    ctx.fillStyle = "#07080c";
    ctx.fillRect(0, 0, w, h);
    drawSky();
    drawCity();
    drawRail();
    drawTrees();
    drawRain(0.35);
    drawFloor();
    drawSpotlight(originPoint);
    drawPedestal(originPoint);
    drawCore(originPoint, mode === "win" ? 1.4 : 1);
    if (mode !== "play" || chamber !== 2) drawAmbientShards(originPoint);
    if (mode === "title") drawRings(originPoint, true);
    else if (chamber === 0 || mode === "win") drawRings(originPoint, false);
    else drawRings(originPoint, false, 0.18);
    if (mode === "play" && chamber === 1) drawFilaments(originPoint);
    if (mode === "play" && chamber === 2) drawPlates();
    if (mode === "play" && chamber === 3) drawCadence(originPoint);
    if (mode === "win") drawBonsai(originPoint);
    drawSparks();
    drawSpot();
    drawRain(1);
  }

  function drawSky() {
    const gradient = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    gradient.addColorStop(0, "#10131c");
    gradient.addColorStop(0.45, "#14101a");
    gradient.addColorStop(1, "#07080c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255, 61, 138, 0.08)";
    ctx.beginPath();
    ctx.ellipse(w * 0.78, h * 0.18, 180 * u, 70 * u, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(94, 242, 255, 0.06)";
    ctx.beginPath();
    ctx.ellipse(w * 0.22, h * 0.16, 140 * u, 50 * u, 0, 0, TAU);
    ctx.fill();
  }

  function drawCity() {
    const par = (mouse.nx - 0.5) * 18;
    for (const building of buildings) {
      const x = building.x * w + par * 0.35;
      const bw = building.bw * w;
      const bh = building.bh * h;
      const y = h * 0.62 - bh;
      ctx.fillStyle = building.accent ? "#1a1422" : "#141820";
      ctx.fillRect(x, y, bw, bh + 8);
      ctx.fillStyle = "rgba(94, 242, 255, 0.18)";
      ctx.fillRect(x, y, bw, 2);
      for (const win of building.wins) {
        const flicker = Math.sin(t * win.speed + win.phase) > win.gate;
        ctx.globalAlpha = flicker ? 0.9 : 0.25;
        ctx.fillStyle = win.hot ? "#ff3d8a" : "#9af6ff";
        ctx.fillRect(x + win.fx * bw, y + win.fy * bh, Math.max(2, bw * 0.08), Math.max(3, bh * 0.035));
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawRail() {
    const y = h * 0.2;
    ctx.strokeStyle = "rgba(94, 242, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    const head = ((t * 0.08) % 1) * (w + 80) - 40;
    ctx.strokeStyle = "#5ef2ff";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(head - 26, y);
    ctx.lineTo(head, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawTrees() {
    drawTree(w * 0.08 + (mouse.nx - 0.5) * 10, h * 0.64, 78 * u, -Math.PI / 2, 5);
    drawTree(w * 0.93 + (mouse.nx - 0.5) * 14, h * 0.66, 64 * u, -Math.PI / 2, 4);
  }

  function drawTree(x, y, len, angle, depth) {
    if (depth === 0 || len < 6) {
      ctx.fillStyle = depth % 2 ? "#5ef2ff" : "#ff3d8a";
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x - 1, y - 1, 2, 2);
      ctx.globalAlpha = 1;
      return;
    }
    const sway = Math.sin(t * 0.7 + depth) * 0.05;
    const x2 = x + Math.cos(angle + sway) * len;
    const y2 = y + Math.sin(angle + sway) * len;
    ctx.strokeStyle = depth > 3 ? "#1a2230" : "#2a3848";
    ctx.lineWidth = Math.max(1, depth * 0.7);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    drawTree(x2, y2, len * 0.72, angle - 0.55, depth - 1);
    drawTree(x2, y2, len * 0.66, angle + 0.5, depth - 1);
  }

  function drawRain(alpha) {
    ctx.strokeStyle = `rgba(190, 220, 235, ${0.28 * alpha})`;
    ctx.lineWidth = 1;
    for (const drop of drops) {
      if ((alpha < 1 && drop.z > 0.65) || (alpha === 1 && drop.z <= 0.65)) continue;
      const x = drop.x * w + (mouse.nx - 0.5) * 8 * drop.z;
      const y = drop.y * h;
      ctx.globalAlpha = 0.25 + drop.z * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 10 * drop.z);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloor() {
    const gradient = ctx.createLinearGradient(0, h * 0.58, 0, h);
    gradient.addColorStop(0, "rgba(8, 10, 16, 0)");
    gradient.addColorStop(0.18, "#10131a");
    gradient.addColorStop(1, "#07080c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, h * 0.58, w, h * 0.42);
    ctx.strokeStyle = "rgba(94, 242, 255, 0.16)";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    ctx.lineTo(w, h * 0.62);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, h * 0.62, w, h);
    ctx.clip();
    ctx.strokeStyle = "rgba(94, 242, 255, 0.07)";
    ctx.lineWidth = 1;
    const horizon = h * 0.62;
    for (let i = -10; i <= 10; i += 1) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 28, horizon);
      ctx.lineTo(cx + i * 220, h);
      ctx.stroke();
    }
    for (let i = 1; i <= 7; i += 1) {
      const y = horizon + (h - horizon) * (i / 7) ** 1.7;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpotlight(originPoint) {
    const glow = ctx.createRadialGradient(originPoint.x, originPoint.y, 10 * u, originPoint.x, originPoint.y, 460 * u);
    glow.addColorStop(0, "rgba(94, 242, 255, 0.2)");
    glow.addColorStop(0.45, "rgba(255, 61, 138, 0.06)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    const spotGlow = ctx.createRadialGradient(spotX || 0, (spotY || h) - 40 * u, 8, spotX || 0, (spotY || h) - 40 * u, 160 * u);
    spotGlow.addColorStop(0, "rgba(94, 242, 255, 0.16)");
    spotGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = spotGlow;
    ctx.beginPath();
    ctx.arc(spotX || 0, (spotY || h) - 50 * u, 160 * u, 0, TAU);
    ctx.fill();
  }

  function drawPedestal(originPoint) {
    ctx.fillStyle = "#12151c";
    ctx.beginPath();
    ctx.moveTo(originPoint.x - 74 * u, originPoint.y + 24 * u);
    ctx.lineTo(originPoint.x + 74 * u, originPoint.y + 24 * u);
    ctx.lineTo(originPoint.x + 120 * u, h * 0.8);
    ctx.lineTo(originPoint.x - 120 * u, h * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(94, 242, 255, 0.35)";
    ctx.stroke();
    const sheen = ctx.createRadialGradient(originPoint.x, h * 0.8, 8, originPoint.x, h * 0.8, 160 * u);
    sheen.addColorStop(0, "rgba(94, 242, 255, 0.16)");
    sheen.addColorStop(1, "rgba(94, 242, 255, 0)");
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.ellipse(originPoint.x, h * 0.8, 160 * u, 22 * u, 0, 0, TAU);
    ctx.fill();
  }

  function drawCore(originPoint, scale) {
    const radius = 78 * u * scale;
    const gradient = ctx.createRadialGradient(originPoint.x, originPoint.y, 2, originPoint.x, originPoint.y, radius);
    const pulse = 0.75 + Math.sin(t * 2.4) * 0.25;
    gradient.addColorStop(0, `rgba(255, 248, 230, ${0.9 * pulse})`);
    gradient.addColorStop(0.25, "rgba(94, 242, 255, 0.45)");
    gradient.addColorStop(1, "rgba(94, 242, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(originPoint.x, originPoint.y, radius, 0, TAU);
    ctx.fill();
  }

  function drawRings(originPoint, spinning, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(originPoint.x, originPoint.y);
    ctx.lineTo(originPoint.x, originPoint.y - 230 * u * RING_Y - 16);
    ctx.stroke();
    ctx.fillStyle = "#ffc14d";
    ctx.beginPath();
    ctx.moveTo(originPoint.x, originPoint.y - 248 * u * RING_Y);
    ctx.lineTo(originPoint.x - 6, originPoint.y - 236 * u * RING_Y);
    ctx.lineTo(originPoint.x + 6, originPoint.y - 236 * u * RING_Y);
    ctx.fill();
    for (let i = RING_R.length - 1; i >= 0; i -= 1) {
      const rotation = spinning ? t * (0.15 + i * 0.05) : -Math.PI / 2 + normStep(state.rings[i]) * (TAU / 8);
      const seated = !spinning && normStep(state.rings[i]) === 0;
      const selected = mode === "play" && chamber === 0 && i === selectedRing;
      drawEllipseRing(originPoint, RING_R[i] * u, RING_COLORS[i], selected, seated);
      for (let glyph = 0; glyph < 8; glyph += 1) {
        const point = ringPoint(originPoint, i, rotation, glyph);
        if (glyph === 0) drawBloom(point.x, point.y, 8 * u, RING_COLORS[i], seated);
        else drawMark(point.x, point.y, glyph, "rgba(180, 200, 214, 0.45)");
      }
    }
    if (mode === "play" && chamber === 0) {
      for (let i = 0; i < 3; i += 1) {
        const seated = normStep(state.rings[i]) === 0;
        ctx.beginPath();
        ctx.fillStyle = seated ? RING_COLORS[i] : "rgba(255,255,255,0.16)";
        ctx.arc(originPoint.x - 28 + i * 28, originPoint.y + 48 * u, 6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawEllipseRing(originPoint, radius, color, selected, seated) {
    ctx.save();
    ctx.translate(originPoint.x, originPoint.y);
    ctx.scale(1, RING_Y);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.strokeStyle = "#121722";
    ctx.lineWidth = 16 * Math.max(1, u * 0.75);
    ctx.stroke();
    ctx.shadowColor = color;
    ctx.shadowBlur = (selected || seated ? 22 : 12) * u;
    ctx.strokeStyle = color;
    ctx.globalAlpha = seated ? 1 : 0.9;
    ctx.lineWidth = (selected ? 7 : 5) * Math.max(1, u * 0.7);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, t * 0.6, t * 0.6 + 0.7);
    ctx.stroke();
    ctx.restore();
  }

  function drawFilaments() {
    for (const [a, b] of EDGES) {
      const key = edgeKey(a, b);
      const live = state.edges.has(key);
      strokeCurve(nodePoint(a), nodePoint(b), live ? "#5ef2ff" : "rgba(255,193,77,0.35)", live ? 3 : 1.2, !live);
    }
    if (drag?.type === "node") {
      strokeCurve(nodePoint(drag.node), { x: drag.x, y: drag.y }, "rgba(94,242,255,0.8)", 2, false);
    }
    NAMES.forEach((name, index) => {
      const point = nodePoint(index);
      const linked = [...state.edges].some((key) => key.split("-").includes(String(index)));
      ctx.beginPath();
      ctx.fillStyle = armed === index ? "#ffc14d" : "#071016";
      ctx.strokeStyle = linked ? "#5ef2ff" : "#ffc14d";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#5ef2ff";
      ctx.shadowBlur = armed === index ? 16 : 0;
      ctx.arc(point.x, point.y, 16 * u, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#e7f7ff";
      ctx.font = `${12 * Math.max(0.8, u)}px Bahnschrift, Segoe UI, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(name, point.x, point.y - 22 * u);
    });
  }

  function drawPlates() {
    const ordered = [...state.plates].sort((a, b) => b.layer - a.layer);
    for (const plate of ordered) {
      const view = plateScreen(plate);
      const aligned = plateAligned(plate);
      const selected = state.plates[selectedPlate] === plate;
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.globalAlpha = 0.92;
      roundRect(-view.w / 2, -view.h / 2, view.w, view.h, 10);
      ctx.fillStyle = aligned ? "rgba(10, 18, 24, 0.35)" : "rgba(10, 14, 20, 0.62)";
      ctx.fill();
      ctx.strokeStyle = selected ? "#ffffff" : RING_COLORS[plate.layer % 3];
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.shadowColor = RING_COLORS[plate.layer % 3];
      ctx.shadowBlur = aligned ? 18 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.clip();
      ctx.strokeStyle = "rgba(94, 242, 255, 0.28)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i += 1) {
        const y = -view.h / 2 + 16 + i * 18;
        ctx.beginPath();
        ctx.moveTo(-view.w / 2 + 10, y);
        ctx.lineTo(-view.w / 4, y);
        ctx.lineTo(-view.w / 4, y + 10);
        ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.fillStyle = aligned ? "#fff8e4" : "rgba(94,242,255,0.25)";
      ctx.shadowColor = aligned ? "#fff" : "#5ef2ff";
      ctx.shadowBlur = aligned ? 16 : 0;
      ctx.arc(view.x, view.y, aligned ? 10 : 7, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawAmbientShards(originPoint) {
    for (let i = 0; i < 3; i += 1) {
      const angle = t * 0.15 + i * 2.1;
      const x = originPoint.x + Math.cos(angle) * (250 + i * 16) * u;
      const y = originPoint.y + Math.sin(angle * 0.8) * 70 * u - 30;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = i === 1 ? "#ff3d8a" : "#5ef2ff";
      ctx.strokeRect(-28 * u, -16 * u, 56 * u, 32 * u);
      ctx.restore();
    }
  }

  function drawCadence(originPoint) {
    ctx.save();
    ctx.translate(originPoint.x, originPoint.y);
    ctx.scale(1, RING_Y);
    ctx.beginPath();
    ctx.strokeStyle = gateOpen() && chamber === 3 && mode === "play" ? "#ffffff" : "rgba(255,193,77,0.75)";
    ctx.lineWidth = 8;
    ctx.shadowColor = "#ffc14d";
    ctx.shadowBlur = 12;
    ctx.arc(0, 0, 188 * u, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "rgba(94,242,255,0.35)";
    for (let i = 0; i < trail.length; i += 1) {
      const point = trail[i];
      ctx.globalAlpha = i / trail.length;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const mote = motePoint();
    ctx.fillStyle = "#fff6d8";
    ctx.shadowColor = "#ffc14d";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(mote.x, mote.y, 7 * u, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawBonsai(originPoint) {
    const grow = winT;
    branch(originPoint.x, originPoint.y + 10, 70 * u * grow, -Math.PI / 2, 6, grow);
  }

  function branch(x, y, len, angle, depth, grow) {
    if (depth === 0 || len < 4 || grow <= 0.02) {
      ctx.fillStyle = depth % 2 ? "#ff3d8a" : "#5ef2ff";
      ctx.globalAlpha = grow;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;
    ctx.strokeStyle = "#d8fff8";
    ctx.globalAlpha = 0.35 + grow * 0.6;
    ctx.lineWidth = Math.max(1, depth * 0.45);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    branch(x2, y2, len * 0.72, angle - 0.5, depth - 1, grow);
    branch(x2, y2, len * 0.68, angle + 0.48, depth - 1, grow);
  }

  function drawSpot() {
    const moving = Math.hypot(spotTarget().x - spotX, spotTarget().y - spotY) > 6;
    const talking = speaking;
    const bob = Math.sin(t * 2.2) * 2 - Math.sin(Math.min(1, hop) * Math.PI) * 16;
    const step = Math.sin(walk);
    const s = u * 1.35;
    ctx.save();
    ctx.translate(spotX, spotY + bob);
    ctx.scale(s, s);
    ctx.fillStyle = "rgba(94, 242, 255, 0.14)";
    ctx.beginPath();
    ctx.ellipse(8, -46, 46, 58, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(6, 6, 48, 10, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "#12151c";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-30, -30);
    const wag = Math.sin(t * (talking ? 6 : 3)) * 10;
    ctx.quadraticCurveTo(-62, -48 + wag, -74, -16 + wag);
    ctx.stroke();
    ctx.fillStyle = "#5ef2ff";
    ctx.shadowColor = "#5ef2ff";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(-74, -16 + wag, 3.2, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#0c0e12";
    roundRect(-22, -8, 12, 22 + step * 4, 3);
    ctx.fill();
    roundRect(16, -8, 11, 22 - step * 4, 3);
    ctx.fill();

    ctx.fillStyle = "#0e1116";
    ctx.beginPath();
    ctx.moveTo(-28, -36);
    ctx.lineTo(18, -28);
    ctx.lineTo(10, -8);
    ctx.lineTo(-32, -14);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#10141c";
    ctx.beginPath();
    ctx.ellipse(0, -40, 34, 20, -0.15, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#222838";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(94,242,255,0.85)";
    ctx.beginPath();
    ctx.moveTo(-16, -50);
    ctx.lineTo(20, -34);
    ctx.stroke();
    ctx.fillStyle = "#ff3d8a";
    ctx.globalAlpha = talking ? 0.35 + Math.abs(Math.sin(t * 10)) * 0.65 : 0.85;
    ctx.fillRect(14, -48, 5, 4);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#0c0e12";
    ctx.beginPath();
    ctx.arc(26, -60, 16, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(16, -70);
    ctx.lineTo(8, -96 - (talking ? Math.sin(t * 9) * 2 : 0));
    ctx.lineTo(24, -72);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(30, -72);
    ctx.lineTo(40, -98);
    ctx.lineTo(42, -70);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(38, -56, 8, 5, 0.3, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#070b10";
    roundRect(16, -66, 24, 9, 3);
    ctx.fill();
    ctx.fillStyle = "#5ef2ff";
    ctx.shadowColor = "#5ef2ff";
    ctx.shadowBlur = talking ? 16 : 8;
    roundRect(18, -64, 20, talking ? 4 + Math.sin(t * 14) : 4, 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "#5ef2ff";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(12, -74);
    ctx.lineTo(4, -88);
    ctx.stroke();
    ctx.fillStyle = Math.sin(t * 5) > 0 ? "#ffc14d" : "#5ef2ff";
    ctx.beginPath();
    ctx.arc(4, -88, 2, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(94,242,255,0.9)";
    ctx.beginPath();
    ctx.arc(28, -16, 9, 0, TAU);
    ctx.moveTo(28, -22);
    ctx.lineTo(28, -10);
    ctx.moveTo(22, -16);
    ctx.lineTo(34, -16);
    ctx.stroke();
    ctx.restore();
  }

  function drawSparks() {
    for (const spark of sparks) {
      ctx.globalAlpha = Math.max(0, spark.life * 2);
      ctx.fillStyle = spark.color;
      ctx.fillRect(spark.x, spark.y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawBloom(x, y, radius, color, seated) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.fillStyle = seated ? color : "transparent";
    ctx.lineWidth = 1.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = seated ? 12 : 0;
    ctx.beginPath();
    for (let i = 0; i < 4; i += 1) {
      ctx.ellipse(0, 0, radius, radius * 0.42, (i * Math.PI) / 4, 0, TAU);
    }
    ctx.stroke();
    if (seated) ctx.fill();
    ctx.restore();
  }

  function drawMark(x, y, kind, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (kind % 4 === 1) {
      ctx.arc(0, 0, 4, Math.PI, TAU);
    } else if (kind % 4 === 2) {
      ctx.moveTo(-4, 3);
      ctx.lineTo(0, -4);
      ctx.lineTo(4, 3);
    } else if (kind % 4 === 3) {
      ctx.rect(-3, -3, 6, 6);
    } else {
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
    }
    ctx.stroke();
    ctx.restore();
  }

  function strokeCurve(a, b, color, width, dashed) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dashed) ctx.setLineDash([5, 6]);
    ctx.shadowColor = color;
    ctx.shadowBlur = dashed ? 0 : 10;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2 - 28 * u;
    ctx.quadraticCurveTo(midX, midY, b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function layout() {
    const nextW = canvas.clientWidth || window.innerWidth;
    const nextH = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.floor(nextW * dpr);
    const ph = Math.floor(nextH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    w = nextW;
    h = nextH;
    u = clamp(Math.min(w / 1040, (h - 210) / 640), 0.55, 1.25);
    const reach = 270 * u;
    const wanted = w < 900 ? w * 0.5 : w * (mode === "title" ? 0.6 : 0.56);
    cx = clamp(wanted, reach + 16, w - reach - 16);
    cy = h < 700 ? h * 0.42 : h * 0.46;
  }

  function origin() {
    return {
      x: cx + (mouse.nx - 0.5) * 16,
      y: cy + (mouse.ny - 0.5) * 10,
    };
  }

  function spotTarget() {
    if (mode === "title") return { x: cx - 36 * u, y: Math.min(h * 0.74, cy + 170 * u) };
    if (w < 820) return { x: w * 0.18, y: h * 0.8 };
    return { x: Math.max(90, Math.min(w * 0.16, cx - 320 * u)), y: h * 0.76 };
  }

  function ringPoint(originPoint, index, rotation, glyph) {
    const radius = RING_R[index] * u;
    const angle = rotation + glyph * (TAU / 8);
    return {
      x: originPoint.x + Math.cos(angle) * radius,
      y: originPoint.y + Math.sin(angle) * radius * RING_Y,
    };
  }

  function hitRing(point) {
    const originPoint = origin();
    const ellipse = Math.hypot(point.x - originPoint.x, (point.y - originPoint.y) / RING_Y);
    let best = -1;
    let bestDistance = 26 * u;
    RING_R.forEach((radius, index) => {
      const distance = Math.abs(ellipse - radius * u);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  function nodePoint(index) {
    const originPoint = origin();
    const angle = -Math.PI / 2 + index * (TAU / 6);
    return {
      x: originPoint.x + Math.cos(angle) * 228 * u,
      y: originPoint.y + Math.sin(angle) * 132 * u,
    };
  }

  function hitNode(point) {
    let best = -1;
    let bestDistance = 42 * u;
    for (let i = 0; i < 6; i += 1) {
      const node = nodePoint(i);
      const distance = Math.hypot(point.x - node.x, point.y - node.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  function plateScale(plate) {
    return 1 - plate.layer * 0.14;
  }

  function plateScreen(plate) {
    const originPoint = origin();
    const scale = plateScale(plate);
    return {
      x: originPoint.x + plate.x * scale,
      y: originPoint.y + plate.y * scale * 0.82,
      w: 188 * u * scale,
      h: 124 * u * scale,
    };
  }

  function plateAligned(plate) {
    const view = plateScreen(plate);
    const originPoint = origin();
    return Math.hypot(view.x - originPoint.x, view.y - originPoint.y) < 34 * u;
  }

  function hitPlate(point) {
    const ordered = state.plates
      .map((plate, index) => ({ plate, index }))
      .sort((a, b) => a.plate.layer - b.plate.layer);
    for (const item of ordered) {
      const view = plateScreen(item.plate);
      if (Math.abs(point.x - view.x) < view.w / 2 && Math.abs(point.y - view.y) < view.h / 2) return item.index;
    }
    return -1;
  }

  function motePoint() {
    const originPoint = origin();
    return {
      x: originPoint.x + Math.cos(state.cadenceAngle) * 188 * u,
      y: originPoint.y + Math.sin(state.cadenceAngle) * 188 * u * RING_Y,
    };
  }

  function gateOpen() {
    return angDist(state.cadenceAngle, -Math.PI / 2) < 0.42;
  }

  function hitSpot(point) {
    return Math.hypot(point.x - spotX, point.y - (spotY - 40 * u)) < 70 * u;
  }

  function countRings() {
    return state.rings.reduce((sum, step) => sum + (normStep(step) === 0 ? 1 : 0), 0);
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function status(text) {
    statusEl.textContent = text;
    statusUntil = performance.now() + 1700;
  }

  function burstAt(x, y, color) {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * TAU;
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * 80,
        vy: Math.sin(angle) * 80,
        life: 0.45,
        color,
      });
    }
  }

  function detent(index) {
    tone(480 + index * 70, 0.05, "square", 0.02);
  }

  function chime() {
    [523, 659, 784].forEach((freq, index) => {
      setTimeout(() => tone(freq, 0.18, "triangle", 0.05), index * 120);
    });
  }

  function ensureAudio() {
    if (audio) return audio;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audio = new Ctx();
    return audio;
  }

  function startAmbient() {
    const context = ensureAudio();
    if (!context || !soundOn || drone) return;
    if (context.state === "suspended") context.resume();
    const low = context.createOscillator();
    const high = context.createOscillator();
    const gain = context.createGain();
    low.frequency.value = 55;
    high.frequency.value = 82.5;
    low.type = "sine";
    high.type = "triangle";
    gain.gain.value = 0.012;
    low.connect(gain);
    high.connect(gain);
    gain.connect(context.destination);
    low.start();
    high.start();
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.015;
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(context.destination);
    noise.start();
    drone = { low, high, noise, gain, noiseGain };
  }

  function stopAmbient() {
    if (!drone) return;
    try {
      drone.low.stop();
      drone.high.stop();
      drone.noise.stop();
    } catch (err) {
      /* ignore */
    }
    drone = null;
  }

  function tone(freq, duration, type, gainValue) {
    const context = ensureAudio();
    if (!context || !soundOn) return;
    if (context.state === "suspended") context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = freq;
    gain.gain.setValueAtTime(gainValue, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  function makeCity() {
    const rand = mulberry32(11);
    const list = [];
    for (let i = 0; i < 18; i += 1) {
      const bw = 0.035 + rand() * 0.03;
      const wins = [];
      const cols = 3 + Math.floor(rand() * 3);
      const rows = 6 + Math.floor(rand() * 8);
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          if (rand() < 0.35) continue;
          wins.push({
            fx: 0.12 + (c / cols) * 0.75,
            fy: 0.08 + (r / rows) * 0.84,
            speed: 0.6 + rand() * 2,
            phase: rand() * 6,
            gate: 0.2 + rand() * 0.5,
            hot: rand() > 0.82,
          });
        }
      }
      list.push({
        x: i * 0.058 - 0.02,
        bw,
        bh: 0.16 + rand() * 0.28,
        accent: i % 5 === 0,
        wins,
      });
    }
    return list;
  }

  function edgeKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  function normStep(step) {
    return ((step % 8) + 8) % 8;
  }

  function angDist(a, b) {
    let delta = (a - b) % TAU;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    return Math.abs(delta);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function roundRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }
})();
