import { signalClaim } from './shared/signaling-client.js';
import { hashPin } from './shared/protocol.js';

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
            // WebRTC handshake wired in Phase 7.
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
