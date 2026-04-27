# Phone Bridge — Live Phone-to-Desktop AR Preview Design

**Date:** 2026-04-26
**Status:** Draft for review
**Replaces:** Existing QR + LAN-IP mobile preview flow (`main.js:4126-4232`, `openSpatialPreview` desktop branch at `main.js:4452-4456`).

## Summary

Replace the current QR-to-localhost mobile preview with a properly secured live link between the desktop editor and a phone-side AR client. The phone becomes the rich AR rendering surface and sensor source; the desktop receives a live composite video feed, accepts tap-to-select input from the phone, and pushes scene edits back in real time. All transport is end-to-end encrypted (WebRTC). All paths are free of cost.

## Goals

1. Eliminate manual IP entry and the "open the LAN URL on your phone first" requirement.
2. Eliminate the third-party QR rendering service that currently sees every share URL.
3. Establish HTTPS-only transport and an unguessable session token.
4. Stream the phone's camera + AR overlays live to the desktop, while desktop edits propagate back to the phone within ~100 ms.
5. Support both iOS Safari and Android Chrome with whatever each platform exposes to the open web — no native code in v1.

## Non-Goals (v1)

- LiDAR depth on iOS (Apple does not expose it to web; would require a native iOS companion).
- WebXR on iOS (Safari does not support it).
- TURN-relayed pairing (skip for v1; surface clear error on restrictive networks).
- Multi-viewer sessions (one desktop + one phone only).
- Phone-side scene editing (phone only sends taps + pose; mutations stay on desktop).
- Auto-reconnect after disconnect (force a deliberate re-pair).

## Decisions Locked During Brainstorming

| # | Question | Choice |
|---|---|---|
| Q1 | Primary user story | Bidirectional, leaning toward "phone is the AR client + sensor source." |
| Q2 | Edit propagation | Live delta sync (~100 ms target). |
| Q3 | iOS bar | RGB camera + DeviceOrientation tilt. No SLAM, no anchored placement on iOS. |
| Q4 | Desktop UX | New phone icon next to camera icon. On pair, phone feed fills ~75% of viewport; sidebars remain interactive. |
| Q5 | Selection | Tap on phone (primary) + click in layer tree (fallback). |
| Q6 | Phone scope | Active screen + prototype navigation. Edit/Play toggle on phone. |
| Q7 | Stack | Cloudflare Pages (static) + Cloudflare Worker + Durable Object signaling. WebRTC peer-to-peer for media + data. STUN only (no TURN). |
| Q8 | Pairing security | QR + 4-digit PIN. 3-strike eviction. |

## Architecture

### Three components, one repo

```
SpatialUI/
├── index.html, main.js, styles.css   (existing editor)
├── phone.html, phone.js              (new phone client)
├── shared/
│   ├── peer.js                       (RTCPeerConnection wrapper)
│   ├── protocol.js                   (message types + encode/decode)
│   └── signaling-client.js           (Worker /api/signal/* HTTP+WS client)
├── worker/src/index.js               (Worker entry, routes /api/signal/*)
├── worker/src/session-room.js        (Durable Object class)
├── vite.config.js                    (multi-entry + dev proxy)
├── wrangler.toml                     (Worker + DO config)
└── package.json                      (new deps: wrangler, concurrently, qrcode, vitest, playwright)
```

### Runtime layers

```
                Cloudflare Pages (static, HTTPS)
                ├── /                    ← editor
                └── /phone.html          ← phone client

                Cloudflare Worker (signaling only)
                └── /api/signal/*        ← Durable Object per session

[Editor]  ◄────── WebRTC peer-to-peer ──────►  [Phone]
   │ video track  ◄───── camera + UI composite stream
   │ scene-sync   ◄───── tap, mode, nav-req, hit-test (reliable, JSON)
   │ scene-sync   ─────► snapshot, delta, screen-switch, select-ack
   │ pose-stream  ◄───── pose / orientation (unreliable, binary, ~30 Hz)
   │
   └── signaling only at handshake ──► [Worker /api/signal/*]
```

The Worker handles *only* the offer/answer + ICE relay during the ~5 s handshake. Once `iceConnectionState === 'connected'`, both peers close the WS to the Worker and all further traffic flows directly between devices, encrypted by DTLS/SRTP.

