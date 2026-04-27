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
        return new Response('not found', { status: 404 });
    }
}
