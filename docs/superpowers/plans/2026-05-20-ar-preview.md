# AR Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canvas objects appear as world-anchored AR holograms in the phone's camera view — tap a surface to place, walk around to inspect sizing and feel.

**Architecture:** Fix the broken WebXR setup in `phone.js` (wrong initialization order, conflicting render loops), add a reticle that tracks detected surfaces via hit-test, and wire a tap-to-place interaction that positions the snapshot root in world space. iOS falls back to device-orientation 3DoF. DOM overlay provides in-AR controls.

**Tech Stack:** WebXR Device API (`immersive-ar`, `hit-test`, `dom-overlay`), Three.js `WebXRManager`, `renderer.setAnimationLoop`, ARCore (Android), Device Orientation API (iOS fallback), vanilla JS.

---

## File Map

| File | What changes |
|------|-------------|
| `phone.html` | Add `#ar-overlay` div (DOM overlay for WebXR) + `#ios-mode-badge` |
| `styles.css` | AR overlay styles: mode badge, placement hint, controls bar |
| `phone.js` | Unified render loop, fix XR init order, reticle, tap-to-place, session end, XR-aware snapshot apply, iOS badge |

**Untouched:** `main.js`, `index.html`, `shared/`, `worker/`, `vite.config.js`

---

## Task 1: Add AR overlay HTML to phone.html

**Files:**
- Modify: `phone.html`

The `#ar-overlay` div must exist in the DOM before the WebXR session is requested — it is passed as `domOverlay.root`. Add it and the iOS badge just before the closing `</div>` of `#phone-root`.

- [ ] **Open `phone.html`. Find this line (near bottom of `#phone-root`):**

```html
        <div id="phone-mode-toggle" class="phone-mode-pill" data-mode="edit">
            <button data-mode="edit" class="active">Edit</button>
            <button data-mode="play">Play</button>
        </div>
    </div>
```

- [ ] **Replace it with:**

```html
        <div id="phone-mode-toggle" class="phone-mode-pill" data-mode="edit">
            <button data-mode="edit" class="active">Edit</button>
            <button data-mode="play">Play</button>
        </div>

        <!-- AR DOM overlay — shown during immersive-ar WebXR session -->
        <div id="ar-overlay">
            <span id="ar-mode-badge" class="ar-mode-badge">AR Mode</span>
            <div id="ar-placement-hint" class="ar-placement-hint">
                <p>Tap a surface to place your design</p>
            </div>
            <div id="ar-controls" class="ar-controls">
                <button id="ar-reset-btn" class="ar-btn">Reset placement</button>
                <button id="ar-exit-btn" class="ar-btn ar-btn-exit">Exit AR</button>
            </div>
        </div>

        <!-- iOS / 3DoF fallback badge -->
        <span id="ios-mode-badge" class="ar-mode-badge ar-mode-badge--3dof" style="display:none;">3DoF Mode</span>
    </div>
```

- [ ] **Commit:**

```
git add phone.html
git commit -m "feat(phone): add AR DOM overlay + iOS mode badge to phone.html"
```

---

## Task 2: Add AR overlay CSS to styles.css

**Files:**
- Modify: `styles.css` (append to end)

- [ ] **Append the following block to the very end of `styles.css`:**

```css
/* ===== AR PREVIEW OVERLAY ===== */
#ar-overlay {
    display: none;               /* hidden by default; shown via JS when XR session starts */
    position: fixed;
    inset: 0;
    z-index: 9000;
    pointer-events: none;        /* pass taps through to XR select by default */
}

.ar-mode-badge {
    position: absolute;
    top: 14px;
    left: 14px;
    background: rgba(79, 70, 229, 0.85);
    color: #fff;
    font: 600 12px/1 Inter, system-ui, sans-serif;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 5px 10px;
    border-radius: 999px;
    pointer-events: none;
}

.ar-mode-badge--3dof {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid #334155;
}

.ar-placement-hint {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}

.ar-placement-hint p {
    margin: 0;
    font: 500 17px/1.4 Inter, system-ui, sans-serif;
    color: #fff;
    text-align: center;
    background: rgba(15, 23, 42, 0.65);
    padding: 12px 22px;
    border-radius: 12px;
    max-width: 260px;
}

.ar-controls {
    position: absolute;
    bottom: 32px;
    left: 0;
    right: 0;
    display: none;               /* shown after first placement */
    justify-content: center;
    gap: 12px;
    pointer-events: auto;
}

.ar-btn {
    padding: 10px 20px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.25);
    background: rgba(15, 23, 42, 0.8);
    color: #e2e8f0;
    font: 500 14px Inter, system-ui, sans-serif;
    cursor: pointer;
}

.ar-btn-exit {
    background: rgba(239, 68, 68, 0.75);
    border-color: rgba(239, 68, 68, 0.4);
}
```

