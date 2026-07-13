/**
 * Spatial VOID — markerless, world-anchored, interactive WebAR.
 *
 * White-labeled wrapper around an 8th Wall SLAM engine binary. It runs on its OWN
 * fullscreen canvas and three.js scene (created by the engine), completely isolated
 * from the editor's renderer, so it never touches the main app's WebGL context.
 *
 * Flow on a phone: load engine → "move to scan the room" → tap a surface to place the
 * UI → it stays anchored in the room while you walk around → tap buttons to navigate
 * between screens (same prototype links as the editor).
 *
 * This is an OPTIONAL mode. If the engine can't load or the device is unsupported,
 * startVoidAR() rejects and the caller falls back (native Quick Look or flat Play).
 *
 * Engine: the SLAM binary keeps its own vendor copyright header (license compliance);
 * only the product-facing UI here is branded "Spatial VOID".
 */

import * as THREE from 'three';

// The 8th Wall ThreeJS pipeline module reads the global `window.THREE`. Our app imports
// Three as an ES module, so expose it on window for the engine to find.
if (typeof window !== 'undefined' && !window.THREE) {
    window.THREE = THREE;
}

// ----------------------------------------------------------------------------
// Configuration — point these at your licensed / hosted 8th Wall engine binary.
// Some distributions need an app key (?appKey=...); the open binary does not.
// ----------------------------------------------------------------------------
const CONFIG = {
    engineSrc: 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js',
    appKey: '',
    preloadChunks: 'slam',
    loadTimeoutMs: 18000,
    // Templates are authored in ~"metres" (a card is ~2.3 units tall). Default size +
    // lift above the tapped surface, in metres. Both are live-adjustable in the AR view
    // (the ⚙ control) and persisted to localStorage.
    worldScale: 0.35,
    placeLift: 0.32,
    accent: 0x6366f1
};

function readTune() {
    let scale = CONFIG.worldScale;
    let lift = CONFIG.placeLift;
    try {
        const s = parseFloat(localStorage.getItem('voidar.scale'));
        const l = parseFloat(localStorage.getItem('voidar.lift'));
        if (!Number.isNaN(s)) scale = s;
        if (!Number.isNaN(l)) lift = l;
    } catch (_) {}
    return { scale, lift };
}

function saveTune(key, value) {
    try {
        localStorage.setItem('voidar.' + key, String(value));
    } catch (_) {}
}

// ----------------------------------------------------------------------------
// Engine loader (lazy, once).
// ----------------------------------------------------------------------------
let enginePromise = null;
function loadEngine() {
    if (window.XR8) return Promise.resolve(window.XR8);
    if (enginePromise) return enginePromise;
    enginePromise = new Promise((resolve, reject) => {
        const ready = () => (window.XR8 ? resolve(window.XR8) : reject(new Error('Spatial VOID engine missing after load')));
        if (window.XR8) return ready();
        window.addEventListener('xrloaded', ready, { once: true });
        const s = document.createElement('script');
        s.src = CONFIG.engineSrc + (CONFIG.appKey ? `?appKey=${encodeURIComponent(CONFIG.appKey)}` : '');
        s.async = true;
        s.crossOrigin = 'anonymous';
        if (CONFIG.preloadChunks) s.setAttribute('data-preload-chunks', CONFIG.preloadChunks);
        s.onerror = () => reject(new Error('Could not load the Spatial VOID engine'));
        document.head.appendChild(s);
        setTimeout(() => {
            if (!window.XR8) reject(new Error('Spatial VOID engine timed out'));
        }, CONFIG.loadTimeoutMs);
    });
    return enginePromise;
}

/** True where markerless WebAR can run: a mobile browser, secure context, WebGL. */
export function isVoidARSupported() {
    const ua = navigator.userAgent || '';
    const mobile = /iPhone|iPad|iPod|Android/i.test(ua);
    if (!mobile || !window.isSecureContext) return false;
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (_) {
        return false;
    }
}

