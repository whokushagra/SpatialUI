# Phone Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the QR-to-localhost mobile preview with a live, secure WebRTC link between the desktop editor and a phone-side AR client. Phone streams its composited camera+UI view to desktop; desktop pushes scene edits back in real time.

**Architecture:** Cloudflare Pages serves both `index.html` (editor) and `phone.html` (phone client). A Cloudflare Worker with one Durable Object per session brokers the WebRTC handshake (offer/answer + ICE) and enforces a 4-digit PIN. After handshake, both peers close their WS to the Worker and all media + data flow peer-to-peer (DTLS/SRTP encrypted).

**Tech Stack:** Vanilla ES6, Three.js (existing), Vite (multi-entry), Cloudflare Workers + Durable Objects, WebRTC, vitest, @cloudflare/vitest-pool-workers, playwright, qrcode (npm), concurrently.

**Spec reference:** `docs/superpowers/specs/2026-04-26-phone-bridge-design.md`

---

## Conventions for this plan

- **Working directory:** repo root, `C:\Users\soohu\SpatialUI`.
- **Commit cadence:** every task ends in a commit. Small, frequent commits are mandatory.
- **Test runner:** `npx vitest run <path>` for non-Worker tests; `npx vitest run --project=worker <path>` for Worker tests; `npx playwright test <path>` for the smoke test.
- **No emojis in commit messages.** Match existing repo style: short imperative subject.
- **One sub-step ≈ one terminal action ≈ 2–5 minutes.** Don't batch.

---

## Phase 1 — Project Foundation & Scaffold

### Task 1.1: Add new dev/runtime dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit `package.json`**

```json
{
  "name": "void",
  "version": "0.1.0",
  "description": "Void - Designer-First XR UI Platform",
  "scripts": {
    "dev": "concurrently -n vite,worker -c blue,magenta \"vite\" \"wrangler dev --local --port 8787 --config worker/wrangler.toml\"",
    "dev:tunnel": "concurrently -n vite,worker,tunnel \"vite\" \"wrangler dev --local --port 8787 --config worker/wrangler.toml\" \"cloudflared tunnel --url http://localhost:8000\"",
    "build": "vite build",
    "preview": "vite preview",
    "deploy:pages": "vite build && wrangler pages deploy dist/ --project-name=void",
    "deploy:worker": "wrangler deploy --config worker/wrangler.toml",
    "deploy": "npm run deploy:worker && npm run deploy:pages",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.1",
    "qrcode": "^1.5.4",
    "three": "^0.160.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@playwright/test": "^1.47.0",
    "concurrently": "^9.0.0",
    "vite": "^5.0.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.78.0",
    "xlsx": "^0.18.5"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: lockfile updates, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add wrangler, vitest, playwright, qrcode, concurrently deps for phone bridge"
```

---

### Task 1.2: Multi-entry Vite config with `/api` proxy

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Replace `vite.config.js`**

```js
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: {
    port: 8000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'index.html'),
        phone: resolve(__dirname, 'phone.html')
      }
    }
  }
})
```

- [ ] **Step 2: Run `npm run build` to verify config parses**

Run: `npm run build`
Expected: `vite build` errors on missing `phone.html` — that's expected and fixed in Task 1.3.

- [ ] **Step 3: Commit**

```bash
git add vite.config.js
git commit -m "Vite multi-entry config with editor + phone entries and /api proxy"
```

---

### Task 1.3: Stub `phone.html`

**Files:**
- Create: `phone.html`

- [ ] **Step 1: Create `phone.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <title>Void Phone Preview</title>
    <link rel="stylesheet" href="/styles.css" />
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; color: #fff; font-family: Inter, system-ui, sans-serif; }
        #phone-root { position: fixed; inset: 0; }
        #phone-camera-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        #phone-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
        #phone-status { position: absolute; top: 10px; left: 10px; font-size: 12px; opacity: 0.7; }
    </style>
</head>
<body>
    <div id="phone-root">
        <video id="phone-camera-bg" autoplay playsinline muted></video>
        <canvas id="phone-canvas"></canvas>
        <div id="phone-status">phone client booting…</div>
    </div>
    <script type="module" src="/phone.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create stub `phone.js`**

```js
const status = document.getElementById('phone-status');
status.textContent = `phone.html loaded — fragment: ${window.location.hash || '(none)'}`;
```

Save to: `phone.js`

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build`
Expected: `dist/` contains both `index.html` and `phone.html`. No errors.

- [ ] **Step 4: Commit**

```bash
git add phone.html phone.js
git commit -m "Add phone.html + phone.js stub entries"
```

---

### Task 1.4: Wrangler config for Worker + Durable Object

**Files:**
- Create: `worker/wrangler.toml`

- [ ] **Step 1: Create `worker/wrangler.toml`**

```toml
name = "void-signal"
main = "src/index.js"
compatibility_date = "2025-01-01"

[durable_objects]
bindings = [
  { name = "SESSION_ROOM", class_name = "SessionRoom" }
]

[[migrations]]
tag = "v1"
new_classes = ["SessionRoom"]

[dev]
port = 8787
```

- [ ] **Step 2: Create empty Worker stub**

Create: `worker/src/index.js`

```js
export { SessionRoom } from './session-room.js';

export default {
    async fetch(request, env) {
        return new Response('void-signal: not implemented yet', { status: 501 });
    }
};
```

Create: `worker/src/session-room.js`

```js
export class SessionRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }
    async fetch(request) {
        return new Response('SessionRoom: not implemented yet', { status: 501 });
    }
}
```

- [ ] **Step 3: Smoke-test Worker boot**

Run: `npx wrangler dev --local --port 8787 --config worker/wrangler.toml --once` — wait for "Ready" then Ctrl+C.
Expected: starts without error, prints listening on `http://localhost:8787`.

- [ ] **Step 4: Commit**

```bash
git add worker/
git commit -m "Worker scaffold: wrangler config + Worker entry + SessionRoom stub"
```

---

### Task 1.5: Vitest config for both Node and Worker tests

**Files:**
- Create: `vitest.config.js`
- Create: `vitest.workers.config.js`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/unit/**/*.test.js', 'shared/**/*.test.js']
    }
})
```

- [ ] **Step 2: Create `vitest.workers.config.js`**

```js
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
    test: {
        include: ['tests/worker/**/*.test.js'],
        poolOptions: {
            workers: {
                wrangler: { configPath: './worker/wrangler.toml' }
            }
        }
    }
})
```

- [ ] **Step 3: Update `package.json` test scripts**

Replace the `test` and `test:watch` entries:

```json
"test": "vitest run --config vitest.config.js && vitest run --config vitest.workers.config.js",
"test:watch": "vitest --config vitest.config.js",
"test:worker": "vitest run --config vitest.workers.config.js",
```

- [ ] **Step 4: Sanity-check vitest boots**

Create: `tests/unit/sanity.test.js`

```js
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
    it('1 + 1 === 2', () => {
        expect(1 + 1).toBe(2);
    });
});
```

Run: `npm run test`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js vitest.workers.config.js tests/ package.json
git commit -m "Vitest configs for Node and Cloudflare Worker test pools"
```

---

### Task 1.6: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append to `.gitignore`**

```
.wrangler/
playwright-report/
test-results/
.dev.vars
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "Ignore wrangler local state and playwright outputs"
```

---

## Phase 2 — Shared Protocol Module

### Task 2.1: Define message types (TDD)

**Files:**
- Create: `shared/protocol.js`
- Create: `shared/protocol.test.js`

- [ ] **Step 1: Write failing test**

Create `shared/protocol.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { MSG } from './protocol.js';

describe('MSG constants', () => {
    it('exposes message type strings used by both peers', () => {
        expect(MSG.READY).toBe('ready');
        expect(MSG.TAP).toBe('tap');
        expect(MSG.HIT_TEST).toBe('hit-test');
        expect(MSG.MODE).toBe('mode');
        expect(MSG.NAV_REQ).toBe('nav-req');
        expect(MSG.RESYNC_PLEASE).toBe('resync-please');
        expect(MSG.BYE).toBe('bye');
        expect(MSG.SNAPSHOT).toBe('snapshot');
        expect(MSG.SNAPSHOT_CHUNK).toBe('snapshot-chunk');
        expect(MSG.DELTA).toBe('delta');
        expect(MSG.SCREEN_SWITCH).toBe('screen-switch');
        expect(MSG.SELECT_ACK).toBe('select-ack');
    });
});
```

- [ ] **Step 2: Run failing test**

Run: `npm run test`
Expected: FAIL — `MSG` import fails.

- [ ] **Step 3: Implement**

Create `shared/protocol.js`:

```js
export const MSG = Object.freeze({
    READY: 'ready',
    TAP: 'tap',
    HIT_TEST: 'hit-test',
    MODE: 'mode',
    NAV_REQ: 'nav-req',
    RESYNC_PLEASE: 'resync-please',
    BYE: 'bye',
    SNAPSHOT: 'snapshot',
    SNAPSHOT_CHUNK: 'snapshot-chunk',
    DELTA: 'delta',
    SCREEN_SWITCH: 'screen-switch',
    SELECT_ACK: 'select-ack'
});
```

- [ ] **Step 4: Run test**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.js shared/protocol.test.js
git commit -m "shared/protocol: MSG constants + tests"
```

---

### Task 2.2: JSON encode/decode for `scene-sync` channel

**Files:**
- Modify: `shared/protocol.js`
- Modify: `shared/protocol.test.js`

- [ ] **Step 1: Append failing tests**

Append to `shared/protocol.test.js`:

```js
import { encodeSceneSync, decodeSceneSync } from './protocol.js';

