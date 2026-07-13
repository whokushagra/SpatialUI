// ===== THREE.JS IMPORTS =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { scheduleRemoteProjectSave, initVoidRemoteSync } from './voidRemoteSync.js';
import { initLoginScene, disposeLoginScene } from './loginScene.js';
import { VOID_TEMPLATES, buildTemplateExport } from './templates.js';
import { isVoidARSupported, startVoidAR, stopVoidAR } from './voidAR.js';

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
    editorStars: null,
    lights: null,
    viewMode: '2d',
    lastFrameSize: { width: 1.2, height: 0.8 },
    grid2d: null,
    controls3DDefaults: null,
    safeZoneVisible: true,
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
    /** 'camera' | 'xr' | null */
    spatialPreviewKind: null,
    spatialPreviewStream: null,
    /** True while “Preview in Space” is open — editor environment (floor, grids) is hidden */
    spatialPreviewMode: false,
    /** Saved .visible flags for environment objects; restored when preview closes */
    spatialPreviewEnvironmentBackup: null,
    /** WebXR runtime data for anchored AR preview */
    spatialXR: null,
    /** Optional environment preset data for design-time contextual preview */
    activeEnvironmentPresetId: null,
    environmentTexture: null,
    environmentLoading: false,
    defaultEditorBackground: null,
    environmentLoadRequestId: 0,
    /** Floor / 2D design grid visibility (synonym for legacy “gridVisible”). */
    floorVisible: false,
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
    editorExperienceInitialized: false,
    /** Drag-link prototype overlay removed (dropdown-only interactions). */
    prototypeLinkDrag: null,
    prototypeHoverRoot: null,
    /** @type {null | { t0: number, duration: number, easing: string, type: string, toGroup: THREE.Object3D, fromGroup: THREE.Object3D | null, fromPos0: THREE.Vector3, toPos0: THREE.Vector3, dFrom: THREE.Vector3, dTo: THREE.Vector3, data: object, targetId: string, phase: 'dual' | 'toOnly' } } */
    prototypeScreenNavJob: null,
    viewModeEnvVisibilityBackup: null,
    _protoNavTmpVec: new THREE.Vector3(),
    /** @type {null | { wrap: HTMLElement, canvas: HTMLCanvasElement, handle: HTMLButtonElement, ctx: CanvasRenderingContext2D, deletes: HTMLElement, dpr: number }} */
    prototypeLinkUI: null
};

/** Frames, UI components that can have prototype navigation + links */
const INTERACTION_VOID_TYPES = new Set(['frame', 'button', 'text', 'image', 'panel']);
const _protoEdgeLocal = new THREE.Vector3();
const _protoProj = new THREE.Vector3();

const THEME_STORAGE_KEY = 'void-theme';

function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
}

function getEditorCanvasHex(mode = state.viewMode) {
    if (mode === '3d') return isDarkTheme() ? '#0d0d0d' : '#e8e8e8';
    return isDarkTheme() ? '#141414' : '#f0f0f0';
}

function addSubtleStarField() {
    if (!state.scene || state.editorStars) return state.editorStars;
    const geometry = new THREE.BufferGeometry();
    const count = 800;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 2] = -50 - Math.random() * 100;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.04,
        transparent: true,
        opacity: 0.18,
        sizeAttenuation: true
    });
    const starField = new THREE.Points(geometry, material);
    starField.userData.isEditorStars = true;
    starField.userData.isEnvironment = true;
    state.scene.add(starField);
    state.editorStars = starField;
    return starField;
}

function updateCanvasColorSwatchUi(hex) {
    const input = document.getElementById('canvas-color-input');
    const swatch = document.getElementById('canvas-color-swatch');
    if (input) input.value = hex;
    if (swatch) swatch.style.backgroundColor = hex;
}

function syncEditorThemeCanvas() {
    const viewport = document.getElementById('viewport-3d');
    const hex = getEditorCanvasHex(state.viewMode);
    updateCanvasColorSwatchUi(hex);
    if (viewport) viewport.style.background = hex;
    if (state.renderer) state.renderer.setClearColor(new THREE.Color(hex), 1);
    if (state.scene && !state.activeEnvironmentPresetId && state.viewMode === '3d') {
        state.scene.background = new THREE.Color(hex);
    }
    if (!state.scene) return;
    if (isDarkTheme()) {
        const stars = addSubtleStarField();
        if (stars) stars.visible = true;
    } else if (state.editorStars) {
        state.editorStars.visible = false;
    }
}

function snapshotEnvironmentVisibilityForViewMode() {
    if (!state.scene) return;
    const backup = [];
    state.scene.traverse((obj) => {
        if (!obj.userData?.isEnvironment) return;
        if (obj.userData?.isEditorStars) return;
        backup.push({ object: obj, visible: obj.visible });
    });
    state.viewModeEnvVisibilityBackup = backup;
}

function forceHideEnvironmentForTwoD() {
    if (!state.scene) return;
    state.scene.traverse((obj) => {
        if (!obj.userData?.isEnvironment) return;
        if (obj.userData?.isEditorStars) return;
        obj.visible = false;
    });
}

function restoreEnvironmentVisibilityForThreeD() {
    const backup = state.viewModeEnvVisibilityBackup;
    if (!backup || !backup.length) return;
    backup.forEach((entry) => {
        if (entry.object) entry.object.visible = entry.visible;
    });
}

function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}

    const toggles = document.querySelectorAll('[data-theme-toggle]');
    const isLight = next === 'light';
    toggles.forEach((btn) => {
        btn.innerHTML = `<i data-lucide="${isLight ? 'moon' : 'sun'}"></i>`;
        btn.setAttribute('aria-label', 'Toggle theme');
        btn.setAttribute('title', 'Toggle theme');
        btn.setAttribute('data-tooltip', 'Toggle theme');
    });
    initializeLucideIcons();
    syncEditorThemeCanvas();
}

function initializeThemeToggle() {
    let preferred = 'dark';
    try {
        preferred =
            localStorage.getItem(THEME_STORAGE_KEY) ||
            (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    } catch {}
    applyTheme(preferred);

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
            applyTheme(current === 'light' ? 'dark' : 'light');
        });
    });
}

function initializeLucideIcons() {
    if (!window.lucide?.createIcons) return;
    window.lucide.createIcons();
}

function pulseViewportModeTransition() {
    const viewport = document.getElementById('viewport-3d');
    if (!viewport) return;
    viewport.classList.remove('mode-switch-pulse');
    void viewport.offsetWidth;
    viewport.classList.add('mode-switch-pulse');
}

function applyGlobalTooltips() {
    const explicit = {
        'spatial-preview-btn': 'Preview in space',
        'prototype-mode-btn': 'Prototype mode',
        'viewport-toggle-grid': 'Toggle floor grid',
        'viewport-toggle-safe': 'Toggle safe zone',
        'btn-view-mode-toggle': state.viewMode === '2d' ? 'Switch to 3D mode' : 'Switch to 2D mode',
        'menu-save-void': 'Save project',
        'menu-export': 'Export project',
        'canvas-color-btn': 'Canvas background color',
        'toolbar-view-mode-2d': 'Switch to 2D mode',
        'toolbar-view-mode-3d': 'Switch to 3D mode',
        'topbar-add-button': 'Add Button component',
        'topbar-add-panel': 'Add Panel component'
    };
    Object.entries(explicit).forEach(([id, label]) => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('data-tooltip', label);
    });

    document.querySelectorAll('.icon-button, .tool-button, .sidebar-tab').forEach((el) => {
        if (!el.getAttribute('data-tooltip')) {
            const label =
                el.getAttribute('title') ||
                el.getAttribute('aria-label') ||
                el.querySelector('.tab-label')?.textContent?.trim() ||
                el.textContent?.trim();
            if (label) el.setAttribute('data-tooltip', label);
        }
    });
}

function initializePropertySectionIcons() {
    const mapping = {
        Spatial: 'move',
        Frame: 'maximize-2',
        Text: 'type',
        Interaction: 'zap',
        Appearance: 'droplet',
        Lighting: 'settings'
    };
    document.querySelectorAll('.property-section-header span').forEach((el) => {
        const key = Object.keys(mapping).find((k) => el.textContent.trim().startsWith(k));
        if (!key || el.dataset.iconApplied === '1') return;
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', mapping[key]);
        icon.className = 'property-header-icon';
        el.prepend(icon);
        el.dataset.iconApplied = '1';
    });
}

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

function isInteractionVoidType(t) {
    return INTERACTION_VOID_TYPES.has(t);
}

function mapLegacyClickAnimationToTransition(clickAnimation) {
    switch (clickAnimation) {
        case 'fadeIn':
            return 'fade';
        case 'scaleUp':
            return 'scaleUp';
        case 'slideIn':
            return 'slideLeft';
        case 'bounce':
            return 'scaleUp';
        case 'none':
        default:
            return 'instant';
    }
}

function ensureInteractionUserData(u) {
    if (!u) return;
    if (u.onClickScreenId === undefined) u.onClickScreenId = '';
    if (!u.transitionType) u.transitionType = 'fade';
    if (u.transitionDuration == null || !Number.isFinite(Number(u.transitionDuration))) u.transitionDuration = 300;
    if (!u.transitionEasing) u.transitionEasing = 'ease-in-out';
    if (u.prototypeLinkTargetUuid === undefined) u.prototypeLinkTargetUuid = '';
    if (u.clickAnimation === undefined) u.clickAnimation = 'none';
}

function applyProtoEasing(t, name) {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    if (name === 'ease-in') return k * k;
    if (name === 'ease-out') return 1 - (1 - k) * (1 - k);
    if (name === 'linear') return k;
    if (k < 0.5) return 2 * k * k;
    return 1 - Math.pow(-2 * k + 2, 2) / 2;
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
        row.innerHTML = `<span class="layer-icon"><i data-lucide="${icon}"></i></span><span class="layer-name">${escapeHtml(obj.name)}</span>`;
        row.dataset.objectUuid = obj.uuid;
        tree.appendChild(row);
    });
    initializeLucideIcons();
    updateViewportEmptyState();
}

function layerIconFor(obj) {
    const t = obj.userData.voidType;
    if (t === 'button') return 'circle-dot';
    if (t === 'panel') return 'rectangle-horizontal';
    if (t === 'text') return 'type';
    if (t === 'image') return 'image';
    if (t === 'frame') return 'square';
    if (obj.userData.isLight) return 'lightbulb';
    return 'box';
}

function updateViewportEmptyState() {
    const empty = document.getElementById('canvas-empty-state');
    if (!empty) return;
    const designItems = state.objects.filter((o) => {
        if (!o?.userData || o.userData.isEnvironment) return false;
        const t = o.userData.voidType;
        return t === 'frame' || t === 'button' || t === 'panel' || t === 'text' || t === 'image';
    });
    empty.classList.toggle('is-visible', designItems.length === 0);
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
    if (!valid && current && isInteractionVoidType(state.selectedObject?.userData?.voidType)) {
        state.selectedObject.userData.onClickScreenId = '';
    }
}

function updateInteractionPanel(object) {
    const section = document.getElementById('interaction-section');
    const content = section?.querySelector('.property-section-content');
    const collapseBtn = section?.querySelector('.collapse-btn');
    const sel = document.getElementById('button-onclick-screen');
    const fields = document.getElementById('interaction-fields');
    const hint = document.getElementById('interaction-hint');
    if (!section) return;

    const u = object?.userData;
    const show = object && isInteractionVoidType(u?.voidType);
    section.style.display = show ? 'block' : 'none';
    if (show && content) {
        content.style.display = 'block';
        if (collapseBtn) collapseBtn.textContent = '−';
    }

    if (!show || !sel) return;
    ensureInteractionUserData(u);
    populateButtonLinkDropdown();
    sel.value = u.onClickScreenId || '';

    const dur = document.getElementById('proto-transition-duration');
    const typ = document.getElementById('proto-transition-type');
    const eas = document.getElementById('proto-transition-easing');
    const leg = document.getElementById('button-click-animation');
    const rem = document.getElementById('btn-remove-proto-link');

    if (typ) typ.value = u.transitionType || 'fade';
    if (dur) dur.value = String(u.transitionDuration ?? 300);
    if (eas) eas.value = u.transitionEasing || 'ease-in-out';
    if (leg) leg.value = u.clickAnimation || 'none';

    const linked = !!(u.onClickScreenId && u.onClickScreenId.length);
    if (fields) fields.classList.toggle('is-muted', !linked);
    if (hint) hint.style.display = linked ? 'none' : 'block';
    if (rem) rem.style.display = linked ? 'block' : 'none';
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
    state.scene.background = new THREE.Color(getEditorCanvasHex());
    state.defaultEditorBackground = state.scene.background;

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
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 1.0;
    state.renderer.outputColorSpace = THREE.SRGBColorSpace;
    state.renderer.setClearColor(new THREE.Color(getEditorCanvasHex()), 1);
    viewportElement.appendChild(state.renderer.domElement);
    viewportElement.style.background = getEditorCanvasHex();

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
        scheduleRemoteProjectSave();
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
    if (isDarkTheme()) addSubtleStarField();

    // Add Safe Zone
    createSafeZone();

    ensureDefaultScreen();

    applyFloorVisibility();

    // Drag-to-connect overlay removed; dropdown interaction system only.

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
function styleMainViewportGrid(gridHelper) {
    if (!gridHelper || !gridHelper.material) return;
    const mats = Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material];
    if (mats[0]) {
        mats[0].color.set(0x333333);
        mats[0].transparent = true;
        mats[0].opacity = 0.6;
    }
    if (mats[1]) {
        mats[1].color.set(0x222222);
        mats[1].transparent = true;
        mats[1].opacity = 0.4;
    }
}

function createGrid() {
    const gridHelper = new THREE.GridHelper(20, 20, 0x333333, 0x222222);
    gridHelper.name = 'mainGrid';
    gridHelper.visible = false;
    styleMainViewportGrid(gridHelper);
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
    return;
}

// ===== FIRST-TIME TUTORIAL (spotlight overlay) =====
const tutorialSteps = [
    {
        step: 1,
        title: 'Add your first button',
        description:
            "Click 'Assets' in the left panel, then click the Button component to add it to your canvas.",
        targetSelector: "[data-tab='assets']",
        cardPosition: 'right'
    },
    {
        step: 2,
        title: 'Change the button color',
        description:
            "With the button selected, look at the Properties panel on the right. Find the color swatch and click it to change the button's background color.",
        targetSelector: '#properties-panel',
        cardPosition: 'left'
    },
    {
        step: 3,
        title: 'Add a second screen',
        description:
            "Click the 'Screens' tab in the left panel. Then click the '+' button to add a new screen. This will be the screen your button navigates to.",
        targetSelector: "[data-tab='screens']",
        cardPosition: 'right'
    },
    {
        step: 4,
        title: 'Add a frame to Screen 2',
        description:
            'With Screen 2 active, click the Frame tool in the toolbar below, then click and drag on the canvas to draw a frame. This represents your second UI screen.',
        targetSelector: '#floating-toolbar',
        cardPosition: 'top'
    },
    {
        step: 5,
        title: 'Add a text label',
        description:
            "Click the Text tool (T) in the toolbar, then click inside your frame to add a text element. Type something like 'Screen 2' so you can identify it.",
        targetSelector: '#tool-text',
        cardPosition: 'top'
    },
    {
        step: 6,
        title: 'Link your button to Screen 2',
        description:
            "Go back to Screen 1 and select your button. In the Properties panel on the right, scroll to 'Interaction' and choose Screen 2 from the 'On Click → Go To Screen' dropdown.",
        targetSelector: '#interaction-section',
        cardPosition: 'left'
    },
    {
        step: 7,
        title: 'Set the animation style',
        description:
            "Still in the Interaction section, choose an animation type like 'Fade' or 'Slide Left'. Then set a duration — 300ms is a good starting point.",
        targetSelector: '#interaction-section',
        cardPosition: 'left'
    },
    {
        step: 8,
        title: 'Switch to Prototype mode',
        description:
            "Click 'Prototype Mode' in the top bar. Now click your button on the canvas — it should navigate to Screen 2! Click the back arrow to return.",
        targetSelector: '#prototype-mode-btn',
        cardPosition: 'bottom'
    },
    {
        step: 9,
        title: 'Preview in an environment',
        description:
            "Click the 'Environ' tab on the left. Select a preset like 'Minimal Studio' to see your UI floating in a real space. You can orbit the camera to look around.",
        targetSelector: "[data-tab='environments']",
        cardPosition: 'right'
    },
    {
        step: 10,
        title: 'Preview with your camera',
        description:
            'Click the camera icon in the top bar to open the live spatial preview. Your UI will appear overlaid on your real space. Move your mouse to feel the depth.',
        targetSelector: '#spatial-preview-btn',
        cardPosition: 'bottom'
    }
];

let tutorialRuntime = null;

function teardownTutorial() {
    if (tutorialRuntime?.onResize) window.removeEventListener('resize', tutorialRuntime.onResize);
    tutorialRuntime?.overlay?.remove();
    tutorialRuntime = null;
    document.querySelectorAll('.tutorial-done-modal').forEach((el) => el.remove());
}