// ----------------------------------------------------------------------------
// Compact component renderer — reads the same export schema as the editor so the
// AR layout matches what the designer built (rounded glass, art, aligned text).
// ----------------------------------------------------------------------------
function roundedShape(w, h, r) {
    const radius = Math.max(0.0001, Math.min(r, w / 2, h / 2));
    const x = -w / 2;
    const y = -h / 2;
    const s = new THREE.Shape();
    s.moveTo(x + radius, y);
    s.lineTo(x + w - radius, y);
    s.quadraticCurveTo(x + w, y, x + w, y + radius);
    s.lineTo(x + w, y + h - radius);
    s.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    s.lineTo(x + radius, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - radius);
    s.lineTo(x, y + radius);
    s.quadraticCurveTo(x, y, x + radius, y);
    s.closePath();
    return s;
}

function roundedGeo(w, h, r) {
    const g = new THREE.ShapeGeometry(roundedShape(w, h, r), 16);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
        uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
    }
    uv.needsUpdate = true;
    return g;
}

function roundedLineGeo(w, h, r) {
    return new THREE.BufferGeometry().setFromPoints(roundedShape(w, h, r).getPoints(96));
}

function col(v, fallback) {
    if (v == null || v === '') return new THREE.Color(fallback);
    try {
        return new THREE.Color(v);
    } catch (_) {
        return new THREE.Color(fallback);
    }
}

const TEXT_PPU = 1150;
function textTexture(opts) {
    const text = opts.text == null ? '' : String(opts.text);
    const align = opts.align || 'center';
    const wPx = Math.min(2048, Math.max(64, Math.round((opts.w || 1) * TEXT_PPU)));
    const hPx = Math.min(2048, Math.max(48, Math.round((opts.h || 0.25) * TEXT_PPU)));
    const canvas = document.createElement('canvas');
    canvas.width = wPx;
    canvas.height = hPx;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.color || '#ffffff';
    ctx.font = `${opts.weight || '600'} ${opts.fontSize || 60}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    const lh = (opts.fontSize || 60) * 1.2;
    let y = hPx / 2 - (lh * lines.length) / 2 + lh / 2;
    const padX = opts.padX != null ? opts.padX : 14;
    for (const ln of lines) {
        let x;
        if (align === 'left') {
            ctx.textAlign = 'left';
            x = padX;
        } else if (align === 'right') {
            ctx.textAlign = 'right';
            x = wPx - padX;
        } else {
            ctx.textAlign = 'center';
            x = wPx / 2;
        }
        ctx.fillText(ln, x, y);
        y += lh;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
}

function artTexture(kind, accent, wPx = 1024, hPx = 640) {
    const canvas = document.createElement('canvas');
    canvas.width = wPx;
    canvas.height = hPx;
    const ctx = canvas.getContext('2d');
    const A = col(accent, '#4f46e5');
    const shade = (m) => `#${A.clone().multiplyScalar(m).convertLinearToSRGB().getHexString()}`;
    if (kind === 'product') {
        const bg = ctx.createLinearGradient(0, 0, wPx, hPx);
        bg.addColorStop(0, shade(0.5));
        bg.addColorStop(1, '#0b0f1a');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, wPx, hPx);
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = wPx / 26;
        ctx.beginPath();
        ctx.arc(wPx / 2, hPx * 0.52, hPx * 0.26, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
    } else if (kind === 'map' || kind === 'landscape') {
        const sky = ctx.createLinearGradient(0, 0, 0, hPx);
        sky.addColorStop(0, '#1a2740');
        sky.addColorStop(1, shade(1.0));
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, wPx, hPx);
        ctx.fillStyle = shade(0.4);
        ctx.beginPath();
        ctx.moveTo(0, hPx);
        ctx.lineTo(0, hPx * 0.7);
        ctx.lineTo(wPx * 0.5, hPx * 0.55);
        ctx.lineTo(wPx, hPx * 0.72);
        ctx.lineTo(wPx, hPx);
        ctx.fill();
        if (kind === 'map') {
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = wPx / 110;
            ctx.setLineDash([wPx / 40, wPx / 60]);
            ctx.beginPath();
            ctx.moveTo(wPx * 0.15, hPx * 0.85);
            ctx.bezierCurveTo(wPx * 0.4, hPx * 0.6, wPx * 0.55, hPx * 0.78, wPx * 0.85, hPx * 0.45);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    } else if (kind === 'avatar') {
        const bg = ctx.createLinearGradient(0, 0, wPx, hPx);
        bg.addColorStop(0, shade(1.05));
        bg.addColorStop(1, shade(0.55));
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, wPx, hPx);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.arc(wPx / 2, hPx * 0.4, Math.min(wPx, hPx) * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(wPx / 2, hPx * 1.02, Math.min(wPx, hPx) * 0.36, Math.PI, 0);
        ctx.fill();
    } else {
        // calm
        const bg = ctx.createLinearGradient(0, 0, 0, hPx);
        bg.addColorStop(0, '#0a1020');
        bg.addColorStop(0.5, shade(0.45));
        bg.addColorStop(1, shade(0.9));
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, wPx, hPx);
        const orb = ctx.createRadialGradient(wPx / 2, hPx * 0.6, 2, wPx / 2, hPx * 0.6, hPx * 0.3);
        orb.addColorStop(0, '#ffffff');
        orb.addColorStop(0.3, shade(1.25));
        orb.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = orb;
        ctx.fillRect(0, 0, wPx, hPx);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
}

