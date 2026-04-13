// ===== THREE.JS IMPORTS =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// ===== APPLICATION STATE =====
const state = {
    activeTool: 'select',
    activeTab: 'layers',
    selectedObject: null,
    /** @type {{ id: string, name: string, group: THREE.Group }[]} */
    screens: [],
    activeScreenId: null,
    nextScreenIndex: 1,
    viewport: {
        position: { x: 0, y: 1.6, z: -2.5 },
        rotation: { x: 0, y: 45, z: 0 },
        zoom: 100
    },
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    transformControls: null,
    raycaster: null,
    mouse: null,
    objects: [],
    selectableObjects: [],
    lights: null,
    viewMode: '3d',
    lastFrameSize: { width: 1.2, height: 0.8 },
    grid2d: null,
    controls3DDefaults: null,
    /** 'design' = edit / select; 'prototype' = Play Mode — buttons navigate via onClickScreenId */
    editorMode: 'design',
    /** Active screen when user entered Prototype Mode; restored when returning to Design Mode */
    activeScreenIdBeforePrototype: null,
    perspectiveCamera: null,
    orthographicCamera: null,
    /** Last pointer position for Figma-style “drop into frame under cursor” */
    lastViewportPointer: null,
    lastPointerOverCanvas: false,
    /** Saved when opening spatial preview (scene.background is set null for transparency) */
    savedSceneBackground: null,
    spatialPreviewActive: false,
    spatialPreviewStream: null,
    /** True while “Preview in Space” is open — editor environment (floor, grids) is hidden */
    spatialPreviewMode: false,
    /** Saved .visible flags for environment objects; restored when preview closes */
    spatialPreviewEnvironmentBackup: null,
    /**
     * Figma-style canvas drag (2D ortho + Spatial Preview): move / corner-resize without TransformControls gizmo.
     * @type {null | object}
     */
    planarPointerDrag: null,
    /** Simulated XR attach points (parented to active camera). See initializeXRAnchorRig(). */
    anchorRigRoot: null,
    headAnchor: null,
    rightHandAnchor: null,
    leftHandAnchor: null,
    /** Figma-style prototype wires (Design Mode only) */
    prototypeLinksGroup: null,
    /** @type {{ id: number, type: string, root: THREE.Object3D, t0: number, duration: number, data?: object } | null} */
    activeClickAnimation: null,
    /**
     * Dummy onboarding (paper prototype): login → dashboard → full editor.
     * Scene / WebGL init deferred until first entry to `editor` so canvas stays hidden on prior steps.
     */
    appPhase: 'login',
    editorExperienceInitialized: false
};

// ===== SCREENS (each screen = THREE.Group in scene) =====
function getActiveScreen() {
    return state.screens.find((s) => s.id === state.activeScreenId) || null;
}

function getActiveScreenGroup() {
    const s = getActiveScreen();
    return s ? s.group : null;
}

/** Frames parented to XR anchors live outside screen groups; hide unless that screen is active. */
function updateAnchoredFramesVisibility() {
    state.objects.forEach((o) => {
        if (o.userData.voidType !== 'frame') return;
        const a = o.userData.anchor || 'world';
        if (a !== 'world') {
            o.visible = o.userData.screenId === state.activeScreenId;
        } else if (o.parent && o.parent.userData?.isScreenRoot) {
            o.visible = true;
        }
    });
}

function getXRAnchorGroup(type) {
    if (type === 'head') return state.headAnchor;
    if (type === 'rightHand') return state.rightHandAnchor;
    if (type === 'leftHand') return state.leftHandAnchor;
    return null;
}

function findScreenRootGroup(object) {
    let p = object?.parent;
    while (p) {
        if (p.userData?.isScreenRoot) return p;
        p = p.parent;
    }
    return null;
}

/**
 * Reparent frame to simulated head/hand anchors (child of active camera) or back to its screen.
 * Uses THREE.Object3D.attach() to preserve world transform when switching.
 */
function applyFrameXRAnchorType(frame, newType) {
    if (!frame || frame.userData.voidType !== 'frame') return;
    const t = newType || 'world';
    frame.userData.anchor = t;

    if (t === 'world') {
        const slot = frame.userData._xrAnchorSlot;
        if (slot) {
            slot.remove(frame);
            frame.userData._xrAnchorSlot = null;
        }
        const sp =
            frame.userData._xrSavedScreenParent ||
            state.screens.find((sc) => sc.id === frame.userData.screenId)?.group ||
            getActiveScreenGroup();
        if (sp && frame.parent !== sp) {
            sp.attach(frame);
        }
        frame.userData._xrSavedScreenParent = null;
        updateAnchoredFramesVisibility();
        refreshLayersPanel();
        showNotification('Frame anchor: World');
        return;
    }

    const anchor = getXRAnchorGroup(t);
    if (!anchor) return;

    if (!frame.userData._xrSavedScreenParent) {
        frame.userData._xrSavedScreenParent =
            findScreenRootGroup(frame) || state.screens.find((sc) => sc.id === frame.userData.screenId)?.group;
    }

    if (frame.parent) frame.parent.remove(frame);
    anchor.attach(frame);
    frame.userData._xrAnchorSlot = anchor;
    updateAnchoredFramesVisibility();
    refreshLayersPanel();
    const labels = { head: 'Head', rightHand: 'Right Hand', leftHand: 'Left Hand' };
    showNotification(`Frame anchor: ${labels[t] || t}`);
}

function ensureDefaultScreen() {
    if (state.screens.length > 0 && state.activeScreenId) return;
    const id = `screen-${state.nextScreenIndex++}`;
    const group = new THREE.Group();
    group.name = 'Screen: Main Menu';
    group.userData.isScreenRoot = true;
    group.userData.screenId = id;
    state.scene.add(group);
    state.screens.push({ id, name: 'Main Menu', group });
    state.activeScreenId = id;
}

function createScreen(name = `Screen ${state.screens.length + 1}`) {
    if (!state.scene) {
        showNotification('Open the editor from Dashboard first (Create New Project).');
        return null;
    }
    const id = `screen-${state.nextScreenIndex++}`;
    const group = new THREE.Group();
    group.name = `Screen: ${name}`;
    group.userData.isScreenRoot = true;
    group.userData.screenId = id;
    state.scene.add(group);
    state.screens.push({ id, name, group });
    switchToScreen(id);
    refreshScreensPanel();
    refreshLayersPanel();
    showNotification(`Screen created: ${name}`);
    return id;
}

/**
 * @param {string} screenId
 * @param {{ silent?: boolean }} [opts] — silent: skip toast (prototype nav / restore from play mode)
 */
function switchToScreen(screenId, opts = {}) {
    const silent = !!opts.silent;
    const target = state.screens.find((s) => s.id === screenId);
    if (!target) return;
    state.activeScreenId = screenId;
    state.screens.forEach((s) => {
        s.group.visible = s.id === screenId;
    });
    // Frames reparented to XR anchors are not under screen groups — toggle by screenId.
    updateAnchoredFramesVisibility();
    deselectObject();
    refreshScreensPanel();
    refreshLayersPanel();
    if (!silent) showNotification(`Active screen: ${target.name}`);
}

function renameScreen(screenId, newName) {
    const s = state.screens.find((x) => x.id === screenId);
    if (!s) return;
    s.name = newName.trim() || s.name;
    s.group.name = `Screen: ${s.name}`;
    refreshScreensPanel();
    refreshLayersPanel();
    populateButtonLinkDropdown();
}

function refreshScreensPanel() {
    const list = document.getElementById('screens-list');
    if (!list) return;
    list.innerHTML = '';
    state.screens.forEach((s) => {
        const row = document.createElement('div');
        row.className = 'page-item' + (s.id === state.activeScreenId ? ' active' : '');
        row.dataset.screenId = s.id;
        row.innerHTML = `<span class="page-icon">🎬</span><span class="page-name">${escapeHtml(s.name)}</span>`;
        row.addEventListener('click', () => switchToScreen(s.id));
        row.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const next = window.prompt('Rename screen', s.name);
            if (next !== null) renameScreen(s.id, next);
        });
        list.appendChild(row);
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function refreshLayersPanel() {
    const tree = document.getElementById('layers-tree');
    if (!tree) return;
    tree.innerHTML = '';
    const onScreen = state.objects.filter((o) => o.userData.screenId === state.activeScreenId && !o.userData.isEnvironment);
    const empty = document.createElement('div');
    empty.className = 'layer-empty';
    empty.id = 'layers-empty';
    empty.style.display = onScreen.length ? 'none' : 'block';
    empty.textContent = 'No objects on this screen yet.';
    tree.appendChild(empty);

    onScreen.forEach((obj) => {
        const row = document.createElement('div');
        row.className = 'layer-item';
        const icon = layerIconFor(obj);
        row.innerHTML = `<span class="layer-icon">${icon}</span><span class="layer-name">${escapeHtml(obj.name)}</span>`;
        row.dataset.objectUuid = obj.uuid;
        tree.appendChild(row);
    });
}

function layerIconFor(obj) {
    const t = obj.userData.voidType;
    if (t === 'button') return '🔘';
    if (t === 'panel') return '▢';
    if (t === 'text') return '📝';
    if (t === 'image') return '🖼';
    if (t === 'frame') return '▭';
    if (obj.userData.isLight) return '💡';
    return '📦';
}

function populateButtonLinkDropdown() {
    const sel = document.getElementById('button-onclick-screen');
    if (!sel) return;
    const current = state.selectedObject?.userData?.onClickScreenId || '';
    const activeId = state.activeScreenId;
    sel.innerHTML = '<option value="">(None)</option>';
    // Prototype links target *other* screens (Figma-style flow between artboards)
    state.screens.forEach((s) => {
        if (s.id === activeId) return;
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        sel.appendChild(opt);
    });
    const valid = current === '' || Array.from(sel.options).some((o) => o.value === current);
    sel.value = valid ? current : '';
    if (!valid && current && state.selectedObject?.userData?.voidType === 'button') {
        state.selectedObject.userData.onClickScreenId = '';
    }
}

function updateInteractionPanel(object) {
    const section = document.getElementById('interaction-section');
    const content = section?.querySelector('.property-section-content');
    const collapseBtn = section?.querySelector('.collapse-btn');
    const sel = document.getElementById('button-onclick-screen');
    if (!section) return;

    const isButton = object?.userData?.voidType === 'button';
    // Use block + ensure inner content is visible (collapse UI can leave display:none)
    section.style.display = isButton ? 'block' : 'none';
    if (isButton && content) {
        content.style.display = 'block';
        if (collapseBtn) collapseBtn.textContent = '−';
    }

    if (!isButton || !sel) return;
    populateButtonLinkDropdown();
    sel.value = object.userData.onClickScreenId || '';
    const animSel = document.getElementById('button-click-animation');
    if (animSel) animSel.value = object.userData.clickAnimation || 'none';
}

/** Orthographic frustum sized to viewport; zoom slider scales visible world height (Figma-like). */
function createOrthographicCameraForViewport(width, height) {
    const aspect = Math.max(width, 1) / Math.max(height, 1);
    const zoom = (state.viewport?.zoom || 100) / 100;
    const halfH = 2.4 / zoom;
    const halfW = halfH * aspect;
    return new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
}

function updateOrthoCameraFrustum() {
    if (!state.orthographicCamera || !state.renderer) return;
    const el = state.renderer.domElement;
    const width = Math.max(el.clientWidth, 1);
    const height = Math.max(el.clientHeight, 1);
    const aspect = width / height;
    const zoom = (state.viewport?.zoom || 100) / 100;
    const halfH = 2.4 / zoom;
    const halfW = halfH * aspect;
    const o = state.orthographicCamera;
    o.left = -halfW;
    o.right = halfW;
    o.top = halfH;
    o.bottom = -halfH;
    o.updateProjectionMatrix();
}

/** Swap active camera for 2D ortho vs 3D perspective; keeps Orbit + Transform controls in sync. */
function switchActiveCamera(nextCamera) {
    state.camera = nextCamera;
    if (state.controls) state.controls.object = nextCamera;
    if (state.transformControls) state.transformControls.camera = nextCamera;
    // Keep simulated XR anchors in front of the active camera (ortho or perspective).
    if (state.anchorRigRoot && state.camera) {
        state.camera.attach(state.anchorRigRoot);
    }
    updateTransformControlsForViewMode();
    if (state.controls) state.controls.update();
}

// ===== 3D VIEWPORT SETUP =====
function initialize3DViewport() {
    const viewportElement = document.getElementById('viewport-3d');
    if (!viewportElement) return;

    // Remove placeholder
    const placeholder = viewportElement.querySelector('.viewport-placeholder');
    if (placeholder) {
        placeholder.remove();
    }

    // Create Scene
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x0f0f0f);

    // Cameras: perspective (3D) + orthographic (flat 2D / Figma-like)
    const width = viewportElement.clientWidth;
    const height = viewportElement.clientHeight;
    state.perspectiveCamera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    state.perspectiveCamera.position.set(3, 3, 3);
    state.perspectiveCamera.lookAt(0, 0, 0);
    state.camera = state.perspectiveCamera;

    state.orthographicCamera = createOrthographicCameraForViewport(width, height);
    state.orthographicCamera.position.set(0, 0, 5);
    state.orthographicCamera.lookAt(0, 0, 0);

    // Create Renderer (alpha used when spatial preview composites over camera feed)
    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    state.renderer.setSize(width, height);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setClearColor(0x000000, 1);
    viewportElement.appendChild(state.renderer.domElement);

    // Track pointer for “frame under cursor” parenting when placing components
    state.renderer.domElement.addEventListener('pointermove', (e) => {
        state.lastViewportPointer = { x: e.clientX, y: e.clientY };
        state.lastPointerOverCanvas = true;
    });
    state.renderer.domElement.addEventListener('pointerleave', () => {
        state.lastPointerOverCanvas = false;
    });

    // Add Orbit Controls
    state.controls = new OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.05;
    state.controls.screenSpacePanning = false;
    state.controls.minDistance = 1;
    state.controls.maxDistance = 50;
    state.controls.maxPolarAngle = Math.PI / 1.5;

    // Simulated XR anchor points (ShapesXR-style): parent rig follows whichever camera is active.
    state.anchorRigRoot = new THREE.Group();
    state.anchorRigRoot.name = 'XRAnchorRig';
    state.perspectiveCamera.add(state.anchorRigRoot);
    state.headAnchor = new THREE.Group();
    state.headAnchor.name = 'AnchorHead';
    state.headAnchor.position.set(0, 0.05, -1.85);
    state.rightHandAnchor = new THREE.Group();
    state.rightHandAnchor.name = 'AnchorRightHand';
    state.rightHandAnchor.position.set(0.42, -0.38, -0.72);
    state.leftHandAnchor = new THREE.Group();
    state.leftHandAnchor.name = 'AnchorLeftHand';
    state.leftHandAnchor.position.set(-0.42, -0.38, -0.72);
    state.anchorRigRoot.add(state.headAnchor, state.rightHandAnchor, state.leftHandAnchor);

    // Figma-style prototype connection lines (updated each frame in Design Mode only).
    state.prototypeLinksGroup = new THREE.Group();
    state.prototypeLinksGroup.name = 'voidPrototypeLinks';
    state.prototypeLinksGroup.userData.isPrototypeOverlay = true;
    state.scene.add(state.prototypeLinksGroup);

    // Add Transform Controls
    state.transformControls = new TransformControls(state.camera, state.renderer.domElement);
    state.transformControls.addEventListener('dragging-changed', (event) => {
        state.controls.enabled = !event.value;
    });
    state.transformControls.addEventListener('change', () => {
        if (state.selectedObject) {
            if (isChildOfFrame(state.selectedObject)) clampObjectToParentFrame(state.selectedObject);
            updatePropertiesFromObject(state.selectedObject);
        }
    });
    state.scene.add(state.transformControls);

    // Setup Raycaster
    state.raycaster = new THREE.Raycaster();
    state.mouse = new THREE.Vector2();
    state.renderer.domElement.addEventListener('click', onViewportClick);
    state.renderer.domElement.addEventListener('dblclick', onViewportDoubleClick);
    initializePlanarManipulation(state.renderer.domElement);

    // Add Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    state.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    state.scene.add(directionalLight);

    // Add Grid Helper
    createGrid();

    // Add Safe Zone
    createSafeZone();

    ensureDefaultScreen();

    // Add Sample 3D Objects (into active screen group)
    addSampleObjects();

    // Add Axes Helper
    const axesHelper = new THREE.AxesHelper(2);
    axesHelper.userData.isEnvironment = true; // hidden during spatial preview
    state.scene.add(axesHelper);

    // Handle Window Resize
    window.addEventListener('resize', onWindowResize);

    // Start Animation Loop
    animate();

    console.log('✅ 3D Viewport initialized with Three.js + TransformControls');
}

