import { describe, it, expect } from 'vitest';
import { MSG, encodeSceneSync, decodeSceneSync } from './protocol.js';

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
