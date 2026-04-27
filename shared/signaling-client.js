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
    throw new Error(`signal/claim unexpected status: ${res.status}`);
}