function place(obj, d) {
    if (d.position) obj.position.set(d.position.x || 0, d.position.y || 0, d.position.z || 0);
}

function buildPanel(d) {
    const g = new THREE.Group();
    const w = d.width || 1.2;
    const h = d.height || 0.8;
    const r = d.radius != null ? d.radius : 0.1;
    const mesh = new THREE.Mesh(
        roundedGeo(w, h, r),
        new THREE.MeshStandardMaterial({
            color: col(d.color, '#0e1320'),
            roughness: 0.6,
            metalness: 0,
            transparent: true,
            // More opaque in AR so the UI stays legible over a busy room.
            opacity: Math.min(1, (d.opacity != null ? d.opacity : 0.92) + 0.06),
            side: THREE.DoubleSide,
            depthWrite: false
        })
    );
    g.add(mesh);
    const border = new THREE.Line(
        roundedLineGeo(w, h, r),
        new THREE.LineBasicMaterial({ color: col(d.borderColor, '#cbd5e1'), transparent: true, opacity: d.borderOpacity != null ? d.borderOpacity : 0.18, depthWrite: false })
    );
    border.position.z = 0.004;
    g.add(border);
    place(g, d);
    return g;
}

function buildImage(d) {
    const g = new THREE.Group();
    const w = d.width || 0.9;
    const h = d.height || 0.55;
    const r = d.radius != null ? d.radius : 0.07;
    const mat = d.art
        ? new THREE.MeshBasicMaterial({ map: artTexture(d.art, d.color || '#4f46e5', 1024, Math.round((h / w) * 1024)), transparent: true, side: THREE.DoubleSide, depthWrite: false })
        : new THREE.MeshStandardMaterial({ color: col(d.color, '#334155'), roughness: 0.9, transparent: true, opacity: d.opacity != null ? d.opacity : 0.9, side: THREE.DoubleSide, depthWrite: false });
    g.add(new THREE.Mesh(roundedGeo(w, h, r), mat));
    place(g, d);
    return g;
}

function buildText(d) {
    const g = new THREE.Group();
    const w = d.width || 1;
    const h = d.height || 0.25;
    if (d.chip) {
        const chip = new THREE.Mesh(
            roundedGeo(w, h, d.radius != null ? d.radius : Math.min(h / 2, 0.06)),
            new THREE.MeshStandardMaterial({ color: col(d.chip, '#334155'), roughness: 0.6, transparent: true, opacity: d.chipOpacity != null ? d.chipOpacity : 1, side: THREE.DoubleSide, depthWrite: false })
        );
        chip.position.z = -0.001;
        g.add(chip);
    }
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
            map: textTexture({ text: d.text, align: d.align || 'center', weight: d.weight || '600', color: d.textColor || '#f5f7fa', fontSize: d.textFontSize || 40, w, h, padX: d.chip ? 18 : 10 }),
            transparent: true,
            depthWrite: false
        })
    );
    plane.position.z = 0.004;
    g.add(plane);
    place(g, d);
    return g;
}