// ===== CREATE GRID =====
function createGrid() {
    const gridSize = 10;
    const gridDivisions = 20;
    const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x6366f1, 0x333333);
    gridHelper.name = 'mainGrid';
    gridHelper.userData.isEnvironment = true; // hidden during spatial preview (AR overlay)
    state.scene.add(gridHelper);

    const fg = new THREE.Group();
    fg.name = 'flatGrid2d';
    const step = 0.1;
    const ext = 4;
    const pts = [];
    for (let x = -ext; x <= ext + 1e-6; x += step) {
        pts.push(new THREE.Vector3(x, -ext, 0.02), new THREE.Vector3(x, ext, 0.02));
    }
    for (let y = -ext; y <= ext + 1e-6; y += step) {
        pts.push(new THREE.Vector3(-ext, y, 0.02), new THREE.Vector3(ext, y, 0.02));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const lines = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.45 })
    );
    fg.add(lines);
    fg.visible = false;
    fg.userData.isEnvironment = true; // 2D grid — hidden during spatial preview
    state.scene.add(fg);
    state.grid2d = fg;
}

// ===== CREATE SAFE ZONE =====
function createSafeZone() {
    const width = 1.5, height = 1.5, depth = 1.5;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.1
    });
    const safeZone = new THREE.Mesh(geometry, material);
    safeZone.position.set(0, height / 2, 0);
    safeZone.name = 'safeZone';

    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.5 });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    safeZone.add(wireframe);

    safeZone.userData.isEnvironment = true; // hidden during spatial preview
    state.scene.add(safeZone);
}

// ===== ADD SAMPLE OBJECTS =====
function addSampleObjects() {
    const group = getActiveScreenGroup();
    const objects = [
        { type: 'box', color: 0x6366f1, pos: [-1, 0.5, 0], name: 'Cube' },
        { type: 'sphere', color: 0xec4899, pos: [0, 0.5, 0], name: 'Sphere' },
        { type: 'cylinder', color: 0x8b5cf6, pos: [1, 0.5, 0], name: 'Cylinder' }
    ];

    objects.forEach(({ type, color, pos, name }) => {
        let geometry;
        if (type === 'box') geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        else if (type === 'sphere') geometry = new THREE.SphereGeometry(0.3, 32, 32);
        else geometry = new THREE.CylinderGeometry(0.2, 0.2, 0.6, 32);

        const material = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.6 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...pos);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = name;
        mesh.userData.selectable = true;
        mesh.userData.screenId = state.activeScreenId;
        mesh.userData.voidType = 'primitive';
        if (group) group.add(mesh);
        else state.scene.add(mesh);
        state.objects.push(mesh);
        state.selectableObjects.push(mesh);
    });

    // Ground plane (always visible, not part of a screen)
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    plane.name = 'Ground';
    plane.userData.isEnvironment = true;
    state.scene.add(plane);
}

// ===== PROTOTYPE MICRO-ANIMATIONS (ShapesXR-style, no external tween lib) =====
const CLICK_ANIM_MS = 420;

function playButtonClickAnimation(buttonRoot, targetScreenGroup, type) {
    if (!type || type === 'none' || !targetScreenGroup) return;
    state.activeClickAnimation = {
        id: Date.now(),
        type,
        root: targetScreenGroup,
        t0: performance.now(),
        duration: CLICK_ANIM_MS,
        data: captureAnimationStartState(targetScreenGroup, buttonRoot, type)
    };
}

function captureAnimationStartState(screenGroup, buttonRoot, type) {
    const box = new THREE.Box3();
    const data = { buttonRoot, pos: screenGroup.position.clone(), scale: screenGroup.scale.clone() };
    if (type === 'fadeIn') {
        data.opacities = [];
        screenGroup.traverse((ch) => {
            if (ch.isMesh && ch.material) {
                const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                mats.forEach((m) => {
                    m.transparent = true;
                    data.opacities.push({ mat: m, start: m.opacity });
                    m.opacity = 0;
                });
            }
        });
    }
    if (type === 'scaleUp') {
        screenGroup.scale.set(0.08, 0.08, 0.08);
    }
    if (type === 'bounce') {
        data.baseScale = data.scale.clone();
        screenGroup.scale.set(0.2, 0.2, 0.2);
    }
    if (type === 'slideIn') {
        box.setFromObject(screenGroup);
        const size = box.getSize(new THREE.Vector3());
        data.slideOffset = new THREE.Vector3(-size.x * 0.35, 0, 0);
        screenGroup.position.add(data.slideOffset);
    }
    return data;
}

function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function updateClickAnimation() {
    const job = state.activeClickAnimation;
    if (!job || !job.root) return;
    const t = Math.min(1, (performance.now() - job.t0) / job.duration);
    const k = easeOutBack(t);
    const d = job.data;
    const g = job.root;

    if (job.type === 'fadeIn' && d.opacities) {
        d.opacities.forEach(({ mat, start }) => {
            mat.opacity = THREE.MathUtils.lerp(0, Math.min(1, start || 1), t);
        });
    } else if (job.type === 'scaleUp') {
        const a = Math.min(1, t);
        g.scale.x = THREE.MathUtils.lerp(0.08, d.scale.x, a);
        g.scale.y = THREE.MathUtils.lerp(0.08, d.scale.y, a);
        g.scale.z = THREE.MathUtils.lerp(0.08, d.scale.z, a);
    } else if (job.type === 'bounce') {
        const peak = t < 0.65 ? t / 0.65 : 1 + (1 - t) / 0.35 * 0.12;
        const s = THREE.MathUtils.lerp(0.2, 1, Math.min(1, peak));
        g.scale.set(d.baseScale.x * s, d.baseScale.y * s, d.baseScale.z * s);
    } else if (job.type === 'slideIn' && d.slideOffset) {
        const blend = THREE.MathUtils.clamp(1 - k, 0, 1);
        g.position.copy(d.pos).addScaledVector(d.slideOffset, blend);
    }

    if (t >= 1) {
        if (job.type === 'fadeIn' && d.opacities) {
            d.opacities.forEach(({ mat, start }) => {
                mat.opacity = Math.min(1, start || 1);
            });
        }
        g.position.copy(d.pos);
        g.scale.copy(d.scale);
        state.activeClickAnimation = null;
    }
}

// ===== FIGMA-STYLE PLANAR MANIPULATION (2D ortho + Spatial Preview) =====
/**
 * True when the canvas uses pointer routing (move / resize / tap) instead of click + gizmo.
 * Applies to 2D ortho and Spatial Preview (same scene; edits sync live). Prototype uses this
 * pipeline in those views so button taps vs drags are distinguished.
 */
function usePlanarPointerPipeline() {
    return state.viewMode === '2d' || state.spatialPreviewActive;
}

const _planarPlane = new THREE.Plane();
const _planarHit = new THREE.Vector3();
const _planarPrevHit = new THREE.Vector3();
const _planarRay = new THREE.Ray();
const _planarCamDir = new THREE.Vector3();
const _planarLocal = new THREE.Vector3();
const _planarWorldA = new THREE.Vector3();
const _planarWorldB = new THREE.Vector3();
const _planarDeltaW = new THREE.Vector3();

const PLANAR_DRAG_THRESHOLD_PX = 6;
const PLANAR_UI_TYPES = new Set(['frame', 'button', 'text', 'image', 'panel', 'primitive']);

function planarCornerHitThreshold(root) {
    if (root.userData.voidType === 'frame') return 0.14;
    const ph = root.userData.planarBaseHalf;
    if (ph) return Math.max(0.06, Math.min(ph.x, ph.y) * 0.4);
    return 0.1;
}

/** World-space point where the camera ray hits the drag plane through the object (face-on to camera). */
function planarIntersectRayAtObjectDepth(ray, objectRoot, target) {
    state.camera.getWorldDirection(_planarCamDir);
    const n = _planarCamDir.clone().negate();
    objectRoot.getWorldPosition(target);
    _planarPlane.setFromNormalAndCoplanarPoint(n, target);
    return ray.intersectPlane(_planarPlane, target);
}

/** Classify nearest frame corner in group local XY (centered plane). */
function planarClassifyFrameCorner(localX, localY, hw, hh, threshold) {
    const corners = [
        { tag: 'ne', x: hw, y: hh },
        { tag: 'nw', x: -hw, y: hh },
        { tag: 'se', x: hw, y: -hh },
        { tag: 'sw', x: -hw, y: -hh }
    ];
    let best = null;
    let bd = Infinity;
    for (const c of corners) {
        const d = Math.hypot(localX - c.x, localY - c.y);
        if (d < bd && d < threshold) {
            bd = d;
            best = c.tag;
        }
    }
    return best;
}

function planarOppositeCornerLocal(cornerTag, hw, hh) {
    const m = {
        ne: new THREE.Vector3(-hw, -hh, 0),
        nw: new THREE.Vector3(hw, -hh, 0),
        se: new THREE.Vector3(-hw, hh, 0),
        sw: new THREE.Vector3(hw, hh, 0)
    };
    return m[cornerTag];
}

function planarResizeSignsForCorner(cornerTag) {
    const m = { ne: { x: 1, y: 1 }, nw: { x: -1, y: 1 }, se: { x: 1, y: -1 }, sw: { x: -1, y: -1 } };
    return m[cornerTag] || { x: 1, y: 1 };
}

/** After frame geometry change, shift group so the same semantic corner stays fixed in world space. */
function planarPreserveFrameCornerWorld(frame, anchorLocalOld, hwNew, hhNew) {
    _planarWorldA.copy(anchorLocalOld).applyMatrix4(frame.matrixWorld);
    const ax = Math.sign(anchorLocalOld.x);
    const ay = Math.sign(anchorLocalOld.y);
    const anchorLocalNew = new THREE.Vector3(ax * hwNew, ay * hhNew, 0);
    _planarWorldB.copy(anchorLocalNew).applyMatrix4(frame.matrixWorld);
    _planarDeltaW.subVectors(_planarWorldA, _planarWorldB);
    if (frame.parent) {
        const inv = new THREE.Matrix4().copy(frame.parent.matrixWorld).invert();
        _planarDeltaW.applyMatrix4(inv);
    }
    frame.position.add(_planarDeltaW);
}

function endPlanarPointerDrag() {
    state.planarPointerDrag = null;
    if (state.controls) state.controls.enabled = true;
}

/**
 * Prototype / Play Mode navigation from a button (single source of truth).
 * Called from 3D click raycast and from 2D/preview pointerup using the SAME button root captured on pointerdown
 * so we never re-raycast and miss the hit (fixes “click does nothing / falls through to wrong selection”).
 */
