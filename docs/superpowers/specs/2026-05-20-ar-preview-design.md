# AR Preview — Design Spec

**Date:** 2026-05-20  
**Status:** Approved

---

## Goal

When a phone is paired with the Void editor, users can enter an AR mode on the phone that places their canvas objects (buttons, panels, frames) as floating holograms in their real room via the phone camera. They tap a surface to anchor the scene, walk around, and evaluate spatial sizing and feel — exactly as they would in a headset.

---

## User Flow

1. Click phone icon on desktop → QR code appears  
2. Scan with Android phone → PIN entry → pairing connects (already works)  
3. Phone shows live camera + "Tap a surface to place your design" instruction  
4. Reticle ring follows detected floor/wall surface  
5. User taps → canvas objects appear anchored at that point in world space  
6. User walks around freely — objects stay put (6DoF tracking via ARCore/WebXR)  
7. **Reset placement** button repositions the scene; **Exit AR** ends the session  
8. iOS phones: objects auto-place 2m ahead, rotate with phone (3DoF fallback, no placement flow)

---

## Platform Support

| Platform | Mode | Tracking | Placement |
|----------|------|----------|-----------|
| Android Chrome (ARCore) | WebXR `immersive-ar` | 6DoF — position + orientation | Tap-to-place via hit-test |
| iOS Safari | Device orientation (3DoF) | Rotation only | Auto-placed 2m ahead |
| Other | Device orientation (3DoF) | Rotation only | Auto-placed 2m ahead |

---

## Architecture

Everything lives on the **phone side only** — `phone.js`, `phone.html`, `styles.css`. The desktop, signaling layer, protocol, worker, and snapshot format are unchanged.

### Key Fix

`phone.js` already initializes a WebXR session but has two critical bugs that prevent AR from working:

1. `renderer.xr.enabled = true` is set **after** `renderer.xr.setSession(session)` — must be before.  
2. The regular `requestAnimationFrame` render loop runs in parallel with the XR session — these conflict. The fix: replace both loops with a single `renderer.setAnimationLoop(onFrame)` that handles both XR and non-XR rendering.

### Render Loop (unified)

```js
function onFrame(timestamp, frame) {
    if (frame && phoneState.xrHitTest) {
        const hits = frame.getHitTestResults(phoneState.xrHitTest);
        reticle.visible = hits.length > 0;
        if (hits.length > 0) {
            const pose = hits[0].getPose(phoneState.xrRefSpace);
            reticle.matrix.fromArray(pose.transform.matrix);
        }
        // Stream XR pose to desktop
        if (phonePeer) {
            const vp = frame.getViewerPose(phoneState.xrRefSpace);
            if (vp) phonePeer.sendPoseStream(encodeXrPose(new Float32Array(vp.transform.matrix), timestamp));
        }
    }
    phoneState.threeRenderer.render(phoneState.threeScene, phoneState.threeCamera);
}
phoneState.threeRenderer.setAnimationLoop(onFrame);
```

### WebXR Session Request

```js
const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'dom-overlay'],
    domOverlay: { root: document.getElementById('ar-overlay') },
    optionalFeatures: ['depth-sensing']
});
phoneState.threeRenderer.xr.enabled = true;  // BEFORE setSession
await phoneState.threeRenderer.xr.setSession(session);
```

Reference space: `local-floor` (Y=0 = detected floor, objects appear at correct heights).

### Reticle

A `THREE.RingGeometry` ring that tracks the hit-test surface each frame. `matrixAutoUpdate = false` so we write the XR pose matrix directly.

```js
const geo = new THREE.RingGeometry(0.1, 0.14, 32).rotateX(-Math.PI / 2);
const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
reticle = new THREE.Mesh(geo, mat);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
phoneState.threeScene.add(reticle);
```

### Tap-to-Place

`session.select` fires on screen tap during an XR session. When reticle is visible, extract its world position and move the snapshot root there. Hide root until first placement.

```js
session.addEventListener('select', () => {
    if (phoneState.scenePlaced || !reticle.visible) return;
    const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    if (phoneState.snapshotRoot) {
        phoneState.snapshotRoot.position.copy(pos);
        phoneState.snapshotRoot.visible = true;
    }
    phoneState.scenePlaced = true;
    showArControls();
});
```

### Coordinate Mapping

Canvas objects use editor-space coordinates (1 unit = 1 meter). The snapshot root is placed at the tap point (floor level, Y=0 of `local-floor`). A button at Y=1.5m in the editor appears 1.5m above the tap point — eye height for a standing person, matching headset rendering.

No scaling transform needed. `autoFrameSnapshot()` is skipped in XR mode.

### New Snapshot Behavior in XR Mode

When a new snapshot arrives while in XR mode:
- Reconstruct objects in the snapshot root (same as before)
- Root starts **invisible** and `scenePlaced = false`
- Re-show "Tap a surface" instruction so user can re-place the new scene

### DOM Overlay

The `#ar-overlay` div stays visible inside the WebXR session via the `dom-overlay` feature:

```
┌──────────────────────────┐
│ [AR Mode]                │  ← top-left badge
│                          │
│   Tap a surface to       │  ← center hint (hidden after placement)
│   place your design      │
│                          │
│  [Reset]    [Exit AR]    │  ← bottom bar (shown after placement)
└──────────────────────────┘
```

### iOS / 3DoF Fallback

When `immersive-ar` is not supported:
- Objects auto-placed 2m ahead in camera direction (existing `autoFrameSnapshot` behavior)
- Device orientation rotates Three.js camera (existing behavior, bug-fixed to use quaternion)
- Show `#ios-mode-badge` ("3DoF Mode") so user understands the limitation
- No tap-to-place, no reticle

### Session End

`session.end` event:
- Clears `xrSession`, `xrHitTest`, `xrRefSpace`, `reticle`
- Resets `scenePlaced = false`
- Hides `#ar-overlay`
- Re-enables non-XR render loop (setAnimationLoop continues; frame arg becomes null)
- Disables `renderer.xr.enabled` 

---

## Files Changed

| File | Change |
|------|--------|
| `phone.js` | Fix WebXR setup order, unified render loop, reticle, tap-to-place, Reset/Exit handlers, session-end cleanup, XR-aware snapshot apply, iOS badge |
| `phone.html` | Add `#ar-overlay` div, `#ios-mode-badge` span |
| `styles.css` | AR overlay badge, placement hint, controls bar styles |

**No changes to:** `main.js`, `shared/`, `worker/`, `index.html`, `vite.config.js`

---

## Research Notes

- **Apple visionOS / WorldAnchor / ARKit**: Native SDK only — not accessible from web. The concepts (world-space anchoring, local-floor reference frame, surface detection) are directly mirrored in WebXR on Android via ARCore.
- **Meta Spatial Anchors**: Unity SDK only — same concepts apply. WebXR Anchors Module (`XRAnchor`) is the web equivalent.
- **WebXR `immersive-ar`**: Supported on Android Chrome (ARCore), **not** on iOS Safari (as of 2026). iOS visionOS has WebXR VR only.
- **`local-floor` reference space**: Y=0 is the detected floor plane, matching how visionOS and Quest anchor content to the room floor.
