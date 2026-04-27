export { SessionRoom } from './session-room.js';

function randHex(bytes) {
    const arr = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function randPin() {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
    return n.toString().padStart(4, '0');
}

async function handleSignalNew(request, env) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const sessionId = randHex(16);
    const pin = randPin();
    const id = env.SESSION_ROOM.idFromName(sessionId);
    const stub = env.SESSION_ROOM.get(id);
    await stub.fetch('http://room/init', {
        method: 'POST',
        body: JSON.stringify({ sessionId, pin })
    });
    return Response.json({ sessionId, pin });
}

async function handleSignalClaim(request, env) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const { sessionId, pinHash } = await request.json();
    if (!sessionId || !pinHash) return new Response('bad request', { status: 400 });
    const id = env.SESSION_ROOM.idFromName(sessionId);
    const stub = env.SESSION_ROOM.get(id);
    return stub.fetch('http://room/claim', {
        method: 'POST',
        body: JSON.stringify({ pinHash })
    });
}

async function handleSignalWs(request, env) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const sessionId = url.searchParams.get('s');
    const claimToken = url.searchParams.get('t') || null;
    if (role !== 'desktop' && role !== 'phone') return new Response('bad role', { status: 400 });
    if (!sessionId) return new Response('missing session', { status: 400 });
    const id = env.SESSION_ROOM.idFromName(sessionId);
    const stub = env.SESSION_ROOM.get(id);
    return stub.fetch(`http://room/ws?role=${role}&t=${claimToken ?? ''}`, request);
}

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
};

function withCors(res) {
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        const url = new URL(request.url);
        let res;
        if (url.pathname === '/api/signal/new') res = await handleSignalNew(request, env);
        else if (url.pathname === '/api/signal/claim') res = await handleSignalClaim(request, env);
        else if (url.pathname === '/api/signal/ws') return handleSignalWs(request, env);
        else res = new Response('not found', { status: 404 });
        return withCors(res);
    }
};