function runPrototypeButtonNavigation(buttonRoot) {
    if (!buttonRoot || buttonRoot.userData?.voidType !== 'button') return;
    const linkId = buttonRoot.userData.onClickScreenId;
    if (!linkId) {
        showNotification('Button has no linked screen — set “On Click → Go to Screen” in Properties');
        return;
    }
    const target = state.screens.find((s) => s.id === linkId);
    if (!target) {
        showNotification('Linked screen not found');
        return;
    }
    switchToScreen(linkId, { silent: true });
    showNotification(`Prototype → ${target.name}`);
    playButtonClickAnimation(buttonRoot, target.group, buttonRoot.userData.clickAnimation || 'none');
}

function applyPlanarPickFromClient(clientX, clientY) {
    if (state.activeTool !== 'select') return;
    const rect = state.renderer.domElement.getBoundingClientRect();
    state.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    state.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.mouse, state.camera);
    const intersects = state.raycaster.intersectObjects(state.selectableObjects, true);

    if (state.editorMode === 'prototype' && intersects.length > 0) {
        const root = resolveSelectableRoot(intersects[0].object);
        if (root?.userData?.voidType === 'button') {
            runPrototypeButtonNavigation(root);
            return;
        }
    }

    if (intersects.length > 0) {
        const root = resolveSelectableRoot(intersects[0].object);
        if (root) selectObject(root);
        else deselectObject();
    } else {
        deselectObject();
    }
}

function onPlanarPointerDown(e) {
    if (!usePlanarPointerPipeline() || state.activeTool !== 'select' || e.button !== 0) return;
    if (!state.raycaster || !state.camera) return;

    const rect = state.renderer.domElement.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(new THREE.Vector2(mx, my), state.camera);
    const intersects = state.raycaster.intersectObjects(state.selectableObjects, true);
    if (intersects.length === 0) {
        state.planarPointerDrag = {
            kind: 'background',
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            moved: false
        };
        try {
            state.renderer.domElement.setPointerCapture(e.pointerId);
        } catch (_) {}
        if (state.controls) state.controls.enabled = false;
        return;
    }

    const root = resolveSelectableRoot(intersects[0].object);
    if (!root || !PLANAR_UI_TYPES.has(root.userData.voidType)) return;

    // Prototype: defer button activation to pointerup (tap vs drag to move).
    if (state.editorMode === 'prototype' && root.userData.voidType === 'button') {
        state.planarPointerDrag = {
            kind: 'prototypeButton',
            pointerId: e.pointerId,
            root,
            startClientX: e.clientX,
            startClientY: e.clientY,
            moved: false
        };
        try {
            state.renderer.domElement.setPointerCapture(e.pointerId);
        } catch (_) {}
        if (state.controls) state.controls.enabled = false;
        return;
    }

    const hitPoint = intersects[0].point.clone();
    let mode = 'move';
    let cornerTag = null;

    if (root.userData.voidType === 'frame') {
        const hw = root.userData.frameWidth / 2;
        const hh = root.userData.frameHeight / 2;
        root.worldToLocal(hitPoint);
        cornerTag = planarClassifyFrameCorner(hitPoint.x, hitPoint.y, hw, hh, planarCornerHitThreshold(root));
        if (cornerTag) mode = 'resize';
    } else if (['button', 'text', 'image', 'panel'].includes(root.userData.voidType)) {
        const ph = root.userData.planarBaseHalf;
        if (ph) {
            root.worldToLocal(hitPoint);
            const th = planarCornerHitThreshold(root);
            cornerTag = planarClassifyFrameCorner(hitPoint.x, hitPoint.y, ph.x, ph.y, th);
            if (cornerTag) mode = 'resize';
        }
    }

    _planarRay.copy(state.raycaster.ray);
    if (!planarIntersectRayAtObjectDepth(_planarRay, root, _planarHit)) return;

    selectObject(root);

    const drag = {
        kind: 'manip',
        pointerId: e.pointerId,
        root,
        mode,
        cornerTag,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
        lastWorldHit: _planarHit.clone()
    };

    if (mode === 'resize' && cornerTag) {
        if (root.userData.voidType === 'frame') {
            const hw = root.userData.frameWidth / 2;
            const hh = root.userData.frameHeight / 2;
            drag.frameStartW = root.userData.frameWidth;
            drag.frameStartH = root.userData.frameHeight;
            drag.anchorLocal = planarOppositeCornerLocal(cornerTag, hw, hh).clone();
            drag.resizeSigns = planarResizeSignsForCorner(cornerTag);
        } else {
            drag.resizeSigns = planarResizeSignsForCorner(cornerTag);
            drag.startScale = root.scale.clone();
            root.worldToLocal(_planarLocal.copy(_planarHit));
            drag.startLocalHit = _planarLocal.clone();
            const ph = root.userData.planarBaseHalf;
            drag.baseHx = ph?.x || 0.5;
            drag.baseHy = ph?.y || 0.5;
        }
    }

    state.planarPointerDrag = drag;
    try {
        state.renderer.domElement.setPointerCapture(e.pointerId);
    } catch (_) {}
    if (state.controls) state.controls.enabled = false;
    e.preventDefault();
}

function onPlanarPointerMove(e) {
    const drag = state.planarPointerDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;

    const dx = e.clientX - (drag.startClientX ?? 0);
    const dy = e.clientY - (drag.startClientY ?? 0);
    if (Math.hypot(dx, dy) > PLANAR_DRAG_THRESHOLD_PX) drag.moved = true;

    if (drag.kind === 'background') return;

    if (drag.kind === 'prototypeButton') {
        if (!drag.moved || !drag.root) return;
        const root = drag.root;
        const rect = state.renderer.domElement.getBoundingClientRect();
        state.raycaster.setFromCamera(
            new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            ),
            state.camera
        );
        _planarRay.copy(state.raycaster.ray);
        if (!planarIntersectRayAtObjectDepth(_planarRay, root, _planarHit)) return;
        if (!drag.lastWorldHit) {
            drag.lastWorldHit = _planarHit.clone();
            return;
        }
        _planarDeltaW.subVectors(_planarHit, drag.lastWorldHit);
        if (root.parent) {
            const inv = new THREE.Matrix4().copy(root.parent.matrixWorld).invert();
            _planarDeltaW.applyMatrix4(inv);
        }
        root.position.add(_planarDeltaW);
        drag.lastWorldHit.copy(_planarHit);
        if (isChildOfFrame(root)) clampObjectToParentFrame(root);
        updatePropertiesFromObject(root);
        return;
    }

    if (drag.kind !== 'manip') return;

    const root = drag.root;
    if (!root) return;

    state.raycaster.setFromCamera(
        new THREE.Vector2(
            ((e.clientX - state.renderer.domElement.getBoundingClientRect().left) / state.renderer.domElement.clientWidth) * 2 - 1,
            -((e.clientY - state.renderer.domElement.getBoundingClientRect().top) / state.renderer.domElement.clientHeight) * 2 + 1
        ),
        state.camera
    );
    _planarRay.copy(state.raycaster.ray);
    if (!planarIntersectRayAtObjectDepth(_planarRay, root, _planarHit)) return;

    if (drag.mode === 'move') {
        _planarDeltaW.subVectors(_planarHit, drag.lastWorldHit);
        if (root.parent) {
            const inv = new THREE.Matrix4().copy(root.parent.matrixWorld).invert();
            _planarDeltaW.applyMatrix4(inv);
        }
        root.position.add(_planarDeltaW);
        drag.lastWorldHit.copy(_planarHit);
        if (isChildOfFrame(root)) clampObjectToParentFrame(root);
    } else if (drag.mode === 'resize' && drag.cornerTag) {
        if (root.userData.voidType === 'frame') {
            root.worldToLocal(_planarLocal.copy(_planarHit));
            const ax = drag.anchorLocal.x;
            const ay = drag.anchorLocal.y;
            // Full width/height = span between opposite (fixed) corner and pointer in local XY
            let newW = Math.max(0.08, Math.abs(_planarLocal.x - ax));
            let newH = Math.max(0.08, Math.abs(_planarLocal.y - ay));
            newW = Math.min(newW, 20);
            newH = Math.min(newH, 20);
            const anchorOld = drag.anchorLocal.clone();
            rebuildFrameGeometry(root, newW, newH);
            planarPreserveFrameCornerWorld(root, anchorOld, newW / 2, newH / 2);
        } else {
            const signs = drag.resizeSigns;
            root.worldToLocal(_planarLocal.copy(_planarHit));
            const dlx = (_planarLocal.x - drag.startLocalHit.x) * signs.x;
            const dly = (_planarLocal.y - drag.startLocalHit.y) * signs.y;
            const sx = Math.max(0.15, drag.startScale.x + (dlx / drag.baseHx) * 0.5);
            const sy = Math.max(0.15, drag.startScale.y + (dly / drag.baseHy) * 0.5);
            root.scale.set(sx, sy, drag.startScale.z);
        }
        drag.lastWorldHit.copy(_planarHit);
    }

    if (state.selectedObject === root) {
        updatePropertiesFromObject(root);
        updateAppearanceFromObject(root);
    }
}