- [ ] **Verify no existing `.ar-` selectors conflict:**

```
grep -n "\.ar-" styles.css
```

Expected: only lines you just added (near the end of the file).

- [ ] **Commit:**

```
git add styles.css
git commit -m "feat(phone): AR overlay CSS — badge, placement hint, controls bar"
```

---

## Task 3: Unify the render loop in phone.js

**Files:**
- Modify: `phone.js`

**Why:** `phone.js` currently has two competing `requestAnimationFrame` loops — one for Three.js rendering and one for the composite canvas. When WebXR starts, `renderer.setAnimationLoop` should own the render; running `requestAnimationFrame` in parallel causes double renders and breaks XR. Replace with a single `setAnimationLoop` callback.

- [ ] **In `phone.js`, find the `startPhoneCameraAndComposite` function. Locate this block:**

```javascript
    function frame() {
        phoneState.threeRenderer.render(phoneState.threeScene, phoneState.threeCamera);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    const composite = document.createElement('canvas');
    composite.width = canvas.width;
    composite.height = canvas.height;
    const ctx = composite.getContext('2d');
    function compositeFrame() {
        ctx.drawImage(video, 0, 0, composite.width, composite.height);
        ctx.drawImage(canvas, 0, 0);
        requestAnimationFrame(compositeFrame);
    }
    requestAnimationFrame(compositeFrame);
```

- [ ] **Replace it with:**

```javascript
    // Unified render loop — handles both regular and WebXR frames.
    // In XR mode (frame !== null) WebXRManager updates the camera automatically;
    // the XR hit-test and pose-stream logic run in startWebXrMode's onFrame handler.
    phoneState.threeRenderer.setAnimationLoop((timestamp, frame) => {
        phoneState._xrFrame = frame ?? null;
        phoneState.threeRenderer.render(phoneState.threeScene, phoneState.threeCamera);
    });

    // Composite: draw live camera video behind the WebGL canvas for desktop preview stream.
    // This runs independently at ~30 fps and is only used for the WebRTC video track.
    const composite = document.createElement('canvas');
    composite.width = canvas.width;
    composite.height = canvas.height;
    const ctx = composite.getContext('2d');
    function compositeFrame() {
        ctx.drawImage(video, 0, 0, composite.width, composite.height);
        ctx.drawImage(canvas, 0, 0);
        requestAnimationFrame(compositeFrame);
    }
    requestAnimationFrame(compositeFrame);
```

- [ ] **Add `_xrFrame: null` to the `phoneState` object (find the object and add the property):**

```javascript
const phoneState = {
    cameraStream: null,
    threeRenderer: null,
    threeScene: null,
    threeCamera: null,
    composite: { canvas: null, stream: null },
    snapshotRoot: null,
    xrSession: null,
    xrRefSpace: null,
    xrHitTest: null,
    _xrFrame: null,          // ← add this
    reticle: null,           // ← add this
    scenePlaced: false        // ← add this
};
```

- [ ] **Verify the file has no syntax errors by running the dev server briefly:**

```
npm run dev
```

Open `http://localhost:8000` and confirm the editor loads without console errors. Stop the server with Ctrl+C.

- [ ] **Commit:**

```
git add phone.js
git commit -m "refactor(phone): unify render loop under setAnimationLoop; remove parallel rAF"
```

---

## Task 4: Create the hit-test reticle

