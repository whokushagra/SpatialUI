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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/signal/new') return handleSignalNew(request, env);
        if (url.pathname === '/api/signal/claim') return handleSignalClaim(request, env);
        if (url.pathname === '/api/signal/ws') return handleSignalWs(request, env);
        return new Response('not found', { status: 404 });
    }
};