function onPlanarPointerUp(e) {
    const drag = state.planarPointerDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;

    try {
        state.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (drag.kind === 'prototypeButton') {
        if (!drag.moved && drag.root) {
            // Use the button hit on pointerdown — do NOT re-raycast on release (avoids misses / wrong object).
            runPrototypeButtonNavigation(drag.root);
        } else {
            refreshLayersPanel();
        }
        endPlanarPointerDrag();
        return;
    }

    if (drag.kind === 'background') {
        if (!drag.moved) applyPlanarPickFromClient(e.clientX, e.clientY);
        endPlanarPointerDrag();
        return;
    }

    if (drag.kind === 'manip' && state.selectedObject === drag.root) {
        updatePropertiesFromObject(drag.root);
        updateAppearanceFromObject(drag.root);
        refreshLayersPanel();
    }

    endPlanarPointerDrag();
}

function initializePlanarManipulation(domElement) {
    if (!domElement) return;
    domElement.addEventListener('pointerdown', onPlanarPointerDown);
    domElement.addEventListener('pointermove', onPlanarPointerMove);
    domElement.addEventListener('pointerup', onPlanarPointerUp);
    domElement.addEventListener('pointercancel', onPlanarPointerUp);
}

function syncPlanarTransformControls() {
    if (!state.transformControls) return;
    // Play Mode: never show gizmos so buttons receive hits and navigation is reliable.
    if (usePlanarPointerPipeline() || state.editorMode === 'prototype') {
        state.transformControls.detach();
        state.transformControls.visible = false;
        state.transformControls.enabled = false;
    } else {
        state.transformControls.visible = true;
        state.transformControls.enabled = true;
        if (state.selectedObject) state.transformControls.attach(state.selectedObject);
    }
}

// ===== OBJECT SELECTION =====
function onViewportClick(event) {
    if (usePlanarPointerPipeline()) return;
    applyPlanarPickFromClient(event.clientX, event.clientY);
}

function resolveSelectableRoot(object) {
    let o = object;
    while (o) {
        if (state.selectableObjects.includes(o)) return o;
        o = o.parent;
    }
    return null;
}

function onViewportDoubleClick() {
    if (state.selectedObject) {
        focusOnObject(state.selectedObject);
    }
}

function applySelectionHighlight(object, highlight) {
    if (object.isLight && object.userData.isLight) {
        const helper = object.children.find((c) => c.isMesh);
        if (helper && helper.material) {
            if (highlight) helper.material.color.set(0x6366f1);
            else helper.material.color.set(0xffffff);
        }
        return;
    }
    if (object.isGroup) {
        object.traverse((child) => {
            if (child.isMesh && child.material) {
                if (highlight) {
                    if (child.material.emissive) {
                        child.userData._selEmissive = child.material.emissive.clone();
                        child.userData._selEmissiveInt = child.material.emissiveIntensity;
                        child.material.emissive = new THREE.Color(0x6366f1);
                        child.material.emissiveIntensity = 0.3;
                    }
                } else if (child.material.emissive) {
                    child.material.emissive = child.userData._selEmissive
                        ? child.userData._selEmissive.clone()
                        : new THREE.Color(0x000000);
                    child.material.emissiveIntensity =
                        child.userData._selEmissiveInt !== undefined ? child.userData._selEmissiveInt : 0;
                }
            }
        });
        return;
    }
    if (object.material && object.material.color) {
        if (highlight) {
            object.userData.originalColor = object.material.color.getHex();
            if (object.material.emissive) {
                object.material.emissive = new THREE.Color(0x6366f1);
                object.material.emissiveIntensity = 0.3;
            }
        } else {
            if (object.material.emissive) {
                object.material.emissive = new THREE.Color(0x000000);
                object.material.emissiveIntensity = 0;
            }
        }
    }
}

function selectObject(object) {
    if (state.selectedObject) deselectObject();

    state.selectedObject = object;
    applySelectionHighlight(object, true);

    updateTransformControlsForViewMode();
    showPropertiesPanel();
    updatePropertiesFromObject(object);
    updateAppearanceFromObject(object);
    updateInteractionPanel(object);
    updateFrameAndTextPropertyPanels(object);

    showNotification(`Selected: ${object.name}`);
}

function deselectObject() {
    if (!state.selectedObject) return;

    applySelectionHighlight(state.selectedObject, false);
    if (state.transformControls) state.transformControls.detach();
    state.selectedObject = null;
    hidePropertiesPanel();
    updateTransformControlsForViewMode();
}

function focusOnObject(object) {
    const targetPosition = object.position.clone();
    const distance = 3;
    const direction = state.camera.position.clone().sub(targetPosition).normalize();
    const newPosition = targetPosition.clone().add(direction.multiplyScalar(distance));
    animateCameraTo(newPosition, targetPosition);
}

// ===== SPATIAL ↔ WORLD =====
function worldToSpatial(object) {
    if (isChildOfFrame(object)) {
        return {
            distance: -object.position.z,
            side: object.position.x,
            height: object.position.y,
            facingDeg: THREE.MathUtils.radToDeg(object.rotation.y)
        };
    }
    const wp = new THREE.Vector3();
    object.getWorldPosition(wp);
    const q = new THREE.Quaternion();
    object.getWorldQuaternion(q);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    return {
        distance: -wp.z,
        side: wp.x,
        height: wp.y,
        facingDeg: THREE.MathUtils.radToDeg(e.y)
    };
}

function applySpatialToObject(object, spatial) {
    const d = parseFloat(spatial.distance);
    const side = parseFloat(spatial.side);
    const h = parseFloat(spatial.height);
    const facing = parseFloat(spatial.facingDeg);
    if (isChildOfFrame(object)) {
        object.position.set(
            Number.isFinite(side) ? side : 0,
            Number.isFinite(h) ? h : 0,
            Number.isFinite(d) ? -d : 0
        );
        object.rotation.x = 0;
        object.rotation.z = 0;
        object.rotation.y = THREE.MathUtils.degToRad(Number.isFinite(facing) ? facing : 0);
        clampObjectToParentFrame(object);
        return;
    }
    object.position.set(Number.isFinite(side) ? side : 0, Number.isFinite(h) ? h : 0, Number.isFinite(d) ? -d : 0);
    object.rotation.x = 0;
    object.rotation.z = 0;
    object.rotation.y = THREE.MathUtils.degToRad(Number.isFinite(facing) ? facing : 0);
}

// ===== UPDATE PROPERTIES =====
function updatePropertiesFromObject(object) {
    const sp = worldToSpatial(object);
    const sd = document.getElementById('spatial-distance');
    const ss = document.getElementById('spatial-side');
    const sh = document.getElementById('spatial-height');
    const sf = document.getElementById('spatial-facing');
    if (sd) sd.value = sp.distance.toFixed(2);
    if (ss) ss.value = sp.side.toFixed(2);
    if (sh) sh.value = sp.height.toFixed(2);
    if (sf) sf.value = sp.facingDeg.toFixed(0);

    const px = document.getElementById('prop-pos-x');
    const py = document.getElementById('prop-pos-y');
    const pz = document.getElementById('prop-pos-z');
    if (px) px.value = object.position.x.toFixed(2);
    if (py) py.value = object.position.y.toFixed(2);
    if (pz) pz.value = object.position.z.toFixed(2);

    const rx = document.getElementById('prop-rot-x');
    const ry = document.getElementById('prop-rot-y');
    const rz = document.getElementById('prop-rot-z');
    if (rx) rx.value = THREE.MathUtils.radToDeg(object.rotation.x).toFixed(0);
    if (ry) ry.value = THREE.MathUtils.radToDeg(object.rotation.y).toFixed(0);
    if (rz) rz.value = THREE.MathUtils.radToDeg(object.rotation.z).toFixed(0);

    const sx = document.getElementById('prop-scale-x');
    const sy = document.getElementById('prop-scale-y');
    const sz = document.getElementById('prop-scale-z');
    if (sx) sx.value = object.scale.x.toFixed(2);
    if (sy) sy.value = object.scale.y.toFixed(2);
    if (sz) sz.value = object.scale.z.toFixed(2);
}

function readSpatialInputs() {
    return {
        distance: parseFloat(document.getElementById('spatial-distance')?.value),
        side: parseFloat(document.getElementById('spatial-side')?.value),
        height: parseFloat(document.getElementById('spatial-height')?.value),
        facingDeg: parseFloat(document.getElementById('spatial-facing')?.value)
    };
}

function updateObjectFromSpatialInputs() {
    if (!state.selectedObject) return;
    applySpatialToObject(state.selectedObject, readSpatialInputs());
    updatePropertiesFromObject(state.selectedObject);
}

function updateObjectFromWorldInputs() {
    if (!state.selectedObject) return;
    const o = state.selectedObject;
    o.position.x = parseFloat(document.getElementById('prop-pos-x')?.value) || 0;
    o.position.y = parseFloat(document.getElementById('prop-pos-y')?.value) || 0;
    o.position.z = parseFloat(document.getElementById('prop-pos-z')?.value) || 0;
    o.rotation.x = THREE.MathUtils.degToRad(parseFloat(document.getElementById('prop-rot-x')?.value) || 0);
    o.rotation.y = THREE.MathUtils.degToRad(parseFloat(document.getElementById('prop-rot-y')?.value) || 0);
    o.rotation.z = THREE.MathUtils.degToRad(parseFloat(document.getElementById('prop-rot-z')?.value) || 0);
    o.scale.x = parseFloat(document.getElementById('prop-scale-x')?.value) || 1;
    o.scale.y = parseFloat(document.getElementById('prop-scale-y')?.value) || 1;
    o.scale.z = parseFloat(document.getElementById('prop-scale-z')?.value) || 1;
    if (isChildOfFrame(o)) clampObjectToParentFrame(o);
    updatePropertiesFromObject(o);
}

function updateObjectFromProperties() {
    updateObjectFromWorldInputs();
}

// ===== CREATE OBJECT =====
function createObject(type) {
    let geometry, mesh;
    const color = 0x6366f1;

    if (type === 'box') geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    else if (type === 'sphere') geometry = new THREE.SphereGeometry(0.3, 32, 32);
    else if (type === 'cylinder') geometry = new THREE.CylinderGeometry(0.2, 0.2, 0.6, 32);
    else return;

    const material = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.7 });
    mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${type.charAt(0).toUpperCase() + type.slice(1)} ${state.objects.length + 1}`;
    mesh.userData.selectable = true;
    mesh.userData.screenId = state.activeScreenId;
    mesh.userData.voidType = 'primitive';

    const frame = resolveFrameForParenting();
    if (frame) {
        mesh.position.set(0, 0, 0.15);
        mesh.rotation.set(0, 0, 0);
        frame.add(mesh);
        clampObjectToParentFrame(mesh);
    } else {
        mesh.position.set(0, 0.5, 0);
        const screenGroup = getActiveScreenGroup();
        if (screenGroup) screenGroup.add(mesh);
        else state.scene.add(mesh);
    }
    state.objects.push(mesh);
    state.selectableObjects.push(mesh);
    selectObject(mesh);
    refreshLayersPanel();

    showNotification(`Created: ${mesh.name}`);
    return mesh;
}

// ===== XR UI COMPONENTS =====
function makeTextTexture(text, w = 512, h = 128, textColor = '#ffffff', bg = 'rgba(0,0,0,0)', fontSizePx = 56) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (bg !== 'transparent') {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = textColor;
    ctx.font = `bold ${fontSizePx}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

function isChildOfFrame(object) {
    return !!(object.parent && object.parent.userData && object.parent.userData.voidType === 'frame');
}

function clampObjectToParentFrame(object) {
    let p = object.parent;
    while (p && p.userData.voidType !== 'frame') p = p.parent;
    if (!p || p.userData.frameWidth == null) return;
    const margin = 0.04;
    const hw = p.userData.frameWidth / 2 - margin;
    const hh = p.userData.frameHeight / 2 - margin;
    object.position.x = THREE.MathUtils.clamp(object.position.x, -hw, hw);
    object.position.y = THREE.MathUtils.clamp(object.position.y, -hh, hh);
}

/**
 * Figma-style parent: prefer Frame under the pointer (raycast), else selected Frame, else screen root.
 */
function resolveFrameForParenting() {
    if (state.lastPointerOverCanvas && state.lastViewportPointer && state.renderer && state.camera) {
        const rect = state.renderer.domElement.getBoundingClientRect();
        const ndcX = ((state.lastViewportPointer.x - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((state.lastViewportPointer.y - rect.top) / rect.height) * 2 + 1;
        state.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), state.camera);
        const hits = state.raycaster.intersectObjects(state.selectableObjects, true);
        for (let i = 0; i < hits.length; i++) {
            let o = hits[i].object;
            while (o) {
                if (o.userData?.voidType === 'frame') return o;
                o = o.parent;
            }
        }
    }
    if (state.selectedObject?.userData?.voidType === 'frame') return state.selectedObject;
    return null;
}

function addObjectToActiveScreen(object, defaultSpatial = null) {
    object.userData.screenId = state.activeScreenId;
    const frame = resolveFrameForParenting();

    if (frame) {
        object.position.set(0, 0, 0.04);
        object.rotation.set(0, 0, 0);
        frame.add(object);
        clampObjectToParentFrame(object);
    } else {
        if (defaultSpatial) applySpatialToObject(object, defaultSpatial);
        const g = getActiveScreenGroup();
        if (g) g.add(object);
        else state.scene.add(object);
    }
    state.objects.push(object);
    state.selectableObjects.push(object);
    refreshLayersPanel();
}

function createFrame(width, height, name = 'Frame') {
    const group = new THREE.Group();
    group.name = name;
    group.userData.voidType = 'frame';
    group.userData.selectable = true;
    group.userData.frameWidth = width;
    group.userData.frameHeight = height;
    group.userData.frameLabel = name;
    group.userData.anchor = 'world';

    const fillMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        transparent: true,
        opacity: 0.45,
        metalness: 0,
        roughness: 1,
        side: THREE.DoubleSide
    });
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, height), fillMat);
    group.add(fill);
    group.userData.frameFill = fill;

    const edgeGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, height));
    const border = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.95 })
    );
    border.position.z = 0.002;
    group.add(border);
    group.userData.frameBorder = border;

    const labelTex = makeTextTexture(name, 512, 96, '#94a3b8', 'rgba(0,0,0,0)', 36);
    const labelPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(width * 0.95, 1.4), 0.12),
        new THREE.MeshBasicMaterial({ map: labelTex, transparent: true })
    );
    labelPlane.position.set(0, height / 2 + 0.08, 0.004);
    group.add(labelPlane);
    group.userData.frameLabelMesh = labelPlane;
    group.userData.frameLabelTexture = labelTex;

    state.lastFrameSize = { width, height };

    applySpatialToObject(group, { distance: 2.2, side: 0, height: 1.2, facingDeg: 0 });
    const g = getActiveScreenGroup();
    if (g) g.add(group);
    else state.scene.add(group);
    group.userData.screenId = state.activeScreenId;
    state.objects.push(group);
    state.selectableObjects.push(group);
    refreshLayersPanel();
    selectObject(group);
    showNotification(`Frame: ${name}`);
    return group;
}

function rebuildFrameGeometry(frameGroup, width, height) {
    if (!frameGroup || frameGroup.userData.voidType !== 'frame') return;
    const u = frameGroup.userData;
    u.frameWidth = width;
    u.frameHeight = height;

    if (u.frameFill) {
        u.frameFill.geometry.dispose();
        u.frameFill.geometry = new THREE.PlaneGeometry(width, height);
    }
    if (u.frameBorder) {
        u.frameBorder.geometry.dispose();
        u.frameBorder.geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, height));
    }
    if (u.frameLabelMesh && u.frameLabelTexture) {
        const name = u.frameLabel || frameGroup.name;
        u.frameLabelTexture.dispose();
        u.frameLabelTexture = makeTextTexture(name, 512, 96, '#94a3b8', 'rgba(0,0,0,0)', 36);
        u.frameLabelMesh.material.map = u.frameLabelTexture;
        u.frameLabelMesh.material.needsUpdate = true;
        u.frameLabelMesh.geometry.dispose();
        u.frameLabelMesh.geometry = new THREE.PlaneGeometry(Math.min(width * 0.95, 1.8), 0.12);
        u.frameLabelMesh.position.set(0, height / 2 + 0.08, 0.004);
    }

    frameGroup.children.forEach((ch) => {
        if (ch.userData && ch.userData.voidType && ch.userData.voidType !== 'frame' && state.objects.includes(ch)) {
            clampObjectToParentFrame(ch);
        }
    });

    state.lastFrameSize = { width, height };
}

function updateFrameLabelTexture(frameGroup, newName) {
    const u = frameGroup.userData;
    u.frameLabel = newName;
    if (u.frameLabelMesh && u.frameLabelTexture) {
        u.frameLabelTexture.dispose();
        u.frameLabelTexture = makeTextTexture(newName, 512, 96, '#94a3b8', 'rgba(0,0,0,0)', 36);
        u.frameLabelMesh.material.map = u.frameLabelTexture;
        u.frameLabelMesh.material.needsUpdate = true;
    }
}

function createXRButton(label = 'Button') {
    const group = new THREE.Group();
    group.name = `Button ${state.objects.length + 1}`;
    group.userData.voidType = 'button';
    group.userData.label = label;
    group.userData.onClickScreenId = '';
    group.userData.clickAnimation = 'none';
    group.userData.selectable = true;
    group.userData.textFontSize = 56;
    group.userData.textColor = '#ffffff';

    const w = 0.72;
    const h = 0.22;
    group.userData.planarBaseHalf = { x: w / 2, y: h / 2 };
    const d = 0.03;
    const bg = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: 0x4f46e5, metalness: 0.25, roughness: 0.55 })
    );
    group.add(bg);

    const tex = makeTextTexture(label, 512, 128, group.userData.textColor, 'rgba(0,0,0,0)', group.userData.textFontSize);
    const fg = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.92, h * 0.72),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    fg.position.z = d / 2 + 0.002;
    group.add(fg);

    addObjectToActiveScreen(group, { distance: 2, side: 0, height: 1.25, facingDeg: 0 });
    selectObject(group);
    showNotification(`Added button: ${label}`);
    return group;
}