## Pairing Flow (chronological)

1. **Desktop click → mint session.** Editor POSTs `/api/signal/new`. Worker generates `sessionId` (128-bit random) and `pin` (4 digits). Returns both.
2. **Desktop opens WS** to `/api/signal/ws?role=desktop&s=<sessionId>`. Worker upgrades and routes to the corresponding Durable Object.
3. **Editor renders pairing modal:** locally generated QR (using the `qrcode` npm package — no third-party API) encodes `https://<host>/phone.html#s=<sessionId>`. PIN displayed alongside. The session ID lives in the URL fragment so it never appears in any access log.
4. **Phone scans QR** → loads `phone.html#s=<sessionId>` over HTTPS. Reads sessionId from fragment.
5. **Phone shows PIN keypad.** No camera/orientation prompts yet — wait until after PIN match to avoid spurious permission requests.
6. **User enters PIN.** Phone POSTs `/api/signal/claim` with `{ sessionId, pinHash: sha256(sessionId + pin) }`.
7. **Worker verifies hash.** On match: returns one-time `claimToken`, marks room as phone-claimed, notifies desktop over its WS. On mismatch: 401, increment counter. After 3 fails: destroy session, both sides notified.
8. **Phone opens its WS** to `/api/signal/ws?role=phone&s=<sessionId>&t=<claimToken>`. DO accepts.
9. **WebRTC handshake over the room.** Desktop creates offer → phone receives → phone requests camera + orientation permissions (now is when iOS prompts fire) → phone creates answer → ICE candidates exchanged.
10. **Connection established.** Both sides close their WS to the Worker. DO eviction TTL begins counting.
11. **Initial sync.** Phone sends `{ t: 'ready', caps: {...} }`. Desktop replies with `{ t: 'snapshot', screen: <serialized active screen> }`. Phone builds Three.js scene from snapshot.
12. **Pair-mode UX activates** on both sides (see "Editor Integration" and "Phone Client" below).

## Worker / Durable Object Contract

**Routes:**
- `POST /api/signal/new` → `{ sessionId, pin }`
- `POST /api/signal/claim` body `{ sessionId, pinHash }` → `{ claimToken }` or `401`
- `GET /api/signal/ws?role=&s=&t?=` → WebSocket upgrade

**DO state (in-memory, per session):**
```js
{
  sessionId, pinHash, claimToken,
  pinAttemptsRemaining: 3,
  desktopWs?, phoneWs?,
  pendingOffer?, pendingAnswer?,
  iceQueueDesktop[], iceQueuePhone[],
  createdAt, lastActivityAt
}
```

**Lifecycle:**
- 5 min idle pre-claim → destroy.
- 10 min idle post-pair (heartbeat over WS keeps alive) → destroy.
- Both peers disconnected for 30 s → DO deallocates.
- DO never sees scene data, video, or anything from the data channel after handshake.

**Free-tier check:**
- Workers: 100 K req/day free. ~10–20 messages per pairing → ~5,000 pairings/day at the limit. Far above expected use.
- Durable Objects: 1 M req/month, 1 M storage ops/month. Free tier comfortable.
- Pages: unlimited bandwidth, free.
- STUN: Google + Cloudflare public, free.
- TURN: skipped in v1.

## Data Plane (over WebRTC)

### Three lanes share the peer connection

**Lane 1 — Video track (phone → desktop, one-way).** Standard WebRTC media; phone captures the *composite* canvas (camera + Three.js overlays merged) via `canvas.captureStream(30)` and adds the resulting track to the peer connection. Desktop attaches the incoming `MediaStream` to a `<video>` element. Browser handles encoding (~1–3 Mbps adaptive).

**Lane 2 — `scene-sync` data channel (bidirectional, ordered + reliable).** JSON messages.

**Lane 3 — `pose-stream` data channel (phone → desktop, unordered + lossy).** Binary `Float32Array` payloads.

### Message schemas

**`scene-sync`, phone → desktop:**
```js
{ t: 'ready',     platform: 'ios'|'android', caps: { webxr, depth, hitTest } }
{ t: 'tap',       x, y, vw, vh, ts }
{ t: 'hit-test',  worldPos: [x,y,z], normal: [x,y,z], ts }   // android only
{ t: 'mode',      mode: 'edit'|'play' }
{ t: 'nav-req',   targetScreenId, source: 'tap-link' }
{ t: 'resync-please' }                                       // recovery
{ t: 'bye' }                                                 // graceful close
```

