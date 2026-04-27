import { signalClaim, openSignalingSocket, inferWsBase } from './shared/signaling-client.js';
import { hashPin, MSG, encodeSceneSync, decodeSceneSync, SnapshotReassembler, encodeOrientation, encodeXrPose } from './shared/protocol.js';
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
            setError(`Wrong PIN. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} left.`);
            pinDigits = ''; renderPin();
            okBtn.disabled = false;
            if (result.attemptsRemaining === 0) {
                setError('Too many attempts. Re-scan QR from desktop.');
                okBtn.disabled = true;
            }
        } else if (result.status === 'gone') {
            setError('Session expired. Re-scan QR from desktop.');
            okBtn.disabled = true;
        } else if (result.status === 'taken') {
            setError('This session is already in use. Re-scan QR from desktop.');
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

async function onPhonePeerConnected() {
    status.textContent = 'connected';
    const isAndroid = /Android/i.test(navigator.userAgent);
    let xrSupported = false;
    if (isAndroid && navigator.xr) {
        try { xrSupported = await navigator.xr.isSessionSupported('immersive-ar'); } catch { xrSupported = false; }
    }
    phonePeer.sendSceneSync(encodeSceneSync({
        t: MSG.READY,
        platform: isAndroid ? 'android' : (/iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : 'other'),
        caps: { webxr: xrSupported, depth: false, hitTest: xrSupported }
    }));
    if (xrSupported) {
        await startWebXrMode();
    }
    startOrientationLoop();
    startTapHandler();
    startModeToggle();
}

const snapshotReassembler = new SnapshotReassembler();

let deltaApplier = null;

function applySnapshot(msg) {
    if (phoneState.snapshotRoot) {
        phoneState.threeScene.remove(phoneState.snapshotRoot);
    }
    const root = new THREE.Group();
    phoneState.threeScene.add(root);
    phoneState.snapshotRoot = root;

    deltaApplier = new DeltaApplier(root);
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

    // Auto-frame the snapshot in front of the phone camera. Editor-world coordinates can be
    // anywhere; we measure the assembled bounding box, scale to ~1m largest dimension, and
    // park the centroid 1.5m ahead of the camera at eye level.
    autoFrameSnapshot(root);

    status.textContent = `screen ${msg.screen.id} (${msg.screen.objects.length})`;
}

function autoFrameSnapshot(root) {
    const cam = phoneState.threeCamera;
    if (!cam) return;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const targetSize = 1.0;
    const fit = targetSize / maxDim;
    root.scale.setScalar(fit);
    // Centroid in world after scaling lands at center * fit relative to current root pos (0,0,0).
    // We want the scaled centroid at camPos + camForward * 1.5.
    const camPos = cam.position.clone();
    const targetWorld = camPos.clone().add(new THREE.Vector3(0, 0, -1.5));
    root.position.set(
        targetWorld.x - center.x * fit,
        targetWorld.y - center.y * fit,
        targetWorld.z - center.z * fit
    );
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
    } else if (msg.t === MSG.SELECT_ACK) {
        const obj = deltaApplier?.get(msg.objectId);
        if (obj) flashHighlight(obj);
    }
}

const phoneState = {
    cameraStream: null,
    threeRenderer: null,
    threeScene: null,
    threeCamera: null,
    composite: { canvas: null, stream: null },
    snapshotRoot: null,
    xrSession: null,
    xrRefSpace: null,
    xrHitTest: null
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
        const overlay = document.createElement('div');
        overlay.className = 'phone-screen';
        overlay.innerHTML = `
            <h1>Camera access required</h1>
            <p style="color:#94a3b8;text-align:center;max-width:280px;margin:6px 0 16px;">${err.name === 'NotAllowedError' ? 'You denied camera access. Tap below to retry.' : err.message}</p>
            <button id="phone-camera-retry" style="padding:10px 20px;border-radius:8px;border:1px solid #334155;background:#4f46e5;color:#fff;cursor:pointer;">Retry</button>
        `;
        document.getElementById('phone-root').appendChild(overlay);
        overlay.querySelector('#phone-camera-retry').addEventListener('click', () => location.reload());
        throw err;
    }

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { await DeviceOrientationEvent.requestPermission(); } catch {}
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
    startCameraOrientationLoop();
    return phoneState.composite.stream;
}

let lastOrientationSend = 0;
function startOrientationLoop() {
    window.addEventListener('deviceorientation', (e) => {
        const now = performance.now();
        if (now - lastOrientationSend < 50) return; // ~20 Hz cap
        lastOrientationSend = now;
        if (!phonePeer) return;
        const buf = encodeOrientation(e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0, now);
        phonePeer.sendPoseStream(buf);
    });
}

function startTapHandler() {
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest('.phone-pin-keypad') || target.closest('#phone-mode-toggle')) return;
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        if (!phonePeer) return;
        phonePeer.sendSceneSync(encodeSceneSync({
            t: MSG.TAP, x, y, vw: window.innerWidth, vh: window.innerHeight, ts: performance.now()
        }));
    });
}

function flashHighlight(obj) {
    const helper = new THREE.BoxHelper(obj, 0x22c55e);
    phoneState.threeScene.add(helper);
    setTimeout(() => phoneState.threeScene.remove(helper), 1500);
}

let latestOrientation = { alpha: 0, beta: 0, gamma: 0 };

function startCameraOrientationLoop() {
    window.addEventListener('deviceorientation', (e) => {
        latestOrientation = {
            alpha: e.alpha ?? 0,
            beta: e.beta ?? 0,
            gamma: e.gamma ?? 0
        };
    });
    function tick() {
        if (phoneState.threeCamera) {
            phoneState.threeCamera.rotation.set(
                THREE.MathUtils.degToRad(latestOrientation.beta),
                THREE.MathUtils.degToRad(latestOrientation.alpha),
                -THREE.MathUtils.degToRad(latestOrientation.gamma),
                'YXZ'
            );
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

async function startWebXrMode() {
    try {
        const session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['depth-sensing']
        });
        phoneState.xrSession = session;
        await phoneState.threeRenderer.xr.setSession(session);
        phoneState.threeRenderer.xr.enabled = true;
        const refSpace = await session.requestReferenceSpace('local');
        phoneState.xrRefSpace = refSpace;
        const viewerSpace = await session.requestReferenceSpace('viewer');
        phoneState.xrHitTest = await session.requestHitTestSource({ space: viewerSpace });
        startXrPoseLoop();
    } catch (err) {
        status.textContent = `WebXR failed: ${err.message}`;
    }
}

function startXrPoseLoop() {
    const session = phoneState.xrSession;
    if (!session) return;
    session.requestAnimationFrame(function onXrFrame(_t, frame) {
        const refSpace = phoneState.xrRefSpace;
        const viewerPose = frame.getViewerPose(refSpace);
        if (viewerPose && phonePeer) {
            const m = new Float32Array(viewerPose.transform.matrix);
            phonePeer.sendPoseStream(encodeXrPose(m, performance.now()));
        }
        if (phoneState.xrSession === session) session.requestAnimationFrame(onXrFrame);
    });
}

let phoneMode = 'edit';

function startModeToggle() {
    document.querySelectorAll('#phone-mode-toggle button').forEach((b) => {
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            phoneMode = b.dataset.mode;
            document.querySelectorAll('#phone-mode-toggle button').forEach((x) => x.classList.toggle('active', x === b));
            phonePeer?.sendSceneSync(encodeSceneSync({ t: MSG.MODE, mode: phoneMode }));
        });
    });
}