function createXRPanel() {
    const group = new THREE.Group();
    group.name = `Panel ${state.objects.length + 1}`;
    group.userData.voidType = 'panel';
    group.userData.selectable = true;
    group.userData.planarBaseHalf = { x: 0.6, y: 0.4 };

    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.8, 0.04),
        new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            metalness: 0.15,
            roughness: 0.85,
            transparent: true,
            opacity: 0.92
        })
    );
    group.add(mesh);

    addObjectToActiveScreen(group, { distance: 2.2, side: 0, height: 1.3, facingDeg: 0 });
    selectObject(group);
    showNotification('Added panel');
    return group;
}

function createXRTextLabel(text = 'Label') {
    const group = new THREE.Group();
    group.name = `Text ${state.objects.length + 1}`;
    group.userData.voidType = 'text';
    group.userData.text = text;
    group.userData.selectable = true;
    group.userData.textFontSize = 56;
    group.userData.textColor = '#e2e8f0';
    group.userData.textBg = 'rgba(15,23,42,0.35)';
    group.userData.planarBaseHalf = { x: 0.5, y: 0.125 };

    const tex = makeTextTexture(text, 1024, 256, group.userData.textColor, group.userData.textBg, group.userData.textFontSize);
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 0.25),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    group.add(plane);

    addObjectToActiveScreen(group, { distance: 2, side: 0, height: 1.45, facingDeg: 0 });
    selectObject(group);
    showNotification(`Added text: ${text}`);
    return group;
}

function createXRImagePlaceholder() {
    const group = new THREE.Group();
    group.name = `Image ${state.objects.length + 1}`;
    group.userData.voidType = 'image';
    group.userData.selectable = true;

    const w = 0.9;
    const h = 0.55;
    group.userData.planarBaseHalf = { x: w / 2, y: h / 2 };
    const frame = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({
            color: 0x334155,
            metalness: 0.1,
            roughness: 0.9,
            transparent: true,
            opacity: 0.85
        })
    );
    group.add(frame);

    const edges = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h));
    const lines = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.9 })
    );
    lines.position.z = 0.002;
    group.add(lines);

    addObjectToActiveScreen(group, { distance: 2.1, side: 0, height: 1.35, facingDeg: 0 });
    selectObject(group);
    showNotification('Added image placeholder');
    return group;
}

// ===== DELETE OBJECT =====
function disposeObject3D(object) {
    object.traverse((child) => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
                else child.material.dispose();
            }
        }
    });
}

function deleteSelectedObject() {
    if (!state.selectedObject) return;

    const target = state.selectedObject;
    const name = target.name;

    const toRemove = [];
    target.traverse((node) => {
        if (state.objects.includes(node)) toRemove.push(node);
    });
    toRemove.sort((a, b) => {
        let da = 0;
        let db = 0;
        let pa = a;
        let pb = b;
        while (pa.parent) {
            da++;
            pa = pa.parent;
        }
        while (pb.parent) {
            db++;
            pb = pb.parent;
        }
        return db - da;
    });

    toRemove.forEach((obj) => {
        if (obj.userData?.frameLabelTexture) {
            obj.userData.frameLabelTexture.dispose();
            obj.userData.frameLabelTexture = null;
        }
        const parent = obj.parent;
        if (parent) parent.remove(obj);
        else state.scene.remove(obj);
        state.objects = state.objects.filter((o) => o !== obj);
        state.selectableObjects = state.selectableObjects.filter((o) => o !== obj);
        disposeObject3D(obj);
    });

    deselectObject();
    refreshLayersPanel();

    showNotification(`Deleted: ${name}`);
}

