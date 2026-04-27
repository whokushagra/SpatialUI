export async function signalNew({ baseUrl = '/api/signal', fetchImpl = fetch } = {}) {
    const res = await fetchImpl(`${baseUrl}/new`, { method: 'POST' });
    if (!res.ok) throw new Error(`signal/new failed: ${res.status}`);
    return res.json();
}

export async function signalClaim({ sessionId, pinHash, baseUrl = '/api/signal', fetchImpl = fetch }) {
    const res = await fetchImpl(`${baseUrl}/claim`, {
        method: 'POST',
        body: JSON.stringify({ sessionId, pinHash })
    });
    if (res.status === 200) {
        const { claimToken } = await res.json();
        return { status: 'ok', claimToken };
    }
    if (res.status === 401) {
        const { attemptsRemaining } = await res.json();
        return { status: 'wrong-pin', attemptsRemaining };
    }
    if (res.status === 404) return { status: 'gone' };
    if (res.status === 403) return { status: 'taken' };
    throw new Error(`signal/claim unexpected status: ${res.status}`);
}

export function openSignalingSocket({ sessionId, role, claimToken = null, baseWsUrl }) {
    const url = new URL(baseWsUrl);
    url.searchParams.set('role', role);
    url.searchParams.set('s', sessionId);
    if (claimToken) url.searchParams.set('t', claimToken);
    return new WebSocket(url.toString());
}

export function inferWsBase(httpBase = window.location.origin) {
    const u = new URL('/api/signal/ws', httpBase);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.toString();
}