function computeTutorialSpotlight(rect) {
    const pad = 32;
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const ew = Math.max(rect ? rect.width + pad : 200, 120);
    const eh = Math.max(rect ? rect.height + pad : 120, 100);
    const rInner = Math.min(Math.hypot(ew, eh) * 0.38, Math.min(ew, eh) * 0.45);
    return {
        bg: `radial-gradient(ellipse ${ew}px ${eh}px at ${cx}px ${cy}px, transparent 0%, transparent ${rInner}px, rgba(0,0,0,0.78) ${rInner + 40}px)`,
        cx,
        cy
    };
}

function positionTutorialCard(card, step, rect) {
    const w = 280;
    const margin = 16;
    card.style.position = 'absolute';
    card.style.width = `${w}px`;

    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

    if (step.cardPosition === 'right') {
        card.style.left = `${Math.min(rect ? rect.right + margin : cx + margin, window.innerWidth - w - margin)}px`;
        card.style.top = `${Math.max(margin, (rect ? rect.top : cy) - 20)}px`;
        card.style.right = 'auto';
        card.style.bottom = 'auto';
    } else if (step.cardPosition === 'left') {
        card.style.left = `${Math.max(margin, (rect ? rect.left : cx) - w - margin)}px`;
        card.style.top = `${Math.max(margin, (rect ? rect.top : cy) - 20)}px`;
        card.style.right = 'auto';
        card.style.bottom = 'auto';
    } else if (step.cardPosition === 'top') {
        const left = rect
            ? rect.left + rect.width / 2 - w / 2
            : cx - w / 2;
        card.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - w - margin))}px`;
        card.style.top = `${Math.max(margin, (rect ? rect.top : cy - 120) - margin - 140)}px`;
        card.style.bottom = 'auto';
    } else {
        const bot = rect ? rect.bottom + margin : cy + margin;
        const left = rect ? rect.left + rect.width / 2 - w / 2 : cx - w / 2;
        card.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - w - margin))}px`;
        card.style.top = `${Math.min(window.innerHeight - margin - 200, bot)}px`;
        card.style.bottom = 'auto';
    }
}

function showTutorialCompletionModal(onDone) {
    const wrap = document.createElement('div');
    wrap.className = 'tutorial-done-modal';
    wrap.id = 'tutorial-completion-overlay';
    wrap.innerHTML = `
        <div class="tutorial-done-card">
            <i data-lucide="check-circle-2"></i>
            <h3>You're ready to design!</h3>
            <p>You've completed the Void tutorial.<br/>Start building your first XR interface.</p>
            <button type="button" class="tutorial-done-btn" id="tutorial-done-dismiss">Start designing →</button>
        </div>
    `;
    document.body.appendChild(wrap);
    wrap.querySelector('#tutorial-done-dismiss')?.addEventListener('click', () => {
        wrap.remove();
        onDone();
    });
    initializeLucideIcons();
}

function tutorialRenderStep(idx) {
    if (!tutorialRuntime) return;
    const step = tutorialSteps[idx];
    if (!step) return;

    tutorialRuntime.overlay.querySelector('[data-tutorial-step-label]').textContent = `STEP ${step.step} OF ${tutorialSteps.length}`;
    tutorialRuntime.overlay.querySelector('[data-tutorial-title]').textContent = step.title;
    tutorialRuntime.overlay.querySelector('[data-tutorial-desc]').textContent = step.description;

    const btn = tutorialRuntime.overlay.querySelector('[data-tutorial-next]');
    btn.textContent = idx >= tutorialSteps.length - 1 ? 'Finish →' : 'Next →';

    let el = null;
    try {
        el = document.querySelector(step.targetSelector);
    } catch (_) {
        el = null;
    }
    let rect = el ? el.getBoundingClientRect() : null;
    if (el && rect && (rect.width < 4 || rect.height < 4)) rect = null;
    if (!rect) rect = null;

    const spot = computeTutorialSpotlight(rect);
    const veil = tutorialRuntime.overlay.querySelector('.tutorial-veil');
    if (veil) {
        veil.style.transition = 'background 400ms ease';
        veil.style.background = spot.bg;
    }

    positionTutorialCard(tutorialRuntime.card, step, rect);
}

function skipTutorialUi() {
    teardownTutorial();
    showNotification('Tutorial skipped — you can restart it from Help menu');
}

