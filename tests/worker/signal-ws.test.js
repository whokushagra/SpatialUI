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
