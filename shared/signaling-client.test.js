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
