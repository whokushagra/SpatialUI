import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

let scene = null;
let camera = null;
let renderer = null;
let stars = null;
let container = null;
let mounted = false;

let mouseMoveHandler = null;
let wheelHandler = null;
let resizeHandler = null;
let cardMouseMoveHandler = null;
let cardMouseLeaveHandler = null;

let targetX = 0;
let targetY = 0;
let currentX = 0;
let currentY = 0;

let shootingStarTimeout = null;
const shootingStarIntervals = new Set();
const nebulaResources = [];
const shootingStars = new Set();
const elementPool = [];
let activeElementIndex = 0;
let waitingForNext = false;
let nextSpawnTimeout = null;
let startFloatingTimeout = null;
let glassMaterial = null;
let edgeMaterial = null;
let pmremGenerator = null;
let envTexture = null;
let lastFrameTime = 0;

function createLoginCanvasHost() {
    const host = document.createElement('div');
    host.id = 'login-scene-host';
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '100vw';
    host.style.height = '100vh';
    host.style.zIndex = '0';
    host.style.pointerEvents = 'none';
    return host;
}

function createNebula(x, y, z, color, size) {
    if (!scene) return;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, `${color}22`);
    gradient.addColorStop(0.4, `${color}11`);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    scene.add(sprite);
    nebulaResources.push({ texture, material, sprite });
}

function createShootingStar() {
    if (!scene) return;
    const geometry = new THREE.BufferGeometry();
    const startX = (Math.random() - 0.5) * 20;
    const startY = Math.random() * 5 + 2;
    const startZ = (Math.random() - 0.5) * 5;
    const length = Math.random() * 3 + 1.5;

    const points = [
        new THREE.Vector3(startX, startY, startZ),
        new THREE.Vector3(startX - length, startY - length * 0.3, startZ)
    ];
    geometry.setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8
    });

    const star = new THREE.Line(geometry, material);
    scene.add(star);
    shootingStars.add({ star, geometry, material });

    let elapsed = 0;
    const speed = 0.05;
    const interval = window.setInterval(() => {
        elapsed += 16;
        star.position.x -= speed;
        star.position.y -= speed * 0.3;
        material.opacity = Math.max(0, 0.8 - elapsed / 1500);
        if (elapsed >= 1500) {
            scene?.remove(star);
            geometry.dispose();
            material.dispose();
            shootingStars.forEach((entry) => {
                if (entry.star === star) shootingStars.delete(entry);
            });
            window.clearInterval(interval);
            shootingStarIntervals.delete(interval);
        }
    }, 16);
    shootingStarIntervals.add(interval);
}

function scheduleShootingStar() {
    const delay = Math.random() * 5000 + 3000;
    shootingStarTimeout = window.setTimeout(() => {
        createShootingStar();
        scheduleShootingStar();
    }, delay);
}

function makeTextPlane(label) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = "500 32px -apple-system, 'Inter', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), material);
    plane.userData.baseOpacity = 0.7;
    plane.userData.loginTexture = texture;
    return plane;
}

function createButtonElement() {
    const buttonGeo = new THREE.BoxGeometry(2.4, 0.6, 0.08);
    const buttonMesh = new THREE.Mesh(buttonGeo, glassMaterial.clone());
    buttonMesh.userData.baseOpacity = 0.15;

    const edges = new THREE.EdgesGeometry(buttonGeo);
    const edgeMesh = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })
    );
    edgeMesh.userData.baseOpacity = 0.3;

    const textPlane = makeTextPlane('Play');
    if (textPlane) textPlane.position.z = 0.05;

    const group = new THREE.Group();
    group.add(buttonMesh);
    group.add(edgeMesh);
    if (textPlane) group.add(textPlane);
    group.userData.type = 'button';
    return group;
}