// ===== TRANSFORM MODE =====
function setTransformMode(mode) {
    if (!state.transformControls) return;
    state.transformControls.setMode(mode);
    showNotification(`Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
}

// ===== PROTOTYPE LINK LINES (Figma-style; Design Mode only, not Prototype / Camera Preview) =====
const _protoLinkA = new THREE.Vector3();
const _protoLinkB = new THREE.Vector3();
const _protoLinkMid = new THREE.Vector3();
const _protoLinkBox = new THREE.Box3();

function updatePrototypeLinkLines() {
    const g = state.prototypeLinksGroup;
    if (!g || !state.scene) return;

    const showLinks =
        state.editorMode === 'design' &&
        !state.spatialPreviewActive &&
        (state.viewMode === '3d' || state.viewMode === '2d');

    while (g.children.length > 0) {
        const c = g.children[0];
        g.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    }

    if (!showLinks) return;

    state.objects.forEach((obj) => {
        if (obj.userData?.voidType !== 'button') return;
        const linkId = obj.userData.onClickScreenId;
        if (!linkId) return;
        const targetScreen = state.screens.find((s) => s.id === linkId);
        if (!targetScreen) return;

        obj.getWorldPosition(_protoLinkA);
        _protoLinkBox.setFromObject(targetScreen.group);
        if (_protoLinkBox.isEmpty()) return;
        _protoLinkBox.getCenter(_protoLinkB);

        _protoLinkMid.copy(_protoLinkA).lerp(_protoLinkB, 0.5);
        _protoLinkMid.y += 0.38;

        const curve = new THREE.QuadraticBezierCurve3(_protoLinkA.clone(), _protoLinkMid.clone(), _protoLinkB.clone());
        const pts = curve.getPoints(40);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineDashedMaterial({
            color: 0xa78bfa,
            transparent: true,
            opacity: 0.88,
            dashSize: 0.09,
            gapSize: 0.06
        });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        g.add(line);
    });
}

// ===== ANIMATION LOOP =====
function animate() {
    requestAnimationFrame(animate);

    if (state.controls) state.controls.update();

    updateViewportPosition();
    apply2DBillboards();
    updateClickAnimation();
    updatePrototypeLinkLines();

    if (state.renderer && state.scene && state.camera) {
        // Spatial preview: UI (screens/frames) stays visible; environment uses .visible=false at open (no per-frame cost).
        state.renderer.render(state.scene, state.camera);
    }
}

// ===== WINDOW RESIZE =====
function onWindowResize() {
    const viewportElement = document.getElementById('viewport-3d');
    const previewHost = document.getElementById('spatial-preview-canvas-host');
    if (!state.camera || !state.renderer) return;

    let width;
    let height;
    if (state.spatialPreviewActive && previewHost) {
        width = Math.max(previewHost.clientWidth, 1);
        height = Math.max(previewHost.clientHeight, 1);
    } else if (viewportElement) {
        width = Math.max(viewportElement.clientWidth, 1);
        height = Math.max(viewportElement.clientHeight, 1);
    } else return;

    state.renderer.setSize(width, height);
    if (state.perspectiveCamera) {
        state.perspectiveCamera.aspect = width / height;
        state.perspectiveCamera.updateProjectionMatrix();
    }
    updateOrthoCameraFrustum();
}

// ===== UPDATE VIEWPORT INFO =====
function updateViewportPosition() {
    if (!state.camera) return;

    const viewportValue = document.querySelector('.viewport-value');
    if (viewportValue) {
        const pos = state.camera.position;
        const mode = state.viewMode === '2d' ? '2D ortho' : '3D persp';
        viewportValue.textContent =
            `${mode} | X: ${pos.x.toFixed(1)}m, Y: ${pos.y.toFixed(1)}m, Z: ${pos.z.toFixed(1)}m`;
    }
}

// ===== CAMERA VIEW PRESETS =====
function setCameraView(view) {
    if (!state.camera || !state.controls) return;

    // 2D mode is locked to front orthographic (Figma-style canvas)
    if (state.viewMode === '2d' && state.orthographicCamera) {
        state.orthographicCamera.position.set(0, 0, 5);
        state.controls.target.set(0, 0, 0);
        state.orthographicCamera.lookAt(0, 0, 0);
        state.controls.update();
        showNotification('2D: front orthographic view');
        return;
    }

    const distance = 5;
    let newPosition;

    switch (view) {
        case 'top': newPosition = new THREE.Vector3(0, distance, 0); break;
        case 'front': newPosition = new THREE.Vector3(0, 2, distance); break;
        case 'side': newPosition = new THREE.Vector3(distance, 2, 0); break;
        case 'isometric': newPosition = new THREE.Vector3(distance, distance, distance); break;
    }

    animateCameraTo(newPosition);
}

function animateCameraTo(targetPosition, targetLookAt = null) {
    const startPosition = state.camera.position.clone();
    const duration = 600;
    const startTime = Date.now();
    const look = targetLookAt || new THREE.Vector3(0, 0, 0);

    function updateCamera() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        state.camera.position.lerpVectors(startPosition, targetPosition, eased);
        state.camera.lookAt(look);

        if (progress < 1) {
            requestAnimationFrame(updateCamera);
        } else {
            state.controls.target.copy(look);
            state.controls.update();
        }
    }

    updateCamera();
}

// ===== 2D / 3D VIEW MODE =====
function updateTransformControlsForViewMode() {
    if (!state.transformControls) return;
    const tc = state.transformControls;
    if (state.viewMode === '2d') {
        tc.showX = true;
        tc.showY = true;
        tc.showZ = false;
    } else {
        tc.showX = true;
        tc.showY = true;
        tc.showZ = true;
    }
    syncPlanarTransformControls();
}

function setViewMode(mode) {
    if (!state.camera || !state.controls || !state.scene) return;
    if (state.viewMode === mode) return;
    state.viewMode = mode;

    syncViewModeUi();

    const mainGrid = state.scene.getObjectByName('mainGrid');
    if (mainGrid) mainGrid.visible = mode === '3d';
    if (state.grid2d) state.grid2d.visible = mode === '2d';

    if (mode === '2d') {
        if (!state.controls3DDefaults) {
            state.controls3DDefaults = {
                enableRotate: state.controls.enableRotate,
                minPolarAngle: state.controls.minPolarAngle,
                maxPolarAngle: state.controls.maxPolarAngle
            };
        }
        state.controls.enableRotate = false;
        state.controls.enablePan = true;
        state.controls.enableZoom = true;
        state.controls.minPolarAngle = Math.PI / 2;
        state.controls.maxPolarAngle = Math.PI / 2;
        switchActiveCamera(state.orthographicCamera);
        updateOrthoCameraFrustum();
        state.orthographicCamera.position.set(0, 0, 5);
        state.orthographicCamera.lookAt(0, 0, 0);
        state.controls.target.set(0, 0, 0);
        state.controls.update();
    } else {
        if (state.controls3DDefaults) {
            state.controls.enableRotate = state.controls3DDefaults.enableRotate;
            state.controls.minPolarAngle = state.controls3DDefaults.minPolarAngle;
            state.controls.maxPolarAngle = state.controls3DDefaults.maxPolarAngle;
        }
        switchActiveCamera(state.perspectiveCamera);
        animateCameraTo(new THREE.Vector3(4, 4, 4), new THREE.Vector3(0, 0, 0));
    }
    updateTransformControlsForViewMode();
    showNotification(mode === '2d' ? '2D edit mode (orthographic)' : '3D view mode');
}

function syncViewModeUi() {
    const badge = document.getElementById('viewport-mode-badge');
    const modeToggle = document.getElementById('btn-view-mode-toggle');
    if (badge) badge.textContent = state.viewMode === '2d' ? '2D' : '3D';
    if (modeToggle) modeToggle.textContent = state.viewMode === '2d' ? '3D' : '2D';
}

function apply2DBillboards() {
    if (state.viewMode !== '2d' || !state.camera) return;
    const types = ['frame', 'panel', 'button', 'text', 'image'];
    const camPos = new THREE.Vector3();
    state.camera.getWorldPosition(camPos);
    state.objects.forEach((obj) => {
        if (!types.includes(obj.userData.voidType)) return;
        if (obj.parent && obj.parent.userData.voidType === 'frame') return;
        obj.lookAt(camPos);
    });
}

// ===== FRAME PRESET MODAL =====
function openFramePresetModal() {
    const modal = document.getElementById('frame-preset-modal');
    if (!modal) {
        createFrame(state.lastFrameSize.width, state.lastFrameSize.height, 'Frame');
        return;
    }
    modal.style.display = 'flex';
    const nameIn = document.getElementById('frame-name-input');
    if (nameIn) nameIn.value = `Frame ${state.objects.filter((o) => o.userData.voidType === 'frame').length + 1}`;
}

function closeFramePresetModal() {
    const modal = document.getElementById('frame-preset-modal');
    if (modal) modal.style.display = 'none';
}

function confirmFramePreset() {
    const sel = document.getElementById('frame-preset-select');
    const nameIn = document.getElementById('frame-name-input');
    const val = sel ? sel.value : 'custom';
    let w = 1.2;
    let h = 0.8;
    if (val === 'quest-panel') {
        w = 1.2;
        h = 0.8;
    } else if (val === 'quest-wide') {
        w = 1.8;
        h = 0.8;
    } else if (val === 'avp') {
        w = 1.6;
        h = 1.0;
    } else if (val === 'hud') {
        w = 2.0;
        h = 0.4;
    } else {
        w = state.lastFrameSize.width;
        h = state.lastFrameSize.height;
    }
    const name = (nameIn?.value || '').trim() || 'Frame';
    createFrame(w, h, name);
    closeFramePresetModal();
    state.activeTool = 'select';
    document.querySelector('[data-tool="frame"]')?.classList.remove('active');
    document.querySelector('[data-tool="select"]')?.classList.add('active');
}

// ===== TEXT / BUTTON LABEL UPDATES =====
function refreshButtonLabelTexture(object) {
    if (!object || object.userData.voidType !== 'button') return;
    const label = object.userData.label || 'Button';
    const fs = object.userData.textFontSize || 56;
    const col = object.userData.textColor || '#ffffff';
    const fg = object.children.find((c) => c.isMesh && c.material && c.material.map);
    if (!fg || !fg.material.map) return;
    fg.material.map.dispose();
    fg.material.map = makeTextTexture(label, 512, 128, col, 'rgba(0,0,0,0)', fs);
    fg.material.needsUpdate = true;
}

function refreshTextLabelTexture(object) {
    if (!object || object.userData.voidType !== 'text') return;
    const text = object.userData.text || 'Label';
    const fs = object.userData.textFontSize || 56;
    const col = object.userData.textColor || '#e2e8f0';
    const bg = object.userData.textBg || 'rgba(15,23,42,0.35)';
    const mesh = object.children.find((c) => c.isMesh && c.material && c.material.map);
    if (!mesh) return;
    mesh.material.map.dispose();
    mesh.material.map = makeTextTexture(text, 1024, 256, col, bg, fs);
    mesh.material.needsUpdate = true;
}

function updateTextContent(object, newText) {
    if (!object || object.userData.voidType !== 'text') return;
    object.userData.text = newText;
    refreshTextLabelTexture(object);
}

function updateFrameAndTextPropertyPanels(object) {
    const frameSec = document.getElementById('frame-dim-section');
    const textSec = document.getElementById('text-content-section');
    const textContentGroup = document.getElementById('void-text-content-group');
    const buttonLabelGroup = document.getElementById('void-button-label-group');
    const fw = document.getElementById('frame-width-input');
    const fh = document.getElementById('frame-height-input');
    const fn = document.getElementById('frame-name-prop-input');
    const tc = document.getElementById('void-text-content-input');
    const bl = document.getElementById('void-button-label-input');
    const fs = document.getElementById('void-text-font-size');
    const fsv = document.getElementById('void-text-font-size-value');
    const tcp = document.getElementById('void-text-color-input');

    if (frameSec) frameSec.style.display = object?.userData?.voidType === 'frame' ? 'block' : 'none';
    if (textSec) {
        const show = object && (object.userData.voidType === 'text' || object.userData.voidType === 'button');
        textSec.style.display = show ? 'block' : 'none';
    }

    if (object?.userData?.voidType === 'frame') {
        if (fw) fw.value = String(object.userData.frameWidth ?? 1.2);
        if (fh) fh.value = String(object.userData.frameHeight ?? 0.8);
        if (fn) fn.value = object.userData.frameLabel || object.name;
        const fa = document.getElementById('frame-anchor-type');
        if (fa) fa.value = object.userData.anchor || 'world';
    }

    if (object?.userData?.voidType === 'text') {
        if (textContentGroup) textContentGroup.style.display = 'block';
        if (buttonLabelGroup) buttonLabelGroup.style.display = 'none';
        if (tc) tc.value = object.userData.text || '';
        if (fs) fs.value = String(object.userData.textFontSize || 56);
        if (fsv) fsv.textContent = String(object.userData.textFontSize || 56);
        if (tcp) tcp.value = object.userData.textColor || '#e2e8f0';
        if (bl) bl.value = '';
    } else if (object?.userData?.voidType === 'button') {
        if (textContentGroup) textContentGroup.style.display = 'none';
        if (buttonLabelGroup) buttonLabelGroup.style.display = 'block';
        if (bl) bl.value = object.userData.label || '';
        if (tc) tc.value = '';
        if (fs) fs.value = String(object.userData.textFontSize || 56);
        if (fsv) fsv.textContent = String(object.userData.textFontSize || 56);
        if (tcp) tcp.value = object.userData.textColor || '#ffffff';
    }
}

function onFrameDimensionInput() {
    if (!state.selectedObject || state.selectedObject.userData.voidType !== 'frame') return;
    const fw = parseFloat(document.getElementById('frame-width-input')?.value);
    const fh = parseFloat(document.getElementById('frame-height-input')?.value);
    const w = Number.isFinite(fw) ? Math.max(0.1, fw) : state.selectedObject.userData.frameWidth;
    const h = Number.isFinite(fh) ? Math.max(0.1, fh) : state.selectedObject.userData.frameHeight;
    rebuildFrameGeometry(state.selectedObject, w, h);
    updatePropertiesFromObject(state.selectedObject);
}

function onFrameNamePropInput() {
    if (!state.selectedObject || state.selectedObject.userData.voidType !== 'frame') return;
    const fn = document.getElementById('frame-name-prop-input');
    const name = (fn?.value || '').trim() || 'Frame';
    state.selectedObject.name = name;
    updateFrameLabelTexture(state.selectedObject, name);
    refreshLayersPanel();
}

// ===== TOGGLE GRID/SAFE ZONE =====
function toggleGrid() {
    if (state.viewMode === '2d' && state.grid2d) {
        state.grid2d.visible = !state.grid2d.visible;
        return state.grid2d.visible;
    }
    const grid = state.scene.getObjectByName('mainGrid');
    if (grid) {
        grid.visible = !grid.visible;
        return grid.visible;
    }
    return false;
}

function toggleSafeZone() {
    const safeZone = state.scene.getObjectByName('safeZone');
    if (safeZone) {
        safeZone.visible = !safeZone.visible;
        return safeZone.visible;
    }
    return false;
}

// ===== SIDEBAR TAB SWITCHING =====
function initializeSidebarTabs() {
    const tabs = document.querySelectorAll('.sidebar-tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(`${tabName}-tab`).classList.add('active');
            state.activeTab = tabName;
        });
    });
}

// ===== TOOLBAR TOOL SWITCHING =====
function initializeToolbar() {
    const toolButtons = document.querySelectorAll('.tool-button');

    toolButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tool = button.getAttribute('data-tool');
            if (!tool) return;

            toolButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            state.activeTool = tool;

            // Handle creation tools
            if (tool === 'box') {
                createObject('box');
                setTimeout(() => {
                    state.activeTool = 'select';
                    document.querySelector('[data-tool="select"]').click();
                }, 100);
            } else if (tool === 'shape') {
                createObject('sphere');
                setTimeout(() => {
                    state.activeTool = 'select';
                    document.querySelector('[data-tool="select"]').click();
                }, 100);
            } else if (tool === 'frame') {
                openFramePresetModal();
                return;
            }

            showNotification(`Tool: ${tool.charAt(0).toUpperCase() + tool.slice(1)}`);
        });
    });
}

// ===== LAYER SELECTION =====
function initializeLayers() {
    const tree = document.getElementById('layers-tree');
    if (!tree) return;
    tree.addEventListener('click', (e) => {
        const row = e.target.closest('.layer-item[data-object-uuid]');
        if (!row) return;
        const uuid = row.getAttribute('data-object-uuid');
        const obj = state.objects.find((o) => o.uuid === uuid);
        if (obj) {
            tree.querySelectorAll('.layer-item').forEach((el) => el.classList.remove('active'));
            row.classList.add('active');
            selectObject(obj);
        }
    });
}

// ===== PROPERTIES PANEL =====
function showPropertiesPanel() {
    const emptyState = document.querySelector('.empty-state');
    const propertiesSections = document.querySelector('.properties-sections');

    if (emptyState && propertiesSections) {
        emptyState.style.display = 'none';
        propertiesSections.style.display = 'block';
    }
}

function hidePropertiesPanel() {
    const emptyState = document.querySelector('.empty-state');
    const propertiesSections = document.querySelector('.properties-sections');

    if (emptyState && propertiesSections) {
        emptyState.style.display = 'flex';
        propertiesSections.style.display = 'none';
    }
}

function initializePropertySections() {
    const sectionHeaders = document.querySelectorAll('.property-section-header');

    sectionHeaders.forEach((header) => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const collapseBtn = header.querySelector('.collapse-btn');
            if (!content || !collapseBtn) return;

            if (content.style.display === 'none') {
                content.style.display = 'block';
                collapseBtn.textContent = '−';
            } else {
                content.style.display = 'none';
                collapseBtn.textContent = '+';
            }
        });
    });

    ['spatial-distance', 'spatial-side', 'spatial-height', 'spatial-facing'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', updateObjectFromSpatialInputs);
            el.addEventListener('input', updateObjectFromSpatialInputs);
        }
    });

    ['prop-pos-x', 'prop-pos-y', 'prop-pos-z', 'prop-rot-x', 'prop-rot-y', 'prop-rot-z', 'prop-scale-x', 'prop-scale-y', 'prop-scale-z'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', updateObjectFromWorldInputs);
            el.addEventListener('input', updateObjectFromWorldInputs);
        }
    });
}

// ===== VIEWPORT CONTROLS =====
function initializeViewportControls() {
    const viewPresetButtons = document.querySelectorAll('.viewport-controls [data-view-preset]');

    function setActiveViewPreset(activeBtn) {
        viewPresetButtons.forEach((btn) => btn.classList.remove('active'));
        if (activeBtn) activeBtn.classList.add('active');
    }

    viewPresetButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const preset = button.getAttribute('data-view-preset');
            setActiveViewPreset(button);
            if (preset === 'top') {
                setCameraView('top');
                showNotification('View: Top');
            } else if (preset === 'front') {
                setCameraView('front');
                showNotification('View: Front');
            } else if (preset === 'side') {
                setCameraView('side');
                showNotification('View: Side');
            } else if (preset === 'isometric') {
                setCameraView('isometric');
                showNotification('View: Isometric');
            }
        });
    });

    const modeToggle = document.getElementById('btn-view-mode-toggle');
    if (modeToggle) {
        modeToggle.addEventListener('click', () => {
            setViewMode(state.viewMode === '2d' ? '3d' : '2d');
        });
    }

    const gridBtn = document.getElementById('viewport-toggle-grid');
    if (gridBtn) {
        gridBtn.addEventListener('click', () => {
            gridBtn.classList.toggle('active');
            const isVisible = toggleGrid();
            showNotification(`Grid: ${isVisible ? 'On' : 'Off'}`);
        });
    }

    const safeBtn = document.getElementById('viewport-toggle-safe');
    if (safeBtn) {
        safeBtn.addEventListener('click', () => {
            safeBtn.classList.toggle('active');
            const isVisible = toggleSafeZone();
            showNotification(`Safe Zone: ${isVisible ? 'On' : 'Off'}`);
        });
    }
}

// ===== ZOOM CONTROLS =====
function applyViewportZoomToCameras() {
    const zoomPct = state.viewport.zoom || 100;
    const factor = zoomPct / 100;
    if (state.perspectiveCamera) {
        state.perspectiveCamera.fov = 75 / factor;
        state.perspectiveCamera.updateProjectionMatrix();
    }
    updateOrthoCameraFrustum();
}

function initializeZoomControls() {
    const zoomButtons = document.querySelectorAll('.zoom-control .icon-button');
    const zoomDisplay = document.querySelector('.zoom-control span');

    zoomButtons[0].addEventListener('click', () => {
        state.viewport.zoom = Math.max(10, state.viewport.zoom - 10);
        if (zoomDisplay) zoomDisplay.textContent = `${state.viewport.zoom}%`;
        applyViewportZoomToCameras();
    });

    zoomButtons[1].addEventListener('click', () => {
        state.viewport.zoom = Math.min(400, state.viewport.zoom + 10);
        if (zoomDisplay) zoomDisplay.textContent = `${state.viewport.zoom}%`;
        applyViewportZoomToCameras();
    });
}

// ===== KEYBOARD SHORTCUTS =====
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeFramePresetModal();
            if (state.spatialPreviewActive) closeSpatialPreview();
        }

        // Editor shortcuts only (onboarding login/dashboard are HTML-only).
        if (state.appPhase !== 'editor') return;

        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        const modifier = e.metaKey || e.ctrlKey;

        const toolShortcuts = {
            'v': 'select',
            'f': 'frame',
            't': 'text',
            'r': 'shape',
            'b': 'box',
            'i': 'image',
            'c': 'comment'
        };

        if (!modifier && toolShortcuts[e.key.toLowerCase()]) {
            e.preventDefault();
            const tool = toolShortcuts[e.key.toLowerCase()];
            const button = document.querySelector(`[data-tool="${tool}"]`);
            if (button) button.click();
        }

        // Transform modes (when object selected)
        if (state.selectedObject && !modifier) {
            switch (e.key.toLowerCase()) {
                case 'g':
                    e.preventDefault();
                    setTransformMode('translate');
                    break;
                case 'r':
                    e.preventDefault();
                    setTransformMode('rotate');
                    break;
                case 's':
                    e.preventDefault();
                    setTransformMode('scale');
                    break;
                case 'delete':
                case 'backspace':
                    e.preventDefault();
                    deleteSelectedObject();
                    break;
            }
        }

        // File shortcuts
        if (modifier) {
            switch (e.key.toLowerCase()) {
                case 'n':
                    e.preventDefault();
                    showNotification('New File');
                    break;
                case 's':
                    e.preventDefault();
                    downloadVoidJson();
                    break;
                case 'o':
                    e.preventDefault();
                    showNotification('Open');
                    break;
            }
        }
    });
}

// ===== NOTIFICATION SYSTEM =====
let notificationTimeout;
function showNotification(message) {
    let notification = document.getElementById('notification');

    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--color-bg-elevated);
            color: var(--color-text-primary);
            padding: 12px 24px;
            border-radius: 8px;
            border: 1px solid var(--color-border);
            font-size: 13px;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.2s ease;
            box-shadow: var(--shadow-lg);
        `;
        document.body.appendChild(notification);
    }

    clearTimeout(notificationTimeout);
    notification.textContent = message;
    notification.style.opacity = '1';

    notificationTimeout = setTimeout(() => {
        notification.style.opacity = '0';
    }, 2000);
}