**Files:**
- Modify: `phone.js`

The reticle is a white ring that snaps to detected surfaces each frame. It uses `matrixAutoUpdate = false` so we write the XR pose matrix directly without Three.js overwriting it.

- [ ] **In `phone.js`, find `startWebXrMode`. It currently looks like:**

```javascript
async function startWebXrMode() {
    try {
        const session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['depth-sensing']
        });
        phoneState.xrSession = session;
        await phoneState.threeRenderer.xr.setSession(session);
        phoneState.threeRenderer.xr.enabled = true;
        const refSpace = await session.requestReferenceSpace('local');
        phoneState.xrRefSpace = refSpace;
        const viewerSpace = await session.requestReferenceSpace('viewer');
        phoneState.xrHitTest = await session.requestHitTestSource({ space: viewerSpace });
        startXrPoseLoop();
    } catch (err) {
        status.textContent = `WebXR failed: ${err.message}`;
    }
}
```

- [ ] **Replace the entire function with:**

```javascript
async function startWebXrMode() {
    try {
        const session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['hit-test', 'dom-overlay'],
            domOverlay: { root: document.getElementById('ar-overlay') },
            optionalFeatures: ['depth-sensing']
        });
        phoneState.xrSession = session;

        // IMPORTANT: xr.enabled must be true BEFORE setSession is called.
        phoneState.threeRenderer.xr.enabled = true;
        await phoneState.threeRenderer.xr.setSession(session);

        // local-floor: Y=0 is detected floor — objects appear at correct real-world heights.
        const refSpace = await session.requestReferenceSpace('local-floor');
        phoneState.xrRefSpace = refSpace;

        // Viewer space needed for hit-test (ray cast from current camera view).
        const viewerSpace = await session.requestReferenceSpace('viewer');
        phoneState.xrHitTest = await session.requestHitTestSource({ space: viewerSpace });

        // Build reticle ring — tracks hit-test surface.
        const geo = new THREE.RingGeometry(0.1, 0.14, 32).rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
        phoneState.reticle = new THREE.Mesh(geo, mat);
        phoneState.reticle.matrixAutoUpdate = false; // we write the matrix directly from XR pose
        phoneState.reticle.visible = false;
        phoneState.threeScene.add(phoneState.reticle);

        // Show overlay.
        document.getElementById('ar-overlay').style.display = 'block';
        document.getElementById('ar-placement-hint').style.display = 'flex';
        document.getElementById('ar-controls').style.display = 'none';

        // Hide snapshot root until user taps to place.
        if (phoneState.snapshotRoot) phoneState.snapshotRoot.visible = false;
        phoneState.scenePlaced = false;

        // Tap-to-place + session lifecycle.
        session.addEventListener('select', onXrSelect);
        session.addEventListener('end', onXrSessionEnd);

        // Wire overlay buttons.
        document.getElementById('ar-reset-btn').addEventListener('click', resetArPlacement);
        document.getElementById('ar-exit-btn').addEventListener('click', () => session.end());

        // XR frame updates are driven by setAnimationLoop (Task 3); plug in the XR logic.
        phoneState.threeRenderer.setAnimationLoop(onXrFrame);

    } catch (err) {
        console.error('[AR] startWebXrMode failed:', err);
        status.textContent = `AR failed: ${err.message}`;
    }
}
```

- [ ] **Commit:**

```
git add phone.js
git commit -m "feat(phone): create WebXR session with hit-test + dom-overlay, build reticle"
```

---

## Task 5: XR frame handler — hit-test + pose streaming

**Files:**
- Modify: `phone.js`

The `onXrFrame` callback replaces `startXrPoseLoop`. It runs every XR frame (via `setAnimationLoop`), updates the reticle from hit-test results, and streams the viewer pose to the desktop.

- [ ] **In `phone.js`, find and delete the entire `startXrPoseLoop` function:**

