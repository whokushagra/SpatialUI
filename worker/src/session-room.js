function randHex(bytes) {
    const arr = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class SessionRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.sessionId = null;
        this.pinHash = null;
        this.plainPin = null;
        this.pinAttemptsRemaining = 3;
        this.claimToken = null;
        this.createdAt = Date.now();
        this.lastActivityAt = Date.now();
        this.desktopWs = null;
        this.phoneWs = null;
    }
    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/init' && request.method === 'POST') {
            const { sessionId, pin } = await request.json();
            this.sessionId = sessionId;
            this.plainPin = pin;
            this.lastActivityAt = Date.now();
            return new Response('ok');
        }
        if (url.pathname === '/claim' && request.method === 'POST') {
            if (!this.sessionId) return new Response('not found', { status: 404 });
            const idleMs = Date.now() - this.lastActivityAt;
            const claimed = !!this.claimToken;
            const ttl = claimed ? 10 * 60 * 1000 : 5 * 60 * 1000;
            if (idleMs > ttl) {
                this.sessionId = null;
                this.plainPin = null;
                this.claimToken = null;
                return new Response('not found', { status: 404 });
            }
            const { pinHash } = await request.json();
            const expected = await sha256Hex(`${this.sessionId}:${this.plainPin}`);
            if (pinHash !== expected) {
                this.pinAttemptsRemaining -= 1;
                if (this.pinAttemptsRemaining <= 0) {
                    this.sessionId = null;
                    this.plainPin = null;
                    return new Response('not found', { status: 404 });
                }
                return Response.json({ attemptsRemaining: this.pinAttemptsRemaining }, { status: 401 });
            }
            if (!this.claimToken) this.claimToken = randHex(24);
            this.lastActivityAt = Date.now();
            return Response.json({ claimToken: this.claimToken });
        }
        if (url.pathname === '/ws') {
            if (!this.sessionId) return new Response('not found', { status: 404 });
            const role = url.searchParams.get('role');
            const claimToken = url.searchParams.get('t');
            if (role === 'phone' && claimToken !== this.claimToken) {
                return new Response('forbidden', { status: 403 });
            }
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            server.accept();
            this.attachSocket(server, role);
            return new Response(null, { status: 101, webSocket: client });
        }
        return new Response('not found', { status: 404 });
    }

    attachSocket(ws, role) {
        if (role === 'desktop') this.desktopWs = ws;
        if (role === 'phone') this.phoneWs = ws;
        ws.addEventListener('message', (e) => this.onSocketMessage(role, e.data));
        ws.addEventListener('close', () => {
            if (role === 'desktop' && this.desktopWs === ws) this.desktopWs = null;
            if (role === 'phone' && this.phoneWs === ws) this.phoneWs = null;
        });
    }

    onSocketMessage(role, data) {
        this.lastActivityAt = Date.now();
        const target = role === 'desktop' ? this.phoneWs : this.desktopWs;
        if (!target) return;
        try {
            target.send(typeof data === 'string' ? data : new Uint8Array(data));
        } catch {
            // peer gone; close handler will clean up
        }
    }
}
