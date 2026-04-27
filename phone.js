import { signalClaim, openSignalingSocket, inferWsBase } from './shared/signaling-client.js';
import { hashPin, MSG, encodeSceneSync, decodeSceneSync, SnapshotReassembler } from './shared/protocol.js';
import { createPeer } from './shared/peer.js';
import { DeltaApplier } from './shared/delta-applier.js';
import * as THREE from 'three';

const fragment = (window.location.hash || '').match(/#s=([0-9a-f]{32})/);
const sessionId = fragment ? fragment[1] : null;

const status = document.getElementById('phone-status');
const pinScreen = document.getElementById('phone-pin-screen');
const pinDisplay = document.getElementById('phone-pin-display');
const pinError = document.getElementById('phone-pin-error');
const okBtn = document.getElementById('phone-pin-ok');

let pinDigits = '';

function renderPin() {
    pinDisplay.textContent = (pinDigits + '----').slice(0, 4).split('').join(' ');
}

function setError(message) {
    pinError.textContent = message;
}

if (!sessionId) {
    setError('Invalid pairing link. Re-scan the QR from the desktop.');
    okBtn.disabled = true;
} else {
    status.textContent = `session ${sessionId.slice(0, 6)}…`;
    pinScreen.querySelectorAll('.phone-pin-keypad button').forEach((b) => {
        b.addEventListener('click', () => {
            const key = b.dataset.key;
            if (key === 'back') pinDigits = pinDigits.slice(0, -1);
            else if (key === 'ok') return submitPin();
            else if (pinDigits.length < 4 && /\d/.test(key)) pinDigits += key;
            renderPin();
        });
    });
    renderPin();
}

async function submitPin() {
    if (pinDigits.length !== 4) { setError('Enter 4 digits.'); return; }
    setError('');
    okBtn.disabled = true;
    try {
        const pinHash = await hashPin(sessionId, pinDigits);
        const result = await signalClaim({ sessionId, pinHash });
        if (result.status === 'ok') {
            window.__phoneClaim = { sessionId, claimToken: result.claimToken };
            pinScreen.style.display = 'none';
            status.textContent = 'PIN OK. Connecting…';
            await startPhonePeer(result.claimToken);
        } else if (result.status === 'wrong-pin') {
            setError(`Wrong PIN. ${result.attemptsRemaining} attempts left.`);
            pinDigits = ''; renderPin();
        } else if (result.status === 'gone') {
            setError('Session expired. Re-scan the QR from the desktop.');
            okBtn.disabled = true;
        }
    } catch (err) {
        console.error(err);
        setError('Could not reach pairing server.');
    } finally {
        if (!okBtn.disabled || pinDigits.length === 0) okBtn.disabled = false;
    }
}

let phonePeer = null;

async function startPhonePeer(claimToken) {
    status.textContent = 'starting camera…';
    let compositeStream;
    try {
        compositeStream = await startPhoneCameraAndComposite();
    } catch {
        return; // status already set inside startPhoneCameraAndComposite
    }
    const ws = openSignalingSocket({
        sessionId,
        role: 'phone',
        claimToken,
        baseWsUrl: inferWsBase()
    });
    await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', rej, { once: true });
    });
    phonePeer = createPeer({
        role: 'phone',
        signalingWs: ws,
        onSceneSync: (d) => onPhoneSceneSync(d),
        onState: (s) => {
            status.textContent = `WebRTC: ${s}`;
            if (s === 'connected') onPhonePeerConnected();
        }
    });
    compositeStream.getVideoTracks().forEach((t) => phonePeer.pc.addTrack(t, compositeStream));
}

function onPhonePeerConnected() {
    status.textContent = 'connected';
    phonePeer.sendSceneSync(encodeSceneSync({
        t: MSG.READY,
        platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : (/Android/i.test(navigator.userAgent) ? 'android' : 'other'),
        caps: { webxr: !!navigator.xr, depth: false, hitTest: false }
    }));
}

const snapshotReassembler = new SnapshotReassembler();

let deltaApplier = null;

function applySnapshot(msg) {
    if (!deltaApplier) deltaApplier = new DeltaApplier(phoneState.threeScene);
    for (const id of Array.from(deltaApplier.byId.keys())) {
        deltaApplier.apply([{ op: 'delete', id }]);
    }
    const ops = msg.screen.objects.map((item) => ({
        op: 'create',
        id: item.id,
        type: item.type,
        pos: item.pos,
        rot: item.rot,
        scale: item.scale,
        color: item.color
    }));
    deltaApplier.apply(ops);
    status.textContent = `screen ${msg.screen.id} (${msg.screen.objects.length})`;
}

function onPhoneSceneSync(data) {
    const msg = decodeSceneSync(typeof data === 'string' ? data : new TextDecoder().decode(data));
    if (!msg) return;
    if (msg.t === MSG.SNAPSHOT) applySnapshot(msg);
    else if (msg.t === MSG.SNAPSHOT_CHUNK) {
        const final = snapshotReassembler.feed(msg);
        if (final) applySnapshot(final);
    } else if (msg.t === MSG.DELTA) {
        if (deltaApplier) deltaApplier.apply(msg.ops || []);
    } else if (msg.t === MSG.SCREEN_SWITCH) {
        // The desktop will follow up with a fresh SNAPSHOT for the new screen.
    }
}

const phoneState = {
    cameraStream: null,
    threeRenderer: null,
    threeScene: null,
    threeCamera: null,
    composite: { canvas: null, stream: null }
};

async function startPhoneCameraAndComposite() {
    const video = document.getElementById('phone-camera-bg');
    const canvas = document.getElementById('phone-canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    try {
        phoneState.cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }, audio: false
        });
        video.srcObject = phoneState.cameraStream;
        await video.play();
    } catch (err) {
        status.textContent = `camera: ${err.message}`;
        throw err;
    }

    phoneState.threeRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    phoneState.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    phoneState.threeRenderer.setSize(canvas.width, canvas.height, false);
    phoneState.threeScene = new THREE.Scene();
    phoneState.threeCamera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.05, 50);
    phoneState.threeCamera.position.set(0, 1.5, 0);
    phoneState.threeScene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(2, 4, 2);
    phoneState.threeScene.add(dir);

    function frame() {
        phoneState.threeRenderer.render(phoneState.threeScene, phoneState.threeCamera);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    const composite = document.createElement('canvas');
    composite.width = canvas.width;
    composite.height = canvas.height;
    const ctx = composite.getContext('2d');
    function compositeFrame() {
        ctx.drawImage(video, 0, 0, composite.width, composite.height);
        ctx.drawImage(canvas, 0, 0);
        requestAnimationFrame(compositeFrame);
    }
    requestAnimationFrame(compositeFrame);

    phoneState.composite.canvas = composite;
    phoneState.composite.stream = composite.captureStream(30);
    return phoneState.composite.stream;
}