```javascript
function startXrPoseLoop() {
    const session = phoneState.xrSession;
    if (!session) return;
    session.requestAnimationFrame(function onXrFrame(_t, frame) {
        const refSpace = phoneState.xrRefSpace;
        const viewerPose = frame.getViewerPose(refSpace);
        if (viewerPose && phonePeer) {
            const m = new Float32Array(viewerPose.transform.matrix);
            phonePeer.sendPoseStream(encodeXrPose(m, performance.now()));
        }
        if (phoneState.xrSession === session) session.requestAnimationFrame(onXrFrame);
    });
}
```

- [ ] **Add the following new function in its place:**

```javascript
function onXrFrame(timestamp, frame) {
    if (!frame) {
        // Non-XR frame — regular render (camera rotation from device orientation handles itself).
        phoneState.threeRenderer.render(phoneState.threeScene, phoneState.threeCamera);
        return;
    }

    const refSpace = phoneState.xrRefSpace;
    if (!refSpace) return;

    // Update reticle from hit-test.
    if (phoneState.xrHitTest && phoneState.reticle) {
        const hits = frame.getHitTestResults(phoneState.xrHitTest);
        if (hits.length > 0) {
            const hitPose = hits[0].getPose(refSpace);
            phoneState.reticle.visible = true;
            phoneState.reticle.matrix.fromArray(hitPose.transform.matrix);
        } else {
            phoneState.reticle.visible = false;
        }
    }

    // Stream viewer pose to desktop at ~20 Hz (WebXRManager may call this at 60+ fps).
    const now = performance.now();
    if (phonePeer && now - (onXrFrame._lastPoseSend ?? 0) > 50) {
        const viewerPose = frame.getViewerPose(refSpace);
        if (viewerPose) {
            phonePeer.sendPoseStream(encodeXrPose(new Float32Array(viewerPose.transform.matrix), now));
        }
        onXrFrame._lastPoseSend = now;
    }

    // Three.js render — WebXRManager applies the XR camera pose before this call.
    phoneState.threeRenderer.render(phoneState.threeScene, phoneState.threeCamera);
}
onXrFrame._lastPoseSend = 0;
```

- [ ] **Commit:**

```
git add phone.js
git commit -m "feat(phone): XR frame handler — reticle hit-test + pose streaming at 20Hz"
```

---

## Task 6: Tap-to-place and scene anchoring

**Files:**
- Modify: `phone.js`

When the user taps during the XR session, `session.select` fires. If the reticle is visible (hit-test found a surface), we anchor the snapshot root at the reticle's world-space position and show the AR controls.

- [ ] **Add the following two functions to `phone.js` (after `onXrFrame`):**

```javascript
function onXrSelect() {
    if (phoneState.scenePlaced) return;           // already placed — ignore until Reset
    if (!phoneState.reticle?.visible) return;     // no surface detected yet

    const pos = new THREE.Vector3().setFromMatrixPosition(phoneState.reticle.matrix);
    if (phoneState.snapshotRoot) {
        phoneState.snapshotRoot.position.copy(pos);
        phoneState.snapshotRoot.visible = true;
    }
    phoneState.scenePlaced = true;
    showArControls();
}

function resetArPlacement() {
    phoneState.scenePlaced = false;
    if (phoneState.snapshotRoot) phoneState.snapshotRoot.visible = false;
    document.getElementById('ar-placement-hint').style.display = 'flex';
    document.getElementById('ar-controls').style.display = 'none';
}

function showArControls() {
    document.getElementById('ar-placement-hint').style.display = 'none';
    document.getElementById('ar-controls').style.display = 'flex';
}
```

- [ ] **Commit:**

```
git add phone.js
git commit -m "feat(phone): tap-to-place — anchor snapshot root at hit-test surface on select"
```

---

## Task 7: Session-end cleanup

**Files:**
- Modify: `phone.js`

When the user taps **Exit AR** or the session ends for any reason, clean up all XR state and return to the regular camera view.

- [ ] **Add the following function to `phone.js` (after `resetArPlacement`):**

