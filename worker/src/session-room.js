export class SessionRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }
    async fetch(request) {
        return new Response('SessionRoom: not implemented yet', { status: 501 });
    }
}