**`scene-sync`, desktop → phone:**
```js
{ t: 'snapshot',       screen: {...full active screen JSON...} }
{ t: 'snapshot-chunk', i, n, data }                          // when snapshot > 16 KB
{ t: 'delta',          ops: [...] }
{ t: 'screen-switch',  screenId }
{ t: 'select-ack',     objectId }
{ t: 'bye' }
```

**Delta operation shapes:**
```js
{ op: 'create',    id, type, parentId, props: {...} }
{ op: 'delete',    id }
{ op: 'update',    id, props: { color, text, materialPreset, ... } }
{ op: 'transform', id, pos: [x,y,z], rot: [x,y,z,w], scale: [x,y,z] }
```

Apply order within a batch: `create → update/transform → delete`.

**`pose-stream`, binary format:**
```
Header byte: 0x01 = WebXR pose, 0x02 = DeviceOrientation
WebXR (33 bytes):  type + 16 floats (4×4 matrix) + 1 float (timestamp)
DeviceOrient (17): type + 3 floats (alpha,beta,gamma) + 1 float (timestamp)
```

Send rate: ~30 Hz Android (display-refresh capped), ~20 Hz iOS (DeviceOrientation throttled).

### Live delta protocol

A new helper `emitDelta(op)` is added to the editor. It checks `state.phonePairMode === 'connected'` and sends on `scene-sync` if so, no-ops otherwise. Five integration points in existing code get one `emitDelta()` call each:

1. Transform controls drag end → `transform` op
2. Properties panel input change (color, text, material) → `update` op (16 ms debounce per object)
3. Object create → `create` op
4. Object delete → `delete` op
5. Active screen switch → `screen-switch` message (whole-screen swap, not delta)

Existing object-mutation paths stay the source of truth; `emitDelta` is purely an output side effect.

### Tap-to-select round trip

1. Phone: user taps at normalized `(x, y)`.
2. Phone: sends `{ t: 'tap', x, y, vw, vh, ts }`.
3. Desktop: builds `THREE.Raycaster` from the *phone's* latest pose (from `pose-stream`) and the tap NDC. Picks closest object, sets `state.selectedObject`, refreshes properties panel.
4. Desktop: sends `{ t: 'select-ack', objectId }`.
5. Phone: highlights that object's bounding box (green wireframe `BoxHelper`) for ~1.5 s.

### Bandwidth budget

- Video: 1–3 Mbps adaptive
- `pose-stream`: < 8 KB/s peak
- `scene-sync`: ~50 KB at session start (snapshot), then sparse, < 5 KB/s during active editing

Comfortable on home Wi-Fi, 4G, 5G.

## Phone Client (`phone.html`, `phone.js`)

### Shared core

- Full-screen `<video>` (camera background, hidden on Android) + transparent `<canvas>` (Three.js overlays) + corner UI (Edit/Play toggle, status indicator, Disconnect button).
- Trimmed Three.js — no editor code, no transform controls, no gizmos.
- Snapshot/delta applier: maps `id → THREE.Object3D` via a `Map`.
- WebRTC peer with `scene-sync` + `pose-stream` data channels.
- Composite render: camera background + Three.js overlays merged in our own canvas; `canvas.captureStream(30)` is what desktop receives. Same code path on both platforms.

### iOS path (Q3 = RGB + tilt)

- `getUserMedia({ video: { facingMode: 'environment' } })`. Permission prompt fires after PIN match.
- `DeviceOrientationEvent.requestPermission()` (iOS 13+) — gated behind a user gesture, prompted right after PIN.
- Three.js camera matrix updated each frame from `(alpha, beta, gamma)`. UI sits at fixed virtual distance (~1.5 m) ahead of device. Tilts pan the UI; walking does not anchor the UI to the world (honest limit of no-SLAM).
- `pose-stream` sends DeviceOrientation records.

### Android path (full WebXR)