```javascript
function onXrSessionEnd() {
    // Clean up XR state.
    if (phoneState.reticle) {
        phoneState.threeScene.remove(phoneState.reticle);
        phoneState.reticle.geometry?.dispose();
        phoneState.reticle.material?.dispose();
        phoneState.reticle = null;
    }
    phoneState.xrSession = null;
    phoneState.xrRefSpace = null;
    phoneState.xrHitTest = null;
    phoneState.scenePlaced = false;

    // Make any placed snapshot visible again in non-XR render.
    if (phoneState.snapshotRoot) phoneState.snapshotRoot.visible = true;

    // Disable XR mode on the renderer; restore regular render loop.
    phoneState.threeRenderer.xr.enabled = false;
    phoneState.threeRenderer.setAnimationLoop((timestamp, frame) => {
        phoneState._xrFrame = null;
        phoneState.threeRenderer.render(phoneState.threeScene, phoneState.threeCamera);
    });

    // Hide AR overlay.
    document.getElementById('ar-overlay').style.display = 'none';
}
```

- [ ] **Commit:**

```
git add phone.js
git commit -m "feat(phone): XR session-end — remove reticle, restore non-XR render loop"
```

---

## Task 8: Make applySnapshot XR-aware

**Files:**
- Modify: `phone.js`

When a new snapshot arrives **while** an XR session is active, the scene root must start invisible and reset `scenePlaced` so the user taps to place the new scene. Outside XR, keep the existing `autoFrameSnapshot` behavior.

- [ ] **In `phone.js`, find the `applySnapshot` function. Locate the call to `autoFrameSnapshot`:**

```javascript
    // Auto-frame the snapshot in front of the phone camera. ...
    autoFrameSnapshot(root);

    const box = new THREE.Box3().setFromObject(root);
```

- [ ] **Replace `autoFrameSnapshot(root);` with:**

```javascript
    if (phoneState.xrSession) {
        // XR mode: hide until user taps to place. Reset so placement hint reappears.
        root.visible = false;
        phoneState.scenePlaced = false;
        document.getElementById('ar-placement-hint').style.display = 'flex';
        document.getElementById('ar-controls').style.display = 'none';
    } else {
        // Non-XR: auto-frame objects 1.5m in front of camera as before.
        autoFrameSnapshot(root);
    }

```

- [ ] **Commit:**

```
git add phone.js
git commit -m "feat(phone): applySnapshot hides root in XR mode until tap-to-place"
```

---

## Task 9: iOS / 3DoF mode badge

**Files:**
- Modify: `phone.js`

When WebXR is not supported, show the "3DoF Mode" badge so users know they're in rotation-only mode.

- [ ] **In `phone.js`, find `onPhonePeerConnected`. It currently has:**

```javascript
    if (xrSupported) {
        await startWebXrMode();
    }
    startOrientationLoop();
```

- [ ] **Replace with:**

```javascript
    if (xrSupported) {
        await startWebXrMode();
    } else {
        // iOS / unsupported browser — 3DoF orientation mode.
        const badge = document.getElementById('ios-mode-badge');
        if (badge) badge.style.display = 'inline-block';
    }
    startOrientationLoop();
```

- [ ] **Commit:**

```
git add phone.js
git commit -m "feat(phone): show 3DoF Mode badge on iOS / non-WebXR browsers"
```

---

## Task 10: Fix device-orientation camera rotation (iOS bug)

**Files:**
- Modify: `phone.js`

The existing `startCameraOrientationLoop` sets `camera.rotation` directly, which conflicts with Three.js's quaternion and causes gimbal lock. Fix it to use `setFromEuler` with the correct axis order for portrait-mode mobile.

- [ ] **In `phone.js`, find `startCameraOrientationLoop` and replace it entirely:**

```javascript
function startCameraOrientationLoop() {
    const euler = new THREE.Euler();
    window.addEventListener('deviceorientation', (e) => {
        latestOrientation = {
            alpha: e.alpha ?? 0,
            beta:  e.beta  ?? 0,
            gamma: e.gamma ?? 0
        };
        if (phoneState.threeCamera && !phoneState.xrSession) {
            // YXZ order matches phone portrait: alpha=compass(Y), beta=tilt-fwd(X), gamma=roll(Z).
            euler.set(
                THREE.MathUtils.degToRad(latestOrientation.beta),
                THREE.MathUtils.degToRad(latestOrientation.alpha),
                -THREE.MathUtils.degToRad(latestOrientation.gamma),
                'YXZ'
            );
            phoneState.threeCamera.quaternion.setFromEuler(euler);
        }
    });
}
```

