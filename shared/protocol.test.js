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