function initTutorial() {
    if (tutorialRuntime) teardownTutorial();
    if (state.appPhase !== 'editor' || document.getElementById('tutorial-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
        <div class="tutorial-veil" aria-hidden="true"></div>
        <div class="tutorial-modal-card">
            <p class="tutorial-step-label" data-tutorial-step-label>STEP 1 OF 10</p>
            <h4 class="tutorial-card-title" data-tutorial-title>Add your first button</h4>
            <p class="tutorial-card-desc" data-tutorial-desc>Description.</p>
            <div class="tutorial-card-actions">
                <button type="button" class="tutorial-skip-btn" data-tutorial-skip>Skip tutorial</button>
                <button type="button" class="tutorial-next-btn" data-tutorial-next>Next →</button>
            </div>
        </div>
    `;

    overlay.style.cssText =
        'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;pointer-events:auto;transition:opacity 280ms ease;';
    overlay.querySelector('.tutorial-veil').style.cssText =
        'position:absolute;inset:0;background:rgba(0,0,0,0.75);pointer-events:auto;';

    const card = overlay.querySelector('.tutorial-modal-card');

    overlay.querySelector('[data-tutorial-skip]')?.addEventListener('click', skipTutorialUi);

    overlay.querySelector('[data-tutorial-next]')?.addEventListener('click', () => {
        if (!tutorialRuntime) return;
        const idx = tutorialRuntime.index;
        if (idx >= tutorialSteps.length - 1) {
            overlay.style.opacity = '0';
            const ov = overlay;
            if (tutorialRuntime.onResize) window.removeEventListener('resize', tutorialRuntime.onResize);
            tutorialRuntime = null;
            setTimeout(() => {
                ov.remove();
                showTutorialCompletionModal(() => {});
            }, 280);
            return;
        }
        tutorialRuntime.index = idx + 1;
        tutorialRenderStep(tutorialRuntime.index);
    });

    document.body.appendChild(overlay);

    tutorialRuntime = {
        overlay,
        card,
        index: 0,
        onResize: () => tutorialRenderStep(tutorialRuntime?.index ?? 0)
    };
    window.addEventListener('resize', tutorialRuntime.onResize);

    tutorialRenderStep(0);
    initializeLucideIcons();
}

let tutorialIntroTimeoutId = null;

/** Show tutorial after every navigation into the editor (no localStorage “seen” flag). */
function scheduleEditorTutorialOnce() {
    // No tutorial in the phone viewer — it's a clean, chrome-free prototype player.
    if (document.body.classList.contains('void-mobile-viewer')) return;
    if (tutorialIntroTimeoutId) clearTimeout(tutorialIntroTimeoutId);
    tutorialIntroTimeoutId = setTimeout(() => {
        tutorialIntroTimeoutId = null;
        if (state.appPhase !== 'editor' || !state.editorExperienceInitialized) return;
        if (document.getElementById('tutorial-overlay')) return;
        initTutorial();
    }, 1500);
}

let topNavStarRafId = null;
let topNavStarResizeBound = false;

function stopTopNavStarfield() {
    if (topNavStarRafId != null) {
        cancelAnimationFrame(topNavStarRafId);
        topNavStarRafId = null;
    }
}

function initTopNavStarfield() {
    const canvas = document.getElementById('top-nav-stars-canvas');
    const nav = document.getElementById('app-top-nav');
    if (!canvas || !nav) return;
    stopTopNavStarfield();

    const dpr = window.devicePixelRatio || 1;

    function syncSize() {
        const r = nav.getBoundingClientRect();
        const ww = Math.max(1, Math.floor(r.width * dpr));
        const hh = Math.max(1, Math.floor(r.height * dpr));
        canvas.width = ww;
        canvas.height = hh;
    }

    let nw = nav.clientWidth;
    let nh = nav.clientHeight || 44;
    const stars = Array.from({ length: 60 }, () => ({
        x: Math.random() * Math.max(nw, 88),
        y: Math.random() * Math.max(nh, 20),
        r: (0.5 + Math.random() * 1) * dpr,
        a: 0.3 + Math.random() * 0.4,
        vx: 0.05 + Math.random() * 0.1
    }));

    /** @type {{ x: number; y: number; vx: number; vy: number; len: number; ageMs: number; born: number }[]} */
    const shots = [];

    let prev = performance.now();
    let shootAfter = prev + 4000 + Math.random() * 4000;

    if (!topNavStarResizeBound) {
        window.addEventListener('resize', syncSize);
        topNavStarResizeBound = true;
    }

    function frame(now) {
        syncSize();
        const ctx = canvas.getContext('2d');
        nw = nav.clientWidth;
        nh = nav.clientHeight || 1;
        const cw = canvas.width;
        const ch = canvas.height;
        topNavStarRafId = requestAnimationFrame(frame);
        if (nav.hidden || !ctx || nw < 8) return;

        const dt = Math.min(48, now - prev);
        prev = now;
        const sx = cw / nw;
        const sy = ch / nh;

        ctx.clearRect(0, 0, cw, ch);

        for (let i = 0; i < stars.length; i++) {
            const s = stars[i];
            s.x += s.vx * (dt / 16.67);
            if (s.x > nw + 5) s.x = -10;
            if (s.y > nh || s.y < 0) s.y = Math.random() * nh;
            ctx.fillStyle = `rgba(255,255,255,${s.a})`;
            ctx.beginPath();
            ctx.arc(s.x * sx, s.y * sy, s.r, 0, Math.PI * 2);
            ctx.fill();
        }

        if (now > shootAfter && shots.length < 3) {
            shots.push({
                x: -(20 + Math.random() * 40),
                y: Math.random() * nh * 0.6,
                vx: (2 + Math.random() * 2) * (dt / 16.67),
                vy: (0.55 + Math.random() * 0.45) * (dt / 16.67),
                len: 15 + Math.random() * 15,
                ageMs: 0,
                born: now
            });
            shootAfter = now + 4000 + Math.random() * 4000;
        }

        const alive = [];
        for (let j = 0; j < shots.length; j++) {
            const t = shots[j];
            t.ageMs = now - t.born;
            t.x += t.vx * (dt / 16.67);
            t.y += t.vy * (dt / 16.67);

            let alpha = 0;
            const fadeOutStart = Math.max(t.len * 6, 180);
            if (t.ageMs < 180) alpha = (t.ageMs / 180) * 0.65;
            else if (t.ageMs > fadeOutStart) alpha = (1 - (t.ageMs - fadeOutStart) / 300) * 0.65;
            else alpha = 0.65;

            alpha = Math.max(0, Math.min(0.7, alpha));
            if (alpha < 0.02 || t.x > nw + 80) continue;

            const x1 = t.x * sx;
            const y1 = t.y * sy;
            const x2 = (t.x + t.len * 1.05) * sx;
            const y2 = (t.y + t.len * 0.52) * sy;
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            ctx.lineWidth = dpr * 0.9;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            alive.push(t);
        }
        shots.length = 0;
        for (let k = 0; k < alive.length; k++) shots.push(alive[k]);
    }

    topNavStarRafId = requestAnimationFrame(frame);
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
 * Prototype / Play Mode navigation (planar UI with interaction).
 * Called from 3D click raycast and from 2D/preview pointerup with the same root as pointerdown.
 */
function runPrototypeNavigation(root) {
    if (!root || !isInteractionVoidType(root.userData?.voidType)) return;
    const u = root.userData;
    ensureInteractionUserData(u);
    const linkId = u.onClickScreenId;
    if (!linkId) {
        showNotification('No linked screen — set “On Click → Go to Screen” or connect in Prototype mode');
        return;
    }
    const target = state.screens.find((s) => s.id === linkId);
    if (!target) {
        showNotification('Linked screen not found');
        return;
    }
    const fromId = state.activeScreenId;
    playPrototypeScreenTransition(root, fromId, target, u);
}

/** @deprecated use runPrototypeNavigation */
function runPrototypeButtonNavigation(root) {
    runPrototypeNavigation(root);
}

function setTwoScreensVisibleForNav(fromId, toId) {
    const allow = new Set([fromId, toId]);
    state.screens.forEach((s) => {
        s.group.visible = allow.has(s.id);
    });
    state.objects.forEach((o) => {
        if (o.userData?.voidType === 'frame' && o.userData?.anchor && o.userData.anchor !== 'world') {
            o.visible = allow.has(o.userData.screenId);
        }
    });
}

function playPrototypeScreenTransition(_sourceRoot, fromId, targetRec, u) {
    const toId = targetRec.id;
    const name = targetRec.name;
    state.activeClickAnimation = null;

    const type = u.transitionType || 'instant';
    const duration = Math.max(0, u.transitionDuration ?? 300);
    const easing = u.transitionEasing || 'ease-in-out';
    const legacy = u.clickAnimation || 'none';

    if (type === 'instant') {
        switchToScreen(toId, { silent: true });
        showNotification(`Prototype → ${name}`);
        if (legacy && legacy !== 'none') {
            playButtonClickAnimation(_sourceRoot, targetRec.group, legacy);
        }
        return;
    }

    if (type === 'slideLeft' || type === 'slideRight') {
        const fromRec = state.screens.find((s) => s.id === fromId);
        if (!fromRec || fromId === toId) {
            switchToScreen(toId, { silent: true });
            showNotification(`Prototype → ${name}`);
            return;
        }
        const W = 3.2;
        const toG = targetRec.group;
        const fromG = fromRec.group;
        toG.updateMatrixWorld(true);
        fromG.updateMatrixWorld(true);
        const f0x = fromG.position.x;
        const t0x = toG.position.x;
        setTwoScreensVisibleForNav(fromId, toId);
        state.prototypeScreenNavJob = {
            kind: 'slide',
            t0: performance.now(),
            duration: Math.max(1, duration),
            easing,
            fromG,
            toG,
            fromId,
            toId,
            w: W,
            mode: type === 'slideLeft' ? 'left' : 'right',
            f0x,
            t0x
        };
        if (type === 'slideLeft') {
            toG.position.x = t0x + W;
        } else {
            toG.position.x = t0x - W;
        }
        fromG.position.x = f0x;
        showNotification(`Prototype → ${name}`);
        return;
    }

    switchToScreen(toId, { silent: true });
    showNotification(`Prototype → ${name}`);

    if (type === 'fade') {
        const toG = targetRec.group;
        const opac = [];
        toG.traverse((ch) => {
            if (ch.isMesh && ch.material) {
                const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                mats.forEach((m) => {
                    m.transparent = true;
                    const end = m.opacity !== undefined ? m.opacity : 1;
                    opac.push({ mat: m, end: Math.min(1, end) });
                    m.opacity = 0;
                });
            }
        });
        state.prototypeScreenNavJob = {
            kind: 'fade',
            t0: performance.now(),
            duration: Math.max(1, duration),
            easing,
            toG: targetRec.group,
            opac,
            toId
        };
        return;
    }

    if (type === 'scaleUp' || type === 'scaleDown') {
        const toG = targetRec.group;
        const s0 = type === 'scaleUp' ? 0.95 : 1.05;
        const data = { sx: toG.scale.x, sy: toG.scale.y, sz: toG.scale.z, s0 };
        toG.scale.set(s0 * data.sx, s0 * data.sy, s0 * data.sz);
        const opac = [];
        toG.traverse((ch) => {
            if (ch.isMesh && ch.material) {
                const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                mats.forEach((m) => {
                    m.transparent = true;
                    const end = m.opacity !== undefined ? m.opacity : 1;
                    opac.push({ mat: m, end: Math.min(1, end) });
                    m.opacity = 0;
                });
            }
        });
        state.prototypeScreenNavJob = {
            kind: 'scale',
            t0: performance.now(),
            duration: Math.max(1, duration),
            easing,
            toG: targetRec.group,
            toId,
            data,
            opac,
            scaleMode: type
        };
    }
}

function updatePrototypeScreenNavJob() {
    const job = state.prototypeScreenNavJob;
    if (!job) return;
    const now = performance.now();
    const t = Math.min(1, (now - job.t0) / (job.duration || 300));
    const k = applyProtoEasing(t, job.easing || 'ease-in-out');

    if (job.kind === 'slide' && job.fromG && job.toG) {
        const W = job.w;
        if (job.mode === 'left') {
            job.fromG.position.x = THREE.MathUtils.lerp(job.f0x, job.f0x - W, k);
            job.toG.position.x = THREE.MathUtils.lerp(job.t0x + W, job.t0x, k);
        } else {
            job.fromG.position.x = THREE.MathUtils.lerp(job.f0x, job.f0x + W, k);
            job.toG.position.x = THREE.MathUtils.lerp(job.t0x - W, job.t0x, k);
        }
    } else if (job.kind === 'fade' && job.opac) {
        job.opac.forEach(({ mat, end }) => {
            mat.opacity = THREE.MathUtils.lerp(0, end, k);
        });
    } else if (job.kind === 'scale' && job.toG && job.data) {
        const { sx, sy, sz, s0 } = job.data;
        const s = THREE.MathUtils.lerp(s0, 1, k);
        job.toG.scale.set(s * sx, s * sy, s * sz);
        if (job.opac) {
            job.opac.forEach(({ mat, end }) => {
                mat.opacity = THREE.MathUtils.lerp(0, end, k);
            });
        }
    }

    if (t >= 1) {
        if (job.kind === 'slide' && job.toId) {
            if (job.fromG) job.fromG.position.x = job.f0x;
            if (job.toG) job.toG.position.x = job.t0x;
            switchToScreen(job.toId, { silent: true });
        } else if (job.kind === 'fade' && job.opac) {
            job.opac.forEach(({ mat, end }) => {
                mat.opacity = end;
            });
        } else if (job.kind === 'scale' && job.toG && job.data) {
            const { sx, sy, sz } = job.data;
            job.toG.scale.set(sx, sy, sz);
            if (job.opac) {
                job.opac.forEach(({ mat, end }) => {
                    mat.opacity = end;
                });
            }
        }
        state.prototypeScreenNavJob = null;
    }
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
        if (root && isInteractionVoidType(root.userData?.voidType)) {
            runPrototypeNavigation(root);
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

    // Prototype: defer interaction tap to pointerup (tap vs drag to move).
    if (state.editorMode === 'prototype' && isInteractionVoidType(root.userData.voidType)) {
        state.planarPointerDrag = {
            kind: 'prototypeTap',
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

    if (drag.kind === 'prototypeTap') {
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

    if (drag.kind === 'prototypeTap') {
        if (!drag.moved && drag.root) {
            runPrototypeNavigation(drag.root);
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
    updateImagePropertyPanel(object);

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

// ===== Modern spatial-UI polish helpers (rounded corners, glass, art, text) =====
function roundedRectShape(w, h, r) {
    const radius = Math.max(0.0001, Math.min(r, w / 2, h / 2));
    const x = -w / 2;
    const y = -h / 2;
    const s = new THREE.Shape();
    s.moveTo(x + radius, y);
    s.lineTo(x + w - radius, y);
    s.quadraticCurveTo(x + w, y, x + w, y + radius);
    s.lineTo(x + w, y + h - radius);
    s.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    s.lineTo(x + radius, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - radius);
    s.lineTo(x, y + radius);
    s.quadraticCurveTo(x, y, x + radius, y);
    s.closePath();
    return s;
}

function roundedRectGeometry(w, h, r) {
    const g = new THREE.ShapeGeometry(roundedRectShape(w, h, r), 16);
    // ShapeGeometry sets UVs to raw vertex coords; remap to 0..1 across the box so
    // textures (procedural art / images) map correctly onto rounded planes.
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
        uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
    }
    uv.needsUpdate = true;
    return g;
}

function roundedRectLineGeometry(w, h, r) {
    const pts = roundedRectShape(w, h, r).getPoints(96);
    return new THREE.BufferGeometry().setFromPoints(pts);
}

// Text canvas resolution scaled to the element's real size, so a given fontSize maps
// to a CONSISTENT world height on every element (titles, buttons, tiny pills alike).
const TEXT_PPU = 1150;
function textCanvasDims(wWorld, hWorld, lines = 1) {
    return {
        wPx: Math.min(2048, Math.max(64, Math.round(wWorld * TEXT_PPU))),
        hPx: Math.min(2048, Math.max(48, Math.round(hWorld * TEXT_PPU * lines)))
    };
}

function glassPanelMaterial(color, opacity = 0.9) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        metalness: 0.0,
        roughness: 0.6,
        transparent: true,
        opacity,
        side: THREE.DoubleSide
    });
}

/** Soft drop-shadow plane placed slightly behind a card for floating depth. */
function makeSoftShadowMesh(w, h, r) {
    const pad = 0.12;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(128, 132, 20, 128, 132, 128);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w + pad * 2, h + pad * 2),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.position.set(0, -0.02, -0.012);
    mesh.renderOrder = -1;
    return mesh;
}

/**
 * Canvas text texture with alignment, multi-line, and weight control. Returns
 * { texture, aspect } so callers can size the plane to the text without stretching.
 */
function makeRichTextTexture(opts = {}) {
    const text = opts.text == null ? '' : String(opts.text);
    const align = opts.align || 'center';
    const weight = opts.weight || '600';
    const color = opts.color || '#ffffff';
    const fontSize = opts.fontSize || 64;
    const lineHeight = opts.lineHeight || 1.2;
    const font = opts.font || 'Inter, system-ui, -apple-system, sans-serif';
    const wPx = opts.wPx || 1024;
    const hPx = opts.hPx || 256;
    const padX = opts.padX != null ? opts.padX : 16;

    const canvas = document.createElement('canvas');
    canvas.width = wPx;
    canvas.height = hPx;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = `${weight} ${fontSize}px ${font}`;
    ctx.textBaseline = 'middle';

    const lines = text.split('\n');
    const lh = fontSize * lineHeight;
    const totalH = lh * lines.length;
    let y = hPx / 2 - totalH / 2 + lh / 2;
    for (const ln of lines) {
        let x;
        if (align === 'left') {
            ctx.textAlign = 'left';
            x = padX;
        } else if (align === 'right') {
            ctx.textAlign = 'right';
            x = wPx - padX;
        } else {
            ctx.textAlign = 'center';
            x = wPx / 2;
        }
        ctx.fillText(ln, x, y);
        y += lh;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
}

/** Procedural, offline, poster-style artwork for image components. */
function makeArtTexture(kind = 'gradient', accent = '#4f46e5', wPx = 1024, hPx = 640) {
    const canvas = document.createElement('canvas');
    canvas.width = wPx;
    canvas.height = hPx;
    const ctx = canvas.getContext('2d');
    const A = new THREE.Color(accent);
    const shade = (mult) => {
        const c = A.clone();
        c.r = Math.min(1, c.r * mult);
        c.g = Math.min(1, c.g * mult);
        c.b = Math.min(1, c.b * mult);
        return `#${c.getHexString()}`;
    };

    if (kind === 'landscape' || kind === 'map') {
        const sky = ctx.createLinearGradient(0, 0, 0, hPx);
        sky.addColorStop(0, '#1a2740');
        sky.addColorStop(0.55, shade(0.7));
        sky.addColorStop(1, shade(1.1));
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, wPx, hPx);
        // soft sun glow
        const sun = ctx.createRadialGradient(wPx * 0.74, hPx * 0.3, 8, wPx * 0.74, hPx * 0.3, hPx * 0.5);
        sun.addColorStop(0, 'rgba(255,240,210,0.85)');
        sun.addColorStop(1, 'rgba(255,240,210,0)');
        ctx.fillStyle = sun;
        ctx.fillRect(0, 0, wPx, hPx);
        // layered mountain ridges
        const ridge = (baseY, amp, col) => {
            ctx.beginPath();
            ctx.moveTo(0, hPx);
            for (let x = 0; x <= wPx; x += wPx / 8) {
                const yy = baseY + Math.sin(x / wPx * Math.PI * 2) * amp - (x % (wPx / 3)) * 0.04;
                ctx.lineTo(x, yy);
            }
            ctx.lineTo(wPx, hPx);
            ctx.closePath();
            ctx.fillStyle = col;
            ctx.fill();
        };
        ridge(hPx * 0.52, 36, shade(0.5));
        ridge(hPx * 0.66, 30, shade(0.4));
        ridge(hPx * 0.8, 22, shade(0.3));
        if (kind === 'map') {
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = Math.max(6, wPx / 120);
            ctx.lineCap = 'round';
            ctx.setLineDash([wPx / 40, wPx / 60]);
            ctx.beginPath();
            ctx.moveTo(wPx * 0.15, hPx * 0.85);
            ctx.bezierCurveTo(wPx * 0.4, hPx * 0.6, wPx * 0.55, hPx * 0.75, wPx * 0.85, hPx * 0.4);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    } else if (kind === 'product') {
        const bg = ctx.createLinearGradient(0, 0, wPx, hPx);
        bg.addColorStop(0, shade(0.5));
        bg.addColorStop(1, '#0b0f1a');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, wPx, hPx);
        const glow = ctx.createRadialGradient(wPx / 2, hPx * 0.46, 10, wPx / 2, hPx * 0.46, hPx * 0.55);
        glow.addColorStop(0, shade(1.2));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, wPx, hPx);
        ctx.globalAlpha = 1;
        // simple device silhouette (rounded headphone-ish ring)
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = wPx / 26;
        ctx.beginPath();
        ctx.arc(wPx / 2, hPx * 0.52, hPx * 0.26, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
        ctx.lineCap = 'round';
        ctx.lineWidth = wPx / 16;
        [-1, 1].forEach((s) => {
            ctx.beginPath();
            ctx.moveTo(wPx / 2 + s * hPx * 0.25, hPx * 0.5);
            ctx.lineTo(wPx / 2 + s * hPx * 0.25, hPx * 0.66);
            ctx.stroke();
        });
        // floor reflection
        const refl = ctx.createRadialGradient(wPx / 2, hPx * 0.92, 4, wPx / 2, hPx * 0.92, wPx * 0.3);
        refl.addColorStop(0, 'rgba(255,255,255,0.18)');
        refl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = refl;
        ctx.fillRect(0, hPx * 0.7, wPx, hPx * 0.3);
    } else if (kind === 'avatar') {
        const bg = ctx.createLinearGradient(0, 0, wPx, hPx);
        bg.addColorStop(0, shade(1.05));
        bg.addColorStop(1, shade(0.55));
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, wPx, hPx);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.arc(wPx / 2, hPx * 0.4, Math.min(wPx, hPx) * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(wPx / 2, hPx * 1.02, Math.min(wPx, hPx) * 0.36, Math.PI, 0);
        ctx.fill();
    } else {
        // 'calm' / 'gradient' — dark dawn gradient with a glowing orb + breathing rings.
        const bg = ctx.createLinearGradient(0, 0, 0, hPx);
        bg.addColorStop(0, '#0a1020');
        bg.addColorStop(0.5, shade(0.45));
        bg.addColorStop(1, shade(0.9));
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, wPx, hPx);
        const ox = wPx * 0.5;
        const oy = hPx * 0.6;
        // concentric breathing rings
        ctx.lineWidth = Math.max(2, wPx / 360);
        for (let i = 5; i >= 1; i--) {
            ctx.beginPath();
            ctx.arc(ox, oy, hPx * 0.12 * i, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,255,255,${0.05 + i * 0.012})`;
            ctx.stroke();
        }
        // glowing orb
        const orb = ctx.createRadialGradient(ox, oy, 2, ox, oy, hPx * 0.28);
        orb.addColorStop(0, '#ffffff');
        orb.addColorStop(0.25, shade(1.25));
        orb.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = orb;
        ctx.fillRect(0, 0, wPx, hPx);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
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
        object.position.set(0, 0, state.viewMode === '2d' ? 0 : 0.04);
        object.rotation.set(0, 0, 0);
        frame.add(object);
        clampObjectToParentFrame(object);
    } else {
        if (state.viewMode === '2d') {
            object.position.set(0, 0, 0);
            object.rotation.set(0, 0, 0);
        } else if (defaultSpatial) {
            applySpatialToObject(object, defaultSpatial);
        }
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

    ensureInteractionUserData(group.userData);
    state.lastFrameSize = { width, height };

    if (state.viewMode === '2d') {
        group.position.set(0, 0, 0);
        group.rotation.set(0, 0, 0);
    } else {
        applySpatialToObject(group, { distance: 2.2, side: 0, height: 1.2, facingDeg: 0 });
    }
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
    ensureInteractionUserData(group.userData);

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
    ensureInteractionUserData(group.userData);

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
    ensureInteractionUserData(group.userData);

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
    ensureInteractionUserData(group.userData);
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
    group.userData._imagePlateMesh = frame;
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
    queueMicrotask(() => openImageFilePicker(group));
    showNotification('Added image placeholder — choose a file');
    return group;
}

function getImagePlateMesh(obj) {
    if (!obj || obj.userData?.voidType !== 'image') return null;
    if (obj.userData._imagePlateMesh) return obj.userData._imagePlateMesh;
    const found = obj.children.find((c) => c.isMesh && c.geometry?.type === 'PlaneGeometry');
    if (found) obj.userData._imagePlateMesh = found;
    return found || null;
}

function applyImageToComponent(obj, dataUrl) {
    const mesh = getImagePlateMesh(obj);
    if (!mesh?.material) return;
    const prev = mesh.material.map;
    const tl = new THREE.TextureLoader();
    tl.load(dataUrl, (texture) => {
        if (prev) prev.dispose();
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        mesh.material.map = texture;
        mesh.material.color.setHex(0xffffff);
        mesh.material.transparent = false;
        mesh.material.needsUpdate = true;
        showNotification('Image applied');
        refreshLayersPanel();
    });
}

function openImageFilePicker(forObject = state.selectedObject) {
    const target = forObject?.userData?.voidType === 'image' ? forObject : state.selectedObject;
    if (!target || target.userData?.voidType !== 'image') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener(
        'change',
        () => {
            const file = input.files && input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => applyImageToComponent(target, /** @type {string} */ (ev.target.result));
                reader.readAsDataURL(file);
            }
            input.remove();
        },
        { once: true }
    );
    input.click();
}

function updateImagePropertyPanel(object) {
    const grp = document.getElementById('image-source-group');
    if (!grp) return;
    grp.style.display = object?.userData?.voidType === 'image' ? 'block' : 'none';
}

// ===== DELETE OBJECT =====
function disposeObject3D(object) {
    object.traverse((child) => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach((m) => {
                    if (m.map) m.map.dispose();
                    m.dispose();
                });
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
const _protoLineEnd = new THREE.Vector3();

function findObjectByUuidInProject(uuid) {
    if (!uuid) return null;
    for (let i = 0; i < state.objects.length; i++) {
        if (state.objects[i].uuid === uuid) return state.objects[i];
    }
    return null;
}

function getPlanarLinkWorldPoint(root, side) {
    if (!root) return null;
    const t = root.userData.voidType;
    let hx;
    let hy;
    const z = 0.02;
    if (t === 'frame') {
        hx = (root.userData.frameWidth || 1) * 0.5;
        hy = (root.userData.frameHeight || 1) * 0.5;
    } else {
        const ph = root.userData.planarBaseHalf;
        if (!ph) {
            root.getWorldPosition(_protoLineEnd);
            return _protoLineEnd.clone();
        }
        hx = ph.x;
        hy = ph.y;
    }
    if (side === 'right') {
        _protoEdgeLocal.set(hx, 0, z);
    } else if (side === 'left') {
        _protoEdgeLocal.set(-hx, 0, z);
    } else {
        return null;
    }
    _protoEdgeLocal.applyMatrix4(root.matrixWorld);
    return _protoEdgeLocal.clone();
}

function resolveProtoLineEndForScreenLink(obj, targetScreen) {
    const uuid = obj.userData.prototypeLinkTargetUuid;
    if (uuid) {
        const t = findObjectByUuidInProject(uuid);
        if (t && isInteractionVoidType(t.userData.voidType)) {
            const p = getPlanarLinkWorldPoint(t, 'left');
            if (p) return p;
        }
    }
    _protoLinkBox.setFromObject(targetScreen.group);
    if (_protoLinkBox.isEmpty()) {
        return null;
    }
    const min = _protoLinkBox.min;
    const max = _protoLinkBox.max;
    return new THREE.Vector3(min.x, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5);
}

function updatePrototypeLinkLines() {
    const g = state.prototypeLinksGroup;
    if (!g || !state.scene) return;

    // Link lines are a design-mode authoring aid only — never in Play/prototype,
    // spatial preview, or the chrome-free phone viewer.
    const showLinks =
        state.editorMode === 'design' &&
        !state.spatialPreviewActive &&
        !document.body.classList.contains('void-mobile-viewer') &&
        (state.viewMode === '3d' || state.viewMode === '2d');

    while (g.children.length > 0) {
        const c = g.children[0];
        g.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    }

    if (!showLinks) return;

    state.objects.forEach((obj) => {
        if (!isInteractionVoidType(obj.userData?.voidType)) return;
        const linkId = obj.userData.onClickScreenId;
        if (!linkId) return;
        const targetScreen = state.screens.find((s) => s.id === linkId);
        if (!targetScreen) return;

        const pr = getPlanarLinkWorldPoint(obj, 'right');
        if (pr) {
            _protoLinkA.copy(pr);
        } else {
            obj.getWorldPosition(_protoLinkA);
        }
        const end = resolveProtoLineEndForScreenLink(obj, targetScreen);
        if (!end) return;
        // use already resolved source point
        _protoLinkB.copy(end);

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

// ===== PROTOTYPE: HTML canvas overlay (2D bezier links + handle) =====
const _pOv = new THREE.Vector3();
const _pOv2 = new THREE.Vector3();
const _pOv3 = new THREE.Vector3();

function worldToProtoOverlayPx(v, out) {
    _pOv.copy(v);
    _pOv.project(state.camera);
    if (!state.prototypeLinkUI) return 0;
    const el = state.prototypeLinkUI.wrap;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    out.x = (_pOv.x * 0.5 + 0.5) * w;
    out.y = (-_pOv.y * 0.5 + 0.5) * h;
    return _pOv.z;
}

function formatTransitionLabel(t, ms) {
    const map = {
        instant: 'Instant',
        fade: 'Fade',
        slideLeft: 'Slide L',
        slideRight: 'Slide R',
        scaleUp: 'Scale up',
        scaleDown: 'Scale down'
    };
    const n = map[t] || t || 'Instant';
    return `${n} ${Math.round(Number(ms) || 300)}ms`;
}

let _protoLinkModalContext = null;

function openProtoLinkDestinationModal(sourceRoot, targetRoot) {
    // Drag-to-connect flow removed. Keep function as no-op for compatibility.
    void sourceRoot;
    void targetRoot;
}

function closeProtoLinkDestinationModal() {
    // Drag-to-connect flow removed. Keep function as no-op for compatibility.
    _protoLinkModalContext = null;
}

function confirmProtoLinkDestinationModal() {
    // Drag-to-connect flow removed. Keep function as no-op for compatibility.
    closeProtoLinkDestinationModal();
}

function pickProtoLinkableAt(clientX, clientY) {
    void clientX;
    void clientY;
    return null;
}

function syncPrototypeLinkOverlaySize() {
    // Drag overlay removed.
}

function initPrototypeLinkOverlay(viewportElement) {
    // Drag-to-connect overlay removed.
    void viewportElement;
    state.prototypeLinkUI = null;
}

function updatePrototypeLinkOverlay() {
    // Drag-to-connect overlay removed.
}

function updateQRTracking() {
    if (state.spatialPreviewKind !== 'camera' || !state.spatialPreviewActive) return;
    const video = document.getElementById('spatial-preview-video');
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;

    if (typeof window.jsQR === 'undefined') return;

    if (!state.qrCanvas) {
        state.qrCanvas = document.createElement('canvas');
        state.qrCtx = state.qrCanvas.getContext('2d');
    }

    const width = 480;
    const height = Math.round(video.videoHeight * (width / video.videoWidth));
    if (width > 0 && height > 0) {
        state.qrCanvas.width = width;
        state.qrCanvas.height = height;
        state.qrCtx.drawImage(video, 0, 0, width, height);

        try {
            const imgData = state.qrCtx.getImageData(0, 0, width, height);
            const code = window.jsQR(imgData.data, imgData.width, imgData.height);

            const activeGroup = getActiveScreenGroup();
            if (!activeGroup) return;

            if (code) {
                const pose = estimateQRPose(code, width, height);
                if (pose) {
                    if (!state.originalScreenPoses) {
                        state.originalScreenPoses = new Map();
                    }
                    if (!state.originalScreenPoses.has(activeGroup.uuid)) {
                        state.originalScreenPoses.set(activeGroup.uuid, {
                            position: activeGroup.position.clone(),
                            quaternion: activeGroup.quaternion.clone(),
                            scale: activeGroup.scale.clone(),
                            parent: activeGroup.parent
                        });
                    }

                    const offsetZ = 0.08; // 8cm offset in front of QR code
                    const localZ = new THREE.Vector3(0, 0, 1).applyMatrix4(pose.rotMatrix);
                    const targetPos = pose.center.clone().add(localZ.multiplyScalar(offsetZ));

                    activeGroup.position.lerp(targetPos, 0.2);
                    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(pose.rotMatrix);
                    activeGroup.quaternion.slerp(targetQuat, 0.2);

                    updateSpatialPreviewHint('QR Code Anchor Locked! Walk around it to preview.');
                    state.qrTrackerLastSeen = Date.now();
                }
            } else {
                const lastSeen = state.qrTrackerLastSeen || 0;
                if (Date.now() - lastSeen > 2500) {
                    updateSpatialPreviewHint('Point camera at the QR code on your screen to anchor UI.');
                }
            }
        } catch (e) {
            console.error('QR tracking error:', e);
        }
    }
}

// ===== ANIMATION LOOP =====
function animate() {
    requestAnimationFrame(animate);

    if (state.controls) state.controls.update();

    updateViewportPosition();
    apply2DBillboards();
    updateClickAnimation();
    updatePrototypeScreenNavJob();
    updatePrototypeLinkLines();
    updatePrototypeLinkOverlay();

    if (state.spatialPreviewKind === 'xr') return;

    if (state.spatialPreviewKind === 'camera' && state.spatialPreviewQRMode) {
        updateQRTracking();
    }

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
    syncPrototypeLinkOverlaySize();
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
    const sameMode = state.viewMode === mode;
    state.viewMode = mode;

    if (mode === '2d') {
        snapshotEnvironmentVisibilityForViewMode();
        forceHideEnvironmentForTwoD();
    } else {
        restoreEnvironmentVisibilityForThreeD();
    }

    syncViewModeUi();

    applyFloorVisibility();
    if (mode === '2d') {
        state.scene.background = null;
    } else {
        if (state.activeEnvironmentPresetId && state.environmentTexture) {
            state.scene.background = state.environmentTexture;
        } else {
            state.scene.background = state.defaultEditorBackground || new THREE.Color(0x0f0f0f);
        }
    }

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
        state.controls.screenSpacePanning = true;
        state.controls.minPolarAngle = Math.PI / 2;
        state.controls.maxPolarAngle = Math.PI / 2;
        switchActiveCamera(state.orthographicCamera);
        updateOrthoCameraFrustum();
        state.orthographicCamera.position.set(0, 0, 10);
        state.orthographicCamera.lookAt(0, 0, 0);
        state.controls.target.set(0, 0, 0);
        state.controls.update();
        if (state.transformControls) {
            state.transformControls.detach();
            state.transformControls.visible = false;
            state.transformControls.enabled = false;
        }
        // Keep stored visibility states; only hide while in 2D mode.
    } else {
        if (state.controls3DDefaults) {
            state.controls.enableRotate = state.controls3DDefaults.enableRotate;
            state.controls.minPolarAngle = state.controls3DDefaults.minPolarAngle;
            state.controls.maxPolarAngle = state.controls3DDefaults.maxPolarAngle;
        }
        state.controls.enablePan = true;
        state.controls.screenSpacePanning = false;
        switchActiveCamera(state.perspectiveCamera);
        state.perspectiveCamera.position.set(0, 2, 8);
        state.perspectiveCamera.lookAt(0, 0, 0);
        state.controls.target.set(0, 0, 0);
        state.controls.update();
        if (state.transformControls) {
            state.transformControls.visible = true;
            state.transformControls.enabled = true;
        }
        // Restore uses stored state values (floorVisible / safeZoneVisible).
    }
    syncEditorThemeCanvas();
    updateTransformControlsForViewMode();
    if (!sameMode) {
        pulseViewportModeTransition();
        showNotification(mode === '2d' ? '2D mode — Space + drag to pan' : '3D mode — orbit and inspect depth');
    }
}

function syncViewModeUi() {
    const badge = document.getElementById('viewport-mode-badge');
    const modeToggle = document.getElementById('btn-view-mode-toggle');
    const btn2d = document.getElementById('btn-view-mode-2d');
    const btn3d = document.getElementById('btn-view-mode-3d');
    if (badge) badge.textContent = state.viewMode === '2d' ? '2D' : '3D';
    if (btn2d && btn3d) {
        btn2d.classList.toggle('active', state.viewMode === '2d');
        btn3d.classList.toggle('active', state.viewMode === '3d');
        btn2d.setAttribute('aria-pressed', state.viewMode === '2d' ? 'true' : 'false');
        btn3d.setAttribute('aria-pressed', state.viewMode === '3d' ? 'true' : 'false');
    }
    const tb2d = document.getElementById('toolbar-view-mode-2d');
    const tb3d = document.getElementById('toolbar-view-mode-3d');
    if (tb2d && tb3d) {
        tb2d.classList.toggle('active', state.viewMode === '2d');
        tb3d.classList.toggle('active', state.viewMode === '3d');
        tb2d.setAttribute('aria-pressed', state.viewMode === '2d' ? 'true' : 'false');
        tb3d.setAttribute('aria-pressed', state.viewMode === '3d' ? 'true' : 'false');
    }
    if (modeToggle) {
        const icon = modeToggle.querySelector('[data-lucide]');
        if (icon) icon.setAttribute('data-lucide', state.viewMode === '2d' ? 'box' : 'layout-dashboard');
        modeToggle.setAttribute('title', state.viewMode === '2d' ? 'Switch to 3D mode' : 'Switch to 2D mode');
        modeToggle.setAttribute('data-tooltip', state.viewMode === '2d' ? 'Switch to 3D mode' : 'Switch to 2D mode');
    }
    initializeLucideIcons();
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
function syncFloorToggleButton() {
    const btn = document.getElementById('viewport-toggle-grid');
    if (!btn) return;
    btn.classList.toggle('active', !!state.floorVisible);
    btn.classList.toggle('is-off', !state.floorVisible);
    btn.setAttribute('aria-pressed', state.floorVisible ? 'true' : 'false');
    btn.title = 'Toggle floor grid';
    btn.setAttribute('data-tooltip', 'Toggle floor grid');
}

function applyFloorVisibility() {
    if (!state.scene) return;
    const mainGrid = state.scene.getObjectByName('mainGrid');
    const ground = state.scene.getObjectByName('Ground');
    const safeZone = state.scene.getObjectByName('safeZone');
    const axes = state.scene.children.find((obj) => obj && obj.type === 'AxesHelper');
    const bgIsHdri = !!(state.scene.background && state.scene.background.isTexture);
    if (state.viewMode === '3d') {
        const guides = !!state.floorVisible;
        const showFloorGuides = guides && !bgIsHdri;
        if (mainGrid) mainGrid.visible = showFloorGuides;
        if (ground) ground.visible = showFloorGuides;
        if (safeZone) safeZone.visible = !!state.safeZoneVisible;
        if (axes) axes.visible = true;
        if (state.grid2d) state.grid2d.visible = false;
    } else {
        if (mainGrid) mainGrid.visible = false;
        if (ground) ground.visible = false;
        if (safeZone) safeZone.visible = false;
        if (axes) axes.visible = false;
        if (state.grid2d) state.grid2d.visible = !!state.floorVisible;
    }
    syncFloorToggleButton();
    syncSafeZoneToggleButton();
}

function syncSafeZoneToggleButton() {
    const btn = document.getElementById('viewport-toggle-safe');
    if (!btn) return;
    btn.classList.toggle('active', !!state.safeZoneVisible);
    btn.classList.toggle('is-off', !state.safeZoneVisible);
    btn.setAttribute('aria-pressed', state.safeZoneVisible ? 'true' : 'false');
    btn.title = 'Toggle safe zone';
    btn.setAttribute('data-tooltip', 'Toggle safe zone');
}

function toggleFloorVisibility() {
    state.floorVisible = !state.floorVisible;
    applyFloorVisibility();
    return state.floorVisible;
}

function toggleGrid() {
    return toggleFloorVisibility();
}

function toggleSafeZone() {
    state.safeZoneVisible = !state.safeZoneVisible;
    applyFloorVisibility();
    return state.safeZoneVisible;
}

function installViewModeSegmentedControl() {
    const existingToggle = document.getElementById('btn-view-mode-toggle');
    if (!existingToggle || document.getElementById('btn-view-mode-2d')) return;
    const host = existingToggle.parentElement;
    if (!host) return;

    const segment = document.createElement('div');
    segment.id = 'view-mode-segment';
    segment.className = 'view-mode-segment';

    const btn2d = document.createElement('button');
    btn2d.type = 'button';
    btn2d.id = 'btn-view-mode-2d';
    btn2d.className = 'view-mode-tab';
    btn2d.textContent = '2D';
    btn2d.addEventListener('click', () => setViewMode('2d'));

    const btn3d = document.createElement('button');
    btn3d.type = 'button';
    btn3d.id = 'btn-view-mode-3d';
    btn3d.className = 'view-mode-tab';
    btn3d.textContent = '3D';
    btn3d.addEventListener('click', () => setViewMode('3d'));

    segment.appendChild(btn2d);
    segment.appendChild(btn3d);
    host.insertBefore(segment, existingToggle);
    existingToggle.style.display = 'none';
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
            initializeLucideIcons();
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

    document.getElementById('topbar-add-button')?.addEventListener('click', () => {
        createXRButton('Button');
        initializeLucideIcons();
    });

    document.getElementById('topbar-add-panel')?.addEventListener('click', () => {
        createXRPanel();
        initializeLucideIcons();
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
    initializeLucideIcons();
}

function hidePropertiesPanel() {
    const emptyState = document.querySelector('.empty-state');
    const propertiesSections = document.querySelector('.properties-sections');

    if (emptyState && propertiesSections) {
        emptyState.style.display = 'flex';
        propertiesSections.style.display = 'none';
    }
    updateImagePropertyPanel(null);
    initializeLucideIcons();
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
    installViewModeSegmentedControl();

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
    syncViewModeUi();

    document.getElementById('toolbar-view-mode-2d')?.addEventListener('click', () => setViewMode('2d'));
    document.getElementById('toolbar-view-mode-3d')?.addEventListener('click', () => setViewMode('3d'));

    const gridBtn = document.getElementById('viewport-toggle-grid');
    if (gridBtn) {
        gridBtn.addEventListener('click', () => {
            const isVisible = toggleGrid();
            showNotification(`Floor/Grid: ${isVisible ? 'On' : 'Off'}`);
        });
        syncFloorToggleButton();
    }

    const colorPicker = document.getElementById('canvas-color-input');
    const colorReset = document.getElementById('canvas-color-reset');
    if (colorPicker) {
        colorPicker.addEventListener('input', (e) => {
            const hex = e.target.value;
            updateCanvasColorSwatchUi(hex);
            const viewport = document.getElementById('viewport-3d');
            if (viewport) viewport.style.background = hex;
            state.defaultEditorBackground = new THREE.Color(hex);
            if (state.scene && !state.activeEnvironmentPresetId && state.viewMode === '3d') {
                state.scene.background = state.defaultEditorBackground;
            }
            if (state.renderer) {
                state.renderer.setClearColor(new THREE.Color(hex), 1);
            }
            applyFloorVisibility();
            initializeLucideIcons();
        });
    }
    if (colorReset) {
        colorReset.addEventListener('click', () => {
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            const resetHex = isLight ? '#f0f0f0' : '#141414';
            if (colorPicker) colorPicker.value = resetHex;
            if (colorPicker) colorPicker.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    const safeBtn = document.getElementById('viewport-toggle-safe');
    if (safeBtn) {
        safeBtn.addEventListener('click', () => {
            const isVisible = toggleSafeZone();
            showNotification(`Safe Zone: ${isVisible ? 'On' : 'Off'}`);
        });
        syncSafeZoneToggleButton();
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
        notification.className = 'notification-toast';
        document.body.appendChild(notification);
    }

    clearTimeout(notificationTimeout);
    notification.textContent = message;
    notification.classList.add('is-visible');

    notificationTimeout = setTimeout(() => {
        notification.classList.remove('is-visible');
    }, 2500);
}

// ===== EXPORT / SAVE =====
function serializeObjectForVoid(o) {
    const u = o.userData || {};
    ensureInteractionUserData(u);
    const base = {
        id: o.uuid,
        name: o.name,
        type: u.voidType || (o.isLight ? 'light' : 'primitive'),
        label: u.label || '',
        text: u.text || '',
        onClickScreenId: u.onClickScreenId || '',
        clickAnimation: u.clickAnimation || 'none',
        transitionType: u.transitionType || 'fade',
        transitionDuration: u.transitionDuration ?? 300,
        transitionEasing: u.transitionEasing || 'ease-in-out',
        prototypeLinkTargetUuid: u.prototypeLinkTargetUuid || '',
        screenId: u.screenId || '',
        position: { x: o.position.x, y: o.position.y, z: o.position.z },
        rotation: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
        scale: { x: o.scale.x, y: o.scale.y, z: o.scale.z }
    };
    // Round-trip the full styling set so saved / mobile-previewed projects keep their
    // exact look (rounded corners, glass, art, aligned text, pills, shadows, …).
    const style = u._style || {};
    const STYLE_KEYS = [
        'color', 'opacity', 'radius', 'border', 'borderColor', 'borderOpacity', 'shadow',
        'textColor', 'textFontSize', 'textBg', 'align', 'weight', 'variant', 'glow',
        'chip', 'chipOpacity', 'art', 'fillColor', 'fillOpacity'
    ];
    STYLE_KEYS.forEach((k) => {
        const v = style[k] != null ? style[k] : u[k];
        if (v != null) base[k] = v;
    });
    if (u.planarBaseHalf && u.voidType !== 'frame') {
        base.width = u.planarBaseHalf.x * 2;
        base.height = u.planarBaseHalf.y * 2;
    }
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
        projectName: state.currentProjectName || 'Untitled',
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

function safeSetExportedUuid(obj, id) {
    if (
        typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) {
        obj.uuid = id;
    }
}

function bumpNextScreenIndexFromImport(screenId) {
    const m = /^screen-(\d+)$/.exec(screenId || '');
    if (m) {
        const n = parseInt(m[1], 10);
        if (n >= state.nextScreenIndex) state.nextScreenIndex = n + 1;
    }
}

function clearProjectForVoidImport() {
    deselectObject();
    const objs = [...state.objects];
    objs.forEach((obj) => {
        disposeObject3D(obj);
        if (obj.parent) obj.parent.remove(obj);
        else if (state.scene) state.scene.remove(obj);
    });
    state.objects = [];
    state.selectableObjects = [];

    state.screens.forEach((s) => {
        if (s.group.parent) s.group.parent.remove(s.group);
        disposeObject3D(s.group);
    });
    state.screens = [];
    state.activeScreenId = null;
    state.nextScreenIndex = 1;
}

function createScreenWithImportedId(screenId, name) {
    const group = new THREE.Group();
    group.name = `Screen: ${name}`;
    group.userData.isScreenRoot = true;
    group.userData.screenId = screenId;
    state.scene.add(group);
    state.screens.push({ id: screenId, name, group });
    bumpNextScreenIndexFromImport(screenId);
    return group;
}

function registerImportedRootObject(root) {
    state.objects.push(root);
    state.selectableObjects.push(root);
}

function applyVoidTransform(o, data) {
    if (data.position) o.position.set(data.position.x, data.position.y, data.position.z);
    if (data.rotation) o.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    if (data.scale) o.scale.set(data.scale.x, data.scale.y, data.scale.z);
}

// Optional styling helpers for imported components. All fields are optional so
// older exports (and the live editor) keep their original look. Templates use
// them to give each project a distinct, professional palette.
function voidColor(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    try {
        return new THREE.Color(value);
    } catch (_) {
        return fallback;
    }
}

function buildImportedPrimitive(data) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x6366f1, metalness: 0.4, roughness: 0.6 })
    );
    mesh.name = data.name || 'Cube';
    safeSetExportedUuid(mesh, data.id);
    mesh.userData.selectable = true;
    mesh.userData.voidType = 'primitive';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    applyVoidTransform(mesh, data);
    return mesh;
}

function buildImportedButton(data) {
    const label = data.label || 'Button';
    const group = new THREE.Group();
    group.name = data.name || 'Button';
    safeSetExportedUuid(group, data.id);
    group.userData.voidType = 'button';
    group.userData.label = label;
    group.userData.onClickScreenId = data.onClickScreenId || '';
    group.userData.clickAnimation = data.clickAnimation || 'none';
    group.userData.prototypeLinkTargetUuid = data.prototypeLinkTargetUuid || '';
    group.userData.transitionType = data.transitionType;
    group.userData.transitionDuration = data.transitionDuration;
    group.userData.transitionEasing = data.transitionEasing;
    ensureInteractionUserData(group.userData);
    group.userData.selectable = true;
    group.userData.textFontSize = data.textFontSize || 56;
    group.userData.textColor = data.textColor || '#ffffff';
    group.userData.color = data.color || '#4f46e5';

    const w = data.width != null ? data.width : 0.72;
    const h = data.height != null ? data.height : 0.22;
    group.userData.planarBaseHalf = { x: w / 2, y: h / 2 };
    group.userData.radius = data.radius != null ? data.radius : Math.min(h / 2, 0.06);
    group.userData.variant = data.variant || 'solid';
    const r = group.userData.radius;

    // Rounded, flat pill — modern spatial-UI button.
    const baseColor = voidColor(data.color, new THREE.Color(0x4f46e5));
    const isGhost = group.userData.variant === 'ghost';
    const bg = new THREE.Mesh(
        roundedRectGeometry(w, h, r),
        new THREE.MeshStandardMaterial({
            color: baseColor,
            metalness: 0.0,
            roughness: 0.55,
            transparent: true,
            opacity: isGhost ? (data.opacity != null ? data.opacity : 0.16) : (data.opacity != null ? data.opacity : 1),
            emissive: baseColor,
            emissiveIntensity: data.glow != null ? data.glow : (isGhost ? 0 : 0.06),
            side: THREE.DoubleSide
        })
    );
    group.add(bg);

    if (isGhost) {
        const ol = new THREE.Line(
            roundedRectLineGeometry(w, h, r),
            new THREE.LineBasicMaterial({ color: baseColor, transparent: true, opacity: 0.85 })
        );
        ol.position.z = 0.001;
        group.add(ol);
    }

    const align = data.align || 'center';
    const tfW = w * 0.9;
    const tfH = h * 0.62;
    const tdim = textCanvasDims(tfW, tfH);
    const tex = makeRichTextTexture({
        text: label,
        align,
        weight: data.weight || '600',
        color: group.userData.textColor,
        fontSize: group.userData.textFontSize,
        wPx: tdim.wPx,
        hPx: tdim.hPx,
        padX: 24
    });
    const fg = new THREE.Mesh(
        new THREE.PlaneGeometry(tfW, tfH),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    fg.position.z = 0.004;
    group.add(fg);

    applyVoidTransform(group, data);
    return group;
}

function buildImportedPanel(data) {
    const group = new THREE.Group();
    group.name = data.name || 'Panel';
    safeSetExportedUuid(group, data.id);
    group.userData.voidType = 'panel';
    group.userData.onClickScreenId = data.onClickScreenId || '';
    group.userData.clickAnimation = data.clickAnimation || 'none';
    group.userData.prototypeLinkTargetUuid = data.prototypeLinkTargetUuid || '';
    group.userData.transitionType = data.transitionType;
    group.userData.transitionDuration = data.transitionDuration;
    group.userData.transitionEasing = data.transitionEasing;
    ensureInteractionUserData(group.userData);
    group.userData.selectable = true;
    const pw = data.width != null ? data.width : 1.2;
    const ph = data.height != null ? data.height : 0.8;
    group.userData.planarBaseHalf = { x: pw / 2, y: ph / 2 };
    group.userData.color = data.color || '#1e293b';
    group.userData.radius = data.radius != null ? data.radius : 0.09;
    const pr = group.userData.radius;

    // Soft drop shadow behind the card for floating depth (cards opt in).
    if (data.shadow) {
        group.add(makeSoftShadowMesh(pw, ph, pr));
    }

    const mesh = new THREE.Mesh(
        roundedRectGeometry(pw, ph, pr),
        glassPanelMaterial(
            voidColor(data.color, new THREE.Color(0x1e293b)),
            data.opacity != null ? data.opacity : 0.92
        )
    );
    group.add(mesh);

    // Hairline rounded border so cards read crisp in AR / preview.
    const pborder = new THREE.Line(
        roundedRectLineGeometry(pw, ph, pr),
        new THREE.LineBasicMaterial({
            color: voidColor(data.borderColor, new THREE.Color(0x64748b)),
            transparent: true,
            opacity: data.borderOpacity != null ? data.borderOpacity : 0.55
        })
    );
    pborder.position.z = 0.004;
    group.add(pborder);

    applyVoidTransform(group, data);
    return group;
}

function buildImportedText(data) {
    const text = data.text || 'Label';
    const group = new THREE.Group();
    group.name = data.name || 'Text';
    safeSetExportedUuid(group, data.id);
    group.userData.voidType = 'text';
    group.userData.onClickScreenId = data.onClickScreenId || '';
    group.userData.clickAnimation = data.clickAnimation || 'none';
    group.userData.prototypeLinkTargetUuid = data.prototypeLinkTargetUuid || '';
    group.userData.transitionType = data.transitionType;
    group.userData.transitionDuration = data.transitionDuration;
    group.userData.transitionEasing = data.transitionEasing;
    ensureInteractionUserData(group.userData);
    group.userData.text = text;
    group.userData.selectable = true;
    group.userData.textFontSize = data.textFontSize || 56;
    group.userData.textColor = data.textColor || '#e2e8f0';
    group.userData.textBg = data.textBg != null ? data.textBg : 'transparent';
    group.userData.align = data.align || 'center';
    const tw = data.width != null ? data.width : 1;
    const th = data.height != null ? data.height : 0.25;
    group.userData.planarBaseHalf = { x: tw / 2, y: th / 2 };

    // Optional rounded chip/pill background (e.g. for tags).
    if (data.chip) {
        const cr = data.radius != null ? data.radius : Math.min(th / 2, 0.06);
        const chip = new THREE.Mesh(
            roundedRectGeometry(tw, th, cr),
            glassPanelMaterial(voidColor(data.chip, new THREE.Color(0x334155)), data.chipOpacity != null ? data.chipOpacity : 1)
        );
        chip.position.z = -0.001;
        group.add(chip);
    }

    const lines = String(text).split('\n').length;
    const tdim = textCanvasDims(tw, th);
    const tex = makeRichTextTexture({
        text,
        align: group.userData.align,
        weight: data.weight || '600',
        color: group.userData.textColor,
        fontSize: group.userData.textFontSize,
        wPx: tdim.wPx,
        hPx: tdim.hPx,
        padX: data.chip ? 18 : 10
    });
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(tw, th),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    plane.position.z = 0.004;
    group.add(plane);
    applyVoidTransform(group, data);
    return group;
}

function buildImportedImage(data) {
    const group = new THREE.Group();
    group.name = data.name || 'Image';
    safeSetExportedUuid(group, data.id);
    group.userData.voidType = 'image';
    group.userData.onClickScreenId = data.onClickScreenId || '';
    group.userData.clickAnimation = data.clickAnimation || 'none';
    group.userData.prototypeLinkTargetUuid = data.prototypeLinkTargetUuid || '';
    group.userData.transitionType = data.transitionType;
    group.userData.transitionDuration = data.transitionDuration;
    group.userData.transitionEasing = data.transitionEasing;
    ensureInteractionUserData(group.userData);
    group.userData.selectable = true;
    group.userData.color = data.color || '#334155';
    group.userData.art = data.art || null;

    const w = data.width != null ? data.width : 0.9;
    const h = data.height != null ? data.height : 0.55;
    group.userData.planarBaseHalf = { x: w / 2, y: h / 2 };
    const ir = data.radius != null ? data.radius : 0.07;

    let fillMat;
    if (data.art) {
        // Procedural poster-style artwork (offline, reliable) keyed to an accent color.
        const tex = makeArtTexture(data.art, data.color || '#4f46e5', 1024, Math.round((h / w) * 1024));
        fillMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    } else {
        fillMat = new THREE.MeshStandardMaterial({
            color: voidColor(data.color, new THREE.Color(0x334155)),
            metalness: 0.1,
            roughness: 0.9,
            transparent: true,
            opacity: data.opacity != null ? data.opacity : 0.9,
            side: THREE.DoubleSide
        });
    }
    const frame = new THREE.Mesh(roundedRectGeometry(w, h, ir), fillMat);
    group.userData._imagePlateMesh = frame;
    group.add(frame);

    if (data.border !== false) {
        const lines = new THREE.Line(
            roundedRectLineGeometry(w, h, ir),
            new THREE.LineBasicMaterial({
                color: voidColor(data.borderColor, new THREE.Color(0xcbd5e1)),
                transparent: true,
                opacity: data.borderOpacity != null ? data.borderOpacity : 0.35
            })
        );
        lines.position.z = 0.003;
        group.add(lines);
    }

    applyVoidTransform(group, data);
    return group;
}

function buildImportedFrame(data, screenIdForScope) {
    const width = data.frameWidth != null ? data.frameWidth : 1.2;
    const height = data.frameHeight != null ? data.frameHeight : 0.8;
    const label = data.frameLabel || data.name || 'Frame';

    const group = new THREE.Group();
    group.name = data.name || label;
    safeSetExportedUuid(group, data.id);
    group.userData.voidType = 'frame';
    group.userData.selectable = true;
    group.userData.frameWidth = width;
    group.userData.frameHeight = height;
    group.userData.frameLabel = label;
    group.userData.anchor = data.anchor || 'world';
    group.userData.onClickScreenId = data.onClickScreenId || '';
    group.userData.clickAnimation = data.clickAnimation || 'none';
    group.userData.prototypeLinkTargetUuid = data.prototypeLinkTargetUuid || '';
    group.userData.transitionType = data.transitionType;
    group.userData.transitionDuration = data.transitionDuration;
    group.userData.transitionEasing = data.transitionEasing;
    ensureInteractionUserData(group.userData);

    const fr = data.radius != null ? data.radius : 0.08;
    const fillMat = new THREE.MeshStandardMaterial({
        color: voidColor(data.fillColor, new THREE.Color(0x0f172a)),
        transparent: true,
        opacity: data.fillOpacity != null ? data.fillOpacity : 0.45,
        metalness: 0,
        roughness: 1,
        side: THREE.DoubleSide
    });
    group.userData.fillColor = data.fillColor || '#0f172a';
    const fill = new THREE.Mesh(roundedRectGeometry(width, height, fr), fillMat);
    group.add(fill);
    group.userData.frameFill = fill;

    const border = new THREE.Line(
        roundedRectLineGeometry(width, height, fr),
        new THREE.LineBasicMaterial({
            color: voidColor(data.borderColor, new THREE.Color(0x64748b)),
            transparent: true,
            opacity: 0.9
        })
    );
    border.position.z = 0.003;
    group.add(border);
    group.userData.frameBorder = border;

    const labelTex = makeTextTexture(label, 512, 96, '#94a3b8', 'rgba(0,0,0,0)', 36);
    const labelPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(width * 0.95, 1.4), 0.12),
        new THREE.MeshBasicMaterial({ map: labelTex, transparent: true })
    );
    labelPlane.position.set(0, height / 2 + 0.08, 0.004);
    group.add(labelPlane);
    group.userData.frameLabelMesh = labelPlane;
    group.userData.frameLabelTexture = labelTex;

    applyVoidTransform(group, data);

    const children = Array.isArray(data.children) ? data.children : [];
    children.forEach((ch) => {
        const built = buildVoidObjectTreeFromData(ch, screenIdForScope);
        built.userData.screenId = screenIdForScope;
        group.add(built);
        registerImportedRootObject(built);
    });

    group.userData.screenId = screenIdForScope;
    return group;
}

function buildVoidObjectTreeFromData(data, screenIdForScope) {
    const t = data.type;
    let obj;
    if (t === 'button') obj = buildImportedButton(data);
    else if (t === 'panel') obj = buildImportedPanel(data);
    else if (t === 'text') obj = buildImportedText(data);
    else if (t === 'image') obj = buildImportedImage(data);
    else if (t === 'frame') obj = buildImportedFrame(data, screenIdForScope);
    else obj = buildImportedPrimitive(data);
    // Remember the styling inputs so save/export/mobile-preview round-trips the look.
    if (obj && obj.userData) obj.userData._style = data;
    return obj;
}

function applyVoidImport(exportObj) {
    if (!state.scene) {
        showNotification('Open the editor before loading cloud data.');
        return false;
    }
    if (!exportObj || exportObj.void !== true || !Array.isArray(exportObj.screens)) {
        showNotification('Invalid Void export payload.');
        return false;
    }

    window.__voidImportInFlight = true;
    try {
        clearProjectForVoidImport();

        exportObj.screens.forEach((sc, idx) => {
            createScreenWithImportedId(sc.id, sc.name || `Screen ${idx + 1}`);
        });

        exportObj.screens.forEach((sc) => {
            const screenRec = state.screens.find((s) => s.id === sc.id);
            if (!screenRec) return;
            const components = Array.isArray(sc.components) ? sc.components : [];
            components.forEach((comp) => {
                const obj = buildVoidObjectTreeFromData(comp, sc.id);
                obj.userData.screenId = sc.id;
                screenRec.group.add(obj);
                registerImportedRootObject(obj);
            });
        });

        const active =
            exportObj.activeScreenId && state.screens.some((s) => s.id === exportObj.activeScreenId)
                ? exportObj.activeScreenId
                : state.screens[0]?.id;
        if (active) switchToScreen(active, { silent: true });

        exportObj.screens.forEach((sc) => {
            const screenRec = state.screens.find((s) => s.id === sc.id);
            if (!screenRec) return;
            screenRec.group.children.forEach((root) => {
                if (root.userData?.voidType === 'frame' && root.userData.anchor && root.userData.anchor !== 'world') {
                    applyFrameXRAnchorType(root, root.userData.anchor);
                }
            });
        });

        refreshScreensPanel();
        refreshLayersPanel();
        populateButtonLinkDropdown();
        updatePrototypeLinkLines();
        showNotification('Loaded saved Void project');
        return true;
    } finally {
        window.__voidImportInFlight = false;
    }
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
        const o = state.selectedObject;
        if (o && isInteractionVoidType(o.userData?.voidType)) {
            ensureInteractionUserData(o.userData);
            o.userData.onClickScreenId = sel.value || '';
            showNotification(o.userData.onClickScreenId ? 'On Click link updated' : 'On Click link cleared');
            scheduleRemoteProjectSave();
            updatePrototypeLinkLines();
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
    const leg = document.getElementById('button-click-animation');
    if (leg) {
        leg.addEventListener('change', () => {
            const o = state.selectedObject;
            if (o && isInteractionVoidType(o.userData?.voidType)) {
                o.userData.clickAnimation = leg.value || 'none';
                showNotification('Legacy animation (use Animation type for new projects)');
            }
        });
    }
    const t = document.getElementById('proto-transition-type');
    if (t) {
        t.addEventListener('change', () => {
            const o = state.selectedObject;
            if (o && isInteractionVoidType(o.userData?.voidType)) {
                ensureInteractionUserData(o.userData);
                o.userData.transitionType = t.value || 'fade';
                scheduleRemoteProjectSave();
            }
        });
    }
    const d = document.getElementById('proto-transition-duration');
    if (d) {
        const applyDur = () => {
            const o = state.selectedObject;
            if (o && isInteractionVoidType(o.userData?.voidType)) {
                const v = Math.min(2000, Math.max(0, parseInt(d.value, 10) || 0));
                o.userData.transitionDuration = v;
                d.value = String(v);
                scheduleRemoteProjectSave();
            }
        };
        d.addEventListener('change', applyDur);
        d.addEventListener('input', applyDur);
    }
    const e = document.getElementById('proto-transition-easing');
    if (e) {
        e.addEventListener('change', () => {
            const o = state.selectedObject;
            if (o && isInteractionVoidType(o.userData?.voidType)) {
                o.userData.transitionEasing = e.value || 'ease-in-out';
                scheduleRemoteProjectSave();
            }
        });
    }
    const rm = document.getElementById('btn-remove-proto-link');
    if (rm) {
        rm.addEventListener('click', () => {
            const o = state.selectedObject;
            if (o && isInteractionVoidType(o.userData?.voidType)) {
                o.userData.onClickScreenId = '';
                o.userData.prototypeLinkTargetUuid = '';
                showNotification('Connection removed');
                scheduleRemoteProjectSave();
                updateInteractionPanel(o);
            }
        });
    }
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

// ===== ENVIRONMENT PRESETS (optional design-time context) =====
const ENVIRONMENT_PRESETS = [
    {
        id: 'living-room',
        name: 'Living Room',
        description: 'Warm interior context',
        hdrUrls: [
            'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/living_room_2k.hdr',
            'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/living_room_4k.hdr',
            'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/old_room_2k.hdr'
        ],
        previewUrl: 'https://cdn.polyhaven.com/asset_img/thumbs/living_room.png?height=160'
    },
    {
        id: 'modern-office',
        name: 'Modern Office',
        description: 'Clean commercial lighting',
        hdrUrls: [
            'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/modern_office_2_2k.hdr',
            'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/modern_office_4k.hdr',
            'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/office_2k.hdr'
        ],
        previewUrl: 'https://cdn.polyhaven.com/asset_img/thumbs/modern_office.png?height=160'
    },
    {
        id: 'bedroom',
        name: 'Bedroom',
        description: 'Calm personal interior',
        hdrUrls: [
            'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/hotel_room_2k.hdr',
            'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/vintage_room_4k.hdr'
        ],
        previewUrl: 'https://cdn.polyhaven.com/asset_img/thumbs/vintage_room.png?height=160'
    },
    {
        id: 'minimal-studio',
        name: 'Minimal Studio',
        description: 'Neutral controlled backdrop',
        hdrUrls: ['https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/studio_small_08_4k.hdr'],
        previewUrl: 'https://cdn.polyhaven.com/asset_img/thumbs/studio_small_08.png?height=160'
    },
    {
        id: 'outdoor-space',
        name: 'Outdoor Space',
        description: 'Open daylight perspective',
        hdrUrls: ['https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/kloppenheim_06_4k.hdr'],
        previewUrl: 'https://cdn.polyhaven.com/asset_img/thumbs/kloppenheim_06.png?height=160'
    }
];

function setEnvironmentLoading(loading, message = 'Loading environment...') {
    state.environmentLoading = !!loading;
    const indicator = document.getElementById('environment-loading-indicator');
    if (!indicator) return;
    indicator.textContent = message;
    indicator.style.display = loading ? 'block' : 'none';
}

/** Try HDR URLs in order; disposes aborted textures if request stale. */
function loadHdriFromUrlList(urls, requestId, onLoad, onFailAll) {
    const list = (urls || []).filter(Boolean);
    if (!list.length) {
        onFailAll();
        return;
    }
    const loader = new RGBELoader();
    loader.setDataType(THREE.HalfFloatType);
    let i = 0;
    const tryNext = () => {
        if (requestId !== state.environmentLoadRequestId) return;
        if (i >= list.length) {
            onFailAll();
            return;
        }
        const url = list[i++];
        loader.load(
            url,
            (texture) => {
                if (requestId !== state.environmentLoadRequestId) {
                    texture.dispose();
                    return;
                }
                onLoad(texture);
            },
            undefined,
            () => tryNext()
        );
    };
    tryNext();
}

function clearEnvironmentPlaceholder(presetId) {
    const card = document.querySelector(`.environment-card[data-environment-id="${presetId}"]`);
    if (!card) return;
    card.classList.remove('environment-card--unavailable');
    card.querySelector('.environment-card-ph-overlay')?.remove();
}

function showEnvironmentPlaceholder(presetId) {
    const card = document.querySelector(`.environment-card[data-environment-id="${presetId}"]`);
    if (!card) return;
    card.classList.add('environment-card--unavailable');
    let ph = card.querySelector('.environment-card-ph-overlay');
    if (!ph) {
        ph = document.createElement('div');
        ph.className = 'environment-card-ph-overlay';
        ph.innerHTML =
            '<span class="environment-card-ph-text">Preview unavailable</span><span class="environment-card-ph-sub">Tap to retry</span>';
        card.appendChild(ph);
    }
}

function refreshEnvironmentPresetUi() {
    const root = document.getElementById('environments-list');
    if (!root) return;
    root.querySelectorAll('.environment-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.environmentId === state.activeEnvironmentPresetId);
    });
}

function clearEnvironmentPreset(showToast = true) {
    if (!state.scene) return;
    if (state.environmentTexture) {
        state.environmentTexture.dispose();
        state.environmentTexture = null;
    }
    state.environmentLoadRequestId += 1;
    setEnvironmentLoading(false);
    state.activeEnvironmentPresetId = null;
    state.scene.background = null;
    state.scene.environment = null;
    if (state.viewMode === '3d') {
        state.scene.background = state.defaultEditorBackground || new THREE.Color(0x0f0f0f);
    }
    applyFloorVisibility();
    refreshEnvironmentPresetUi();
    if (showToast) showNotification('Default canvas restored');
}

function applyEnvironmentPreset(presetId) {
    if (!state.scene) {
        showNotification('Open the editor first.');
        return;
    }
    const preset = ENVIRONMENT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const requestId = ++state.environmentLoadRequestId;
    setEnvironmentLoading(true);

    const hdrUrls =
        preset.hdrUrls || [preset.imageUrl, preset.fallbackUrl].filter((u) => typeof u === 'string' && u);

    loadHdriFromUrlList(
        hdrUrls,
        requestId,
        (texture) => {
            if (requestId !== state.environmentLoadRequestId) {
                texture.dispose();
                return;
            }
            clearEnvironmentPlaceholder(preset.id);
            if (state.environmentTexture) state.environmentTexture.dispose();
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            state.environmentTexture = texture;
            state.scene.environment = texture;
            state.scene.background = state.viewMode === '2d' ? null : texture;
            state.activeEnvironmentPresetId = preset.id;
            setEnvironmentLoading(false);
            applyFloorVisibility();
            refreshEnvironmentPresetUi();
            showNotification(`Environment: ${preset.name}`);
        },
        () => {
            if (requestId !== state.environmentLoadRequestId) return;
            setEnvironmentLoading(false, 'Environment unavailable');
            showEnvironmentPlaceholder(preset.id);
            showNotification('Loading failed — check connection');
        }
    );
}

function initializeEnvironmentsUI() {
    const list = document.getElementById('environments-list');
    const clearBtn = document.getElementById('btn-clear-environment');
    if (!list) return;

    list.innerHTML = '';
    ENVIRONMENT_PRESETS.forEach((preset) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'environment-card';
        card.dataset.environmentId = preset.id;
        card.innerHTML = `
            <img class="environment-card-preview" src="${preset.previewUrl}" alt="${escapeHtml(preset.name)} preview" loading="lazy" />
            <span class="environment-card-title">${escapeHtml(preset.name)}</span>
            <span class="environment-card-subtitle">${escapeHtml(preset.description)}</span>
        `;
        card.addEventListener('click', () => applyEnvironmentPreset(preset.id));
        list.appendChild(card);
    });

    clearBtn?.addEventListener('click', () => clearEnvironmentPreset(true));
    refreshEnvironmentPresetUi();
    initializeLucideIcons();
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
    state.prototypeLinkDrag = null;
    state.prototypeHoverRoot = null;
    if (mode !== 'prototype') closeProtoLinkDestinationModal();

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
    document.getElementById('prototype-mode-btn')?.classList.toggle('active', mode === 'prototype');
    document.getElementById('btn-mode-design')?.setAttribute('aria-pressed', mode === 'design' ? 'true' : 'false');
    document.getElementById('prototype-mode-btn')?.setAttribute('aria-pressed', mode === 'prototype' ? 'true' : 'false');

    const exitBtn = document.getElementById('btn-exit-prototype');
    if (exitBtn) {
        exitBtn.style.display = mode === 'prototype' ? 'inline-flex' : 'none';
        exitBtn.setAttribute('aria-hidden', mode === 'prototype' ? 'false' : 'true');
    }

    if (mode === 'prototype') {
        showNotification('Prototype mode — click elements to test navigation');
    } else if (prev === 'prototype') {
        showNotification('Design Mode');
    }

    initializeLucideIcons();
    pulseViewportModeTransition();
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

function isIPhoneSafari() {
    const ua = navigator.userAgent || '';
    const isIPhone = /iPhone/i.test(ua);
    const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
    return isIPhone && isSafari;
}

/**
 * True only where AR Quick Look actually works (iOS Safari with <a rel="ar"> support).
 * On Android / desktop the USDZ link merely downloads a file, so we hide the AR option
 * everywhere else. This is the official Apple feature-detection.
 */
function supportsQuickLookAR() {
    const ua = navigator.userAgent || '';
    const isAppleMobile = /iPhone|iPad|iPod/i.test(ua) ||
        (/Macintosh/i.test(ua) && 'ontouchend' in document); // iPadOS desktop UA
    if (!isAppleMobile) return false;
    const a = document.createElement('a');
    return !!(a.relList && a.relList.supports && a.relList.supports('ar'));
}

function encodeMobilePreviewPayload(data) {
    try {
        return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    } catch {
        return '';
    }
}

function decodeMobilePreviewPayload(raw) {
    if (!raw) return null;
    try {
        const json = decodeURIComponent(escape(atob(raw)));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/**
 * Publish a scene for mobile preview. Prefers the dev-server handoff (returns a tiny
 * id so the QR stays small/scannable); falls back to an inline base64 hash for builds
 * without the middleware (only viable for small scenes).
 */
async function publishMobilePreviewPayload(exportObj) {
    try {
        const res = await fetch('/__void_preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportObj)
        });
        if (res.ok) {
            const { id } = await res.json();
            if (id) return { mode: 'pid', value: id };
        }
    } catch (_) {}
    return { mode: 'inline', value: encodeMobilePreviewPayload(exportObj) };
}

async function getMobilePreviewPayloadFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('voidMobilePreview') !== '1') return null;

    const pid = params.get('pid');
    if (pid) {
        try {
            const res = await fetch(`/__void_preview?id=${encodeURIComponent(pid)}`);
            if (res.ok) return await res.json();
        } catch (_) {}
        return null;
    }

    const hash = window.location.hash || '';
    const raw = hash.startsWith('#v=') ? hash.slice(3) : '';
    return decodeMobilePreviewPayload(raw);
}

function createWorldClone(object) {
    const clone = object.clone(true);
    object.updateMatrixWorld(true);
    clone.matrixAutoUpdate = true;
    clone.position.setFromMatrixPosition(object.matrixWorld);
    clone.quaternion.setFromRotationMatrix(object.matrixWorld);
    clone.scale.setFromMatrixScale(object.matrixWorld);
    return clone;
}

async function launchQuickLookForActiveScreen() {
    if (!state.scene) {
        showNotification('Open editor first.');
        return;
    }
    const screen = getActiveScreen();
    if (!screen) {
        showNotification('No active screen to preview.');
        return;
    }

    const exportScene = new THREE.Scene();
    const root = new THREE.Group();
    root.name = `VoidAR:${screen.name}`;
    exportScene.add(root);

    screen.group.updateMatrixWorld(true);
    screen.group.children.forEach((child) => {
        if (child.userData?.isEnvironment) return;
        if (child.visible === false) return;
        root.add(createWorldClone(child));
    });

    if (root.children.length === 0) {
        showNotification('Add frames/components before AR preview.');
        return;
    }

    try {
        const exporter = new USDZExporter();
        const arrayBuffer = await exporter.parse(exportScene);
        const blob = new Blob([arrayBuffer], { type: 'model/vnd.usdz+zip' });
        const usdzUrl = URL.createObjectURL(blob);

        const anchor = document.createElement('a');
        anchor.rel = 'ar';
        anchor.href = usdzUrl;
        const img = document.createElement('img');
        img.alt = 'Open AR';
        img.src =
            'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
        anchor.appendChild(img);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        setTimeout(() => URL.revokeObjectURL(usdzUrl), 20000);
    } catch (err) {
        showNotification(`Could not build AR model: ${err?.message || 'Export failed'}`);
    }
}

async function openDesktopMobilePreviewShareDialog() {
    const handoff = await publishMobilePreviewPayload(buildVoidExport());
    if (!handoff || !handoff.value) {
        showNotification('Could not prepare mobile preview link.');
        return;
    }

    let base = `${window.location.origin}${window.location.pathname}`;
    if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && typeof __MAC_LAN_IP__ !== 'undefined' && __MAC_LAN_IP__ !== 'localhost') {
        const networkHost = `${__MAC_LAN_IP__}:${window.location.port || '8000'}`;
        base = `${window.location.protocol}//${networkHost}${window.location.pathname}`;
    }
    // Server handoff → short ?pid= URL (small, reliably scannable). Inline → base64 hash.
    const shareUrl =
        handoff.mode === 'pid'
            ? `${base}?voidMobilePreview=1&pid=${handoff.value}`
            : `${base}?voidMobilePreview=1#v=${encodeURIComponent(handoff.value)}`;
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(shareUrl)}`;

    const old = document.getElementById('void-mobile-preview-share');
    if (old) old.remove();

    const overlay = document.getElementById('spatial-preview-overlay');
    const panel = document.createElement('div');
    panel.id = 'void-mobile-preview-share';
    panel.style.cssText = `
        position: absolute;
        bottom: 12px;
        right: 12px;
        z-index: 12000;
        pointer-events: none;
    `;
    const card = document.createElement('div');
    card.style.cssText = `
        width: min(92vw, 360px);
        max-height: min(52vh, 420px);
        overflow: auto;
        z-index: 12000;
        background: rgba(15,23,42,0.95);
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 16px;
        color: #e2e8f0;
        font: 13px/1.4 Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        box-shadow: 0 12px 28px rgba(0,0,0,0.45);
        pointer-events: auto;
    `;
    card.innerHTML = `
        <div style="font-size:15px;font-weight:600;margin-bottom:8px;">Open on iPhone</div>
        <p style="margin:0 0 10px 0;color:#94a3b8;">Scan with iPhone Camera. Opens the live, interactive prototype — tap buttons to move between screens, or place any screen in AR.</p>
        <div style="display:flex;justify-content:center;margin:8px 0 12px;">
            <img src="${qrSrc}" alt="Preview QR" width="220" height="220" style="border-radius:8px;border:1px solid #334155;background:#fff;" />
        </div>
        <input id="void-mobile-preview-link-input" value="${shareUrl}" readonly style="width:100%;padding:8px;border-radius:8px;border:1px solid #334155;background:#020617;color:#cbd5e1;" />
        <p style="margin:10px 0 0 0;color:#64748b;">If URL contains localhost, open this app via your Mac's LAN IP first.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button id="void-mobile-preview-copy" style="padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer;">Copy Link</button>
            <button id="void-mobile-preview-close" style="padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#334155;color:#fff;cursor:pointer;">Close</button>
        </div>
    `;
    panel.appendChild(card);
    if (overlay) overlay.appendChild(panel);
    else document.body.appendChild(panel);

    const input = card.querySelector('#void-mobile-preview-link-input');
    card.querySelector('#void-mobile-preview-close')?.addEventListener('click', () => panel.remove());
    card.querySelector('#void-mobile-preview-copy')?.addEventListener('click', async () => {
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareUrl);
            else {
                input?.select();
                document.execCommand('copy');
            }
            showNotification('Mobile preview link copied');
        } catch {
            showNotification('Copy failed — use the link field');
        }
    });
}

/** Switch to a given screen, then launch native AR (Quick Look) for it. */
async function launchQuickLookForScreen(screenId) {
    if (screenId) switchToScreen(screenId, { silent: true });
    await launchQuickLookForActiveScreen();
}

/** Open the mobile screen-selector that lists every screen for AR / tap-through. */
function escapeHtmlAttr(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

// Sync check used at startup to skip the login flash when a QR link is opened.
function isMobilePreviewUrl() {
    return new URLSearchParams(window.location.search).get('voidMobilePreview') === '1';
}

function showMobileViewerLoading(on, message) {
    let el = document.getElementById('void-mobile-loading');
    if (on) {
        if (!el) {
            el = document.createElement('div');
            el.id = 'void-mobile-loading';
            el.className = 'void-mobile-loading';
            el.innerHTML =
                '<div class="vml-brand">VOID</div><div class="vml-spinner"></div><div class="vml-msg">Loading prototype…</div>';
            document.body.appendChild(el);
        }
        if (message) el.querySelector('.vml-msg').textContent = message;
        return;
    }
    if (!el) return;
    if (message) {
        el.classList.add('is-error');
        el.querySelector('.vml-spinner')?.remove();
        el.querySelector('.vml-msg').textContent = message;
        return;
    }
    el.remove();
}

// ===== Template preview harness =====
// Open ?voidPreview=1 (optionally &t=aura&s=aura-home) for a clean, chrome-free view
// of any template with app + screen tabs — a fast way to iterate on template designs.
function isTemplatePreviewUrl() {
    return new URLSearchParams(window.location.search).get('voidPreview') === '1';
}

function enterTemplatePreview() {
    document.body.classList.add('void-mobile-viewer', 'void-preview');
    setAppPhase('editor');
    const q = new URLSearchParams(window.location.search);
    loadPreviewTemplate(q.get('t') || 'aura', q.get('s') || '');
}

function loadPreviewTemplate(id, screenId) {
    const meta = VOID_TEMPLATES.find((t) => t.id === id) || VOID_TEMPLATES[0];
    const data = buildTemplateExport(meta.id);
    state.currentProjectName = meta.projectName;
    applyVoidImport(data);
    setViewMode('2d');
    setEditorMode('prototype');
    if (screenId && state.screens.some((s) => s.id === screenId)) {
        switchToScreen(screenId, { silent: true });
    }
    requestAnimationFrame(() => onWindowResize());
    buildPreviewBar(meta.id);
}

function buildPreviewBar(activeTemplate) {
    document.getElementById('void-preview-bar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'void-preview-bar';
    bar.className = 'void-preview-bar';
    const apps = VOID_TEMPLATES
        .map((t) => `<button class="vpb-tab${t.id === activeTemplate ? ' is-on' : ''}" data-t="${t.id}">${escapeHtmlAttr(t.projectName)}</button>`)
        .join('');
    const screens = state.screens
        .map((s) => `<button class="vpb-screen${s.id === state.activeScreenId ? ' is-on' : ''}" data-s="${s.id}">${escapeHtmlAttr(s.name)}</button>`)
        .join('');
    bar.innerHTML = `
        <div class="vpb-row vpb-row--apps"><span class="vpb-label">PREVIEW</span>${apps}</div>
        <div class="vpb-row vpb-row--screens">${screens}</div>`;
    document.body.appendChild(bar);
    bar.querySelectorAll('.vpb-tab').forEach((b) => b.addEventListener('click', () => loadPreviewTemplate(b.dataset.t)));
    bar.querySelectorAll('.vpb-screen').forEach((b) =>
        b.addEventListener('click', () => {
            switchToScreen(b.dataset.s, { silent: true });
            buildPreviewBar(activeTemplate);
        })
    );
}

/**
 * Phone viewer: load the shared scene and drop straight into a clean, fullscreen,
 * 2D interactive prototype — no login, no editor chrome, no dev tools. Tapping a
 * button navigates between screens. A small bar gives access to per-screen AR.
 */
async function enterMobilePreviewExperience() {
    document.body.classList.add('void-mobile-viewer');
    showMobileViewerLoading(true);

    const payload = await getMobilePreviewPayloadFromUrl();
    setAppPhase('editor'); // editor chrome stays hidden via the body class
    if (!payload) {
        showMobileViewerLoading(false, 'Could not load this preview. Re-open the QR from the desktop.');
        return;
    }
    if (payload.projectName) state.currentProjectName = payload.projectName;
    applyVoidImport(payload);

    startMobilePlayFlow();
    requestAnimationFrame(() => {
        onWindowResize();
        showMobileViewerLoading(false);
    });
}

/** Clean fullscreen 2D interactive prototype for phones (no chrome, tap to navigate). */
function startMobilePlayFlow() {
    document.getElementById('void-mobile-selector')?.remove();
    document.body.classList.add('void-mobile-viewer', 'void-mobile-play');

    if (state.screens[0]) switchToScreen(state.screens[0].id, { silent: true });
    if (typeof setViewMode === 'function') setViewMode('2d');
    if (typeof setEditorMode === 'function') setEditorMode('prototype');
    if (state.controls) {
        state.controls.enabled = true;
        state.controls.enablePan = true;
        state.controls.enableZoom = true;
    }
    requestAnimationFrame(() => onWindowResize());

    if (!document.getElementById('void-mobile-bar')) {
        // Spatial VOID (markerless SLAM) where supported; native Quick Look only on iPhone/iPad.
        const voidArBtn = isVoidARSupported()
            ? '<button type="button" class="vmb-btn vmb-btn--accent" id="vmb-voidar">Spatial VOID</button>'
            : '';
        const nativeArBtn = supportsQuickLookAR()
            ? '<button type="button" class="vmb-btn" id="vmb-ar">Native AR</button>'
            : '';
        const bar = document.createElement('div');
        bar.id = 'void-mobile-bar';
        bar.className = 'void-mobile-bar';
        bar.innerHTML = `
            <span class="vmb-name">${escapeHtmlAttr(state.currentProjectName || 'Prototype')}</span>
            <span class="vmb-spacer"></span>
            <button type="button" class="vmb-btn" id="vmb-home">Restart</button>
            ${nativeArBtn}
            ${voidArBtn}`;
        document.body.appendChild(bar);
        bar.querySelector('#vmb-home')?.addEventListener('click', () => {
            if (state.screens[0]) switchToScreen(state.screens[0].id, { silent: true });
            showNotification('Back to start');
        });
        bar.querySelector('#vmb-ar')?.addEventListener('click', () => openMobileScreenSelector());
        bar.querySelector('#vmb-voidar')?.addEventListener('click', () => launchVoidAR());
    }
}

/** Launch the white-labeled Spatial VOID (AR) mode; fall back gracefully if it can't start. */
async function launchVoidAR() {
    showNotification('Starting Spatial VOID…');
    try {
        await startVoidAR(buildVoidExport(), state.activeScreenId, {});
    } catch (err) {
        console.warn('Spatial VOID unavailable:', err);
        if (supportsQuickLookAR()) {
            showNotification('Spatial VOID unavailable — opening native AR');
            openMobileScreenSelector();
        } else {
            showNotification(`Spatial VOID unavailable: ${err?.message || 'unsupported device'}`);
        }
    }
}

/** Secondary overlay: list every screen; tap one to place it in the room via native AR. */
function openMobileScreenSelector() {
    document.getElementById('void-mobile-selector')?.remove();
    const projectName = state.currentProjectName || 'Your Project';

    const wrap = document.createElement('div');
    wrap.id = 'void-mobile-selector';
    wrap.className = 'void-mobile-selector';

    const rows = state.screens
        .map((s, i) => {
            const count = s.group?.children?.filter((c) => c.userData && !c.userData.isEnvironment).length || 0;
            return `
            <li class="vms-row" data-screen="${s.id}">
                <span class="vms-index">${i + 1}</span>
                <span class="vms-meta">
                    <span class="vms-name">${escapeHtmlAttr(s.name)}</span>
                    <span class="vms-sub">${count} element${count === 1 ? '' : 's'}</span>
                </span>
                <span class="vms-ar-go">Place ›</span>
            </li>`;
        })
        .join('');

    wrap.innerHTML = `
        <div class="vms-card">
            <button type="button" class="vms-close" id="vms-close" aria-label="Done">Done</button>
            <div class="vms-head">
                <div class="vms-brand">VIEW IN AR</div>
                <h1 class="vms-title">${escapeHtmlAttr(projectName)}</h1>
                <p class="vms-tagline">Tap a screen to place it in your room with the iPhone camera.</p>
            </div>
            <ul class="vms-list">${rows}</ul>
        </div>
    `;
    document.body.appendChild(wrap);

    wrap.querySelector('#vms-close')?.addEventListener('click', () => wrap.remove());
    wrap.querySelectorAll('.vms-row').forEach((row) => {
        row.addEventListener('click', () => launchQuickLookForScreen(row.dataset.screen));
    });
}
function estimateQRPose(code, videoWidth, videoHeight) {
    const corners = [
        code.location.topLeftCorner,
        code.location.topRightCorner,
        code.location.bottomRightCorner,
        code.location.bottomLeftCorner
    ];

    const cx = videoWidth / 2;
    const cy = videoHeight / 2;
    const f = Math.max(videoWidth, videoHeight) * 0.85;
    const W = 0.15; // 15 cm QR code size

    const rays = corners.map(pt => {
        return new THREE.Vector3(
            (pt.x - cx) / f,
            -(pt.y - cy) / f,
            -1
        ).normalize();
    });

    const dist2D_top = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
    const dist2D_bottom = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
    const dist2D_left = Math.hypot(corners[0].x - corners[3].x, corners[0].y - corners[3].y);
    const dist2D_right = Math.hypot(corners[1].x - corners[2].x, corners[1].y - corners[2].y);
    const avgDist2D = (dist2D_top + dist2D_bottom + dist2D_left + dist2D_right) / 4;

    const initialZ = (f * W) / Math.max(1, avgDist2D);
    let Zs = [initialZ, initialZ, initialZ, initialZ];
    
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
    const iterations = 40;
    const lr = 0.05;

    for (let iter = 0; iter < iterations; iter++) {
        const C = Zs.map((z, i) => rays[i].clone().multiplyScalar(z));
        let grads = [0, 0, 0, 0];
        
        for (const [i, j] of edges) {
            const diff = C[i].clone().sub(C[j]);
            const distSq = diff.lengthSq();
            const Wsq = W * W;
            const error = distSq - Wsq;
            
            grads[i] += error * diff.dot(rays[i]);
            grads[j] -= error * diff.dot(rays[j]);
        }
        
        for (let i = 0; i < 4; i++) {
            Zs[i] -= lr * grads[i];
            Zs[i] = Math.max(0.1, Math.min(10.0, Zs[i]));
        }
    }

    const C = Zs.map((z, i) => rays[i].clone().multiplyScalar(z));
    const center = new THREE.Vector3();
    C.forEach(pt => center.add(pt));
    center.divideScalar(4);

    const xDir1 = C[1].clone().sub(C[0]);
    const xDir2 = C[2].clone().sub(C[3]);
    const x_axis = xDir1.add(xDir2).normalize();

    const yDir1 = C[0].clone().sub(C[3]);
    const yDir2 = C[1].clone().sub(C[2]);
    const y_axis = yDir1.add(yDir2).normalize();

    const z_axis = new THREE.Vector3().crossVectors(x_axis, y_axis).normalize();
    const orthogonal_y = new THREE.Vector3().crossVectors(z_axis, x_axis).normalize();

    const rotMatrix = new THREE.Matrix4().makeBasis(x_axis, orthogonal_y, z_axis);

    return { center, rotMatrix };
}

function createSpatialReticle() {
    const geo = new THREE.RingGeometry(0.08, 0.1, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
        color: 0x5be7ff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
    });
    const reticle = new THREE.Mesh(geo, mat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    reticle.name = 'SpatialPreviewReticle';
    return reticle;
}

function saveObjectPoseForSpatialPreview(object) {
    if (!object) return null;
    return {
        parent: object.parent || null,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone()
    };
}

function restoreObjectPoseForSpatialPreview(object, pose) {
    if (!object || !pose) return;
    if (pose.parent && object.parent !== pose.parent) {
        pose.parent.attach(object);
    }
    object.position.copy(pose.position);
    object.quaternion.copy(pose.quaternion);
    object.scale.copy(pose.scale);
}

function getSpatialPreviewAnchorRoots() {
    // Anchor whole screen for simplest convincing "placed UI board" behavior.
    const screenGroup = getActiveScreenGroup();
    if (!screenGroup) return [];
    return [screenGroup];
}

function updateSpatialPreviewHint(text) {
    const hint = document.getElementById('spatial-preview-hint');
    if (hint) hint.textContent = text;
}

function onSpatialXRSelect() {
    const xr = state.spatialXR;
    if (!xr || xr.placed || !xr.lastHit) return;
    xr.pendingPlace = true;
}

async function placeSpatialXRAnchor(frame) {
    const xr = state.spatialXR;
    if (!xr || xr.placed || !xr.lastHit || !state.scene) return;
    xr.pendingPlace = false;

    if (!xr.savedPoses.size) {
        xr.anchorTargets.forEach((target) => {
            xr.savedPoses.set(target.uuid, { object: target, pose: saveObjectPoseForSpatialPreview(target) });
        });
    }

    if (xr.lastHit.createAnchor) {
        try {
            xr.anchor = await xr.lastHit.createAnchor();
            xr.anchorSpace = xr.anchor.anchorSpace;
        } catch {
            xr.anchor = null;
            xr.anchorSpace = null;
        }
    }

    if (!xr.anchorSpace) {
        const pose = xr.lastHit.getPose(xr.refSpace);
        if (!pose) return;
        xr.anchorRoot.matrix.fromArray(pose.transform.matrix);
        xr.anchorRoot.matrix.decompose(xr.anchorRoot.position, xr.anchorRoot.quaternion, xr.anchorRoot.scale);
    }

    xr.anchorTargets.forEach((target) => xr.anchorRoot.attach(target));
    xr.placed = true;
    xr.reticle.visible = false;
    updateSpatialPreviewHint('Anchored in room. Walk around to inspect scale, depth and perspective.');
}

function updateSpatialXRFrame(_time, frame) {
    const xr = state.spatialXR;
    if (!xr || !frame) return;

    if (!xr.placed) {
        const hits = frame.getHitTestResults(xr.hitTestSource);
        if (hits.length > 0) {
            xr.lastHit = hits[0];
            const pose = xr.lastHit.getPose(xr.refSpace);
            if (pose) {
                xr.reticle.visible = true;
                xr.reticle.matrix.fromArray(pose.transform.matrix);
            }
        } else {
            xr.lastHit = null;
            xr.reticle.visible = false;
        }
    }

    if (xr.anchorSpace) {
        const anchorPose = frame.getPose(xr.anchorSpace, xr.refSpace);
        if (anchorPose) {
            xr.anchorRoot.matrix.fromArray(anchorPose.transform.matrix);
            xr.anchorRoot.matrix.decompose(xr.anchorRoot.position, xr.anchorRoot.quaternion, xr.anchorRoot.scale);
        }
    }

    if (xr.pendingPlace && !xr.placeLock) {
        xr.placeLock = true;
        placeSpatialXRAnchor(frame)
            .catch(() => {})
            .finally(() => {
                if (state.spatialXR) state.spatialXR.placeLock = false;
            });
    }

    state.renderer.render(state.scene, state.camera);
}

async function openSpatialPreviewXR(overlay, host) {
    if (!navigator.xr || !state.renderer || !state.scene) return false;
    const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    if (!supported) return false;

    const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor', 'hit-test'],
        optionalFeatures: ['anchors', 'plane-detection', 'depth-sensing', 'dom-overlay'],
        domOverlay: overlay ? { root: overlay } : undefined
    });

    state.savedSceneBackground = state.scene.background;
    state.scene.background = null;
    state.renderer.setClearAlpha(0);
    enterSpatialPreviewEnvironment();

    state.renderer.xr.enabled = true;
    await state.renderer.xr.setSession(session);
    host.appendChild(state.renderer.domElement);

    const refSpace = await session.requestReferenceSpace('local-floor');
    const viewerSpace = await session.requestReferenceSpace('viewer');
    const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

    const anchorRoot = new THREE.Group();
    anchorRoot.name = 'SpatialXRAnchorRoot';
    state.scene.add(anchorRoot);

    const reticle = createSpatialReticle();
    state.scene.add(reticle);

    state.spatialXR = {
        session,
        refSpace,
        viewerSpace,
        hitTestSource,
        anchor: null,
        anchorSpace: null,
        anchorRoot,
        reticle,
        lastHit: null,
        pendingPlace: false,
        placeLock: false,
        placed: false,
        savedPoses: new Map(),
        anchorTargets: getSpatialPreviewAnchorRoots()
    };

    session.addEventListener('select', onSpatialXRSelect);
    session.addEventListener('end', () => {
        if (state.spatialPreviewActive) closeSpatialPreview();
    });

    state.renderer.setAnimationLoop(updateSpatialXRFrame);
    state.spatialPreviewKind = 'xr';
    return true;
}

function teardownSpatialPreviewXR({ endSession = false } = {}) {
    const xr = state.spatialXR;
    if (!xr || !state.scene || !state.renderer) return;

    state.renderer.setAnimationLoop(null);

    xr.savedPoses.forEach(({ object, pose }) => {
        restoreObjectPoseForSpatialPreview(object, pose);
    });

    xr.hitTestSource?.cancel?.();
    if (xr.reticle?.parent) xr.reticle.parent.remove(xr.reticle);
    if (xr.anchorRoot?.parent) xr.anchorRoot.parent.remove(xr.anchorRoot);

    xr.session?.removeEventListener?.('select', onSpatialXRSelect);
    if (endSession && xr.session) {
        xr.session.end().catch(() => {});
    }

    state.renderer.xr.enabled = false;
    state.spatialXR = null;
}

/**
 * Position the perspective camera so the active screen is fully in frame, viewed
 * front-on (straight down -Z), out in space — the same orientation as the editor's
 * 2D front view. Distance is derived from the screen's bounding box and the camera FOV.
 */
function frameCameraToActiveScreen(margin = 1.18) {
    const cam = state.perspectiveCamera;
    if (!cam) return;
    const group = getActiveScreenGroup();
    const fallback = () => {
        cam.position.set(0, 0, 1.8);
        cam.quaternion.set(0, 0, 0, 1);
        cam.updateMatrixWorld(true);
    };
    if (!group) return fallback();

    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return fallback();

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const host = document.getElementById('spatial-preview-canvas-host');
    const aspect = host && host.clientHeight ? host.clientWidth / host.clientHeight : (cam.aspect || 16 / 9);
    const fov = (cam.fov || 50) * Math.PI / 180;
    const distV = (size.y / 2) / Math.tan(fov / 2);
    const distH = (size.x / 2) / (Math.tan(fov / 2) * aspect);
    const dist = Math.max(distV, distH, 0.5) * margin + size.z / 2;

    cam.aspect = aspect;
    cam.up.set(0, 1, 0);
    cam.position.set(center.x, center.y, center.z + dist);
    cam.lookAt(center); // directly in front → front-on, no tilt
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    if (state.controls) state.controls.target.copy(center);
}

async function openSpatialPreview(opts = false) {
    // Back-compat: callers pass a boolean (forceWebAR) or an options object.
    const o = typeof opts === 'boolean' ? { forceWebAR: opts } : (opts || {});
    const forceWebAR = !!o.forceWebAR || !!o.interactive;
    const interactive = !!o.interactive;
    state.spatialPreviewInteractive = interactive;

    const overlay = document.getElementById('spatial-preview-overlay');
    const video = document.getElementById('spatial-preview-video');
    const host = document.getElementById('spatial-preview-canvas-host');
    const mainVp = document.getElementById('viewport-3d');
    if (!overlay || !video || !host || !mainVp || !state.renderer || !state.scene) return;

    try {
        const isMobileDevice = /Android|iPad|iPhone|iPod/i.test(navigator.userAgent || '');

        // Desktop flow: show non-blocking QR + link while webcam preview runs.
        if (!isMobileDevice) {
            openDesktopMobilePreviewShareDialog();
        }

        // iPhone Safari: Quick Look gives the most reliable room-anchored AR today.
        if (isIPhoneSafari() && !forceWebAR) {
            await launchQuickLookForActiveScreen();
            return;
        }

        const openedXR = await openSpatialPreviewXR(overlay, host).catch(() => false);
        if (openedXR) {
            if (video) {
                video.srcObject = null;
                video.style.display = 'none';
            }
            state.spatialPreviewActive = true;
            overlay.classList.add('is-open');
            overlay.setAttribute('aria-hidden', 'false');
            onWindowResize();
            updateSpatialPreviewHint('Move device to detect floor/walls, then tap to anchor UI in space.');
            showNotification('Spatial AR preview');
            updateTransformControlsForViewMode();
            return;
        }

        state.spatialPreviewKind = 'camera';
        if (video) video.style.display = '';
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

        // Save the original active camera's pose/controls BEFORE we override anything, so
        // close() can restore the editor exactly as it was.
        state.savedViewModeForPreview = state.viewMode;
        state.savedActiveCameraForPreview = state.camera;
        state.savedCameraPosition = state.camera.position.clone();
        state.savedCameraQuaternion = state.camera.quaternion.clone();
        state.savedControlsTarget = state.controls ? state.controls.target.clone() : null;
        state.savedControlsEnabled = state.controls ? state.controls.enabled : true;

        // Camera passthrough AR needs the PERSPECTIVE camera so the live video and the 3D
        // projection match. In 2D the active camera is orthographic and sits in the UI plane,
        // which renders the screen edge-on — switch to perspective before framing.
        if (state.camera !== state.perspectiveCamera) {
            switchActiveCamera(state.perspectiveCamera);
        }

        if (state.controls) state.controls.enabled = false;
        if (o.qr) {
            // Legacy QR-anchored mode (secondary): camera represents the phone at origin and
            // the active screen is moved onto the detected QR pose each frame.
            state.spatialPreviewQRMode = true;
            state.camera.position.set(0, 0, 0);
            state.camera.quaternion.set(0, 0, 0, 1);
        } else {
            // Default: frame the active screen front-on and out in space, matching the exact
            // orientation seen in the editor's front (2D) view. Tap-to-navigate in interactive.
            state.spatialPreviewQRMode = false;
            switchToScreen(state.activeScreenId || state.screens[0]?.id, { silent: true });
            frameCameraToActiveScreen(1.18);
            if (interactive && state.editorMode !== 'prototype') setEditorMode('prototype');
        }

        // On iOS Safari in Web AR mode, show a switch button to native Quick Look
        if (isIPhoneSafari()) {
            const chrome = document.querySelector('#spatial-preview-overlay .spatial-preview-chrome');
            if (chrome && !document.getElementById('spatial-preview-ql-switch')) {
                const qlBtn = document.createElement('button');
                qlBtn.type = 'button';
                qlBtn.className = 'btn-primary';
                qlBtn.id = 'spatial-preview-ql-switch';
                qlBtn.style.cssText = 'margin-left:12px; padding:8px 12px; border-radius:8px; border:none; background:#4f46e5; color:white; font-size:12px; font-weight:600; cursor:pointer;';
                qlBtn.textContent = 'Switch to iOS Quick Look';
                qlBtn.addEventListener('click', () => {
                    closeSpatialPreview();
                    launchQuickLookForActiveScreen();
                });
                chrome.appendChild(qlBtn);
            }
        }

        host.appendChild(state.renderer.domElement);
        state.spatialPreviewActive = true;
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
        onWindowResize();

        updateSpatialPreviewHint(
            interactive
                ? 'Interactive AR — tap buttons to navigate between screens.'
                : o.qr
                    ? 'Point camera at the QR code on your screen to anchor UI.'
                    : 'Your UI in space. Scan the share QR to open it on your iPhone.'
        );
        showNotification(interactive ? 'Interactive AR preview' : 'Spatial preview');
        updateTransformControlsForViewMode();
    } catch (err) {
        state.spatialPreviewKind = null;
        showNotification(`Camera unavailable: ${err?.message || 'Permission denied'}`);
    }
}

function closeSpatialPreview() {
    const overlay = document.getElementById('spatial-preview-overlay');
    const mainVp = document.getElementById('viewport-3d');
    const video = document.getElementById('spatial-preview-video');

    if (state.spatialPreviewKind === 'xr') {
        teardownSpatialPreviewXR({ endSession: true });
    }

    if (state.spatialPreviewStream) {
        state.spatialPreviewStream.getTracks().forEach((t) => t.stop());
        state.spatialPreviewStream = null;
    }
    if (video) {
        video.srcObject = null;
        video.style.display = '';
    }
    if (state.renderer?.domElement && mainVp) {
        mainVp.appendChild(state.renderer.domElement);
    }

    // Clean up iOS Quick Look switcher button
    const qlBtn = document.getElementById('spatial-preview-ql-switch');
    if (qlBtn) qlBtn.remove();

    // Restore original screen group position and orientation
    if (state.originalScreenPoses) {
        for (const [uuid, pose] of state.originalScreenPoses.entries()) {
            const screen = state.screens.find(s => s.group.uuid === uuid);
            if (screen) {
                screen.group.position.copy(pose.position);
                screen.group.quaternion.copy(pose.quaternion);
                screen.group.scale.copy(pose.scale);
            }
        }
        state.originalScreenPoses = null;
    }

    // Restore the active camera object (we forced perspective for the AR passthrough).
    if (state.savedActiveCameraForPreview) {
        if (state.camera !== state.savedActiveCameraForPreview) {
            switchActiveCamera(state.savedActiveCameraForPreview);
        }
        state.savedActiveCameraForPreview = null;
        state.savedViewModeForPreview = null;
    }

    // Restore original camera pose and controls state
    if (state.savedCameraPosition) {
        state.camera.position.copy(state.savedCameraPosition);
        state.camera.quaternion.copy(state.savedCameraQuaternion);
        state.savedCameraPosition = null;
    }
    if (state.controls && state.savedControlsTarget) {
        state.controls.target.copy(state.savedControlsTarget);
        state.controls.enabled = state.savedControlsEnabled;
        state.controls.update();
        state.savedControlsTarget = null;
    }

    // Restore ground / grid / guides before moving renderer back to the main viewport.
    exitSpatialPreviewEnvironment();
    if (state.scene) {
        if (state.savedSceneBackground !== null && state.savedSceneBackground !== undefined) {
            state.scene.background = state.savedSceneBackground;
        } else {
            state.scene.background = new THREE.Color(0x0f0f0f);
        }
        state.savedSceneBackground = null;
    }
    if (state.renderer) state.renderer.setClearAlpha(1);
    // Leave interactive AR: drop prototype mode back to design so the editor is normal.
    if (state.spatialPreviewInteractive) {
        if (state.editorMode === 'prototype') setEditorMode('design');
        state.spatialPreviewInteractive = false;
    }
    state.spatialPreviewActive = false;
    state.spatialPreviewKind = null;
    if (overlay) {
        overlay.classList.remove('is-open');
        overlay.setAttribute('aria-hidden', 'true');
    }
    document.getElementById('void-mobile-preview-share')?.remove();
    // Bring the mobile screen-selector back if it was hidden behind interactive AR.
    const mobileSel = document.getElementById('void-mobile-selector');
    if (mobileSel) mobileSel.style.display = '';
    onWindowResize();
    updateTransformControlsForViewMode();
    showNotification('Preview closed');
}

function initializeEditorModeAndSpatialPreview() {
    document.getElementById('btn-mode-design')?.addEventListener('click', () => setEditorMode('design'));
    document.getElementById('prototype-mode-btn')?.addEventListener('click', () => setEditorMode('prototype'));
    document.getElementById('btn-exit-prototype')?.addEventListener('click', () => setEditorMode('design'));
    document.getElementById('spatial-preview-btn')?.addEventListener('click', () => openSpatialPreview());
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

    setViewMode('2d');
}

/**
 * Switch onboarding / shell phase. Does not alter editor DOM; only visibility + deferred init.
 */
function setAppPhase(phase) {
    const allowed = ['login', 'dashboard', 'templates', 'editor'];
    if (!allowed.includes(phase)) return;
    const prev = state.appPhase;
    state.appPhase = phase;

    const login = document.getElementById('phase-login');
    const dash = document.getElementById('phase-dashboard');
    const templates = document.getElementById('phase-templates');
    const editor = document.getElementById('phase-editor');
    const nav = document.getElementById('app-top-nav');

    if (login) login.hidden = phase !== 'login';
    if (dash) dash.hidden = phase !== 'dashboard';
    if (templates) templates.hidden = phase !== 'templates';
    if (editor) editor.hidden = phase !== 'editor';
    if (nav) nav.hidden = phase === 'login';

    if (phase === 'templates') renderTemplatePicker();

    if (phase === 'login') {
        initLoginScene();
        stopTopNavStarfield();
    } else if (prev === 'login' && phase !== 'login') {
        disposeLoginScene();
    }

    if (phase === 'dashboard' || phase === 'templates' || phase === 'editor') {
        requestAnimationFrame(() => initTopNavStarfield());
    }

    if (phase === 'editor') {
        ensureEditorExperienceInitialized();
        requestAnimationFrame(() => {
            onWindowResize();
        });
        scheduleEditorTutorialOnce();
    }
}

// Map the dashboard's "recent project" cards to the matching starter template.
const DASHBOARD_CARD_TEMPLATE = {
    'Meditation App': 'aura',
    'Product Demo': 'orbit',
    'XR Workshop': 'forge'
};

/**
 * Load a starter template into the editor: initialize the editor, then rebuild
 * the scene from the template's Void export and open it in design view.
 */
function loadTemplateProject(templateId) {
    const data = buildTemplateExport(templateId);
    if (!data) {
        // Unknown id → treat as blank project.
        openBlankProject();
        return;
    }
    setAppPhase('editor');
    const ok = applyVoidImport(data);
    if (ok) {
        const meta = VOID_TEMPLATES.find((t) => t.id === templateId);
        state.currentProjectName = meta?.projectName || 'Untitled';
        if (typeof setViewMode === 'function') setViewMode('2d');
        showNotification(`Opened “${state.currentProjectName}” template`);
    }
}

function openBlankProject() {
    setAppPhase('editor');
    state.currentProjectName = 'Untitled';
    if (typeof setViewMode === 'function') setViewMode('2d');
}

/** Render the template picker cards from the shared VOID_TEMPLATES catalog. */
function renderTemplatePicker() {
    const grid = document.getElementById('templates-grid');
    if (!grid || grid.dataset.rendered === '1') return;

    const blank = document.createElement('article');
    blank.className = 'dashboard-project-card dashboard-project-card--new template-card';
    blank.setAttribute('role', 'button');
    blank.tabIndex = 0;
    blank.dataset.template = 'blank';
    blank.innerHTML = `
        <div class="dashboard-card-thumb">
            <i data-lucide="plus"></i>
        </div>
        <div class="dashboard-card-info">
            <span class="dashboard-project-name">Blank Canvas</span>
            <span class="dashboard-project-meta">Start from an empty screen</span>
        </div>`;
    grid.appendChild(blank);

    VOID_TEMPLATES.forEach((t) => {
        const card = document.createElement('article');
        card.className = 'dashboard-project-card template-card';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.dataset.template = t.id;
        card.innerHTML = `
            <div class="dashboard-card-thumb template-card-thumb" style="--tpl-accent:${t.accent}">
                <span class="template-card-glyph" style="background:${t.accent}"></span>
                <span class="template-card-screens">${t.screens} screens</span>
            </div>
            <div class="dashboard-card-info">
                <span class="dashboard-project-name">${t.projectName}</span>
                <span class="dashboard-project-meta">${t.tagline}</span>
                <span class="dashboard-device-tag">${t.device}</span>
            </div>`;
        grid.appendChild(card);
    });

    grid.addEventListener('click', (e) => {
        const card = e.target.closest('.template-card');
        if (!card) return;
        const id = card.dataset.template;
        if (id === 'blank') openBlankProject();
        else loadTemplateProject(id);
    });
    grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.template-card');
        if (!card) return;
        e.preventDefault();
        if (card.dataset.template === 'blank') openBlankProject();
        else loadTemplateProject(card.dataset.template);
    });

    grid.dataset.rendered = '1';
    initializeLucideIcons();
}

function initializeOnboardingFlow() {
    document.getElementById('btn-onboarding-login')?.addEventListener('click', () => {
        setAppPhase('dashboard');
    });
    document.getElementById('btn-onboarding-guest')?.addEventListener('click', () => {
        setAppPhase('templates');
    });
    // New Project → template picker
    document.getElementById('btn-onboarding-create-project')?.addEventListener('click', () => {
        setAppPhase('templates');
    });
    document.getElementById('dashboard-new-project-card')?.addEventListener('click', () => {
        setAppPhase('templates');
    });
    // Recent project cards → load their matching template directly
    document.querySelector('#phase-dashboard .dashboard-project-grid')?.addEventListener('click', (e) => {
        const card = e.target.closest('.dashboard-project-card');
        if (!card || card.id === 'dashboard-new-project-card') return;
        const name = card.querySelector('.dashboard-project-name')?.textContent?.trim() || '';
        const tplId = DASHBOARD_CARD_TEMPLATE[name];
        if (tplId) loadTemplateProject(tplId);
        else openBlankProject();
    });
    document.getElementById('templates-back')?.addEventListener('click', () => {
        setAppPhase('dashboard');
    });
    document.getElementById('app-nav-dashboard')?.addEventListener('click', () => {
        if (state.appPhase === 'editor' || state.appPhase === 'templates') {
            if (state.spatialPreviewActive) closeSpatialPreview();
            setAppPhase('dashboard');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 XR Spatial UI Designer Initialized');
    initializeThemeToggle();
    initializeLucideIcons();
    applyGlobalTooltips();
    initializePropertySectionIcons();

    initializeOnboardingFlow();
    initializeHelpTutorialMenu();

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

    initializeScreensUI();
    initializeEnvironmentsUI();
    initializePropertySectionIcons();
    initializeLucideIcons();
    applyGlobalTooltips();
    updateViewportEmptyState();

    // 3D viewport + scene: deferred until setAppPhase('editor') — see ensureEditorExperienceInitialized().

    console.log('Initial state:', state);

    initVoidRemoteSync();

    // A scanned QR opens the clean phone viewer directly — never flash login/editor chrome.
    // ?voidPreview=1 opens the clean template-preview harness (for design iteration).
    if (isTemplatePreviewUrl()) {
        enterTemplatePreview();
    } else if (isMobilePreviewUrl()) {
        enterMobilePreviewExperience();
    } else {
        setAppPhase('login');
    }
});

// ===== EXPORT FOR DEBUGGING =====
function initializeHelpTutorialMenu() {
    document.getElementById('menu-restart-tutorial')?.addEventListener('click', (e) => {
        e.stopPropagation();
        teardownTutorial();
        document.querySelectorAll('.tutorial-done-modal').forEach((el) => el.remove());
        if (state.appPhase !== 'editor') {
            showNotification('Open a project first, then use Help → Restart tutorial.');
            return;
        }
        if (!state.editorExperienceInitialized) ensureEditorExperienceInitialized();
        initTutorial();
        showNotification('Tutorial restarted');
        initializeLucideIcons();
    });
}

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
    applyVoidImport,
    applyViewportZoomToCameras,
    createScreen,
    switchToScreen,
    setAppPhase,
    ensureEditorExperienceInitialized,
    initTutorial
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

    document.getElementById('btn-change-image')?.addEventListener('click', () => {
        openImageFilePicker(state.selectedObject);
    });
    
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