Note: The guard `!phoneState.xrSession` ensures we don't overwrite the camera when WebXR is active (WebXRManager owns it then).

- [ ] **Commit:**

```
git add phone.js
git commit -m "fix(phone): device orientation uses quaternion setFromEuler; skip in XR mode"
```

---

## Task 11: Build and deploy

- [ ] **Build production bundle:**

```
npm run build
```

Expected: `dist/` produced with `phone.html`, `index.html`, assets. No build errors.

- [ ] **Deploy worker (picks up any changes):**

```
cd worker && npx wrangler deploy --config wrangler.toml
cd ..
```

Expected: `Deployed void-signal triggers` + URL.

- [ ] **Deploy frontend to Cloudflare Pages:**

```
npx wrangler pages deploy "C:\Users\soohu\SpatialUI\dist" --project-name=void --commit-dirty=true
```

Expected: `Deployment complete! ... void-cdf.pages.dev`

- [ ] **Push branch:**

```
git push origin Void-SpatialUI-with-phone
```

---

## Task 12: Verify on Android device

Manual verification steps (no automated test can cover WebXR AR on a real device).

- [ ] **Open the Cloudflare Pages URL on desktop. Click the phone icon. QR code appears.**

- [ ] **Scan QR with an Android phone (Chrome). Enter the 4-digit PIN. Status shows "connected".**

- [ ] **Phone shows camera feed. "Tap a surface to place your design" instruction is visible in center.**

- [ ] **Point phone at the floor or a table. Reticle ring should appear tracking the surface.**

- [ ] **Tap the surface. Canvas objects (boxes, panels, buttons from the editor) should appear at that location, anchored in world space.**

- [ ] **Walk around the placed objects. Verify they stay fixed in the room as you move.**

- [ ] **Tap "Reset placement". Objects disappear; "Tap a surface" instruction reappears.**

- [ ] **Tap "Exit AR". AR session ends; phone returns to camera-only view. Mode pill still visible.**

- [ ] **Test cancel button on desktop: open phone pairing modal, click Cancel. Modal should close.**

**If objects don't appear after tap-to-place:** Open Chrome DevTools remote debug (`chrome://inspect`) and check console for errors from `onXrSelect` or `applySnapshot`.

**If reticle never appears:** The floor may not be detected. Try pointing at a well-lit, textured surface. Check console for `requestHitTestSource` errors.

**If session refuses to start:** Confirm `dom-overlay` is supported: `navigator.xr.isSessionSupported('immersive-ar')` must resolve true, and `#ar-overlay` must be in the DOM before the session is requested.

---

## Self-Review Checklist

- [x] **Spec coverage:** All spec sections have a task — XR init fix (T4), reticle (T4), tap-to-place (T6), Reset/Exit (T6, T7), session end (T7), XR-aware snapshot (T8), iOS badge (T9), orientation fix (T10).
- [x] **Placeholders:** None — all steps contain exact code.
- [x] **Type consistency:** `phoneState.reticle` used in T4 (create), T5 (read), T7 (destroy). `phoneState.scenePlaced` used in T4 (init false), T6 (set true), T7 (reset), T8 (reset). `onXrSelect`/`resetArPlacement`/`showArControls` defined in T6, referenced in T4. `onXrSessionEnd` defined in T7, wired in T4. All consistent.
- [x] **`startXrPoseLoop` deleted in T5** — T4 no longer calls it (T4 uses `setAnimationLoop` directly).
- [x] **`onXrFrame` replaces the old `function frame()`** — the old loop is removed in T3 before T5 adds the new one. No double-render.
- [x] **`#ar-overlay` exists in DOM (T1) before `startWebXrMode` references it (T4).**
- [x] **`resetArPlacement` and `showArControls` are defined in T6, which is after T4** — execution order is fine because they're only called after the session `select` event fires, which happens after `startWebXrMode` completes.