// ===== EXPORT / SAVE =====
function serializeObjectForVoid(o) {
    const u = o.userData || {};
    const base = {
        id: o.uuid,
        name: o.name,
        type: u.voidType || (o.isLight ? 'light' : 'primitive'),
        label: u.label || '',
        text: u.text || '',
        onClickScreenId: u.onClickScreenId || '',
        clickAnimation: u.clickAnimation || 'none',
        screenId: u.screenId || '',
        position: { x: o.position.x, y: o.position.y, z: o.position.z },
        rotation: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
        scale: { x: o.scale.x, y: o.scale.y, z: o.scale.z }
    };
    if (u.voidType === 'frame') {
        base.frameWidth = u.frameWidth;
        base.frameHeight = u.frameHeight;
        base.frameLabel = u.frameLabel || o.name;
        base.anchor = u.anchor || 'world';
        base.children = o.children
            .filter((ch) => ch.userData && ch.userData.voidType && ch.userData.voidType !== 'frame' && state.objects.includes(ch))
            .map(serializeObjectForVoid);
    }
    return base;
}

function buildVoidExport() {
    const screens = state.screens.map((s) => ({
        id: s.id,
        name: s.name,
        components: s.group.children
            .filter((c) => c.userData && !c.userData.isEnvironment)
            .map(serializeObjectForVoid)
    }));
    return {
        version: 1,
        void: true,
        exportedAt: new Date().toISOString(),
        activeScreenId: state.activeScreenId,
        screens
    };
}

function downloadVoidJson() {
    const data = buildVoidExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scene.void.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showNotification('Saved scene.void.json');
}

function initializeMenuSave() {
    const saveBtn = document.getElementById('menu-save-void');
    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadVoidJson();
        });
    }
}

function setupButtonLinkListener() {
    const sel = document.getElementById('button-onclick-screen');
    if (!sel) return;
    sel.addEventListener('change', () => {
        if (state.selectedObject?.userData?.voidType === 'button') {
            state.selectedObject.userData.onClickScreenId = sel.value || '';
            showNotification(state.selectedObject.userData.onClickScreenId ? 'Button link updated' : 'Button link cleared');
        }
    });
}

function setupFrameAnchorListener() {
    const sel = document.getElementById('frame-anchor-type');
    if (!sel) return;
    sel.addEventListener('change', () => {
        if (state.selectedObject?.userData?.voidType === 'frame') {
            applyFrameXRAnchorType(state.selectedObject, sel.value || 'world');
        }
    });
}

function setupButtonAnimationListener() {
    const sel = document.getElementById('button-click-animation');
    if (!sel) return;
    sel.addEventListener('change', () => {
        if (state.selectedObject?.userData?.voidType === 'button') {
            state.selectedObject.userData.clickAnimation = sel.value || 'none';
            showNotification('Click animation updated');
        }
    });
}

// ===== ASSET/COLOR/PAGE INTERACTIONS =====
function initializeAssets() {
    document.querySelectorAll('#assets-components .asset-card[data-component]').forEach((card) => {
        card.addEventListener('click', () => {
            const type = card.getAttribute('data-component');
            if (type === 'button') createXRButton('Start');
            else if (type === 'panel') createXRPanel();
            else if (type === 'text') createXRTextLabel('Welcome');
            else if (type === 'image') createXRImagePlaceholder();
        });
    });
}

function initializeColors() {
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
            const color = swatch.style.background;
            showNotification(`Color selected: ${color}`);
        });
    });
}

function initializeScreensUI() {
    const btn = document.getElementById('btn-add-screen');
    if (btn) {
        btn.addEventListener('click', () => {
            const suggested = `Screen ${state.screens.length + 1}`;
            const name = window.prompt('Screen name', suggested);
            if (name === null) return;
            createScreen(name.trim() || suggested);
        });
    }
}

// ===== DESIGN / PROTOTYPE + SPATIAL PREVIEW (camera compositing) =====
function setEditorMode(mode) {
    const prev = state.editorMode;

    // Entering Prototype (Play) Mode: remember which screen we were editing (Figma-style return).
    if (mode === 'prototype' && prev !== 'prototype') {
        state.activeScreenIdBeforePrototype = state.activeScreenId;
        deselectObject();
    }

    // Back to Design Mode: restore the screen that was active when Play Mode started.
    if (mode === 'design' && prev === 'prototype' && state.activeScreenIdBeforePrototype) {
        const backId = state.activeScreenIdBeforePrototype;
        state.activeScreenIdBeforePrototype = null;
        switchToScreen(backId, { silent: true });
    }

    state.editorMode = mode;

    document.getElementById('btn-mode-design')?.classList.toggle('active', mode === 'design');
    document.getElementById('btn-mode-prototype')?.classList.toggle('active', mode === 'prototype');
    document.getElementById('btn-mode-design')?.setAttribute('aria-pressed', mode === 'design' ? 'true' : 'false');
    document.getElementById('btn-mode-prototype')?.setAttribute('aria-pressed', mode === 'prototype' ? 'true' : 'false');

    const exitBtn = document.getElementById('btn-exit-prototype');
    if (exitBtn) {
        exitBtn.style.display = mode === 'prototype' ? 'inline-flex' : 'none';
        exitBtn.setAttribute('aria-hidden', mode === 'prototype' ? 'false' : 'true');
    }

    if (mode === 'prototype') {
        showNotification('Prototype Mode — click buttons to navigate linked screens');
    } else if (prev === 'prototype') {
        showNotification('Design Mode');
    }

    updateTransformControlsForViewMode();
}

/**
 * Mark editor-only scene dressing invisible for AR overlay. Objects tagged with
 * userData.isEnvironment (ground plane, grids, axes, safe zone) are backed up and hidden.
 * Screen groups and all UI content are unchanged.
 */
function enterSpatialPreviewEnvironment() {
    if (!state.scene) return;
    if (state.spatialPreviewEnvironmentBackup?.length) {
        exitSpatialPreviewEnvironment();
    }
    const backup = [];
    state.scene.traverse((obj) => {
        if (obj.userData?.isEnvironment) {
            backup.push({ object: obj, visible: obj.visible });
            obj.visible = false;
        }
    });
    state.spatialPreviewEnvironmentBackup = backup;
    state.spatialPreviewMode = true;
}

/** Restore environment visibility after spatial preview closes. */
function exitSpatialPreviewEnvironment() {
    if (state.spatialPreviewEnvironmentBackup) {
        for (const { object, visible } of state.spatialPreviewEnvironmentBackup) {
            if (object) object.visible = visible;
        }
        state.spatialPreviewEnvironmentBackup = null;
    }
    state.spatialPreviewMode = false;
}

async function openSpatialPreview() {
    const overlay = document.getElementById('spatial-preview-overlay');
    const video = document.getElementById('spatial-preview-video');
    const host = document.getElementById('spatial-preview-canvas-host');
    const mainVp = document.getElementById('viewport-3d');
    if (!overlay || !video || !host || !mainVp || !state.renderer || !state.scene) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });
        video.srcObject = stream;
        state.spatialPreviewStream = stream;
        await video.play().catch(() => {});

        state.savedSceneBackground = state.scene.background;
        state.scene.background = null;
        state.renderer.setClearAlpha(0);

        // Hide floor, grids, axes, safe zone — only UI frames/components draw over the camera.
        enterSpatialPreviewEnvironment();

        host.appendChild(state.renderer.domElement);
        state.spatialPreviewActive = true;
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
        onWindowResize();

        const hint = document.getElementById('spatial-preview-hint');
        if (hint) {
            hint.textContent =
                'Drag to move; drag corners to resize — same scene as Design Mode (no gizmo in preview).';
        }
        showNotification('Spatial preview');
        updateTransformControlsForViewMode();
    } catch (err) {
        showNotification(`Camera unavailable: ${err?.message || 'Permission denied'}`);
    }
}

function closeSpatialPreview() {
    const overlay = document.getElementById('spatial-preview-overlay');
    const mainVp = document.getElementById('viewport-3d');
    const video = document.getElementById('spatial-preview-video');

    // Restore ground / grid / guides before moving renderer back to the main viewport.
    exitSpatialPreviewEnvironment();

    if (state.spatialPreviewStream) {
        state.spatialPreviewStream.getTracks().forEach((t) => t.stop());
        state.spatialPreviewStream = null;
    }
    if (video) video.srcObject = null;
    if (state.renderer?.domElement && mainVp) {
        mainVp.appendChild(state.renderer.domElement);
    }
    if (state.scene) {
        if (state.savedSceneBackground !== null && state.savedSceneBackground !== undefined) {
            state.scene.background = state.savedSceneBackground;
        } else {
            state.scene.background = new THREE.Color(0x0f0f0f);
        }
        state.savedSceneBackground = null;
    }
    if (state.renderer) state.renderer.setClearAlpha(1);
    state.spatialPreviewActive = false;
    if (overlay) {
        overlay.classList.remove('is-open');
        overlay.setAttribute('aria-hidden', 'true');
    }
    onWindowResize();
    updateTransformControlsForViewMode();
    showNotification('Preview closed');
}

function initializeEditorModeAndSpatialPreview() {
    document.getElementById('btn-mode-design')?.addEventListener('click', () => setEditorMode('design'));
    document.getElementById('btn-mode-prototype')?.addEventListener('click', () => setEditorMode('prototype'));
    document.getElementById('btn-exit-prototype')?.addEventListener('click', () => setEditorMode('design'));
    document.getElementById('btn-spatial-preview')?.addEventListener('click', () => openSpatialPreview());
    document.getElementById('spatial-preview-close')?.addEventListener('click', () => closeSpatialPreview());
}

// ===== INITIALIZE APPLICATION =====
function initializeFrameTextPresetModal() {
    document.getElementById('frame-preset-confirm')?.addEventListener('click', confirmFramePreset);
    document.getElementById('frame-preset-cancel')?.addEventListener('click', closeFramePresetModal);
    document.getElementById('frame-preset-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'frame-preset-modal') closeFramePresetModal();
    });

    ['frame-width-input', 'frame-height-input'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', onFrameDimensionInput);
            el.addEventListener('input', onFrameDimensionInput);
        }
    });
    document.getElementById('frame-name-prop-input')?.addEventListener('change', onFrameNamePropInput);
    document.getElementById('frame-name-prop-input')?.addEventListener('input', onFrameNamePropInput);

    document.getElementById('void-text-content-input')?.addEventListener('input', (e) => {
        if (state.selectedObject?.userData?.voidType === 'text') {
            updateTextContent(state.selectedObject, e.target.value);
        }
    });
    document.getElementById('void-button-label-input')?.addEventListener('input', (e) => {
        if (state.selectedObject?.userData?.voidType === 'button') {
            state.selectedObject.userData.label = e.target.value;
            refreshButtonLabelTexture(state.selectedObject);
        }
    });
    document.getElementById('void-text-font-size')?.addEventListener('input', (e) => {
        const o = state.selectedObject;
        if (!o || (o.userData.voidType !== 'text' && o.userData.voidType !== 'button')) return;
        const v = parseInt(e.target.value, 10) || 56;
        o.userData.textFontSize = THREE.MathUtils.clamp(v, 24, 96);
        const lab = document.getElementById('void-text-font-size-value');
        if (lab) lab.textContent = String(o.userData.textFontSize);
        if (o.userData.voidType === 'text') refreshTextLabelTexture(o);
        else refreshButtonLabelTexture(o);
    });
    document.getElementById('void-text-color-input')?.addEventListener('input', (e) => {
        const o = state.selectedObject;
        if (!o || (o.userData.voidType !== 'text' && o.userData.voidType !== 'button')) return;
        o.userData.textColor = e.target.value;
        if (o.userData.voidType === 'text') refreshTextLabelTexture(o);
        else refreshButtonLabelTexture(o);
    });
}

/**
 * One-time Three.js + scene setup when user opens the real editor (after "Create New Project").
 * Keeps WebGL hidden during Login / Dashboard for cleaner user testing.
 */
function ensureEditorExperienceInitialized() {
    if (state.editorExperienceInitialized) return;
    state.editorExperienceInitialized = true;

    initialize3DViewport();
    initializeLightingControls();

    applyViewportZoomToCameras();
    syncViewModeUi();
    updateTransformControlsForViewMode();

    refreshScreensPanel();
    refreshLayersPanel();
    populateButtonLinkDropdown();

    setTimeout(() => {
        showNotification('Editor ready — same Void canvas as before onboarding');
    }, 400);
}

/**
 * Switch onboarding / shell phase. Does not alter editor DOM; only visibility + deferred init.
 */
function setAppPhase(phase) {
    const allowed = ['login', 'dashboard', 'editor'];
    if (!allowed.includes(phase)) return;
    state.appPhase = phase;

    const login = document.getElementById('phase-login');
    const dash = document.getElementById('phase-dashboard');
    const editor = document.getElementById('phase-editor');
    const nav = document.getElementById('app-top-nav');

    if (login) login.hidden = phase !== 'login';
    if (dash) dash.hidden = phase !== 'dashboard';
    if (editor) editor.hidden = phase !== 'editor';
    if (nav) nav.hidden = phase === 'login';

    if (phase === 'editor') {
        ensureEditorExperienceInitialized();
        requestAnimationFrame(() => {
            onWindowResize();
        });
    }
}