function createPanelElement() {
    const panelGeo = new THREE.BoxGeometry(3.0, 1.8, 0.06);
    const panelMesh = new THREE.Mesh(panelGeo, glassMaterial.clone());
    panelMesh.material.opacity = 0.1;
    panelMesh.material.transmission = 0.95;
    panelMesh.userData.baseOpacity = 0.1;

    const edgeGeo = new THREE.EdgesGeometry(panelGeo);
    const edgeMesh = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: 0xaaaaff, transparent: true, opacity: 0.2 })
    );
    edgeMesh.userData.baseOpacity = 0.2;

    const group = new THREE.Group();
    group.add(panelMesh);
    group.add(edgeMesh);
    group.userData.type = 'panel';
    return group;
}

function createFrameElement() {
    const frameGeo = new THREE.BoxGeometry(3.5, 2.2, 0.04);
    const frameEdges = new THREE.EdgesGeometry(frameGeo);
    const frameMesh = new THREE.LineSegments(
        frameEdges,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 })
    );
    frameMesh.userData.baseOpacity = 0.15;
    const group = new THREE.Group();
    group.add(frameMesh);
    group.userData.type = 'frame';
    return group;
}

function createTextBlockElement() {
    const textGeo = new THREE.BoxGeometry(2.0, 0.3, 0.04);
    const textMesh = new THREE.Mesh(textGeo, glassMaterial.clone());
    textMesh.material.opacity = 0.12;
    textMesh.userData.baseOpacity = 0.12;

    for (let i = 0; i < 3; i++) {
        const lineGeo = new THREE.BoxGeometry(1.6 - i * 0.3, 0.06, 0.02);
        const lineMat = edgeMaterial.clone();
        lineMat.opacity = 0.15;
        const lineMesh = new THREE.Mesh(lineGeo, lineMat);
        lineMesh.position.y = -0.25 - i * 0.18;
        lineMesh.userData.baseOpacity = 0.15;
        textMesh.add(lineMesh);
    }

    const group = new THREE.Group();
    group.add(textMesh);
    group.userData.type = 'textblock';
    return group;
}

function createSphereElement() {
    const sphereGeo = new THREE.SphereGeometry(0.4, 32, 32);
    const sphereMesh = new THREE.Mesh(sphereGeo, glassMaterial.clone());
    sphereMesh.material.opacity = 0.08;
    sphereMesh.material.transmission = 0.98;
    sphereMesh.userData.baseOpacity = 0.08;
    const group = new THREE.Group();
    group.add(sphereMesh);
    group.userData.type = 'sphere';
    return group;
}

function setElementOpacity(group, opacity) {
    group.traverse((child) => {
        if (!child.material) return;
        const apply = (m) => {
            if (m.opacity !== undefined) {
                m.opacity = opacity * (child.userData.baseOpacity || 1);
            }
        };
        if (Array.isArray(child.material)) child.material.forEach(apply);
        else apply(child.material);
    });
}

function initFloatingElements() {
    if (!scene) return;
    elementPool.length = 0;
    const created = [createButtonElement(), createPanelElement(), createFrameElement(), createTextBlockElement(), createSphereElement()];
    created.forEach((el) => {
        el.visible = false;
        el.userData.active = false;
        scene.add(el);
        elementPool.push(el);
    });
}

function spawnElement(index) {
    const el = elementPool[index % elementPool.length];
    if (!el) return;
    const spawnSide = Math.random() > 0.5 ? 1 : -1;
    el.position.set(spawnSide * (8 + Math.random() * 4), (Math.random() - 0.5) * 5, -2 - Math.random() * 6);
    el.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    el.userData.velocity = {
        x: -spawnSide * (0.003 + Math.random() * 0.004),
        y: (Math.random() - 0.5) * 0.002,
        z: (Math.random() - 0.5) * 0.001
    };
    el.userData.tumble = {
        x: (Math.random() - 0.5) * 0.004,
        y: (Math.random() - 0.5) * 0.006,
        z: (Math.random() - 0.5) * 0.003
    };
    el.userData.targetOpacity = 0.5 + Math.random() * 0.3;
    el.userData.lifetime = 0;
    el.userData.maxLifetime = 8000 + Math.random() * 5000;
    el.userData.active = true;
    el.visible = true;
    setElementOpacity(el, 0);
}

