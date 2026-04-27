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