describe('scene-sync codec', () => {
    it('round-trips a tap message', () => {
        const original = { t: MSG.TAP, x: 0.5, y: 0.25, vw: 390, vh: 844, ts: 1700000000 };
        const wire = encodeSceneSync(original);
        expect(typeof wire).toBe('string');
        const back = decodeSceneSync(wire);
        expect(back).toEqual(original);
    });
    it('returns null for malformed input', () => {
        expect(decodeSceneSync('not json')).toBeNull();
    });
    it('rejects messages without a t field', () => {
        expect(decodeSceneSync(JSON.stringify({ foo: 1 }))).toBeNull();
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Append to `shared/protocol.js`:

```js
export function encodeSceneSync(message) {
    return JSON.stringify(message);
}

export function decodeSceneSync(wire) {
    try {
        const parsed = JSON.parse(wire);
        if (!parsed || typeof parsed.t !== 'string') return null;
        return parsed;
    } catch {
        return null;
    }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.js shared/protocol.test.js
git commit -m "shared/protocol: scene-sync JSON codec with null-on-malformed contract"
```

---

### Task 2.3: Binary `pose-stream` codec

**Files:**
- Modify: `shared/protocol.js`
- Modify: `shared/protocol.test.js`

- [ ] **Step 1: Append failing tests**

Append to `shared/protocol.test.js`:

```js
import { encodeXrPose, encodeOrientation, decodePose, POSE_TYPE_XR, POSE_TYPE_ORIENT } from './protocol.js';

describe('pose-stream codec', () => {
    it('round-trips an XR pose matrix', () => {
        const m = new Float32Array(16);
        for (let i = 0; i < 16; i++) m[i] = i * 0.1;
        const ts = 1234.5;
        const buf = encodeXrPose(m, ts);
        const decoded = decodePose(buf);
        expect(decoded.kind).toBe(POSE_TYPE_XR);
        expect(decoded.matrix).toBeInstanceOf(Float32Array);
        expect(decoded.matrix.length).toBe(16);
        for (let i = 0; i < 16; i++) expect(decoded.matrix[i]).toBeCloseTo(i * 0.1, 5);
        expect(decoded.ts).toBeCloseTo(ts, 2);
    });
    it('round-trips a DeviceOrientation triple', () => {
        const buf = encodeOrientation(10, 20, 30, 99);
        const decoded = decodePose(buf);
        expect(decoded.kind).toBe(POSE_TYPE_ORIENT);
        expect(decoded.alpha).toBeCloseTo(10, 5);
        expect(decoded.beta).toBeCloseTo(20, 5);
        expect(decoded.gamma).toBeCloseTo(30, 5);
        expect(decoded.ts).toBeCloseTo(99, 2);
    });
    it('returns null on unknown header', () => {
        const buf = new ArrayBuffer(2);
        new DataView(buf).setUint8(0, 0xff);
        expect(decodePose(buf)).toBeNull();
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Append to `shared/protocol.js`:

```js
export const POSE_TYPE_XR = 0x01;
export const POSE_TYPE_ORIENT = 0x02;

export function encodeXrPose(matrix16, ts) {
    const buf = new ArrayBuffer(1 + 16 * 4 + 4);
    const view = new DataView(buf);
    view.setUint8(0, POSE_TYPE_XR);
    for (let i = 0; i < 16; i++) view.setFloat32(1 + i * 4, matrix16[i], true);
    view.setFloat32(1 + 16 * 4, ts, true);
    return buf;
}

export function encodeOrientation(alpha, beta, gamma, ts) {
    const buf = new ArrayBuffer(1 + 3 * 4 + 4);
    const view = new DataView(buf);
    view.setUint8(0, POSE_TYPE_ORIENT);
    view.setFloat32(1, alpha, true);
    view.setFloat32(5, beta, true);
    view.setFloat32(9, gamma, true);
    view.setFloat32(13, ts, true);
    return buf;
}

export function decodePose(buf) {
    if (!buf || buf.byteLength < 5) return null;
    const view = new DataView(buf);
    const kind = view.getUint8(0);
    if (kind === POSE_TYPE_XR) {
        if (buf.byteLength < 1 + 16 * 4 + 4) return null;
        const matrix = new Float32Array(16);
        for (let i = 0; i < 16; i++) matrix[i] = view.getFloat32(1 + i * 4, true);
        const ts = view.getFloat32(1 + 16 * 4, true);
        return { kind, matrix, ts };
    }
    if (kind === POSE_TYPE_ORIENT) {
        if (buf.byteLength < 1 + 3 * 4 + 4) return null;
        return {
            kind,
            alpha: view.getFloat32(1, true),
            beta: view.getFloat32(5, true),
            gamma: view.getFloat32(9, true),
            ts: view.getFloat32(13, true)
        };
    }
    return null;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.js shared/protocol.test.js
git commit -m "shared/protocol: binary pose-stream codec for XR matrix and DeviceOrientation"
```

---

### Task 2.4: Snapshot chunking

**Files:**
- Modify: `shared/protocol.js`
- Modify: `shared/protocol.test.js`

- [ ] **Step 1: Append failing tests**

Append to `shared/protocol.test.js`:

```js
import { chunkSnapshot, SnapshotReassembler } from './protocol.js';

describe('snapshot chunking', () => {
    it('chunks a large snapshot and reassembles', () => {
        const big = { t: MSG.SNAPSHOT, screen: { id: 's1', objects: 'x'.repeat(40000) } };
        const chunks = chunkSnapshot(big, 8000);
        expect(chunks.length).toBeGreaterThan(1);
        chunks.forEach((c, i) => {
            expect(c.t).toBe(MSG.SNAPSHOT_CHUNK);
            expect(c.i).toBe(i);
            expect(c.n).toBe(chunks.length);
        });
        const reasm = new SnapshotReassembler();
        let final = null;
        for (const c of chunks) {
            const r = reasm.feed(c);
            if (r) final = r;
        }
        expect(final).toEqual(big);
    });
    it('returns the message unchunked when small enough', () => {
        const small = { t: MSG.SNAPSHOT, screen: { id: 's1' } };
        const chunks = chunkSnapshot(small, 8000);
        expect(chunks.length).toBe(1);
        expect(chunks[0].t).toBe(MSG.SNAPSHOT);
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Append to `shared/protocol.js`:

```js
export function chunkSnapshot(message, maxBytes = 14000) {
    const wire = JSON.stringify(message);
    if (wire.length <= maxBytes) return [message];
    const parts = [];
    for (let off = 0; off < wire.length; off += maxBytes) {
        parts.push(wire.slice(off, off + maxBytes));
    }
    return parts.map((data, i) => ({ t: MSG.SNAPSHOT_CHUNK, i, n: parts.length, data }));
}

export class SnapshotReassembler {
    constructor() {
        this.parts = [];
        this.expected = 0;
    }
    feed(chunk) {
        if (chunk.t !== MSG.SNAPSHOT_CHUNK) return null;
        if (this.expected === 0) {
            this.expected = chunk.n;
            this.parts = new Array(chunk.n);
        }
        this.parts[chunk.i] = chunk.data;
        if (this.parts.filter(Boolean).length !== this.expected) return null;
        const wire = this.parts.join('');
        this.parts = [];
        this.expected = 0;
        try {
            return JSON.parse(wire);
        } catch {
            return null;
        }
    }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.js shared/protocol.test.js
git commit -m "shared/protocol: snapshot chunking + reassembler"
```

---

### Task 2.5: PIN hash helper

**Files:**
- Modify: `shared/protocol.js`
- Modify: `shared/protocol.test.js`

- [ ] **Step 1: Append failing test**

Append to `shared/protocol.test.js`:

```js
import { hashPin } from './protocol.js';

describe('hashPin', () => {
    it('produces a stable hex SHA-256 over sessionId + pin', async () => {
        const a = await hashPin('abc', '1234');
        const b = await hashPin('abc', '1234');
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
    });
    it('differs across different inputs', async () => {
        const a = await hashPin('abc', '1234');
        const b = await hashPin('abc', '1235');
        expect(a).not.toBe(b);
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test`
Expected: FAIL — `hashPin` undefined.

- [ ] **Step 3: Implement**

Append to `shared/protocol.js`:

```js
export async function hashPin(sessionId, pin) {
    const msg = new TextEncoder().encode(`${sessionId}:${pin}`);
    const hash = await crypto.subtle.digest('SHA-256', msg);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.js shared/protocol.test.js
git commit -m "shared/protocol: SHA-256 hashPin(sessionId, pin)"
```

---

## Phase 3 — Signaling Worker (Worker + Durable Object)

### Task 3.1: Worker route — `POST /api/signal/new`

**Files:**
- Modify: `worker/src/index.js`
- Modify: `worker/src/session-room.js`
- Create: `tests/worker/signal-new.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/worker/signal-new.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('POST /api/signal/new', () => {
    it('returns sessionId and 4-digit pin', async () => {
        const res = await SELF.fetch('http://x/api/signal/new', { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(typeof body.sessionId).toBe('string');
        expect(body.sessionId.length).toBe(32);
        expect(body.pin).toMatch(/^\d{4}$/);
    });
    it('rejects GET', async () => {
        const res = await SELF.fetch('http://x/api/signal/new');
        expect(res.status).toBe(405);
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test:worker`
Expected: FAIL — Worker still returns 501.

- [ ] **Step 3: Implement Worker route**

Replace `worker/src/index.js`:

```js
export { SessionRoom } from './session-room.js';

function randHex(bytes) {
    const arr = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function randPin() {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
    return n.toString().padStart(4, '0');
}

async function handleSignalNew(request, env) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const sessionId = randHex(16);
    const pin = randPin();
    const id = env.SESSION_ROOM.idFromName(sessionId);
    const stub = env.SESSION_ROOM.get(id);
    await stub.fetch('http://room/init', {
        method: 'POST',
        body: JSON.stringify({ sessionId, pin })
    });
    return Response.json({ sessionId, pin });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/signal/new') return handleSignalNew(request, env);
        return new Response('not found', { status: 404 });
    }
};
```

Replace `worker/src/session-room.js`:

```js
export class SessionRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.sessionId = null;
        this.pinHash = null;
        this.plainPin = null;
        this.pinAttemptsRemaining = 3;
        this.claimToken = null;
        this.createdAt = Date.now();
        this.lastActivityAt = Date.now();
        this.desktopWs = null;
        this.phoneWs = null;
    }
    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/init' && request.method === 'POST') {
            const { sessionId, pin } = await request.json();
            this.sessionId = sessionId;
            this.plainPin = pin;
            this.lastActivityAt = Date.now();
            return new Response('ok');
        }
        return new Response('not found', { status: 404 });
    }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/ tests/
git commit -m "worker: POST /api/signal/new mints sessionId + 4-digit PIN, stores in DO"
```

---

### Task 3.2: Worker route — `POST /api/signal/claim`

**Files:**
- Modify: `worker/src/index.js`
- Modify: `worker/src/session-room.js`
- Create: `tests/worker/signal-claim.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/worker/signal-claim.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function newSession() {
    const res = await SELF.fetch('http://x/api/signal/new', { method: 'POST' });
    return res.json();
}

async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('POST /api/signal/claim', () => {
    it('returns claimToken when PIN matches', async () => {
        const { sessionId, pin } = await newSession();
        const pinHash = await sha256Hex(`${sessionId}:${pin}`);
        const res = await SELF.fetch('http://x/api/signal/claim', {
            method: 'POST',
            body: JSON.stringify({ sessionId, pinHash })
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(typeof body.claimToken).toBe('string');
        expect(body.claimToken.length).toBeGreaterThan(16);
    });
    it('returns 401 when PIN is wrong, with attemptsRemaining decremented', async () => {
        const { sessionId } = await newSession();
        const wrongHash = await sha256Hex(`${sessionId}:0000-wrong`);
        const res = await SELF.fetch('http://x/api/signal/claim', {
            method: 'POST',
            body: JSON.stringify({ sessionId, pinHash: wrongHash })
        });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.attemptsRemaining).toBe(2);
    });
    it('destroys the session after 3 wrong PINs', async () => {
        const { sessionId } = await newSession();
        const wrongHash = await sha256Hex(`${sessionId}:wrong`);
        for (let i = 0; i < 3; i++) {
            await SELF.fetch('http://x/api/signal/claim', {
                method: 'POST',
                body: JSON.stringify({ sessionId, pinHash: wrongHash })
            });
        }
        const final = await SELF.fetch('http://x/api/signal/claim', {
            method: 'POST',
            body: JSON.stringify({ sessionId, pinHash: wrongHash })
        });
        expect(final.status).toBe(404);
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test:worker`
Expected: FAIL — `claim` route does not exist.

- [ ] **Step 3: Implement claim route in `worker/src/index.js`**

Insert before the default export, and update the `fetch` switch:

```js
async function handleSignalClaim(request, env) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const { sessionId, pinHash } = await request.json();
    if (!sessionId || !pinHash) return new Response('bad request', { status: 400 });
    const id = env.SESSION_ROOM.idFromName(sessionId);
    const stub = env.SESSION_ROOM.get(id);
    return stub.fetch('http://room/claim', {
        method: 'POST',
        body: JSON.stringify({ pinHash })
    });
}
```

Update the `fetch` default export:

```js
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/signal/new') return handleSignalNew(request, env);
        if (url.pathname === '/api/signal/claim') return handleSignalClaim(request, env);
        return new Response('not found', { status: 404 });
    }
};
```

- [ ] **Step 4: Implement claim handler in `worker/src/session-room.js`**

Add to the `SessionRoom.fetch` switch (before the existing `not found`):

```js
        if (url.pathname === '/claim' && request.method === 'POST') {
            if (!this.sessionId) return new Response('not found', { status: 404 });
            const { pinHash } = await request.json();
            const expected = await sha256Hex(`${this.sessionId}:${this.plainPin}`);
            if (pinHash !== expected) {
                this.pinAttemptsRemaining -= 1;
                if (this.pinAttemptsRemaining <= 0) {
                    this.sessionId = null;
                    this.plainPin = null;
                    return new Response('not found', { status: 404 });
                }
                return Response.json({ attemptsRemaining: this.pinAttemptsRemaining }, { status: 401 });
            }
            if (!this.claimToken) this.claimToken = randHex(24);
            this.lastActivityAt = Date.now();
            return Response.json({ claimToken: this.claimToken });
        }
```

At the top of `worker/src/session-room.js`, add helpers:

```js
function randHex(bytes) {
    const arr = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `npm run test:worker`
Expected: PASS (all three claim tests).

- [ ] **Step 6: Commit**

```bash
git add worker/ tests/
git commit -m "worker: POST /api/signal/claim with PIN hash check + 3-strike eviction"
```

---

### Task 3.3: WebSocket relay — desktop role

**Files:**
- Modify: `worker/src/index.js`
- Modify: `worker/src/session-room.js`
- Create: `tests/worker/signal-ws.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/worker/signal-ws.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function newSession() {
    const res = await SELF.fetch('http://x/api/signal/new', { method: 'POST' });
    return res.json();
}

function openWs(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.addEventListener('open', () => resolve(ws), { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
}

describe('WS /api/signal/ws', () => {
    it('accepts a desktop role connection', async () => {
        const { sessionId } = await newSession();
        const res = await SELF.fetch(`http://x/api/signal/ws?role=desktop&s=${sessionId}`, {
            headers: { Upgrade: 'websocket' }
        });
        expect(res.status).toBe(101);
        expect(res.webSocket).toBeDefined();
    });
    it('rejects unknown role', async () => {
        const { sessionId } = await newSession();
        const res = await SELF.fetch(`http://x/api/signal/ws?role=other&s=${sessionId}`, {
            headers: { Upgrade: 'websocket' }
        });
        expect(res.status).toBe(400);
    });
    it('rejects unknown session', async () => {
        const res = await SELF.fetch(`http://x/api/signal/ws?role=desktop&s=nosuch`, {
            headers: { Upgrade: 'websocket' }
        });
        expect(res.status).toBe(404);
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test:worker`
Expected: FAIL — WS route absent.

- [ ] **Step 3: Implement Worker WS route**

Add to `worker/src/index.js`:

```js
async function handleSignalWs(request, env) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const sessionId = url.searchParams.get('s');
    const claimToken = url.searchParams.get('t') || null;
    if (role !== 'desktop' && role !== 'phone') return new Response('bad role', { status: 400 });
    if (!sessionId) return new Response('missing session', { status: 400 });
    const id = env.SESSION_ROOM.idFromName(sessionId);
    const stub = env.SESSION_ROOM.get(id);
    return stub.fetch(`http://room/ws?role=${role}&t=${claimToken ?? ''}`, request);
}
```

Update `fetch` default export:

```js
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/signal/new') return handleSignalNew(request, env);
        if (url.pathname === '/api/signal/claim') return handleSignalClaim(request, env);
        if (url.pathname === '/api/signal/ws') return handleSignalWs(request, env);
        return new Response('not found', { status: 404 });
    }
};
```

- [ ] **Step 4: Implement DO `/ws` handler**

Add to `SessionRoom.fetch` switch:

```js
        if (url.pathname === '/ws') {
            if (!this.sessionId) return new Response('not found', { status: 404 });
            const role = url.searchParams.get('role');
            const claimToken = url.searchParams.get('t');
            if (role === 'phone' && claimToken !== this.claimToken) {
                return new Response('forbidden', { status: 403 });
            }
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            server.accept();
            this.attachSocket(server, role);
            return new Response(null, { status: 101, webSocket: client });
        }
```

Add `attachSocket` to the class body:

```js
    attachSocket(ws, role) {
        if (role === 'desktop') this.desktopWs = ws;
        if (role === 'phone') this.phoneWs = ws;
        ws.addEventListener('message', (e) => this.onSocketMessage(role, e.data));
        ws.addEventListener('close', () => {
            if (role === 'desktop' && this.desktopWs === ws) this.desktopWs = null;
            if (role === 'phone' && this.phoneWs === ws) this.phoneWs = null;
        });
    }

    onSocketMessage(_role, _data) {
        // relay implementation comes in Task 3.4
    }
```

- [ ] **Step 5: Run, expect PASS**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/ tests/
git commit -m "worker: WS /api/signal/ws — accept desktop+phone, reject unknown role/session"
```

---

### Task 3.4: WS relay — forward signaling messages between peers

**Files:**
- Modify: `worker/src/session-room.js`
- Modify: `tests/worker/signal-ws.test.js`

- [ ] **Step 1: Append failing test**

Append to `tests/worker/signal-ws.test.js`:

```js
async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pairAndConnect() {
    const { sessionId, pin } = await newSession();
    const pinHash = await sha256Hex(`${sessionId}:${pin}`);
    const claimRes = await SELF.fetch('http://x/api/signal/claim', {
        method: 'POST',
        body: JSON.stringify({ sessionId, pinHash })
    });
    const { claimToken } = await claimRes.json();
    const desk = await openWs(`http://x/api/signal/ws?role=desktop&s=${sessionId}`);
    const phone = await openWs(`http://x/api/signal/ws?role=phone&s=${sessionId}&t=${claimToken}`);
    return { desk, phone };
}

it('relays messages from desktop to phone', async () => {
    const { desk, phone } = await pairAndConnect();
    const got = new Promise((resolve) => phone.addEventListener('message', (e) => resolve(e.data), { once: true }));
    desk.send(JSON.stringify({ kind: 'offer', sdp: 'v=0...' }));
    expect(JSON.parse(await got)).toEqual({ kind: 'offer', sdp: 'v=0...' });
});

it('relays messages from phone to desktop', async () => {
    const { desk, phone } = await pairAndConnect();
    const got = new Promise((resolve) => desk.addEventListener('message', (e) => resolve(e.data), { once: true }));
    phone.send(JSON.stringify({ kind: 'answer', sdp: 'v=0...' }));
    expect(JSON.parse(await got)).toEqual({ kind: 'answer', sdp: 'v=0...' });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test:worker`
Expected: FAIL — `onSocketMessage` is a no-op.

- [ ] **Step 3: Implement message forwarding**

Replace the `onSocketMessage` stub in `worker/src/session-room.js`:

```js
    onSocketMessage(role, data) {
        this.lastActivityAt = Date.now();
        const target = role === 'desktop' ? this.phoneWs : this.desktopWs;
        if (!target) return;
        try {
            target.send(typeof data === 'string' ? data : new Uint8Array(data));
        } catch {
            // peer gone; close handler will clean up
        }
    }
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/ tests/
git commit -m "worker: WS relay forwards signaling messages between desktop and phone"
```

---

### Task 3.5: Idle TTL eviction

**Files:**
- Modify: `worker/src/session-room.js`
- Create: `tests/worker/signal-ttl.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/worker/signal-ttl.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('session TTL', () => {
    it('expires sessions older than 5 minutes pre-claim', async () => {
        vi.useFakeTimers();
        try {
            const res = await SELF.fetch('http://x/api/signal/new', { method: 'POST' });
            const { sessionId } = await res.json();
            vi.advanceTimersByTime(5 * 60 * 1000 + 100);
            const claimRes = await SELF.fetch('http://x/api/signal/claim', {
                method: 'POST',
                body: JSON.stringify({ sessionId, pinHash: 'whatever' })
            });
            expect(claimRes.status).toBe(404);
        } finally {
            vi.useRealTimers();
        }
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test:worker`
Expected: FAIL — TTL not enforced.

- [ ] **Step 3: Implement TTL check on claim**

Replace the `/claim` handler's first non-trivial check (in `worker/src/session-room.js`):

```js
        if (url.pathname === '/claim' && request.method === 'POST') {
            if (!this.sessionId) return new Response('not found', { status: 404 });
            const idleMs = Date.now() - this.lastActivityAt;
            const claimed = !!this.claimToken;
            const ttl = claimed ? 10 * 60 * 1000 : 5 * 60 * 1000;
            if (idleMs > ttl) {
                this.sessionId = null;
                this.plainPin = null;
                this.claimToken = null;
                return new Response('not found', { status: 404 });
            }
            // ... rest unchanged
```

(Keep the rest of the handler — PIN hash check, attempts logic — as-is below the new block.)

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/ tests/
git commit -m "worker: idle TTL eviction (5 min pre-claim, 10 min post-pair)"
```

---

## Phase 4 — Signaling Client (Shared)

### Task 4.1: HTTP helpers (`signal-new`, `signal-claim`)

**Files:**
- Create: `shared/signaling-client.js`
- Create: `shared/signaling-client.test.js`

- [ ] **Step 1: Write failing test**

Create `shared/signaling-client.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { signalNew, signalClaim } from './signaling-client.js';

describe('signaling-client HTTP', () => {
    it('signalNew POSTs and returns sessionId+pin', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ sessionId: 'abc', pin: '1234' })
        });
        const result = await signalNew({ baseUrl: '/api/signal', fetchImpl: fetchMock });
        expect(result).toEqual({ sessionId: 'abc', pin: '1234' });
        expect(fetchMock).toHaveBeenCalledWith('/api/signal/new', { method: 'POST' });
    });
    it('signalClaim returns claimToken on success', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ claimToken: 'tok123' })
        });
        const result = await signalClaim({ sessionId: 'abc', pinHash: 'h', baseUrl: '/api/signal', fetchImpl: fetchMock });
        expect(result).toEqual({ status: 'ok', claimToken: 'tok123' });
    });
    it('signalClaim returns wrong-pin status on 401', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: async () => ({ attemptsRemaining: 2 })
        });
        const result = await signalClaim({ sessionId: 'abc', pinHash: 'h', baseUrl: '/api/signal', fetchImpl: fetchMock });
        expect(result).toEqual({ status: 'wrong-pin', attemptsRemaining: 2 });
    });
    it('signalClaim returns gone status on 404', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            json: async () => ({})
        });
        const result = await signalClaim({ sessionId: 'abc', pinHash: 'h', baseUrl: '/api/signal', fetchImpl: fetchMock });
        expect(result).toEqual({ status: 'gone' });
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `shared/signaling-client.js`:

```js
export async function signalNew({ baseUrl = '/api/signal', fetchImpl = fetch } = {}) {
    const res = await fetchImpl(`${baseUrl}/new`, { method: 'POST' });
    if (!res.ok) throw new Error(`signal/new failed: ${res.status}`);
    return res.json();
}

export async function signalClaim({ sessionId, pinHash, baseUrl = '/api/signal', fetchImpl = fetch }) {
    const res = await fetchImpl(`${baseUrl}/claim`, {
        method: 'POST',
        body: JSON.stringify({ sessionId, pinHash })
    });
    if (res.status === 200) {
        const { claimToken } = await res.json();
        return { status: 'ok', claimToken };
    }
    if (res.status === 401) {
        const { attemptsRemaining } = await res.json();
        return { status: 'wrong-pin', attemptsRemaining };
    }
    if (res.status === 404) return { status: 'gone' };
    throw new Error(`signal/claim unexpected status: ${res.status}`);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/signaling-client.js shared/signaling-client.test.js
git commit -m "shared/signaling-client: signalNew + signalClaim HTTP helpers"
```

---

### Task 4.2: WebSocket connector

**Files:**
- Modify: `shared/signaling-client.js`

- [ ] **Step 1: Append implementation (no separate test — manual smoke later)**

Append to `shared/signaling-client.js`:

```js
export function openSignalingSocket({ sessionId, role, claimToken = null, baseWsUrl }) {
    const url = new URL(baseWsUrl);
    url.searchParams.set('role', role);
    url.searchParams.set('s', sessionId);
    if (claimToken) url.searchParams.set('t', claimToken);
    return new WebSocket(url.toString());
}

export function inferWsBase(httpBase = window.location.origin) {
    const u = new URL('/api/signal/ws', httpBase);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.toString();
}
```

- [ ] **Step 2: Smoke-check exports compile**

Run: `npm run test`
Expected: existing tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/signaling-client.js
git commit -m "shared/signaling-client: WebSocket connector + HTTP→WS base inference"
```

---

## Phase 5 — Desktop Pairing Modal

### Task 5.1: Add phone pairing button to toolbar

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Find the spatial preview button**

Open `index.html` and locate the button with `id="btn-spatial-preview"`. Insert a new button immediately before or after it.

- [ ] **Step 2: Insert phone pair button**

Add this button in the same toolbar group as `btn-spatial-preview`:

```html
<button id="btn-phone-pair" class="tool-btn" data-tool="phone-pair" title="Live phone preview">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="3" width="12" height="18" rx="2"></rect>
        <rect x="9" y="6" width="6" height="6" fill="currentColor"></rect>
        <circle cx="12" cy="18" r="0.8" fill="currentColor"></circle>
    </svg>
</button>
```

- [ ] **Step 3: Verify it renders**

Run: `npm run dev` (Ctrl+C the wrangler half if it complains; the editor should still come up).
Open `http://localhost:8000`. Confirm the new phone icon appears next to the existing camera icon.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "index.html: phone-pair toolbar button next to spatial preview"
```

---

### Task 5.2: Pair modal markup

**Files:**
- Modify: `index.html`
- Modify: `styles.css`

- [ ] **Step 1: Add modal markup before `</body>` in `index.html`**

```html
<div id="phone-pair-modal" class="hidden" role="dialog" aria-modal="true" aria-labelledby="phone-pair-title">
    <div class="phone-pair-card">
        <h2 id="phone-pair-title">Pair phone for live preview</h2>
        <p class="phone-pair-sub">Scan this QR with your phone, then enter the PIN.</p>
        <canvas id="phone-pair-qr" width="240" height="240"></canvas>
        <div class="phone-pair-pin">
            <span class="phone-pair-pin-label">PIN</span>
            <span id="phone-pair-pin-value" class="phone-pair-pin-value">----</span>
        </div>
        <div class="phone-pair-status" id="phone-pair-status">Waiting for phone…</div>
        <div class="phone-pair-actions">
            <button id="phone-pair-cancel" type="button">Cancel</button>
        </div>
    </div>
</div>
```

- [ ] **Step 2: Append matching CSS to `styles.css`**

```css
#phone-pair-modal {
    position: fixed; inset: 0; z-index: 12000;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
}
#phone-pair-modal.hidden { display: none; }
.phone-pair-card {
    background: #0f172a; color: #e2e8f0;
    border: 1px solid #334155; border-radius: 12px;
    padding: 24px; width: min(92vw, 360px);
    box-shadow: 0 12px 28px rgba(0,0,0,0.5);
    text-align: center;
    font-family: Inter, system-ui, sans-serif;
}
.phone-pair-card h2 { font-size: 16px; margin: 0 0 6px; }
.phone-pair-sub { font-size: 13px; color: #94a3b8; margin: 0 0 16px; }
#phone-pair-qr { background: #fff; border-radius: 8px; padding: 8px; }
.phone-pair-pin { margin-top: 14px; }
.phone-pair-pin-label { font-size: 12px; color: #94a3b8; letter-spacing: 0.1em; text-transform: uppercase; }
.phone-pair-pin-value { display: block; font-size: 32px; font-weight: 600; letter-spacing: 0.2em; margin-top: 4px; font-variant-numeric: tabular-nums; }
.phone-pair-status { font-size: 13px; color: #94a3b8; margin-top: 16px; }
.phone-pair-actions { margin-top: 18px; display: flex; justify-content: flex-end; gap: 8px; }
.phone-pair-actions button { padding: 8px 14px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; cursor: pointer; }
.phone-pair-actions button:hover { background: #334155; }
```

- [ ] **Step 3: Reload `localhost:8000`. Confirm the modal does NOT show by default (it has `hidden` class).**

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "Pair modal markup + styling (hidden by default)"
```

---

### Task 5.3: Open modal on click, mint session, render QR + PIN

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add module-scope state and pairing function near the existing spatial preview code**

Find the spot near `main.js:4566` (the `initializeEditorModeAndSpatialPreview` function). Above it, add the following block (do not modify the existing function yet):

```js
import QRCode from 'qrcode';
import { signalNew } from './shared/signaling-client.js';

const phonePair = {
    sessionId: null,
    pin: null,
    desktopWs: null,
    abortController: null
};

function openPhonePairing() {
    const modal = document.getElementById('phone-pair-modal');
    const qrCanvas = document.getElementById('phone-pair-qr');
    const pinValue = document.getElementById('phone-pair-pin-value');
    const status = document.getElementById('phone-pair-status');
    if (!modal || !qrCanvas || !pinValue || !status) return;

    modal.classList.remove('hidden');
    pinValue.textContent = '----';
    status.textContent = 'Minting session…';

    signalNew()
        .then(({ sessionId, pin }) => {
            phonePair.sessionId = sessionId;
            phonePair.pin = pin;
            const phoneUrl = `${window.location.origin}/phone.html#s=${sessionId}`;
            return QRCode.toCanvas(qrCanvas, phoneUrl, { width: 240, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
                .then(() => {
                    pinValue.textContent = pin;
                    status.textContent = 'Waiting for phone…';
                });
        })
        .catch((err) => {
            console.error('[phonePair] signalNew failed', err);
            status.textContent = 'Could not reach pairing server.';
        });
}

function closePhonePairing() {
    const modal = document.getElementById('phone-pair-modal');
    if (modal) modal.classList.add('hidden');
    if (phonePair.desktopWs) {
        try { phonePair.desktopWs.close(); } catch {}
        phonePair.desktopWs = null;
    }
    phonePair.sessionId = null;
    phonePair.pin = null;
}
```

- [ ] **Step 2: Wire the toolbar button**

Append to `initializeEditorModeAndSpatialPreview()`:

```js
    document.getElementById('btn-phone-pair')?.addEventListener('click', () => openPhonePairing());
    document.getElementById('phone-pair-cancel')?.addEventListener('click', () => closePhonePairing());
```

- [ ] **Step 3: Manual smoke**

Run: `npm run dev` (both vite and wrangler). Open `http://localhost:8000`, click the new phone icon.
Expected: modal opens, after ~200 ms the QR canvas renders and the PIN appears.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "main.js: openPhonePairing — mint session, render local QR, show PIN"
```

---

### Task 5.4: Open desktop signaling WebSocket, surface phone-claimed event

**Files:**
- Modify: `main.js`
- Modify: `worker/src/session-room.js`

- [ ] **Step 1: Worker — broadcast phone-claimed event over desktop WS on successful claim**

In `worker/src/session-room.js`, inside the `/claim` success branch (just before returning the `claimToken`), insert:

```js
            if (this.desktopWs) {
                try { this.desktopWs.send(JSON.stringify({ kind: 'phone-claimed' })); } catch {}
            }
```

- [ ] **Step 2: Desktop — open WS, listen for phone-claimed**

Update `openPhonePairing()` in `main.js`. After `pinValue.textContent = pin;` set:

```js
            return openDesktopSignalingWs(sessionId);
```

Add the helper above `openPhonePairing`:

```js
import { openSignalingSocket, inferWsBase } from './shared/signaling-client.js';

function openDesktopSignalingWs(sessionId) {
    const ws = openSignalingSocket({ sessionId, role: 'desktop', baseWsUrl: inferWsBase() });
    phonePair.desktopWs = ws;
    ws.addEventListener('message', (e) => {
        let msg = null;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.kind === 'phone-claimed') onPhoneClaimed();
    });
    ws.addEventListener('close', () => {
        if (phonePair.desktopWs === ws) phonePair.desktopWs = null;
    });
    return new Promise((resolve, reject) => {
        ws.addEventListener('open', () => resolve(ws), { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
}

function onPhoneClaimed() {
    const status = document.getElementById('phone-pair-status');
    if (status) status.textContent = 'Phone connected — establishing video link…';
    // WebRTC handshake wired in Phase 7.
}
```

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`. Click phone icon → modal opens, status: "Waiting for phone…". In another tab, open the dev tools and run:

```js
const sid = document.getElementById('phone-pair-pin-value').dataset.sid; // not yet stored — see step 4
```

Skip this verification — we'll do an end-to-end test in Phase 6 once the phone client can claim.

- [ ] **Step 4: Commit**

```bash
git add main.js worker/src/session-room.js
git commit -m "Desktop opens signaling WS; worker pushes phone-claimed to desktop on PIN match"
```

---

## Phase 6 — Phone PIN Entry & Claim

### Task 6.1: Phone PIN keypad UI

**Files:**
- Modify: `phone.html`
- Modify: `phone.js`

- [ ] **Step 1: Replace `phone.html` body**

Replace the body of `phone.html` with:

```html
<body>
    <div id="phone-root">
        <video id="phone-camera-bg" autoplay playsinline muted></video>
        <canvas id="phone-canvas"></canvas>

        <div id="phone-pin-screen" class="phone-screen">
            <h1>Enter the PIN shown on the desktop</h1>
            <div id="phone-pin-display" class="phone-pin-display">- - - -</div>
            <div id="phone-pin-error" class="phone-pin-error"></div>
            <div class="phone-pin-keypad">
                <button data-key="1">1</button><button data-key="2">2</button><button data-key="3">3</button>
                <button data-key="4">4</button><button data-key="5">5</button><button data-key="6">6</button>
                <button data-key="7">7</button><button data-key="8">8</button><button data-key="9">9</button>
                <button data-key="back">⌫</button><button data-key="0">0</button><button data-key="ok" id="phone-pin-ok">OK</button>
            </div>
        </div>

        <div id="phone-status">phone client booting…</div>
    </div>
    <script type="module" src="/phone.js"></script>
</body>
```

- [ ] **Step 2: Append CSS rules to `styles.css`**

```css
.phone-screen { position: absolute; inset: 0; background: rgba(15,23,42,0.94); color: #e2e8f0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
.phone-screen h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; text-align: center; }
.phone-pin-display { font-size: 40px; letter-spacing: 0.4em; font-variant-numeric: tabular-nums; margin-bottom: 12px; }
.phone-pin-error { color: #f87171; min-height: 18px; font-size: 13px; margin-bottom: 8px; }
.phone-pin-keypad { display: grid; grid-template-columns: repeat(3, 72px); gap: 10px; }
.phone-pin-keypad button { width: 72px; height: 72px; border-radius: 12px; border: 1px solid #334155; background: #1e293b; color: #fff; font-size: 22px; cursor: pointer; }
.phone-pin-keypad button:active { background: #334155; }
#phone-pin-ok { background: #4f46e5; }
```

- [ ] **Step 3: Replace `phone.js`**

```js
import { signalClaim } from './shared/signaling-client.js';
import { hashPin } from './shared/protocol.js';

const fragment = (window.location.hash || '').match(/#s=([0-9a-f]{32})/);
const sessionId = fragment ? fragment[1] : null;

const status = document.getElementById('phone-status');
const pinScreen = document.getElementById('phone-pin-screen');
const pinDisplay = document.getElementById('phone-pin-display');
const pinError = document.getElementById('phone-pin-error');
const okBtn = document.getElementById('phone-pin-ok');

let pinDigits = '';

function renderPin() {
    pinDisplay.textContent = (pinDigits + '----').slice(0, 4).split('').join(' ');
}

function setError(message) {
    pinError.textContent = message;
}

if (!sessionId) {
    setError('Invalid pairing link. Re-scan the QR from the desktop.');
    okBtn.disabled = true;
} else {
    status.textContent = `session ${sessionId.slice(0, 6)}…`;
    pinScreen.querySelectorAll('.phone-pin-keypad button').forEach((b) => {
        b.addEventListener('click', () => {
            const key = b.dataset.key;
            if (key === 'back') pinDigits = pinDigits.slice(0, -1);
            else if (key === 'ok') return submitPin();
            else if (pinDigits.length < 4 && /\d/.test(key)) pinDigits += key;
            renderPin();
        });
    });
    renderPin();
}

async function submitPin() {
    if (pinDigits.length !== 4) { setError('Enter 4 digits.'); return; }
    setError('');
    okBtn.disabled = true;
    try {
        const pinHash = await hashPin(sessionId, pinDigits);
        const result = await signalClaim({ sessionId, pinHash });
        if (result.status === 'ok') {
            window.__phoneClaim = { sessionId, claimToken: result.claimToken };
            pinScreen.style.display = 'none';
            status.textContent = 'PIN OK. Connecting…';
            // WebRTC handshake wired in Phase 7
        } else if (result.status === 'wrong-pin') {
            setError(`Wrong PIN. ${result.attemptsRemaining} attempts left.`);
            pinDigits = ''; renderPin();
        } else if (result.status === 'gone') {
            setError('Session expired. Re-scan the QR from the desktop.');
            okBtn.disabled = true;
        }
    } catch (err) {
        console.error(err);
        setError('Could not reach pairing server.');
    } finally {
        if (!okBtn.disabled || pinDigits.length === 0) okBtn.disabled = false;
    }
}
```

- [ ] **Step 4: Manual smoke (ghost-phone tab)**

Run: `npm run dev`. In one tab, open `http://localhost:8000`, click phone icon. Note the sessionId from the QR (you can read it via dev tools: `phonePair.sessionId` — but `phonePair` is module-scoped; instead, just scan the QR or copy the URL from `qrCanvas.toDataURL()`). For dev convenience, also paste the URL: open dev console on the editor and run `window.__voidLastPhoneUrl` once Task 5.3 stored it. Add that line:

In `main.js`, at the end of the `signalNew().then(...)` chain (after setting status), insert:

```js
            window.__voidLastPhoneUrl = phoneUrl;
```

Reload editor → click phone icon → in console: `__voidLastPhoneUrl` → copy. Open in second tab. Enter the PIN shown on desktop. Expected: phone screen hides, status shows "PIN OK. Connecting…", and the desktop modal status flips to "Phone connected — establishing video link…".

- [ ] **Step 5: Commit**

```bash
git add phone.html phone.js styles.css main.js
git commit -m "Phone PIN keypad + claim flow; desktop receives phone-claimed event"
```

---

## Phase 7 — WebRTC Handshake

### Task 7.1: Shared `peer.js` wrapper

**Files:**
- Create: `shared/peer.js`

- [ ] **Step 1: Implement (no unit test — covered by ghost-phone smoke)**

Create `shared/peer.js`:

```js
const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }
];

export function createPeer({ role, signalingWs, onTrack, onSceneSync, onPoseStream, onState }) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    let sceneSync = null;
    let poseStream = null;

    if (role === 'desktop') {
        sceneSync = pc.createDataChannel('scene-sync', { ordered: true });
        poseStream = pc.createDataChannel('pose-stream', { ordered: false, maxRetransmits: 0 });
        wireChannel(sceneSync, 'scene-sync');
        wireChannel(poseStream, 'pose-stream');
    } else {
        pc.addEventListener('datachannel', (e) => {
            if (e.channel.label === 'scene-sync') { sceneSync = e.channel; wireChannel(sceneSync, 'scene-sync'); }
            else if (e.channel.label === 'pose-stream') { poseStream = e.channel; wireChannel(poseStream, 'pose-stream'); }
        });
    }

    function wireChannel(ch, label) {
        ch.binaryType = 'arraybuffer';
        ch.addEventListener('message', (e) => {
            if (label === 'scene-sync') onSceneSync?.(e.data);
            else onPoseStream?.(e.data);
        });
    }

    pc.addEventListener('track', (e) => onTrack?.(e));
    pc.addEventListener('iceconnectionstatechange', () => onState?.(pc.iceConnectionState));
    pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) signalingWs.send(JSON.stringify({ kind: 'ice', candidate: e.candidate }));
    });

    signalingWs.addEventListener('message', async (e) => {
        let msg = null;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.kind === 'offer') {
            await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signalingWs.send(JSON.stringify({ kind: 'answer', sdp: answer.sdp }));
        } else if (msg.kind === 'answer') {
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        } else if (msg.kind === 'ice') {
            try { await pc.addIceCandidate(msg.candidate); } catch {}
        }
    });

    async function startOffer() {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signalingWs.send(JSON.stringify({ kind: 'offer', sdp: offer.sdp }));
    }

    function sendSceneSync(data) {
        if (sceneSync && sceneSync.readyState === 'open') sceneSync.send(data);
    }

    function sendPoseStream(buf) {
        if (poseStream && poseStream.readyState === 'open') poseStream.send(buf);
    }

    function close() {
        try { sceneSync?.close(); } catch {}
        try { poseStream?.close(); } catch {}
        try { pc.close(); } catch {}
    }

    return { pc, startOffer, sendSceneSync, sendPoseStream, close };
}
```

- [ ] **Step 2: Run unit tests to confirm nothing broke**

Run: `npm run test`
Expected: existing tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/peer.js
git commit -m "shared/peer: RTCPeerConnection wrapper with two data channels and signaling-WS plumbing"
```

---

### Task 7.2: Desktop creates offer on phone-claimed

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Import peer wrapper**

Add at the top of the existing imports block in `main.js`:

```js
import { createPeer } from './shared/peer.js';
```

- [ ] **Step 2: Replace `onPhoneClaimed` with full handshake**

```js
function onPhoneClaimed() {
    const status = document.getElementById('phone-pair-status');
    if (status) status.textContent = 'Phone connected — establishing video link…';

    const peer = createPeer({
        role: 'desktop',
        signalingWs: phonePair.desktopWs,
        onTrack: (e) => onPhoneVideoTrack(e),
        onSceneSync: (data) => onSceneSyncMessage(data),
        onPoseStream: (buf) => onPoseStreamMessage(buf),
        onState: (s) => {
            if (status) status.textContent = `WebRTC: ${s}`;
            if (s === 'connected') onPeerConnected();
            if (s === 'failed' || s === 'disconnected' || s === 'closed') onPeerDisconnected();
        }
    });
    phonePair.peer = peer;
    peer.startOffer();
}

function onPhoneVideoTrack(_e) {
    // Wired in Task 9.2.
}
function onSceneSyncMessage(_data) {
    // Wired in Phase 10.
}
function onPoseStreamMessage(_buf) {
    // Wired in Phase 12.
}
function onPeerConnected() {
    const modal = document.getElementById('phone-pair-modal');
    if (modal) modal.classList.add('hidden');
    enterPairMode();
}
function onPeerDisconnected() {
    exitPairMode();
}
function enterPairMode() {
    state.phonePairMode = 'connected';
    // Viewport swap wired in Task 9.2.
}
function exitPairMode() {
    state.phonePairMode = false;
    if (phonePair.peer) { phonePair.peer.close(); phonePair.peer = null; }
}
```

Add to the `state` object (search for `const state = {` near top of `main.js`):

```js
    phonePairMode: false,
```

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "main.js: desktop creates WebRTC offer on phone-claimed; placeholders for media + data hooks"
```

---

### Task 7.3: Phone opens signaling WS + creates peer (answers offer)

**Files:**
- Modify: `phone.js`

- [ ] **Step 1: Append after the successful claim block**

Replace the inside of `if (result.status === 'ok')` in `phone.js`:

```js
        if (result.status === 'ok') {
            pinScreen.style.display = 'none';
            status.textContent = 'PIN OK. Connecting…';
            await startPhonePeer(result.claimToken);
        }
```

Append helpers at the bottom of `phone.js`:

```js
import { openSignalingSocket, inferWsBase } from './shared/signaling-client.js';
import { createPeer } from './shared/peer.js';

let phonePeer = null;

async function startPhonePeer(claimToken) {
    const ws = openSignalingSocket({
        sessionId, role: 'phone', claimToken,
        baseWsUrl: inferWsBase()
    });
    await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', rej, { once: true });
    });
    phonePeer = createPeer({
        role: 'phone',
        signalingWs: ws,
        onSceneSync: (d) => onPhoneSceneSync(d),
        onState: (s) => {
            status.textContent = `WebRTC: ${s}`;
            if (s === 'connected') onPhonePeerConnected();
        }
    });
}

function onPhonePeerConnected() {
    status.textContent = 'connected';
    // Camera + composite stream wired in Phase 8.
}

function onPhoneSceneSync(_data) {
    // Snapshot/delta application wired in Phase 10/11.
}
```

(Move the `import` lines to the top of the file with the existing imports.)

- [ ] **Step 2: Manual smoke — full handshake**

Run: `npm run dev`. Open editor in tab A, click phone icon, copy `__voidLastPhoneUrl` from console. Open it in tab B (or on a real phone via Cloudflare Tunnel). Enter the PIN.

Expected: both tab A's "WebRTC: …" status and tab B's status progress through `checking → connected`. Modal closes on tab A.

- [ ] **Step 3: Commit**

```bash
git add phone.js
git commit -m "phone.js: open signaling WS + create peer, answer offer, surface state"
```

---

## Phase 8 — Phone Camera + Composite Stream

### Task 8.1: getUserMedia + composite canvas (iOS path baseline)

**Files:**
- Modify: `phone.js`

- [ ] **Step 1: Add camera + Three.js scene wiring**

Append to `phone.js`:

```js
import * as THREE from 'three';

const phoneState = {
    cameraStream: null,
    threeRenderer: null,
    threeScene: null,
    threeCamera: null,
    composite: { canvas: null, stream: null }
};

async function startPhoneCameraAndComposite() {
    const video = document.getElementById('phone-camera-bg');
    const canvas = document.getElementById('phone-canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    try {
        phoneState.cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }, audio: false
        });
        video.srcObject = phoneState.cameraStream;
        await video.play();
    } catch (err) {
        status.textContent = `camera: ${err.message}`;
        throw err;
    }

    phoneState.threeRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    phoneState.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    phoneState.threeRenderer.setSize(canvas.width, canvas.height, false);
    phoneState.threeScene = new THREE.Scene();
    phoneState.threeCamera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.05, 50);
    phoneState.threeCamera.position.set(0, 1.5, 0);
    phoneState.threeScene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(2, 4, 2);
    phoneState.threeScene.add(dir);

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

    phoneState.composite.canvas = composite;
    phoneState.composite.stream = composite.captureStream(30);
    return phoneState.composite.stream;
}
```

- [ ] **Step 2: Trigger after peer connection**

Replace `onPhonePeerConnected` body:

```js
async function onPhonePeerConnected() {
    status.textContent = 'starting camera…';
    try {
        const compositeStream = await startPhoneCameraAndComposite();
        compositeStream.getVideoTracks().forEach((t) => phonePeer.pc.addTrack(t, compositeStream));
        // Renegotiate so the new track is sent.
        const offer = await phonePeer.pc.createOffer();
        await phonePeer.pc.setLocalDescription(offer);
        // Pose loop + tilt logic in Phase 12+13.
    } catch (err) {
        status.textContent = `camera failed: ${err.message}`;
    }
}
```

**Note:** Adding a track post-handshake requires re-negotiation. We instead opt to pre-add a placeholder transceiver before the offer. To avoid that complexity in v1, we move the `getUserMedia` call to *before* `startOffer`/`createAnswer`. Update `startPhonePeer` to call `startPhoneCameraAndComposite` and add the track BEFORE creating the peer:

Replace `startPhonePeer`:

```js
async function startPhonePeer(claimToken) {
    status.textContent = 'starting camera…';
    let compositeStream;
    try {
        compositeStream = await startPhoneCameraAndComposite();
    } catch {
        return; // status already set
    }
    const ws = openSignalingSocket({
        sessionId, role: 'phone', claimToken,
        baseWsUrl: inferWsBase()
    });
    await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', rej, { once: true });
    });
    phonePeer = createPeer({
        role: 'phone',
        signalingWs: ws,
        onSceneSync: (d) => onPhoneSceneSync(d),
        onState: (s) => {
            status.textContent = `WebRTC: ${s}`;
            if (s === 'connected') onPhonePeerConnected();
        }
    });
    compositeStream.getVideoTracks().forEach((t) => phonePeer.pc.addTrack(t, compositeStream));
}

function onPhonePeerConnected() {
    status.textContent = 'connected';
}
```

- [ ] **Step 3: Manual smoke**

Run via Cloudflare Tunnel for HTTPS:

```bash
npm run dev:tunnel
```

Look for a `https://*.trycloudflare.com` URL in the wrangler/cloudflared output. Open the editor on it. Click phone icon. On a phone (or another tab), open the phone URL. Approve the camera permission prompt. Enter PIN.

Expected: phone shows live camera; once peer connects, the desktop tab's `phonePair.peer.pc.getReceivers()` shows a video receiver with track readyState `live`.

- [ ] **Step 4: Commit**

```bash
git add phone.js
git commit -m "phone: start camera + Three.js scene + composite canvas, attach video track to peer"
```

---

## Phase 9 — Desktop Pair-Mode Viewport

### Task 9.1: Add `<video>` element + banner to editor viewport

**Files:**
- Modify: `index.html`
- Modify: `styles.css`

- [ ] **Step 1: Find the existing 3D viewport container**

Search `index.html` for `id="viewport-3d"`. Inside or directly adjacent (same parent), add the phone-feed elements.

- [ ] **Step 2: Insert markup**

Inside the viewport container, immediately after `<canvas>` (or as a sibling at the same level):

```html
<video id="phone-feed-video" class="phone-feed-hidden" autoplay playsinline muted></video>
<div id="phone-feed-banner" class="phone-feed-hidden">
    <span>Live to phone — tap on phone or layer to select</span>
    <button id="phone-feed-disconnect" type="button">Disconnect</button>
</div>
```

- [ ] **Step 3: Append CSS to `styles.css`**

```css
#phone-feed-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; z-index: 5; }
.phone-feed-hidden { display: none !important; }
#phone-feed-banner {
    position: absolute; top: 0; left: 0; right: 0; z-index: 6;
    padding: 8px 12px; background: rgba(15,23,42,0.85); color: #e2e8f0;
    display: flex; justify-content: space-between; align-items: center;
    font: 13px/1.4 Inter, system-ui, sans-serif;
}
#phone-feed-banner button {
    padding: 4px 10px; border-radius: 6px; border: 1px solid #334155;
    background: #1e293b; color: #fff; cursor: pointer;
}
.viewport-paired #viewport-3d > canvas { visibility: hidden; }
```

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "Pair-mode viewport: phone-feed video + disconnect banner (hidden by default)"
```

---

### Task 9.2: `enterPairMode` / `exitPairMode` swap behavior + receive video track

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Replace the placeholder `onPhoneVideoTrack`**

```js
function onPhoneVideoTrack(e) {
    const video = document.getElementById('phone-feed-video');
    if (!video) return;
    const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
    video.srcObject = stream;
    video.play().catch(() => {});
}
```

- [ ] **Step 2: Replace `enterPairMode` / `exitPairMode` bodies**

```js
function enterPairMode() {
    state.phonePairMode = 'connected';
    document.getElementById('phone-feed-video')?.classList.remove('phone-feed-hidden');
    document.getElementById('phone-feed-banner')?.classList.remove('phone-feed-hidden');
    document.body.classList.add('viewport-paired');
}

function exitPairMode() {
    state.phonePairMode = false;
    document.getElementById('phone-feed-video')?.classList.add('phone-feed-hidden');
    document.getElementById('phone-feed-banner')?.classList.add('phone-feed-hidden');
    document.body.classList.remove('viewport-paired');
    if (phonePair.peer) { try { phonePair.peer.close(); } catch {} phonePair.peer = null; }
    if (phonePair.desktopWs) { try { phonePair.desktopWs.close(); } catch {} phonePair.desktopWs = null; }
    const v = document.getElementById('phone-feed-video');
    if (v) { v.srcObject = null; }
}
```

- [ ] **Step 3: Wire the disconnect button**

Append to `initializeEditorModeAndSpatialPreview()`:

```js
    document.getElementById('phone-feed-disconnect')?.addEventListener('click', () => exitPairMode());
```

- [ ] **Step 4: Manual smoke**

Run with tunnel. Pair phone. After PIN entry: modal closes, viewport hides 3D canvas, phone camera feed appears, banner sits on top. Click disconnect → 3D returns.

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "Desktop pair-mode: swap viewport for phone feed, attach incoming video, disconnect handler"
```

---

## Phase 10 — Initial Snapshot Sync

### Task 10.1: Build a flat screen snapshot on desktop

**Files:**
- Create: `shared/snapshot.js`
- Create: `shared/snapshot.test.js`

- [ ] **Step 1: Write failing test**

Create `shared/snapshot.test.js`:

```js
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { serializeScreen } from './snapshot.js';

function makeBox(name, id) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.position.set(1, 2, 3);
    m.userData.voidId = id;
    return m;
}

describe('serializeScreen', () => {
    it('emits objects with id, type, transform, color', () => {
        const screen = new THREE.Group();
        screen.userData.voidId = 'screen-1';
        const a = makeBox('A', 'obj-a');
        screen.add(a);
        const out = serializeScreen(screen);
        expect(out.id).toBe('screen-1');
        expect(out.objects).toHaveLength(1);
        expect(out.objects[0]).toMatchObject({
            id: 'obj-a',
            type: 'box',
            pos: [1, 2, 3],
            color: '#ff0000'
        });
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `shared/snapshot.js`:

```js
function detectType(object) {
    if (object.userData?.voidType) return object.userData.voidType;
    if (object.geometry?.type === 'BoxGeometry') return 'box';
    if (object.geometry?.type === 'SphereGeometry') return 'sphere';
    if (object.geometry?.type === 'PlaneGeometry') return 'plane';
    return 'group';
}

function colorHex(material) {
    if (!material || !material.color) return null;
    return '#' + material.color.getHexString();
}

export function serializeScreen(screenGroup) {
    const objects = [];
    screenGroup.traverse((obj) => {
        if (obj === screenGroup) return;
        if (!obj.userData?.voidId) return;
        objects.push({
            id: obj.userData.voidId,
            type: detectType(obj),
            pos: [obj.position.x, obj.position.y, obj.position.z],
            rot: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
            scale: [obj.scale.x, obj.scale.y, obj.scale.z],
            color: colorHex(obj.material),
            text: obj.userData.text ?? null,
            parentId: obj.parent?.userData?.voidId ?? null
        });
    });
    return {
        id: screenGroup.userData.voidId ?? 'screen-default',
        name: screenGroup.name ?? 'Screen',
        objects
    };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/snapshot.js shared/snapshot.test.js
git commit -m "shared/snapshot: serializeScreen — flat list of voidId-bearing objects"
```

---

### Task 10.2: Tag every editor object with a `voidId`

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add a unique-id helper near the top of `main.js`**

Find where `state` is defined. Above it:

```js
function nextVoidId(prefix = 'obj') {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
```

- [ ] **Step 2: Find every `createObject`-style call site and tag the resulting object**

Search for `state.objects.push(` and `scene.add(` patterns where new editor objects (boxes, spheres, planes, frames) are created. At each call site, immediately after creating the THREE object and before adding to the scene/state, set:

```js
mesh.userData.voidId = mesh.userData.voidId || nextVoidId('obj');
```

There are ~5 such call sites — tag each. (The exact lines will be uncovered as the engineer reads `main.js`. The behavior change is additive: existing objects get a stable id; nothing else changes.)

Also, in `getActiveScreen()` or wherever a screen group is created, ensure:

```js
screenGroup.userData.voidId = screenGroup.userData.voidId || nextVoidId('screen');
```

- [ ] **Step 3: Backfill `voidId` on import**

Find `applyVoidImport` (`main.js:3612`). After existing scene reconstruction, traverse and assign ids to anything missing one:

```js
state.scene.traverse((o) => {
    if (o.isMesh && !o.userData.voidId) o.userData.voidId = nextVoidId('obj');
});
```

- [ ] **Step 4: Manual smoke**

Run editor, create a box. Open dev tools: `state.scene.children` → confirm boxes have `userData.voidId`.

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "main.js: assign stable voidId to all created/imported objects"
```

---

### Task 10.3: Send snapshot on phone READY

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Replace the `onSceneSyncMessage` placeholder**

```js
import { MSG, encodeSceneSync, decodeSceneSync, chunkSnapshot } from './shared/protocol.js';
import { serializeScreen } from './shared/snapshot.js';

function onSceneSyncMessage(data) {
    const msg = decodeSceneSync(typeof data === 'string' ? data : new TextDecoder().decode(data));
    if (!msg) return;
    if (msg.t === MSG.READY) sendSnapshotToPhone();
}

function sendSnapshotToPhone() {
    const screen = getActiveScreen();
    if (!screen) return;
    const screenJson = serializeScreen(screen.group ?? screen);
    const fullMsg = { t: MSG.SNAPSHOT, screen: screenJson };
    const chunks = chunkSnapshot(fullMsg);
    for (const c of chunks) phonePair.peer?.sendSceneSync(encodeSceneSync(c));
}
```

(Note: the existing `getActiveScreen()` returns either a screen object containing `.group` or the group itself depending on the project's screen system. Adapt the second arg accordingly when reading existing code.)

- [ ] **Step 2: Phone — send READY when peer connects**

In `phone.js`, replace `onPhonePeerConnected`:

```js
import { MSG, encodeSceneSync } from './shared/protocol.js';

function onPhonePeerConnected() {
    status.textContent = 'connected';
    phonePeer.sendSceneSync(encodeSceneSync({
        t: MSG.READY,
        platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : (/Android/i.test(navigator.userAgent) ? 'android' : 'other'),
        caps: { webxr: !!navigator.xr, depth: false, hitTest: false }
    }));
}
```

- [ ] **Step 3: Phone — handle snapshot**

Replace `onPhoneSceneSync`:

```js
import { decodeSceneSync, SnapshotReassembler } from './shared/protocol.js';

const snapshotReassembler = new SnapshotReassembler();

function onPhoneSceneSync(data) {
    const msg = decodeSceneSync(typeof data === 'string' ? data : new TextDecoder().decode(data));
    if (!msg) return;
    if (msg.t === MSG.SNAPSHOT) applySnapshot(msg);
    if (msg.t === MSG.SNAPSHOT_CHUNK) {
        const final = snapshotReassembler.feed(msg);
        if (final) applySnapshot(final);
    }
}

const objectsById = new Map();

function applySnapshot(msg) {
    objectsById.forEach((o) => phoneState.threeScene.remove(o));
    objectsById.clear();
    for (const item of msg.screen.objects) {
        const obj = buildObjectFromSnapshot(item);
        if (obj) {
            objectsById.set(item.id, obj);
            phoneState.threeScene.add(obj);
        }
    }
    status.textContent = `screen ${msg.screen.id} (${msg.screen.objects.length})`;
}

function buildObjectFromSnapshot(item) {
    let geo;
    if (item.type === 'sphere') geo = new THREE.SphereGeometry(0.5, 16, 16);
    else if (item.type === 'plane') geo = new THREE.PlaneGeometry(1, 1);
    else geo = new THREE.BoxGeometry(1, 1, 1);
    const color = item.color || '#ffffff';
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.voidId = item.id;
    mesh.position.fromArray(item.pos || [0, 0, 0]);
    if (item.rot) mesh.quaternion.fromArray(item.rot);
    if (item.scale) mesh.scale.fromArray(item.scale);
    return mesh;
}
```

- [ ] **Step 4: Manual smoke**

Pair phone, place a box on desktop, click phone icon, complete pair. Phone should render the same box.

(If the phone's box doesn't appear at the right scale, that's expected: the iOS path renders at fixed virtual distance — Phase 13 handles the camera framing. For now, confirm an object exists in `phoneState.threeScene.children`.)

- [ ] **Step 5: Commit**

```bash
git add main.js phone.js
git commit -m "Initial snapshot sync: desktop sends on READY; phone applies and rebuilds Three.js scene"
```

---

## Phase 11 — Live Delta Emission & Application

### Task 11.1: Delta applier on phone (TDD)

**Files:**
- Create: `shared/delta-applier.js`
- Create: `shared/delta-applier.test.js`

- [ ] **Step 1: Write failing test**

Create `shared/delta-applier.test.js`:

```js
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DeltaApplier } from './delta-applier.js';

describe('DeltaApplier', () => {
    it('creates an object', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([{ op: 'create', id: 'x', type: 'box', pos: [1, 2, 3], color: '#00ff00' }]);
        const o = a.get('x');
        expect(o).toBeDefined();
        expect(o.position.x).toBe(1);
    });
    it('updates color via update op', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([{ op: 'create', id: 'x', type: 'box', color: '#000000' }]);
        a.apply([{ op: 'update', id: 'x', props: { color: '#ff00ff' } }]);
        const hex = a.get('x').material.color.getHexString();
        expect(hex).toBe('ff00ff');
    });
    it('transforms position', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([{ op: 'create', id: 'x', type: 'box' }]);
        a.apply([{ op: 'transform', id: 'x', pos: [10, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1] }]);
        expect(a.get('x').position.x).toBe(10);
    });
    it('deletes', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([{ op: 'create', id: 'x', type: 'box' }]);
        a.apply([{ op: 'delete', id: 'x' }]);
        expect(a.get('x')).toBeUndefined();
    });
    it('orders create→update→delete within one batch', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([
            { op: 'delete', id: 'x' },
            { op: 'update', id: 'x', props: { color: '#ffffff' } },
            { op: 'create', id: 'x', type: 'box', color: '#000000' }
        ]);
        expect(a.get('x')).toBeDefined();
        expect(a.get('x').material.color.getHexString()).toBe('ffffff');
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm run test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `shared/delta-applier.js`:

```js
import * as THREE from 'three';

export class DeltaApplier {
    constructor(scene) {
        this.scene = scene;
        this.byId = new Map();
    }
    get(id) { return this.byId.get(id); }
    apply(ops) {
        const creates = [], updates = [], xforms = [], deletes = [];
        for (const o of ops) {
            if (o.op === 'create') creates.push(o);
            else if (o.op === 'update') updates.push(o);
            else if (o.op === 'transform') xforms.push(o);
            else if (o.op === 'delete') deletes.push(o);
        }
        for (const op of creates) this._create(op);
        for (const op of updates) this._update(op);
        for (const op of xforms) this._transform(op);
        for (const op of deletes) this._delete(op);
    }
    _create(op) {
        let geo;
        if (op.type === 'sphere') geo = new THREE.SphereGeometry(0.5, 16, 16);
        else if (op.type === 'plane') geo = new THREE.PlaneGeometry(1, 1);
        else geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshStandardMaterial({ color: op.color || '#ffffff' });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.voidId = op.id;
        if (op.pos) mesh.position.fromArray(op.pos);
        if (op.rot) mesh.quaternion.fromArray(op.rot);
        if (op.scale) mesh.scale.fromArray(op.scale);
        this.byId.set(op.id, mesh);
        this.scene.add(mesh);
    }
    _update(op) {
        const m = this.byId.get(op.id);
        if (!m) return;
        if (op.props?.color && m.material) m.material.color.set(op.props.color);
        if (op.props?.text !== undefined) m.userData.text = op.props.text;
    }
    _transform(op) {
        const m = this.byId.get(op.id);
        if (!m) return;
        if (op.pos) m.position.fromArray(op.pos);
        if (op.rot) m.quaternion.fromArray(op.rot);
        if (op.scale) m.scale.fromArray(op.scale);
    }
    _delete(op) {
        const m = this.byId.get(op.id);
        if (!m) return;
        this.scene.remove(m);
        m.geometry?.dispose?.();
        m.material?.dispose?.();
        this.byId.delete(op.id);
    }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/delta-applier.js shared/delta-applier.test.js
git commit -m "shared/delta-applier: ordered batched create/update/transform/delete with id map"
```

---

### Task 11.2: Phone wires delta applier

**Files:**
- Modify: `phone.js`

- [ ] **Step 1: Replace the `applySnapshot` body and `onPhoneSceneSync`**

```js
import { DeltaApplier } from './shared/delta-applier.js';

let deltaApplier = null;

function applySnapshot(msg) {
    if (!deltaApplier) deltaApplier = new DeltaApplier(phoneState.threeScene);
    // tear down everything in the applier
    for (const id of Array.from(deltaApplier.byId.keys())) {
        deltaApplier.apply([{ op: 'delete', id }]);
    }
    const ops = msg.screen.objects.map((item) => ({
        op: 'create',
        id: item.id,
        type: item.type,
        pos: item.pos,
        rot: item.rot,
        scale: item.scale,
        color: item.color
    }));
    deltaApplier.apply(ops);
    status.textContent = `screen ${msg.screen.id} (${msg.screen.objects.length})`;
}

function onPhoneSceneSync(data) {
    const msg = decodeSceneSync(typeof data === 'string' ? data : new TextDecoder().decode(data));
    if (!msg) return;
    if (msg.t === MSG.SNAPSHOT) applySnapshot(msg);
    else if (msg.t === MSG.SNAPSHOT_CHUNK) {
        const final = snapshotReassembler.feed(msg);
        if (final) applySnapshot(final);
    } else if (msg.t === MSG.DELTA) {
        if (deltaApplier) deltaApplier.apply(msg.ops || []);
    } else if (msg.t === MSG.SCREEN_SWITCH) {
        // Snapshot for the new screen will follow.
    }
}
```

(Remove the older `objectsById` Map and the `buildObjectFromSnapshot` function that Phase 10 added.)

- [ ] **Step 2: Manual smoke**

Pair phone. Box exists on desktop → phone shows it. (No live deltas yet; that's the next task.)

- [ ] **Step 3: Commit**

```bash
git add phone.js
git commit -m "phone: route snapshot+delta+screen-switch through DeltaApplier"
```

---

### Task 11.3: Editor `emitDelta` helper + 5 instrumentation hooks

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add the helper**

Place near `phonePair` definition:

```js
const deltaQueue = new Map(); // id → latest op (transform/update merging)
let deltaFlushTimer = null;

function emitDelta(op) {
    if (state.phonePairMode !== 'connected' || !phonePair.peer) return;
    if (op.op === 'transform' || op.op === 'update') {
        const key = `${op.op}:${op.id}`;
        const existing = deltaQueue.get(key);
        if (existing && op.op === 'update') {
            existing.props = { ...existing.props, ...op.props };
        } else {
            deltaQueue.set(key, op);
        }
        if (!deltaFlushTimer) deltaFlushTimer = setTimeout(flushDeltaQueue, 16);
    } else {
        // create / delete flushed immediately, but after any pending coalesce
        if (deltaFlushTimer) { clearTimeout(deltaFlushTimer); deltaFlushTimer = null; }
        const ops = Array.from(deltaQueue.values()).concat([op]);
        deltaQueue.clear();
        sendDeltaBatch(ops);
    }
}

function flushDeltaQueue() {
    deltaFlushTimer = null;
    if (deltaQueue.size === 0) return;
    const ops = Array.from(deltaQueue.values());
    deltaQueue.clear();
    sendDeltaBatch(ops);
}

function sendDeltaBatch(ops) {
    if (!phonePair.peer) return;
    phonePair.peer.sendSceneSync(encodeSceneSync({ t: MSG.DELTA, ops }));
}
```

- [ ] **Step 2: Hook 1 — object creation**

Find the existing object-creation paths (search for `createObject` or `state.objects.push(` — there are likely a handful of code blocks). After each created mesh has `userData.voidId` assigned and is in the scene, append:

```js
emitDelta({
    op: 'create',
    id: mesh.userData.voidId,
    type: mesh.userData.voidType ?? 'box',
    pos: [mesh.position.x, mesh.position.y, mesh.position.z],
    rot: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
    scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
    color: mesh.material?.color ? '#' + mesh.material.color.getHexString() : null
});
```

- [ ] **Step 3: Hook 2 — object deletion**

Find `deleteSelectedObject` (referenced at `main.js:4734`). Before the actual scene-removal call, capture the id:

```js
const __deletedId = state.selectedObject?.userData?.voidId;
// existing removal code
if (__deletedId) emitDelta({ op: 'delete', id: __deletedId });
```

- [ ] **Step 4: Hook 3 — transform-controls drag**

Find where `TransformControls` events are wired. Listen for the existing `objectChange` or `dragging-changed` event and on drag-end emit:

```js
state.transformControls.addEventListener('objectChange', () => {
    const o = state.selectedObject;
    if (!o?.userData?.voidId) return;
    emitDelta({
        op: 'transform',
        id: o.userData.voidId,
        pos: [o.position.x, o.position.y, o.position.z],
        rot: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
        scale: [o.scale.x, o.scale.y, o.scale.z]
    });
});
```

- [ ] **Step 5: Hook 4 — color picker**

Find the existing color-input listener (the block starting around `colorInput.addEventListener('input'` near `main.js:4752`). Inside the handler, after the color is applied to the material:

```js
const __o = state.selectedObject && getPrimaryMesh(state.selectedObject);
if (__o?.userData?.voidId) emitDelta({ op: 'update', id: __o.userData.voidId, props: { color } });
```

- [ ] **Step 6: Hook 5 — screen switch**

Find `switchToScreen` (referenced at `main.js:4740`). It takes a `screenId` parameter and sets `state.activeScreenId` to that value somewhere in its body. At the end of the function (after the active-screen assignment has run), append:

```js
    if (state.phonePairMode === 'connected' && phonePair.peer) {
        phonePair.peer.sendSceneSync(encodeSceneSync({
            t: MSG.SCREEN_SWITCH,
            screenId: state.activeScreenId
        }));
        sendSnapshotToPhone();
    }
```

`state.activeScreenId` is the post-switch authoritative id — using `state` rather than the function's parameter avoids accidentally sending a switch message that didn't actually take effect (e.g., if the existing function bails early when the target id doesn't exist).

- [ ] **Step 7: Manual smoke**

Pair phone. Drag a box on desktop → phone reflects new position within ~1 frame. Change color → reflects. Create new box → appears on phone. Delete → disappears.

- [ ] **Step 8: Commit**

```bash
git add main.js
git commit -m "Live delta emission: 5 editor hooks with 16ms transform/update coalescing"
```

---

## Phase 12 — Pose Stream + Tap-to-Select

### Task 12.1: Phone sends DeviceOrientation pose

**Files:**
- Modify: `phone.js`

- [ ] **Step 1: After camera permission succeeds, request orientation permission (iOS) and start the pose loop**

Append to `startPhoneCameraAndComposite` after `await video.play()`:

```js
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { await DeviceOrientationEvent.requestPermission(); } catch {}
    }
```

Append a new function:

```js
import { encodeOrientation } from './shared/protocol.js';

let lastOrientationSend = 0;
function startOrientationLoop() {
    window.addEventListener('deviceorientation', (e) => {
        const now = performance.now();
        if (now - lastOrientationSend < 50) return; // ~20 Hz cap
        lastOrientationSend = now;
        if (!phonePeer) return;
        const buf = encodeOrientation(e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0, now);
        phonePeer.sendPoseStream(buf);
    });
}
```

Call `startOrientationLoop()` from `onPhonePeerConnected`.

- [ ] **Step 2: Manual smoke**

Pair real phone via tunnel. Tilt the phone. On desktop console: `phonePair.peer.pc.getDataChannels?.() ?? phonePair.peer.pc` — confirm pose-stream is open. (Receiving end wired in next task.)

- [ ] **Step 3: Commit**

```bash
git add phone.js
git commit -m "phone: send DeviceOrientation on pose-stream channel at 20Hz"
```

---

### Task 12.2: Desktop receives + stores latest pose

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Replace `onPoseStreamMessage`**

```js
import { decodePose, POSE_TYPE_XR, POSE_TYPE_ORIENT } from './shared/protocol.js';

const phonePose = { kind: null, matrix: null, alpha: 0, beta: 0, gamma: 0, ts: 0 };

function onPoseStreamMessage(buf) {
    const p = decodePose(buf);
    if (!p) return;
    phonePose.kind = p.kind;
    phonePose.ts = p.ts;
    if (p.kind === POSE_TYPE_XR) phonePose.matrix = p.matrix;
    else { phonePose.alpha = p.alpha; phonePose.beta = p.beta; phonePose.gamma = p.gamma; }
}
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "desktop: store latest phone pose from pose-stream"
```

---

### Task 12.3: Phone sends `tap`; desktop ray-casts and selects

**Files:**
- Modify: `phone.js`
- Modify: `main.js`

- [ ] **Step 1: Phone — tap handler**

Append to `phone.js`:

```js
function startTapHandler() {
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest('.phone-pin-keypad') || target.closest('#phone-mode-toggle')) return;
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        if (!phonePeer) return;
        phonePeer.sendSceneSync(encodeSceneSync({
            t: MSG.TAP, x, y, vw: window.innerWidth, vh: window.innerHeight, ts: performance.now()
        }));
    });
}
```

Call `startTapHandler()` from `onPhonePeerConnected`.

- [ ] **Step 2: Desktop — handle tap**

In `onSceneSyncMessage`, add a branch:

```js
    if (msg.t === MSG.TAP) handlePhoneTap(msg);
```

Define:

```js
function handlePhoneTap(msg) {
    const screen = getActiveScreen();
    if (!screen) return;
    const screenGroup = screen.group ?? screen;
    const candidates = [];
    screenGroup.traverse((o) => { if (o.isMesh && o.userData?.voidId) candidates.push(o); });
    if (candidates.length === 0) return;

    // Build a virtual phone camera matching the phone's likely pose.
    const phoneCam = new THREE.PerspectiveCamera(60, msg.vw / msg.vh, 0.05, 50);
    phoneCam.position.set(0, 1.5, 0);
    if (phonePose.kind === POSE_TYPE_ORIENT) {
        phoneCam.rotation.set(
            THREE.MathUtils.degToRad(phonePose.beta),
            THREE.MathUtils.degToRad(phonePose.alpha),
            -THREE.MathUtils.degToRad(phonePose.gamma),
            'YXZ'
        );
    }
    phoneCam.updateMatrixWorld(true);

    const ndc = new THREE.Vector2(msg.x * 2 - 1, -(msg.y * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, phoneCam);
    const hit = ray.intersectObjects(candidates, false)[0];
    if (!hit) return;

    selectObject(hit.object);
    phonePair.peer?.sendSceneSync(encodeSceneSync({ t: MSG.SELECT_ACK, objectId: hit.object.userData.voidId }));
}
```

- [ ] **Step 3: Phone — show highlight on select-ack**

In `onPhoneSceneSync`, branch:

```js
    } else if (msg.t === MSG.SELECT_ACK) {
        const obj = deltaApplier?.get(msg.objectId);
        if (obj) flashHighlight(obj);
    }
```

Define:

```js
function flashHighlight(obj) {
    const helper = new THREE.BoxHelper(obj, 0x22c55e);
    phoneState.threeScene.add(helper);
    setTimeout(() => phoneState.threeScene.remove(helper), 1500);
}
```

- [ ] **Step 4: Manual smoke**

Pair phone. Tap on a visible box on the phone → desktop properties panel switches to that box; phone shows green wireframe for ~1.5 s.

(Note: ray accuracy depends on the iOS-tilt camera approximation; behavior is "best-effort" until Phase 13 lays out the UI at fixed virtual distance to match.)

- [ ] **Step 5: Commit**

```bash
git add phone.js main.js
git commit -m "Tap-to-select round trip: phone tap → desktop ray-cast → select-ack → phone highlight"
```

---

## Phase 13 — iOS Orientation Mode (Camera Layout)

### Task 13.1: Orient the phone-side Three.js camera from DeviceOrientation

**Files:**
- Modify: `phone.js`

- [ ] **Step 1: Add a per-frame camera update from orientation**

Append to `phone.js`:

```js
let latestOrientation = { alpha: 0, beta: 0, gamma: 0 };

function startCameraOrientationLoop() {
    window.addEventListener('deviceorientation', (e) => {
        latestOrientation = {
            alpha: e.alpha ?? 0,
            beta: e.beta ?? 0,
            gamma: e.gamma ?? 0
        };
    });
    function tick() {
        if (phoneState.threeCamera) {
            phoneState.threeCamera.rotation.set(
                THREE.MathUtils.degToRad(latestOrientation.beta),
                THREE.MathUtils.degToRad(latestOrientation.alpha),
                -THREE.MathUtils.degToRad(latestOrientation.gamma),
                'YXZ'
            );
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}
```

Call `startCameraOrientationLoop()` from `startPhoneCameraAndComposite` after the renderer is set up.

- [ ] **Step 2: Position the snapshot UI at fixed virtual distance**

In `applySnapshot`, after the create ops, position the screen group ~1.5 m in front and rescale ~0.5:

```js
phoneState.threeScene.position.set(0, 1.5, -1.5);
phoneState.threeScene.scale.setScalar(0.5);
```

Wait — `threeScene` is the root scene, not a group. Instead, wrap snapshot objects in a sub-group. Modify `applySnapshot`:

Replace the body with this fuller version:

```js
function applySnapshot(msg) {
    if (phoneState.snapshotRoot) {
        phoneState.threeScene.remove(phoneState.snapshotRoot);
    }
    const root = new THREE.Group();
    root.position.set(0, 0, -1.5);
    root.scale.setScalar(0.5);
    phoneState.threeScene.add(root);
    phoneState.snapshotRoot = root;

    deltaApplier = new DeltaApplier(root);
    const ops = msg.screen.objects.map((item) => ({
        op: 'create',
        id: item.id,
        type: item.type,
        pos: item.pos,
        rot: item.rot,
        scale: item.scale,
        color: item.color
    }));
    deltaApplier.apply(ops);
    status.textContent = `screen ${msg.screen.id} (${msg.screen.objects.length})`;
}
```

- [ ] **Step 3: Manual smoke**

Pair real iPhone via tunnel. Camera permission: yes. Orientation permission: yes. Expected: AR-ish overlay floats in front of the device; tilting pans it. Walking does not anchor (intentional v1 limit).

- [ ] **Step 4: Commit**

```bash
git add phone.js
git commit -m "iOS orientation mode: tilt camera + fixed-distance snapshot root"
```

---

## Phase 14 — Android WebXR Mode

### Task 14.1: Detect WebXR availability and branch on platform

**Files:**
- Modify: `phone.js`

- [ ] **Step 1: Add detection helper and branch**

Replace the platform-detect line in `onPhonePeerConnected`:

```js
const isAndroid = /Android/i.test(navigator.userAgent);
const xrSupported = isAndroid && navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));
phonePeer.sendSceneSync(encodeSceneSync({
    t: MSG.READY,
    platform: isAndroid ? 'android' : 'ios',
    caps: { webxr: xrSupported, depth: false, hitTest: xrSupported }
}));

if (xrSupported) await startWebXrMode();
else { startCameraOrientationLoop(); /* iOS path */ }
```

(Wrap `onPhonePeerConnected` body in `async function`.)

- [ ] **Step 2: Stub `startWebXrMode`**

```js
async function startWebXrMode() {
    try {
        const session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['depth-sensing']
        });
        phoneState.xrSession = session;
        const canvas = phoneState.threeRenderer.domElement;
        await phoneState.threeRenderer.xr.setSession(session);
        phoneState.threeRenderer.xr.enabled = true;
        const refSpace = await session.requestReferenceSpace('local');
        phoneState.xrRefSpace = refSpace;
        const viewerSpace = await session.requestReferenceSpace('viewer');
        phoneState.xrHitTest = await session.requestHitTestSource({ space: viewerSpace });
        startXrPoseLoop();
    } catch (err) {
        status.textContent = `WebXR failed: ${err.message}`;
        startCameraOrientationLoop();
    }
}

function startXrPoseLoop() {
    const session = phoneState.xrSession;
    session.requestAnimationFrame(function onXrFrame(_t, frame) {
        const refSpace = phoneState.xrRefSpace;
        const viewerPose = frame.getViewerPose(refSpace);
        if (viewerPose && phonePeer) {
            const m = new Float32Array(viewerPose.transform.matrix);
            phonePeer.sendPoseStream(encodeXrPose(m, performance.now()));
        }
        if (session) session.requestAnimationFrame(onXrFrame);
    });
}
```

- [ ] **Step 3: Manual smoke (Android device required)**

Pair an Android Chrome on a Pixel-class device via tunnel. Expected: AR session starts; view shows snapshot anchored in front; pose-stream sends XR matrices. On older Android without WebXR, falls back to tilt path.

- [ ] **Step 4: Commit**

```bash
git add phone.js
git commit -m "Android WebXR mode: immersive-ar session, hit-test source, XR pose streaming"
```

---

### Task 14.2: Desktop ray-cast updated to use XR pose when available

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Update `handlePhoneTap` to honor XR matrix**

Replace the camera setup block in `handlePhoneTap`:

```js
    const phoneCam = new THREE.PerspectiveCamera(60, msg.vw / msg.vh, 0.05, 50);
    if (phonePose.kind === POSE_TYPE_XR && phonePose.matrix) {
        phoneCam.matrix.fromArray(phonePose.matrix);
        phoneCam.matrixAutoUpdate = false;
        phoneCam.matrixWorldNeedsUpdate = true;
    } else {
        phoneCam.position.set(0, 1.5, 0);
        phoneCam.rotation.set(
            THREE.MathUtils.degToRad(phonePose.beta),
            THREE.MathUtils.degToRad(phonePose.alpha),
            -THREE.MathUtils.degToRad(phonePose.gamma),
            'YXZ'
        );
    }
    phoneCam.updateMatrixWorld(true);
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "desktop: ray-cast against XR-pose camera when phone is in WebXR mode"
```

---

## Phase 15 — Mode Toggle & Prototype Navigation

### Task 15.1: Edit/Play toggle pill on phone

**Files:**
- Modify: `phone.html`
- Modify: `styles.css`
- Modify: `phone.js`

- [ ] **Step 1: Add toggle markup**

Inside `#phone-root` in `phone.html`, before the closing `</div>`:

```html
<div id="phone-mode-toggle" class="phone-mode-pill" data-mode="edit">
    <button data-mode="edit" class="active">Edit</button>
    <button data-mode="play">Play</button>
</div>
```

- [ ] **Step 2: Append CSS**

```css
.phone-mode-pill { position: absolute; bottom: 18px; right: 18px; background: rgba(15,23,42,0.85); border: 1px solid #334155; border-radius: 999px; padding: 4px; display: flex; gap: 4px; }
.phone-mode-pill button { padding: 6px 14px; border-radius: 999px; border: none; background: transparent; color: #cbd5e1; font: 13px Inter, sans-serif; cursor: pointer; }
.phone-mode-pill button.active { background: #4f46e5; color: #fff; }
```

- [ ] **Step 3: Wire in `phone.js`**

Append:

```js
let phoneMode = 'edit';

function startModeToggle() {
    document.querySelectorAll('#phone-mode-toggle button').forEach((b) => {
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            phoneMode = b.dataset.mode;
            document.querySelectorAll('#phone-mode-toggle button').forEach((x) => x.classList.toggle('active', x === b));
            phonePeer?.sendSceneSync(encodeSceneSync({ t: MSG.MODE, mode: phoneMode }));
        });
    });
}
```

Call `startModeToggle()` from `onPhonePeerConnected`.

- [ ] **Step 4: Commit**

```bash
git add phone.html styles.css phone.js
git commit -m "Phone Edit/Play toggle pill + MODE message"
```

---

### Task 15.2: Play-mode tap → screen-switch (desktop-side routing)

**Files:**
- Modify: `main.js`

The phone tap handler from Task 12.3 stays unchanged. The desktop decides whether a tap is a select or a play-mode navigation based on the most recent `MODE` message. Phone mode is broadcast via the toggle pill (Task 15.1).

- [ ] **Step 1: Desktop — track phone mode and route**

Track phone mode:

```js
let lastPhoneMode = 'edit';

// extend onSceneSyncMessage:
    if (msg.t === MSG.MODE) lastPhoneMode = msg.mode;
```

In `handlePhoneTap`, after the `hit` is found:

```js
    if (lastPhoneMode === 'play') {
        const linkTargetId = hit.object.userData?.prototypeLinkScreenId;
        if (linkTargetId) {
            switchToScreen(linkTargetId); // existing function — Task 11.3 already routes a SCREEN_SWITCH message + new snapshot to the phone
            return;
        }
    }
    selectObject(hit.object);
    phonePair.peer?.sendSceneSync(encodeSceneSync({ t: MSG.SELECT_ACK, objectId: hit.object.userData.voidId }));
```

Note: `prototypeLinkScreenId` is the field name from the existing prototype-linking commit (`4150ea6`). Open that commit (or read the relevant interaction-panel code in `main.js`) to confirm the exact userData key — if it differs (`linkedScreenId`, `prototypeLink`, etc.), substitute the real key.

- [ ] **Step 2: Manual smoke**

Pair phone. On desktop, link two buttons via the prototype panel (existing flow). Toggle phone to Play. Tap the linked button → desktop's active screen switches → phone's snapshot updates.

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "Play mode: phone tap on linked object triggers desktop screen-switch"
```

---

## Phase 16 — Error Handling & Recovery

### Task 16.1: PIN error UX with attempts + lockout

**Files:**
- Modify: `phone.js`

- [ ] **Step 1: Already partially in `submitPin`. Tighten messages.**

Replace the body of `submitPin` (the `wrong-pin` and `gone` branches):

```js
        if (result.status === 'wrong-pin') {
            setError(`Wrong PIN. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} left.`);
            pinDigits = ''; renderPin();
            okBtn.disabled = false;
            if (result.attemptsRemaining === 0) {
                setError('Too many attempts. Re-scan QR from desktop.');
                okBtn.disabled = true;
            }
        } else if (result.status === 'gone') {
            setError('Session expired. Re-scan QR from desktop.');
            okBtn.disabled = true;
        }
```

- [ ] **Step 2: Commit**

```bash
git add phone.js
git commit -m "phone: clearer PIN error messages with lockout state"
```

---

### Task 16.2: WebRTC failure → user-visible banner

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Update `onPeerDisconnected` to differentiate failure vs clean close**

Track failure:

```js
function showFailureBanner(text) {
    const banner = document.getElementById('phone-feed-banner');
    if (!banner) return;
    const span = banner.querySelector('span');
    if (span) span.textContent = text;
}
```

In the peer creation `onState`:

```js
        onState: (s) => {
            if (s === 'connected') onPeerConnected();
            else if (s === 'failed') { showFailureBanner('Couldn\'t establish a direct connection — your network may block peer-to-peer.'); exitPairMode(); }
            else if (s === 'disconnected') showFailureBanner('Phone disconnected — waiting to reconnect…');
            else if (s === 'closed') exitPairMode();
        }
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "Desktop banner reflects ICE state — failed/disconnected/closed"
```

---

### Task 16.3: Camera permission denied UX on phone

**Files:**
- Modify: `phone.js`

- [ ] **Step 1: Replace the `catch` in `startPhoneCameraAndComposite`**

```js
    } catch (err) {
        const overlay = document.createElement('div');
        overlay.className = 'phone-screen';
        overlay.innerHTML = `
            <h1>Camera access required</h1>
            <p style="color:#94a3b8;text-align:center;max-width:280px;margin:6px 0 16px;">${err.name === 'NotAllowedError' ? 'You denied camera access. Tap below to retry.' : err.message}</p>
            <button id="phone-camera-retry" style="padding:10px 20px;border-radius:8px;border:1px solid #334155;background:#4f46e5;color:#fff;cursor:pointer;">Retry</button>
        `;
        document.getElementById('phone-root').appendChild(overlay);
        overlay.querySelector('#phone-camera-retry').addEventListener('click', () => location.reload());
        throw err;
    }
```

- [ ] **Step 2: Commit**

```bash
git add phone.js
git commit -m "phone: full-screen retry overlay on camera-permission denied"
```

---

### Task 16.4: Replace existing `openDesktopMobilePreviewShareDialog` flow

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Comment out the call from `openSpatialPreview`**

Find the existing block at `main.js:4452`:

```js
        // Desktop flow: show non-blocking QR + link while webcam preview runs.
        if (!isMobileDevice) {
            openDesktopMobilePreviewShareDialog();
        }
```

Replace with:

```js
        // Old QR-share flow superseded by the new phone-pair button (btn-phone-pair).
        // See openPhonePairing() above.
```

- [ ] **Step 2: Delete the now-unused functions**

Delete `openDesktopMobilePreviewShareDialog` (around `main.js:4126`) and `initializeIPhoneQuickLookEntry` (around `main.js:4198`) and remove their references from `initializeApp` / wherever they're called. Keep `launchQuickLookForActiveScreen` — it's still useful as an iOS-only one-shot Quick Look fallback that can be triggered separately later.

- [ ] **Step 3: Manual smoke**

Open the editor. Click the existing camera "Spatial Preview" button — the old QR card should NOT appear; you get the webcam preview as before. Click the new phone icon — the new pairing modal appears. The two flows are now independent.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "Remove legacy openDesktopMobilePreviewShareDialog + initializeIPhoneQuickLookEntry; new flow takes over"
```

---

## Phase 17 — Playwright Smoke Test (Ghost-Phone)

### Task 17.1: Playwright config

**Files:**
- Create: `playwright.config.js`

- [ ] **Step 1: Create**

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    use: {
        baseURL: 'http://localhost:8000',
        headless: true,
        permissions: ['camera', 'microphone']
    },
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:8000',
        reuseExistingServer: true,
        timeout: 30_000
    }
});
```

- [ ] **Step 2: Commit**

```bash
git add playwright.config.js
git commit -m "Playwright config for e2e ghost-phone tests"
```

---

### Task 17.2: Ghost-phone pairing test

**Files:**
- Create: `tests/e2e/ghost-pair.spec.js`

- [ ] **Step 1: Write the test**

```js
import { test, expect } from '@playwright/test';

test('desktop and ghost-phone pair via QR + PIN', async ({ context }) => {
    const editor = await context.newPage();
    await editor.goto('/');
    await editor.click('#btn-phone-pair');

    // Wait for QR + PIN to render
    await editor.waitForFunction(() => window.__voidLastPhoneUrl?.length > 0, null, { timeout: 5000 });
    const phoneUrl = await editor.evaluate(() => window.__voidLastPhoneUrl);
    const pin = await editor.evaluate(() => document.getElementById('phone-pair-pin-value').textContent);
    expect(pin).toMatch(/^\d{4}$/);

    const phone = await context.newPage();
    await phone.goto(phoneUrl);
    for (const d of pin.split('')) {
        await phone.click(`.phone-pin-keypad button[data-key="${d}"]`);
    }
    await phone.click('#phone-pin-ok');

    // Editor should see modal close and pair-mode active
    await editor.waitForSelector('#phone-pair-modal.hidden', { timeout: 10000 });
    const paired = await editor.evaluate(() => document.body.classList.contains('viewport-paired'));
    expect(paired).toBe(true);
});
```

- [ ] **Step 2: Run**

Run: `npm run test:e2e`
Expected: PASS. (This will exercise the full handshake plus camera-permission auto-grant configured in `playwright.config.js`.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/
git commit -m "Playwright: ghost-phone pairing smoke test"
```

---

## Phase 18 — Deploy & Documentation

### Task 18.1: Update `README.md` with phone-bridge instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a section**

```markdown

## Phone Live Preview

1. `npm run dev` starts both the editor (port 8000) and the signaling Worker (port 8787).
2. For testing on a real phone, run `npm run dev:tunnel` to expose the editor over HTTPS via Cloudflare Tunnel.
3. In the editor, click the phone icon next to the camera icon. Scan the QR with your phone, enter the 4-digit PIN.
4. Phone shows live AR preview; desktop edits propagate within ~100 ms.

### Deploy

- `npm run deploy:worker` — push the signaling Worker.
- `npm run deploy:pages` — push the static site (editor + phone client).
- `npm run deploy` — both, in order.

Cloudflare account required; `wrangler login` once before first deploy.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "README: phone live preview usage + deploy instructions"
```

---

### Task 18.2: Manual deploy verification (one-time)

**Files:**
- None (manual)

- [ ] **Step 1: Login**

Run: `npx wrangler login`
Expected: browser opens, Cloudflare auth completes.

- [ ] **Step 2: Deploy Worker**

Run: `npm run deploy:worker`
Expected: outputs `https://void-signal.<account>.workers.dev`.

- [ ] **Step 3: Deploy Pages**

Run: `npm run deploy:pages`
Expected: outputs `https://void.pages.dev` (or similar).

- [ ] **Step 4: Smoke test against deployed site**

Open `https://void.pages.dev` on desktop. Click phone icon. Scan QR with iPhone (cellular). Enter PIN. Verify live link works.

- [ ] **Step 5: Commit any deploy notes**

If you discover account-specific config (e.g., a `[vars]` block in `wrangler.toml` for a custom signaling URL on the front-end), commit it now.

```bash
git add -A
git commit -m "Deploy verification — any production config tweaks discovered during first deploy"
```

(Skip if nothing changed.)

---

## Self-Review Checklist (run before handing off)

- [ ] All 8 spec decisions (Q1–Q8) implemented or explicitly out-of-scope
- [ ] Acceptance Criteria 1–7 from the spec verifiable against this plan's tasks
- [ ] No "TBD", "TODO", or vague steps remaining
- [ ] All file paths used in the plan match repo reality (run `find . -name <file>` if unsure)
- [ ] Every test step has a concrete code block, not a description
- [ ] Every commit has a clear, imperative subject

---

**End of plan.**
