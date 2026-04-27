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