- `navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['depth-sensing'] })`.
- WebXR provides camera + pose + hit-test in one session. Camera is owned by WebXR (no separate `getUserMedia`).
- Our own canvas receives the WebXR scene render, then `captureStream(30)` for the desktop track.
- `pose-stream` sends pose matrices (and depth metadata when available).
- **Risk noted:** concurrent `getUserMedia` + WebXR is unreliable across Android Chrome versions. v1 commits to canvas-capture only.

### Phone UI

- Bottom-right: small `Edit | Play` toggle pill.
- Top-left: connection indicator (green = connected, red = disconnected) + session ID suffix (debug aid).
- Tap-anywhere on the AR view sends `tap`; toggle pill intercepts its own taps.
- On `select-ack`: green `BoxHelper` around selected object for ~1.5 s.
- On disconnect: full-screen overlay — *"Disconnected — close this tab. Re-scan QR from desktop to start a new session."*

## Desktop Editor Integration

### `index.html` additions

- New `<button id="btn-phone-pair" data-tool="phone-pair">` next to `btn-spatial-preview`. SVG: phone outline with QR mark. Tooltip: *"Live phone preview"*.

### `main.js` additions

- `state.phonePairMode = false | 'pairing' | 'connected'`
- `openPhonePairing()` — replaces the existing `openDesktopMobilePreviewShareDialog` (`main.js:4126`).
- Pairing modal: locally generated QR (via `qrcode` package), PIN in big numerals, "Waiting for phone…" status, Cancel button.
- `enterPairMode()` / `exitPairMode()` — swap viewport to `<video>` (`#phone-feed-video` sized to ~75 %), hide 3D canvas, show banner.
- `onPhoneTap(msg)` — Raycaster from phone pose + tap NDC, set selection, ack.
- `emitDelta(op)` — debounced, conditional output hook.
- Existing `state.raycaster` canvas-click handler is disabled while in pair-mode.

### Files touched

- ~150 LOC new in `main.js`
- ~30 LOC modified (5 `emitDelta` hooks, replace existing QR dialog function)
- ~100 LOC new in `styles.css` for pair-mode viewport + modal
- New files: `phone.html`, `phone.js`, `shared/*`, `worker/src/*`, `vite.config.js`, `wrangler.toml`

## Dev Workflow

```
npm run dev
  ├── vite dev                  on :8000  (editor + phone.html)
  └── wrangler dev worker/      on :8787  (signaling Worker)
```

`vite.config.js` proxies `/api/*` → `localhost:8787`. Both processes orchestrated by `concurrently`.

**Physical-phone testing:** `cloudflared tunnel --url http://localhost:8000` exposes a public HTTPS URL. Phone can be on cellular or any network; no LAN, no cert install. mkcert + LAN IP retained as offline fallback.

## Build & Deploy

```
npm run build       → vite builds dist/ (index.html + phone.html + chunks)
npm run deploy      → wrangler pages deploy dist/   (static)
                      wrangler deploy worker/       (Worker + DO)
```

One Cloudflare account, one `*.pages.dev` subdomain, single repo, single `npm run deploy`.

## New Dependencies

- `wrangler` (devDep) — Cloudflare CLI
- `concurrently` (devDep) — run vite + wrangler together
- `qrcode` (runtime, ~10 KB) — local QR rendering
- `vitest` (devDep) — unit + Worker tests
- `@cloudflare/vitest-pool-workers` (devDep) — Worker test environment
- `playwright` (devDep) — headless ghost-phone integration test

No frameworks added on the runtime side. Vanilla JS stays vanilla.

## Error Handling

### Pairing errors

| Failure | Surface | UX |
|---|---|---|
| Session expired | Phone after scan | *"Session expired. Re-scan the QR from your desktop."* |
| Wrong PIN (1st, 2nd) | Phone | Inline shake + counter (*"2 attempts left"*) |
| Wrong PIN (3rd) | Both | Phone: *"Too many attempts."* Desktop: *"Pairing canceled."* Session destroyed. |
| Worker unreachable | Desktop | Modal: *"Can't reach pairing server. Check connection."* |
| Stale session reused | Phone | *"This session is already in use."* |

### WebRTC handshake

- `iceConnectionState === 'failed'`: desktop banner — *"Couldn't establish a direct connection. Your network may block peer-to-peer traffic."*
- Worker WS drops mid-handshake: one silent retry within 3 s; if it fails again, surface network error.

