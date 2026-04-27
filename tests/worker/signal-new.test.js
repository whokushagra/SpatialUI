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
