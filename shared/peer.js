const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }
];

export function createPeer({ role, signalingWs, onTrack, onSceneSync, onPoseStream, onState }) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    let sceneSync = null;
    let poseStream = null;

    if (role === 'desktop') {
        // Pre-declare a video receive slot so the offer SDP includes a video m-section.
        // Without this, the phone's addTrack on the answer side has no matching m-line —
        // the answer can't introduce media not in the offer, so video silently drops out
        // of negotiation. Connection succeeds via data channels but onTrack never fires.
        pc.addTransceiver('video', { direction: 'recvonly' });
        sceneSync = pc.createDataChannel('scene-sync', { ordered: true });
        poseStream = pc.createDataChannel('pose-stream', { ordered: false, maxRetransmits: 0 });
        wireChannel(sceneSync, 'scene-sync');
        wireChannel(poseStream, 'pose-stream');
    } else {
        pc.addEventListener('datachannel', (e) => {
            if (e.channel.label === 'scene-sync') { sceneSync = e.channel; wireChannel(sceneSync, 'scene-sync'); }
            else if (e.channel.label === 'pose-stream') { poseStream = e.channel; wireChannel(poseStream, 'pose-stream'); }
        });
    }

    function wireChannel(ch, label) {
        ch.binaryType = 'arraybuffer';
        ch.addEventListener('message', (e) => {
            if (label === 'scene-sync') onSceneSync?.(e.data);
            else onPoseStream?.(e.data);
        });
    }

    pc.addEventListener('track', (e) => onTrack?.(e));
    pc.addEventListener('iceconnectionstatechange', () => onState?.(pc.iceConnectionState));
    pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) signalingWs.send(JSON.stringify({ kind: 'ice', candidate: e.candidate }));
    });

    signalingWs.addEventListener('message', async (e) => {
        let msg = null;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.kind === 'offer') {
            await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signalingWs.send(JSON.stringify({ kind: 'answer', sdp: answer.sdp }));
        } else if (msg.kind === 'answer') {
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        } else if (msg.kind === 'ice') {
            try { await pc.addIceCandidate(msg.candidate); } catch {}
        }
    });

    async function startOffer() {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signalingWs.send(JSON.stringify({ kind: 'offer', sdp: offer.sdp }));
    }

    function sendSceneSync(data) {
        if (sceneSync && sceneSync.readyState === 'open') sceneSync.send(data);
    }

    function sendPoseStream(buf) {
        if (poseStream && poseStream.readyState === 'open') poseStream.send(buf);
    }

    function close() {
        try { sceneSync?.close(); } catch {}
        try { poseStream?.close(); } catch {}
        try { pc.close(); } catch {}
    }

    return { pc, startOffer, sendSceneSync, sendPoseStream, close };
}