### Phone permission denials

- Camera denied → full-screen overlay with "Tap to retry."
- DeviceOrientation denied (iOS) → continue at fixed orientation, hint shown.
- WebXR unsupported on Android → silent fallback to iOS-style path with note.

### Mid-session

- Clean disconnect: cleanup + banner on opposite side.
- Network blip: ICE auto-recovers from `'disconnected'` → `'connected'` (~30 s window). Yellow banner during gap; `'failed'` treated as full disconnect.
- iOS tab backgrounded: media tracks suspend. On `visibilitychange` foreground, attempt resume; if peer connection dead, force re-pair.
- `beforeunload` / `pagehide`: send final `{ t: 'bye' }`, close.

### Protocol divergence

- Phone receives delta with unknown id → log, send `{ t: 'resync-please' }` → desktop sends fresh `snapshot` → phone rebuilds.
- Snapshot > 16 KB: chunk via `snapshot-chunk` messages, reassemble before applying.

## Testing Approach

### Automated (every PR)

1. **Unit tests** (`vitest`):
   - `protocol.js` encode/decode round-trip (every message type).
   - Delta applier: snapshot + ops sequence → expected scene tree.
   - PIN hash: known input/output.
   - Snapshot chunking + reassembly.

2. **Worker tests** (`vitest` + `@cloudflare/vitest-pool-workers`):
   - `POST /api/signal/new` shape.
   - PIN match logic, 3-strike eviction, TTL expiry (mocked time).
   - Two simulated WS peers exchange offer/answer + ICE through the DO.
   - Stale-session reuse rejected.

3. **Smoke test** (`playwright`):
   - Ghost-phone mode: open `index.html` and `phone.html` in two tabs. Mouse simulates tap. Full pairing handshake + a few deltas + tap-to-select.

### Manual matrix (each release)

| Device | Network | Tests |
|---|---|---|
| iPhone Safari (iOS 17+) | Same Wi-Fi | Pair, tilt, tap-select, mode toggle, prototype nav, disconnect, re-pair |
| iPhone Safari | Cellular | Same as above via Cloudflare Tunnel URL |
| Android Chrome (Pixel 6+) | Same Wi-Fi | WebXR pairing, hit-test, depth metadata |
| Android Chrome (older, no WebXR) | Same Wi-Fi | Verify auto fallback to tilt mode |
| Either | Restricted Wi-Fi | Verify graceful failure with clear error |

### Explicitly NOT tested in v1

- LiDAR depth on iOS (no API).
- TURN-relayed connections (no TURN in v1).
- Multi-viewer per session (out of scope).

## Open Items / Future Work

- **iOS LiDAR + ARKit data:** would require a native iOS companion app wrapping the phone client in `WKWebView` with a JS bridge. Tracked as a v2 candidate; spec and effort estimate to be written separately.
- **Web AR via 8thWall / Niantic Lightship:** paid alternative to native iOS for SLAM on Safari. Decision deferred until v1 usage data tells us iOS tilt-only is the limiting factor.
- **TURN servers:** add when "couldn't connect" failures become a measurable problem. Open Relay Project free tier is the first option; paid Cloudflare TURN if reliability matters more than cost.
- **Multi-viewer:** several phones on one session, or two desktops watching one phone. Trivial extension of the DO room model but not needed for v1.
- **Session resume:** post-disconnect rebind with a fresh ICE pass. Requires storing a refresh token on both clients, which has its own security tradeoffs.

## Acceptance Criteria

The feature is shippable when, on a fresh Cloudflare deploy:

1. Click the phone icon in the editor → modal shows QR + 4-digit PIN within 1 s.
2. Scan QR with iPhone Safari + enter correct PIN → live camera feed appears in the desktop viewport within 5 s of PIN entry.
3. Drag a button on the desktop → phone reflects the new position within 100 ms.
4. Tap the same button on the phone → desktop properties panel switches to that button, phone shows green highlight.
5. Toggle Play mode on phone, tap a prototype-linked button → phone navigates to the linked screen, desktop's active screen syncs.
6. Same flow works on Android Chrome with WebXR depth-sensing on a supported device.
7. All flows complete without any manual IP entry, certificate install, or third-party sign-up.
