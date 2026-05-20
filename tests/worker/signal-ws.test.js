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
    const deskRes = await SELF.fetch(`http://x/api/signal/ws?role=desktop&s=${sessionId}`, {
        headers: { Upgrade: 'websocket' }
    });
    const desk = deskRes.webSocket;
    desk.accept();
    const phoneRes = await SELF.fetch(`http://x/api/signal/ws?role=phone&s=${sessionId}&t=${claimToken}`, {
        headers: { Upgrade: 'websocket' }
    });
    const phone = phoneRes.webSocket;
    phone.accept();
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