function buildButton(d) {
    const g = new THREE.Group();
    const w = d.width || 1.5;
    const h = d.height || 0.26;
    const r = d.radius != null ? d.radius : 0.13;
    const ghost = d.variant === 'ghost';
    const base = col(d.color, '#4f46e5');
    const bg = new THREE.Mesh(
        roundedGeo(w, h, r),
        new THREE.MeshStandardMaterial({
            color: base,
            roughness: 0.55,
            metalness: 0,
            transparent: true,
            opacity: ghost ? 0.22 : 1,
            emissive: base,
            emissiveIntensity: ghost ? 0 : (d.glow != null ? d.glow : 0.06),
            side: THREE.DoubleSide,
            depthWrite: false
        })
    );
    g.add(bg);
    if (ghost) {
        const ol = new THREE.Line(roundedLineGeo(w, h, r), new THREE.LineBasicMaterial({ color: base, transparent: true, opacity: 0.85, depthWrite: false }));
        ol.position.z = 0.001;
        g.add(ol);
    }
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.9, h * 0.62),
        new THREE.MeshBasicMaterial({
            map: textTexture({ text: d.label, align: d.align || 'center', weight: d.weight || '600', color: d.textColor || '#ffffff', fontSize: d.textFontSize || 36, w: w * 0.9, h: h * 0.62, padX: 24 }),
            transparent: true,
            depthWrite: false
        })
    );
    plane.position.z = 0.006;
    g.add(plane);
    place(g, d);
    // Mark as a tappable nav target.
    g.userData.voidLink = d.onClickScreenId || '';
    g.traverse((o) => (o.userData.voidLink = d.onClickScreenId || ''));
    return g;
}

function buildComponent(d) {
    if (d.type === 'button') return buildButton(d);
    if (d.type === 'image') return buildImage(d);
    if (d.type === 'text') return buildText(d);
    return buildPanel(d); // panel / frame / fallback
}

function buildScreenGroup(screenData) {
    const group = new THREE.Group();
    (screenData.components || []).forEach((c) => group.add(buildComponent(c)));

    // Flat-UI rendering: paint strictly in authoring order (back-to-front), with no
    // depth test/write and no frustum culling. This makes the card behave like a flat
    // 2D layout that always shows every element from any angle — nothing can sort behind
    // the card or get culled as you tilt/walk around it.
    let order = 1;
    group.traverse((o) => {
        o.frustumCulled = false;
        if (o.material) {
            o.material.depthTest = false;
            o.material.depthWrite = false;
            o.material.transparent = true;
            o.material.side = THREE.DoubleSide;
            o.renderOrder = order++;
        }
    });
    return group;
}

// ----------------------------------------------------------------------------
// Session
// ----------------------------------------------------------------------------
let session = null;

function findScreen(data, id) {
    return data.screens.find((s) => s.id === id) || data.screens[0];
}

