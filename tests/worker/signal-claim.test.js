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
    it('rejects a second claim on an already-claimed session', async () => {
        const { sessionId, pin } = await newSession();
        const pinHash = await sha256Hex(`${sessionId}:${pin}`);
        const first = await SELF.fetch('http://x/api/signal/claim', {
            method: 'POST',
            body: JSON.stringify({ sessionId, pinHash })
        });
        expect(first.status).toBe(200);
        const second = await SELF.fetch('http://x/api/signal/claim', {
            method: 'POST',
            body: JSON.stringify({ sessionId, pinHash })
        });
        expect(second.status).toBe(403);
    });
});