function initializeOnboardingFlow() {
    document.getElementById('btn-onboarding-login')?.addEventListener('click', () => {
        setAppPhase('dashboard');
    });
    document.getElementById('btn-onboarding-create-project')?.addEventListener('click', () => {
        setAppPhase('editor');
    });
    document.getElementById('app-nav-dashboard')?.addEventListener('click', () => {
        if (state.appPhase === 'editor') {
            if (state.spatialPreviewActive) closeSpatialPreview();
            setAppPhase('dashboard');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 XR Spatial UI Designer Initialized');

    initializeOnboardingFlow();

    initializeSidebarTabs();
    initializeToolbar();
    initializeLayers();
    initializePropertySections();
    initializeViewportControls();
    initializeZoomControls();
    initializeKeyboardShortcuts();
    initializeAssets();
    initializeAppearanceControls();
    initializeMenuSave();
    setupButtonLinkListener();
    setupFrameAnchorListener();
    setupButtonAnimationListener();
    initializeFrameTextPresetModal();
    initializeEditorModeAndSpatialPreview();

    initializeColors();
    initializeScreensUI();

    // 3D viewport + scene: deferred until setAppPhase('editor') — see ensureEditorExperienceInitialized().

    console.log('Initial state:', state);
});

// ===== EXPORT FOR DEBUGGING =====
window.XRSpatialUI = {
    state,
    showNotification,
    showPropertiesPanel,
    hidePropertiesPanel,
    toggleGrid,
    toggleSafeZone,
    setCameraView,
    selectObject,
    deselectObject,
    createObject,
    setTransformMode,
    deleteSelectedObject,
    downloadVoidJson,
    buildVoidExport,
    createScreen,
    switchToScreen,
    setAppPhase,
    ensureEditorExperienceInitialized
};

// ===== APPEARANCE CONTROLS =====
function initializeAppearanceControls() {
    // Color Picker
    const colorInput = document.getElementById('object-color');
    const colorHexDisplay = document.getElementById('color-hex-display');
    
    if (colorInput) {
        colorInput.addEventListener('input', (e) => {
            const color = e.target.value;
            colorHexDisplay.textContent = color;
            
            const m = state.selectedObject && getPrimaryMesh(state.selectedObject);
            if (m && m.material) {
                m.material.color.set(color);
                showNotification(`Color: ${color}`);
            }
        });
    }
    
    // Opacity Slider
    const opacitySlider = document.getElementById('object-opacity');
    const opacityValue = document.getElementById('opacity-value');
    
    if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
            const opacity = parseInt(e.target.value) / 100;
            opacityValue.textContent = e.target.value;
            
            const m = state.selectedObject && getPrimaryMesh(state.selectedObject);
            if (m && m.material) {
                m.material.opacity = opacity;
                m.material.transparent = opacity < 1;
                showNotification(`Opacity: ${e.target.value}%`);
            }
        });
    }
    
    // Metalness Slider
    const metalnessSlider = document.getElementById('object-metalness');
    const metalnessValue = document.getElementById('metalness-value');
    
    if (metalnessSlider) {
        metalnessSlider.addEventListener('input', (e) => {
            const metalness = parseInt(e.target.value) / 100;
            metalnessValue.textContent = e.target.value;
            
            const m = state.selectedObject && getPrimaryMesh(state.selectedObject);
            if (m && m.material && m.material.metalness !== undefined) {
                m.material.metalness = metalness;
            }
        });
    }
    
    // Roughness Slider
    const roughnessSlider = document.getElementById('object-roughness');
    const roughnessValue = document.getElementById('roughness-value');
    
    if (roughnessSlider) {
        roughnessSlider.addEventListener('input', (e) => {
            const roughness = parseInt(e.target.value) / 100;
            roughnessValue.textContent = e.target.value;
            
            const m = state.selectedObject && getPrimaryMesh(state.selectedObject);
            if (m && m.material && m.material.roughness !== undefined) {
                m.material.roughness = roughness;
            }
        });
    }
    
    // Material Type Selector
    const materialButtons = document.querySelectorAll('.material-option');
    
    materialButtons.forEach(button => {
        button.addEventListener('click', () => {
            const materialType = button.getAttribute('data-material');
            
            // Update UI
            materialButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Apply material to selected object
            if (state.selectedObject) {
                applyMaterialType(state.selectedObject, materialType);
                showNotification(`Material: ${materialType.charAt(0).toUpperCase() + materialType.slice(1)}`);
            }
        });
    });
}

function getPrimaryMesh(object) {
    if (object.isMesh) return object;
    let found = null;
    object.traverse((c) => {
        if (!found && c.isMesh) found = c;
    });
    return found;
}

// ===== APPLY MATERIAL TYPE =====
function applyMaterialType(object, type) {
    const mesh = getPrimaryMesh(object);
    if (!mesh || !mesh.material) {
        showNotification('Cannot change material for this object');
        return;
    }
    const currentColor = mesh.material.color.getHex();

    mesh.material.dispose();

    switch (type) {
        case 'standard':
            mesh.material = new THREE.MeshStandardMaterial({
                color: currentColor,
                metalness: 0.0,
                roughness: 0.9
            });
            document.getElementById('object-metalness').value = 0;
            document.getElementById('metalness-value').textContent = '0';
            document.getElementById('object-roughness').value = 90;
            document.getElementById('roughness-value').textContent = '90';
            break;

        case 'metallic':
            mesh.material = new THREE.MeshStandardMaterial({
                color: currentColor,
                metalness: 1.0,
                roughness: 0.2
            });
            document.getElementById('object-metalness').value = 100;
            document.getElementById('metalness-value').textContent = '100';
            document.getElementById('object-roughness').value = 20;
            document.getElementById('roughness-value').textContent = '20';
            break;

        case 'glass':
            mesh.material = new THREE.MeshPhysicalMaterial({
                color: currentColor,
                metalness: 0.0,
                roughness: 0.0,
                transmission: 0.9,
                thickness: 0.5,
                transparent: true,
                opacity: 0.5
            });
            document.getElementById('object-opacity').value = 50;
            document.getElementById('opacity-value').textContent = '50';
            document.getElementById('object-metalness').value = 0;
            document.getElementById('metalness-value').textContent = '0';
            document.getElementById('object-roughness').value = 0;
            document.getElementById('roughness-value').textContent = '0';
            break;

        case 'glow':
            mesh.material = new THREE.MeshStandardMaterial({
                color: currentColor,
                emissive: currentColor,
                emissiveIntensity: 0.8,
                metalness: 0.0,
                roughness: 0.5
            });
            document.getElementById('object-metalness').value = 0;
            document.getElementById('metalness-value').textContent = '0';
            document.getElementById('object-roughness').value = 50;
            document.getElementById('roughness-value').textContent = '50';
            break;
    }

    mesh.material.needsUpdate = true;
}

// ===== UPDATE APPEARANCE FROM OBJECT =====
function updateAppearanceFromObject(object) {
    const mesh = getPrimaryMesh(object);
    if (!mesh || !mesh.material) return;

    // Color
    const colorHex = '#' + mesh.material.color.getHexString();
    const colorPicker = document.getElementById('object-color');
    const colorHexDisplay = document.getElementById('color-hex-display');
    
    if (colorPicker) colorPicker.value = colorHex;
    if (colorHexDisplay) colorHexDisplay.textContent = colorHex;
    
    // Opacity
    const opacity = (mesh.material.opacity !== undefined ? mesh.material.opacity : 1.0) * 100;
    const opacitySlider = document.getElementById('object-opacity');
    const opacityValue = document.getElementById('opacity-value');
    
    if (opacitySlider) opacitySlider.value = opacity.toFixed(0);
    if (opacityValue) opacityValue.textContent = opacity.toFixed(0);
    
    // Metalness & Roughness
    if (mesh.material.metalness !== undefined) {
        const metalness = mesh.material.metalness * 100;
        const metalnessSlider = document.getElementById('object-metalness');
        const metalnessValue = document.getElementById('metalness-value');
        
        if (metalnessSlider) metalnessSlider.value = metalness.toFixed(0);
        if (metalnessValue) metalnessValue.textContent = metalness.toFixed(0);
    }

    if (mesh.material.roughness !== undefined) {
        const roughness = mesh.material.roughness * 100;
        const roughnessSlider = document.getElementById('object-roughness');
        const roughnessValue = document.getElementById('roughness-value');
        
        if (roughnessSlider) roughnessSlider.value = roughness.toFixed(0);
        if (roughnessValue) roughnessValue.textContent = roughness.toFixed(0);
    }
}

// ===== LIGHTING CONTROLS =====
function initializeLightingControls() {
    // Store light references in state
    if (!state.lights) {
        state.lights = {
            ambient: null,
            directional: null,
            points: []
        };
    }
    
    // Find existing lights in scene
    state.scene.children.forEach(child => {
        if (child.isAmbientLight) {
            state.lights.ambient = child;
        } else if (child.isDirectionalLight) {
            state.lights.directional = child;
        }
    });
    
    // Ambient Light Intensity
    const ambientIntensity = document.getElementById('ambient-intensity');
    const ambientIntensityValue = document.getElementById('ambient-intensity-value');
    
    if (ambientIntensity && state.lights.ambient) {
        ambientIntensity.addEventListener('input', (e) => {
            const intensity = parseInt(e.target.value) / 100;
            ambientIntensityValue.textContent = e.target.value;
            state.lights.ambient.intensity = intensity;
            showNotification(`Ambient Intensity: ${e.target.value}%`);
        });
    }
    
    // Ambient Light Color
    const ambientColor = document.getElementById('ambient-color');
    const ambientColorHex = document.getElementById('ambient-color-hex');
    
    if (ambientColor && state.lights.ambient) {
        ambientColor.addEventListener('input', (e) => {
            const color = e.target.value;
            ambientColorHex.textContent = color;
            state.lights.ambient.color.set(color);
            showNotification(`Ambient Color: ${color}`);
        });
    }
    
    // Key Light Intensity
    const keyLightIntensity = document.getElementById('key-light-intensity');
    const keyLightIntensityValue = document.getElementById('key-light-intensity-value');
    
    if (keyLightIntensity && state.lights.directional) {
        keyLightIntensity.addEventListener('input', (e) => {
            const intensity = parseInt(e.target.value) / 100;
            keyLightIntensityValue.textContent = e.target.value;
            state.lights.directional.intensity = intensity;
            showNotification(`Key Light: ${e.target.value}%`);
        });
    }
    
    // Key Light Color
    const keyLightColor = document.getElementById('key-light-color');
    const keyLightColorHex = document.getElementById('key-light-color-hex');
    
    if (keyLightColor && state.lights.directional) {
        keyLightColor.addEventListener('input', (e) => {
            const color = e.target.value;
            keyLightColorHex.textContent = color;
            state.lights.directional.color.set(color);
            showNotification(`Key Light Color: ${color}`);
        });
    }
    
    // Shadows Toggle
    const shadowsEnabled = document.getElementById('shadows-enabled');
    
    if (shadowsEnabled && state.lights.directional) {
        shadowsEnabled.addEventListener('change', (e) => {
            state.lights.directional.castShadow = e.target.checked;
            showNotification(`Shadows: ${e.target.checked ? 'On' : 'Off'}`);
        });
    }
    
    // Add Point Light Button
    const addPointLightBtn = document.getElementById('add-point-light');
    
    if (addPointLightBtn) {
        addPointLightBtn.addEventListener('click', () => {
            addPointLight();
        });
    }
}

// ===== ADD POINT LIGHT =====
function addPointLight() {
    const pointLight = new THREE.PointLight(0xffffff, 1.0, 10);
    pointLight.position.set(0, 2, 0);
    pointLight.castShadow = true;
    pointLight.name = `Point Light ${state.lights.points.length + 1}`;
    
    // Add visual helper
    const sphereSize = 0.1;
    const lightHelper = new THREE.Mesh(
        new THREE.SphereGeometry(sphereSize, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    pointLight.add(lightHelper);
    
    pointLight.userData.screenId = state.activeScreenId;
    const g = getActiveScreenGroup();
    if (g) g.add(pointLight);
    else state.scene.add(pointLight);
    state.lights.points.push(pointLight);
    state.objects.push(pointLight);

    pointLight.userData.selectable = true;
    pointLight.userData.isLight = true;
    state.selectableObjects.push(pointLight);
    
    // Auto-select the new light
    selectObject(pointLight);
    
    showNotification(`Added: ${pointLight.name}`);
    console.log('Point light added:', pointLight);
}

// ===== UPDATE LIGHTING VALUES FROM SCENE =====
function updateLightingValues() {
    if (!state.lights) return;
    
    // Ambient Light
    if (state.lights.ambient) {
        const ambientIntensity = document.getElementById('ambient-intensity');
        const ambientIntensityValue = document.getElementById('ambient-intensity-value');
        const ambientColor = document.getElementById('ambient-color');
        const ambientColorHex = document.getElementById('ambient-color-hex');
        
        if (ambientIntensity) {
            const intensity = (state.lights.ambient.intensity * 100).toFixed(0);
            ambientIntensity.value = intensity;
            if (ambientIntensityValue) ambientIntensityValue.textContent = intensity;
        }
        
        if (ambientColor) {
            const colorHex = '#' + state.lights.ambient.color.getHexString();
            ambientColor.value = colorHex;
            if (ambientColorHex) ambientColorHex.textContent = colorHex;
        }
    }
    
    // Directional Light
    if (state.lights.directional) {
        const keyLightIntensity = document.getElementById('key-light-intensity');
        const keyLightIntensityValue = document.getElementById('key-light-intensity-value');
        const keyLightColor = document.getElementById('key-light-color');
        const keyLightColorHex = document.getElementById('key-light-color-hex');
        const shadowsEnabled = document.getElementById('shadows-enabled');
        
        if (keyLightIntensity) {
            const intensity = (state.lights.directional.intensity * 100).toFixed(0);
            keyLightIntensity.value = intensity;
            if (keyLightIntensityValue) keyLightIntensityValue.textContent = intensity;
        }
        
        if (keyLightColor) {
            const colorHex = '#' + state.lights.directional.color.getHexString();
            keyLightColor.value = colorHex;
            if (keyLightColorHex) keyLightColorHex.textContent = colorHex;
        }
        
        if (shadowsEnabled) {
            shadowsEnabled.checked = state.lights.directional.castShadow;
        }
    }
}