function makeOverlay(onExit) {
    const el = document.createElement('div');
    el.id = 'void-ar-overlay';
    el.className = 'void-ar-overlay';
    el.innerHTML = `
        <canvas id="void-ar-canvas" class="void-ar-canvas"></canvas>
        <div class="void-ar-top">
            <span class="void-ar-brand">Spatial&nbsp;VOID</span>
            <div class="void-ar-actions">
                <button type="button" class="void-ar-gear" id="void-ar-gear" aria-label="Adjust">⚙</button>
                <button type="button" class="void-ar-move" id="void-ar-move" style="display:none">Move</button>
                <button type="button" class="void-ar-exit" id="void-ar-exit">Exit</button>
            </div>
        </div>
        <div class="void-ar-tune" id="void-ar-tune" style="display:none">
            <label class="void-ar-tune-row">
                <span>Size <b id="void-ar-size-val"></b></span>
                <input type="range" id="void-ar-size" min="0.12" max="0.7" step="0.01">
            </label>
            <label class="void-ar-tune-row">
                <span>Height <b id="void-ar-height-val"></b></span>
                <input type="range" id="void-ar-height" min="0" max="1.2" step="0.02">
            </label>
        </div>
        <div class="void-ar-hint" id="void-ar-hint">
            <div class="void-ar-spinner"></div>
            <span id="void-ar-hint-text">Starting Spatial VOID…</span>
        </div>`;
    document.body.appendChild(el);
    el.querySelector('#void-ar-exit').addEventListener('click', onExit);
    return el;
}

function setHint(text, spinner) {
    const t = document.getElementById('void-ar-hint-text');
    const s = document.querySelector('#void-ar-hint .void-ar-spinner');
    const hint = document.getElementById('void-ar-hint');
    if (!hint) return;
    if (text == null) {
        hint.style.display = 'none';
        return;
    }
    hint.style.display = 'flex';
    if (t) t.textContent = text;
    if (s) s.style.display = spinner ? '' : 'none';
}

/**
 * Start Spatial VOID for a project export. Resolves once running, rejects if the engine
 * can't load or the device is unsupported (so the caller can fall back).
 */
