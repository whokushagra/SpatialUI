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