function updateFloatingElements(deltaMs) {
    elementPool.forEach((el) => {
        if (!el.userData.active) return;
        el.userData.lifetime += deltaMs;
        const life = el.userData.lifetime;
        const maxLife = el.userData.maxLifetime;
        const fadeTime = 1200;
        const v = el.userData.velocity;
        const t = el.userData.tumble;
        el.position.x += v.x;
        el.position.y += v.y;
        el.position.z += v.z;
        el.rotation.x += t.x;
        el.rotation.y += t.y;
        el.rotation.z += t.z;

        const targetOp = el.userData.targetOpacity;
        if (life < fadeTime) setElementOpacity(el, (life / fadeTime) * targetOp);
        else if (life < maxLife - fadeTime) setElementOpacity(el, targetOp);
        else if (life < maxLife) {
            const fade = (life - (maxLife - fadeTime)) / fadeTime;
            setElementOpacity(el, (1 - fade) * targetOp);
        } else {
            el.userData.active = false;
            el.visible = false;
            if (!waitingForNext) {
                waitingForNext = true;
                nextSpawnTimeout = setTimeout(() => {
                    activeElementIndex += 1;
                    spawnElement(activeElementIndex);
                    waitingForNext = false;
                }, 4000 + Math.random() * 3000);
            }
        }
    });
}

function setupCardInteraction() {
    const card = document.getElementById('login-card');
    if (!card) return;

    cardMouseMoveHandler = (e) => {
        const rect = card.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = (e.clientX - centerX) / (rect.width / 2);
        const dy = (e.clientY - centerY) / (rect.height / 2);

        const tiltX = dy * 3;
        const tiltY = -dx * 3;
        const highlightX = 50 + dx * 30;
        const highlightY = 50 + dy * 30;

        card.style.transition = 'transform 120ms ease, background 120ms ease';
        card.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
        card.style.background = `radial-gradient(circle at ${highlightX}% ${highlightY}%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0.02) 100%)`;
    };

    cardMouseLeaveHandler = () => {
        card.style.transition = 'all 0.5s ease';
        card.style.transform = 'translate(-50%, -50%)';
        card.style.background = 'rgba(255, 255, 255, 0.06)';
    };

    document.addEventListener('mousemove', cardMouseMoveHandler);
    card.addEventListener('mouseleave', cardMouseLeaveHandler);
}

function createScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000005, 1);
    activeElementIndex = 0;
    waitingForNext = false;
    lastFrameTime = 0;

    pmremGenerator = new THREE.PMREMGenerator(renderer);
    envTexture = pmremGenerator.fromScene(new RoomEnvironment()).texture;
    scene.environment = envTexture;

    glassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.0,
        roughness: 0.05,
        transmission: 0.92,
        thickness: 0.5,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        envMapIntensity: 1.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        ior: 1.45
    });
    edgeMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide
    });

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);
    const accentLight = new THREE.PointLight(0x6b6bff, 2.0, 20);
    accentLight.position.set(-3, 2, 3);
    scene.add(accentLight);
    const rimLight = new THREE.PointLight(0x4488ff, 1.0, 15);
    rimLight.position.set(4, -2, -4);
    scene.add(rimLight);

    const starGeometry = new THREE.BufferGeometry();
    const starCount = 3000;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 100;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.08,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true
    });
    stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    createNebula(-3, 1, -5, '#6b6bff', 12);
    createNebula(4, -2, -8, '#ff6baa', 8);
    createNebula(0, 3, -6, '#6baaff', 10);

    mouseMoveHandler = (e) => {
        targetX = (e.clientX / window.innerWidth - 0.5) * 0.8;
        targetY = -(e.clientY / window.innerHeight - 0.5) * 0.4;
    };
    document.addEventListener('mousemove', mouseMoveHandler);

    wheelHandler = (e) => {
        camera.position.z += e.deltaY * 0.005;
        camera.position.z = Math.max(3, Math.min(7, camera.position.z));
    };
    window.addEventListener('wheel', wheelHandler, { passive: true });

    resizeHandler = () => {
        if (!camera || !renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', resizeHandler);

    renderer.setAnimationLoop(() => {
        const now = performance.now();
        const deltaMs = lastFrameTime ? Math.min(40, now - lastFrameTime) : 16;
        lastFrameTime = now;
        currentX += (targetX - currentX) * 0.03;
        currentY += (targetY - currentY) * 0.03;
        camera.position.x = currentX;
        camera.position.y = currentY;
        camera.lookAt(0, 0, 0);

        if (stars) {
            stars.rotation.y += 0.00008;
            stars.rotation.x += 0.00003;
        }
        updateFloatingElements(deltaMs);
        renderer.render(scene, camera);
    });

    scheduleShootingStar();
    initFloatingElements();
    startFloatingTimeout = setTimeout(() => spawnElement(0), 2500);
}

export function initLoginScene() {
    if (mounted) return;
    mounted = true;
    container = createLoginCanvasHost();
    document.body.appendChild(container);
    createScene();
    if (renderer) container.appendChild(renderer.domElement);
    setupCardInteraction();
}

export function disposeLoginScene() {
    if (!mounted) return;
    mounted = false;

    if (shootingStarTimeout) {
        window.clearTimeout(shootingStarTimeout);
        shootingStarTimeout = null;
    }
    shootingStarIntervals.forEach((id) => window.clearInterval(id));
    shootingStarIntervals.clear();
    if (startFloatingTimeout) {
        window.clearTimeout(startFloatingTimeout);
        startFloatingTimeout = null;
    }
    if (nextSpawnTimeout) {
        window.clearTimeout(nextSpawnTimeout);
        nextSpawnTimeout = null;
    }

    shootingStars.forEach(({ star, geometry, material }) => {
        scene?.remove(star);
        geometry.dispose();
        material.dispose();
    });
    shootingStars.clear();

    nebulaResources.forEach(({ sprite, material, texture }) => {
        scene?.remove(sprite);
        material.dispose();
        texture.dispose();
    });
    nebulaResources.length = 0;
    elementPool.forEach((el) => {
        scene?.remove(el);
        el.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.userData?.loginTexture) child.userData.loginTexture.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
                else child.material.dispose();
            }
        });
    });
    elementPool.length = 0;
    if (glassMaterial) glassMaterial.dispose();
    if (edgeMaterial) edgeMaterial.dispose();
    glassMaterial = null;
    edgeMaterial = null;
    if (envTexture) envTexture.dispose();
    envTexture = null;
    if (pmremGenerator) pmremGenerator.dispose();
    pmremGenerator = null;

    if (renderer) {
        renderer.setAnimationLoop(null);
    }
    if (scene) {
        scene.clear();
    }

    if (stars) {
        stars.geometry?.dispose();
        stars.material?.dispose();
    }

    if (mouseMoveHandler) {
        document.removeEventListener('mousemove', mouseMoveHandler);
        mouseMoveHandler = null;
    }
    if (wheelHandler) {
        window.removeEventListener('wheel', wheelHandler);
        wheelHandler = null;
    }
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
    }
    if (cardMouseMoveHandler) {
        document.removeEventListener('mousemove', cardMouseMoveHandler);
        cardMouseMoveHandler = null;
    }
    const card = document.getElementById('login-card');
    if (card && cardMouseLeaveHandler) {
        card.removeEventListener('mouseleave', cardMouseLeaveHandler);
        cardMouseLeaveHandler = null;
    }

    if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentElement) {
            renderer.domElement.parentElement.removeChild(renderer.domElement);
        }
    }

    if (container && container.parentElement) {
        container.parentElement.removeChild(container);
    }

    scene = null;
    camera = null;
    renderer = null;
    stars = null;
    container = null;
}