export async function startVoidAR(exportData, startScreenId, opts = {}) {
    if (!exportData || !Array.isArray(exportData.screens) || !exportData.screens.length) {
        throw new Error('Nothing to show in Spatial VOID');
    }
    if (!isVoidARSupported()) throw new Error('Spatial VOID is not supported on this device');

    const overlay = makeOverlay(() => stopVoidAR());
    const canvas = overlay.querySelector('#void-ar-canvas');

    let XR8;
    try {
        XR8 = await loadEngine();
    } catch (err) {
        overlay.remove();
        throw err;
    }

    const tune = readTune();
    const state = {
        overlay,
        canvas,
        data: exportData,
        currentScreenId: startScreenId || exportData.activeScreenId || exportData.screens[0].id,
        placed: false,
        root: null,
        reticle: null,
        scene: null,
        camera: null,
        renderer: null,
        raycaster: new THREE.Raycaster(),
        pointer: new THREE.Vector2(),
        scale: tune.scale,
        lift: tune.lift,
        placedSurfaceY: 0,
        lastTapTs: 0,
        navCooldownTs: 0
    };
    session = state;

    const showScreen = (id) => {
        if (!state.root) return;
        state.currentScreenId = id;
        while (state.root.children.length) state.root.remove(state.root.children[0]);
        state.root.add(buildScreenGroup(findScreen(state.data, id)));
    };

    const placeAt = (target) => {
        state.placedSurfaceY = target.y;
        state.root.position.set(target.x, target.y + state.lift, target.z);
        state.root.lookAt(state.camera.position.x, state.root.position.y, state.camera.position.z);
        state.placed = true;
        if (state.reticle) state.reticle.visible = false;
        showScreen(state.currentScreenId);
        const mb = document.getElementById('void-ar-move');
        if (mb) mb.style.display = '';
        syncTuneUI();
        setHint('Tap a button to navigate. Walk around to explore.', false);
        setTimeout(() => setHint(null), 2600);
    };

    const onTap = (clientX, clientY, nowMs) => {
        const rect = canvas.getBoundingClientRect();
        const nx = (clientX - rect.left) / rect.width;
        const ny = (clientY - rect.top) / rect.height;

        if (!state.placed) {
            let pos = null;
            try {
                const hits = XR8.XrController.hitTest(nx, ny, ['FEATURE_POINT', 'ESTIMATED_SURFACE', 'DETECTED_SURFACE']);
                if (hits && hits.length) pos = hits[0].position;
            } catch (_) {}
            const target = new THREE.Vector3();
            if (pos) target.set(pos.x, pos.y, pos.z);
            else state.camera.getWorldDirection(target).multiplyScalar(1.2).add(state.camera.position);
            placeAt(target);
            return;
        }

        // Navigate: only the single nearest tappable button wins, with a short cooldown
        // so a transition can't be double-triggered.
        if (nowMs - state.navCooldownTs < 350) return;
        state.pointer.set(nx * 2 - 1, -(ny * 2 - 1));
        state.raycaster.setFromCamera(state.pointer, state.camera);
        const hits = state.raycaster.intersectObject(state.root, true);
        if (!hits.length) return;
        let o = hits[0].object;
        while (o && !o.userData.voidLink && o.parent) o = o.parent;
        const link = o && o.userData.voidLink;
        if (link && state.data.screens.some((s) => s.id === link)) {
            state.navCooldownTs = nowMs;
            showScreen(link);
        }
    };

    // Single tap path: touch fires `touchend` and then a synthesized `click` — dedupe by
    // time so each physical tap is handled exactly once.
    state._onTouch = (e) => {
        const now = (e.timeStamp || Date.now());
        if (now - state.lastTapTs < 450) return;
        state.lastTapTs = now;
        const t = e.changedTouches ? e.changedTouches[0] : e;
        onTap(t.clientX, t.clientY, now);
    };

    // "Move" — re-enter placement without exiting: next surface tap re-anchors the UI.
    const enterPlaceMode = () => {
        state.placed = false;
        if (state.reticle) state.reticle.visible = true;
        const mb = document.getElementById('void-ar-move');
        if (mb) mb.style.display = 'none';
        setHint('Tap a surface to move the layout.', false);
    };
    overlay.querySelector('#void-ar-move')?.addEventListener('click', enterPlaceMode);

    // ⚙ Live tuning — adjust Size (worldScale) and Height (lift) in the room, persisted.
    const sizeInput = overlay.querySelector('#void-ar-size');
    const heightInput = overlay.querySelector('#void-ar-height');
    const sizeVal = overlay.querySelector('#void-ar-size-val');
    const heightVal = overlay.querySelector('#void-ar-height-val');
    const syncTuneUI = () => {
        if (sizeInput) sizeInput.value = state.scale;
        if (heightInput) heightInput.value = state.lift;
        if (sizeVal) sizeVal.textContent = `${Math.round(state.scale * 100)}%`;
        if (heightVal) heightVal.textContent = `${state.lift.toFixed(2)} m`;
    };
    syncTuneUI();
    overlay.querySelector('#void-ar-gear')?.addEventListener('click', () => {
        const tunePanel = overlay.querySelector('#void-ar-tune');
        if (tunePanel) tunePanel.style.display = tunePanel.style.display === 'none' ? 'flex' : 'none';
    });
    sizeInput?.addEventListener('input', () => {
        state.scale = parseFloat(sizeInput.value);
        if (state.root) state.root.scale.setScalar(state.scale);
        saveTune('scale', state.scale);
        syncTuneUI();
    });
    heightInput?.addEventListener('input', () => {
        state.lift = parseFloat(heightInput.value);
        if (state.placed && state.root) {
            state.root.position.y = state.placedSurfaceY + state.lift;
            state.root.lookAt(state.camera.position.x, state.root.position.y, state.camera.position.z);
        }
        saveTune('lift', state.lift);
        syncTuneUI();
    });

    const voidModule = {
        name: 'voidar',
        onStart: ({ canvas: cnv }) => {
            const xr = XR8.Threejs.xrScene();
            state.scene = xr.scene;
            state.camera = xr.camera;
            state.renderer = xr.renderer;

            state.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
            const dir = new THREE.DirectionalLight(0xffffff, 0.7);
            dir.position.set(1, 3, 2);
            state.scene.add(dir);

            state.root = new THREE.Group();
            state.root.scale.setScalar(state.scale);
            state.root.visible = true;
            state.scene.add(state.root);

            // Placement reticle.
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.07, 0.1, 36),
                new THREE.MeshBasicMaterial({ color: CONFIG.accent, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
            );
            ring.rotation.x = -Math.PI / 2;
            state.reticle = ring;
            state.scene.add(ring);

            // Show the first screen immediately (floating until placed).
            state.root.add(buildScreenGroup(findScreen(state.data, state.currentScreenId)));
            state.root.position.set(0, 0, -1.4);

            // Optional initial pose hint; engine drives the camera each frame regardless.
            try {
                XR8.XrController.updateCameraProjectionMatrix({
                    origin: state.camera.position,
                    facing: state.camera.quaternion
                });
            } catch (_) {}
            cnv.addEventListener('touchend', state._onTouch, { passive: true });
            cnv.addEventListener('click', state._onTouch);
            setHint('Move your phone to scan the room, then tap a surface to place it.', false);
        },
        onUpdate: () => {
            // Keep the reticle ~1.4 m ahead on the floor until the UI is placed.
            if (!state.placed && state.reticle && state.camera) {
                const fwd = new THREE.Vector3();
                state.camera.getWorldDirection(fwd);
                const p = state.camera.position.clone().add(fwd.multiplyScalar(1.4));
                state.reticle.position.set(p.x, Math.min(p.y, state.camera.position.y - 0.4), p.z);
                state.root.position.lerp(new THREE.Vector3(p.x, state.reticle.position.y + state.lift, p.z), 0.15);
                state.root.lookAt(state.camera.position.x, state.root.position.y, state.camera.position.z);
            }
        },
        onException: (err) => {
            console.error('Spatial VOID engine error:', err);
            setHint('AR tracking error. Tap Exit and try again in a well-lit space.', false);
        }
    };

    try {
        // Size the canvas backing store to the full viewport before the engine reads it,
        // so the camera feed fills the screen (not a small box).
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);

        // Clear any modules left over from a previous session so re-entry starts clean.
        try {
            XR8.clearCameraPipelineModules();
        } catch (_) {}

        XR8.addCameraPipelineModules([
            XR8.GlTextureRenderer.pipelineModule(),
            XR8.Threejs.pipelineModule(),
            XR8.XrController.pipelineModule(),
            voidModule
        ]);
        XR8.run({ canvas });
        if (typeof opts.onStarted === 'function') opts.onStarted();

        // Resize the canvas backing store to the viewport. IMPORTANT: this must NOT
        // dispatch a 'resize' event, or the resize listener below would retrigger it in
        // an infinite loop (the cause of the screen flicker).
        const sizeCanvas = () => {
            const d = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(window.innerWidth * d);
            canvas.height = Math.round(window.innerHeight * d);
            try {
                if (session && session.renderer) session.renderer.setSize(window.innerWidth, window.innerHeight, false);
            } catch (_) {}
        };
        // Mobile browsers settle the viewport (address bar) a beat after launch — nudge the
        // engine a few times to recompute its canvas size, dispatching resize exactly once each.
        [120, 400, 900].forEach((ms) =>
            setTimeout(() => {
                if (!session) return;
                sizeCanvas();
                window.dispatchEvent(new Event('resize'));
            }, ms)
        );
        const onWinResize = () => sizeCanvas();
        window.addEventListener('resize', onWinResize);
        state._onResize = onWinResize;
    } catch (err) {
        stopVoidAR();
        throw err;
    }
}

export function stopVoidAR() {
    const s = session;
    session = null;
    try {
        if (window.XR8 && window.XR8.stop) window.XR8.stop();
        if (window.XR8 && window.XR8.clearCameraPipelineModules) window.XR8.clearCameraPipelineModules();
    } catch (_) {}
    if (s) {
        try {
            s.canvas.removeEventListener('touchend', s._onTouch);
            s.canvas.removeEventListener('click', s._onTouch);
            if (s._onResize) window.removeEventListener('resize', s._onResize);
        } catch (_) {}
        if (s.overlay && s.overlay.parentNode) s.overlay.remove();
    } else {
        document.getElementById('void-ar-overlay')?.remove();
    }
}

export function isVoidARActive() {
    return !!session;
}
