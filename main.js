// ===== THREE.JS IMPORTS =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// ===== APPLICATION STATE =====
const state = {
    activeTool: 'select',
    activeTab: 'layers',
    selectedObject: null,
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
    selectableObjects: []
};

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

    // Create Camera
    const width = viewportElement.clientWidth;
    const height = viewportElement.clientHeight;
    state.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    state.camera.position.set(3, 3, 3);
    state.camera.lookAt(0, 0, 0);

    // Create Renderer
    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setSize(width, height);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    viewportElement.appendChild(state.renderer.domElement);

    // Add Orbit Controls
    state.controls = new OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.05;
    state.controls.screenSpacePanning = false;
    state.controls.minDistance = 1;
    state.controls.maxDistance = 50;
    state.controls.maxPolarAngle = Math.PI / 1.5;

    // Add Transform Controls
    state.transformControls = new TransformControls(state.camera, state.renderer.domElement);
    state.transformControls.addEventListener('dragging-changed', (event) => {
        state.controls.enabled = !event.value;
    });
    state.transformControls.addEventListener('change', () => {
        if (state.selectedObject) {
            updatePropertiesFromObject(state.selectedObject);
        }
    });
    state.scene.add(state.transformControls);

    // Setup Raycaster
    state.raycaster = new THREE.Raycaster();
    state.mouse = new THREE.Vector2();
    state.renderer.domElement.addEventListener('click', onViewportClick);
    state.renderer.domElement.addEventListener('dblclick', onViewportDoubleClick);

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

    // Add Sample 3D Objects
    addSampleObjects();

    // Add Axes Helper
    const axesHelper = new THREE.AxesHelper(2);
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
    state.scene.add(gridHelper);
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

    state.scene.add(safeZone);
}

// ===== ADD SAMPLE OBJECTS =====
function addSampleObjects() {
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
        state.scene.add(mesh);
        state.objects.push(mesh);
        state.selectableObjects.push(mesh);
    });

    // Ground plane
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    plane.name = 'Ground';
    state.scene.add(plane);
}

// ===== OBJECT SELECTION =====
function onViewportClick(event) {
    if (state.activeTool !== 'select') return;

    const rect = state.renderer.domElement.getBoundingClientRect();
    state.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    state.raycaster.setFromCamera(state.mouse, state.camera);
    const intersects = state.raycaster.intersectObjects(state.selectableObjects);

    if (intersects.length > 0) {
        selectObject(intersects[0].object);
    } else {
        deselectObject();
    }
}

function onViewportDoubleClick() {
    if (state.selectedObject) {
        focusOnObject(state.selectedObject);
    }
}

function selectObject(object) {
    if (state.selectedObject) deselectObject();

    state.selectedObject = object;
    object.userData.originalColor = object.material.color.getHex();
    object.material.emissive = new THREE.Color(0x6366f1);
    object.material.emissiveIntensity = 0.3;

    state.transformControls.attach(object);
    showPropertiesPanel();
    updatePropertiesFromObject(object);
    updateAppearanceFromObject(object);


    showNotification(`Selected: ${object.name}`);
}

function deselectObject() {
    if (!state.selectedObject) return;

    state.selectedObject.material.emissive = new THREE.Color(0x000000);
    state.selectedObject.material.emissiveIntensity = 0;
    state.transformControls.detach();
    state.selectedObject = null;
    hidePropertiesPanel();
}

function focusOnObject(object) {
    const targetPosition = object.position.clone();
    const distance = 3;
    const direction = state.camera.position.clone().sub(targetPosition).normalize();
    const newPosition = targetPosition.clone().add(direction.multiplyScalar(distance));
    animateCameraTo(newPosition, targetPosition);
}

// ===== UPDATE PROPERTIES =====
function updatePropertiesFromObject(object) {
    const inputs = document.querySelectorAll('.property-group input[type="number"]');
    if (inputs.length >= 9) {
        inputs[0].value = object.position.x.toFixed(2);
        inputs[1].value = object.position.y.toFixed(2);
        inputs[2].value = object.position.z.toFixed(2);
        inputs[3].value = THREE.MathUtils.radToDeg(object.rotation.x).toFixed(0);
        inputs[4].value = THREE.MathUtils.radToDeg(object.rotation.y).toFixed(0);
        inputs[5].value = THREE.MathUtils.radToDeg(object.rotation.z).toFixed(0);
        inputs[6].value = object.scale.x.toFixed(2);
        inputs[7].value = object.scale.y.toFixed(2);
        inputs[8].value = object.scale.z.toFixed(2);
    }
}

function updateObjectFromProperties() {
    if (!state.selectedObject) return;

    const inputs = document.querySelectorAll('.property-group input[type="number"]');
    if (inputs.length >= 9) {
        state.selectedObject.position.x = parseFloat(inputs[0].value) || 0;
        state.selectedObject.position.y = parseFloat(inputs[1].value) || 0;
        state.selectedObject.position.z = parseFloat(inputs[2].value) || 0;
        state.selectedObject.rotation.x = THREE.MathUtils.degToRad(parseFloat(inputs[3].value) || 0);
        state.selectedObject.rotation.y = THREE.MathUtils.degToRad(parseFloat(inputs[4].value) || 0);
        state.selectedObject.rotation.z = THREE.MathUtils.degToRad(parseFloat(inputs[5].value) || 0);
        state.selectedObject.scale.x = parseFloat(inputs[6].value) || 1;
        state.selectedObject.scale.y = parseFloat(inputs[7].value) || 1;
        state.selectedObject.scale.z = parseFloat(inputs[8].value) || 1;
    }
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
    mesh.position.set(0, 0.5, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${type.charAt(0).toUpperCase() + type.slice(1)} ${state.objects.length + 1}`;
    mesh.userData.selectable = true;

    state.scene.add(mesh);
    state.objects.push(mesh);
    state.selectableObjects.push(mesh);
    selectObject(mesh);

    showNotification(`Created: ${mesh.name}`);
    return mesh;
}

// ===== DELETE OBJECT =====
function deleteSelectedObject() {
    if (!state.selectedObject) return;

    const name = state.selectedObject.name;
    state.scene.remove(state.selectedObject);
    state.objects = state.objects.filter(obj => obj !== state.selectedObject);
    state.selectableObjects = state.selectableObjects.filter(obj => obj !== state.selectedObject);

    state.selectedObject.geometry.dispose();
    state.selectedObject.material.dispose();
    deselectObject();

    showNotification(`Deleted: ${name}`);
}

// ===== TRANSFORM MODE =====
function setTransformMode(mode) {
    if (!state.transformControls) return;
    state.transformControls.setMode(mode);
    showNotification(`Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
}

// ===== ANIMATION LOOP =====
function animate() {
    requestAnimationFrame(animate);

    if (state.controls) state.controls.update();

    state.objects.forEach((obj, index) => {
        if (!state.selectedObject || obj !== state.selectedObject) {
            obj.rotation.y += 0.005 * (index + 1);
        }
    });

    updateViewportPosition();

    if (state.renderer && state.scene && state.camera) {
        state.renderer.render(state.scene, state.camera);
    }
}

// ===== WINDOW RESIZE =====
function onWindowResize() {
    const viewportElement = document.getElementById('viewport-3d');
    if (!viewportElement || !state.camera || !state.renderer) return;

    const width = viewportElement.clientWidth;
    const height = viewportElement.clientHeight;

    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(width, height);
}

// ===== UPDATE VIEWPORT INFO =====
function updateViewportPosition() {
    if (!state.camera) return;

    const viewportValue = document.querySelector('.viewport-value');
    if (viewportValue) {
        const pos = state.camera.position;
        viewportValue.textContent =
            `X: ${pos.x.toFixed(1)}m, Y: ${pos.y.toFixed(1)}m, Z: ${pos.z.toFixed(1)}m`;
    }
}

// ===== CAMERA VIEW PRESETS =====
function setCameraView(view) {
    if (!state.camera || !state.controls) return;

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

    function updateCamera() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        state.camera.position.lerpVectors(startPosition, targetPosition, eased);
        state.camera.lookAt(targetLookAt || new THREE.Vector3(0, 0, 0));

        if (progress < 1) {
            requestAnimationFrame(updateCamera);
        } else {
            state.controls.target.copy(targetLookAt || new THREE.Vector3(0, 0, 0));
            state.controls.update();
        }
    }

    updateCamera();
}

// ===== TOGGLE GRID/SAFE ZONE =====
function toggleGrid() {
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
            }

            showNotification(`Tool: ${tool.charAt(0).toUpperCase() + tool.slice(1)}`);
        });
    });
}

// ===== LAYER SELECTION =====
function initializeLayers() {
    const layerItems = document.querySelectorAll('.layer-item');

    layerItems.forEach(layer => {
        layer.addEventListener('click', (e) => {
            e.stopPropagation();
            layerItems.forEach(l => l.classList.remove('active'));
            layer.classList.add('active');
            showPropertiesPanel();
        });
    });

    const toggles = document.querySelectorAll('.layer-toggle');
    toggles.forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle.textContent = toggle.textContent === '▼' ? '▶' : '▼';
        });
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

    sectionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const collapseBtn = header.querySelector('.collapse-btn');

            if (content.style.display === 'none') {
                content.style.display = 'block';
                collapseBtn.textContent = '−';
            } else {
                content.style.display = 'none';
                collapseBtn.textContent = '+';
            }
        });
    });

    // Add input listeners
    const propertyInputs = document.querySelectorAll('.property-group input[type="number"]');
    propertyInputs.forEach(input => {
        input.addEventListener('change', updateObjectFromProperties);
        input.addEventListener('input', updateObjectFromProperties);
    });
}

// ===== VIEWPORT CONTROLS =====
function initializeViewportControls() {
    const viewButtons = document.querySelectorAll('.viewport-controls .icon-button');

    viewButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
            if (index === 0) {
                setCameraView('top');
                viewButtons.slice(0, 4).forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                showNotification('View: Top');
            } else if (index === 1) {
                setCameraView('front');
                viewButtons.slice(0, 4).forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                showNotification('View: Front');
            } else if (index === 2) {
                setCameraView('side');
                viewButtons.slice(0, 4).forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                showNotification('View: Side');
            } else if (index === 3) {
                setCameraView('isometric');
                viewButtons.slice(0, 4).forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                showNotification('View: Isometric');
            } else if (index === 5) {
                button.classList.toggle('active');
                const isVisible = toggleGrid();
                showNotification(`Grid: ${isVisible ? 'On' : 'Off'}`);
            } else if (index === 6) {
                button.classList.toggle('active');
                const isVisible = toggleSafeZone();
                showNotification(`Safe Zone: ${isVisible ? 'On' : 'Off'}`);
            }
        });
    });
}

// ===== ZOOM CONTROLS =====
function initializeZoomControls() {
    const zoomButtons = document.querySelectorAll('.zoom-control .icon-button');
    const zoomDisplay = document.querySelector('.zoom-control span');

    zoomButtons[0].addEventListener('click', () => {
        state.viewport.zoom = Math.max(10, state.viewport.zoom - 10);
        zoomDisplay.textContent = `${state.viewport.zoom}%`;
        if (state.camera) {
            state.camera.fov = 75 * (100 / state.viewport.zoom);
            state.camera.updateProjectionMatrix();
        }
    });

    zoomButtons[1].addEventListener('click', () => {
        state.viewport.zoom = Math.min(400, state.viewport.zoom + 10);
        zoomDisplay.textContent = `${state.viewport.zoom}%`;
        if (state.camera) {
            state.camera.fov = 75 * (100 / state.viewport.zoom);
            state.camera.updateProjectionMatrix();
        }
    });
}

// ===== KEYBOARD SHORTCUTS =====
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
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
                case 'f':
                    e.preventDefault();
                    focusOnObject(state.selectedObject);
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
                    showNotification('Save');
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

// ===== ASSET/COLOR/PAGE INTERACTIONS =====
function initializeAssets() {
    const assetCards = document.querySelectorAll('.asset-card');
    assetCards.forEach(card => {
        card.addEventListener('click', () => {
            const assetName = card.querySelector('.asset-name').textContent;
            showNotification(`Selected: ${assetName}`);
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

function initializePages() {
    const pageItems = document.querySelectorAll('.page-item');
    pageItems.forEach(page => {
        page.addEventListener('click', () => {
            pageItems.forEach(p => p.classList.remove('active'));
            page.classList.add('active');
            const pageName = page.querySelector('.page-name').textContent;
            showNotification(`Switched to: ${pageName}`);
        });
    });
}

// ===== INITIALIZE APPLICATION =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 XR Spatial UI Designer Initialized');

    initializeSidebarTabs();
    initializeToolbar();
    initializeLayers();
    initializePropertySections();
    initializeViewportControls();
    initializeZoomControls();
    initializeKeyboardShortcuts();
    initializeAssets();
    initializeAppearanceControls();
    initializeLightingControls();


    initializeColors();
    initializePages();
    initialize3DViewport();

    setTimeout(() => {
        showNotification('Welcome to XR Spatial UI Designer! 🎨');
    }, 500);

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
    deleteSelectedObject
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
            
            if (state.selectedObject) {
                state.selectedObject.material.color.set(color);
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
            
            if (state.selectedObject) {
                state.selectedObject.material.opacity = opacity;
                state.selectedObject.material.transparent = opacity < 1;
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
            
            if (state.selectedObject && state.selectedObject.material.metalness !== undefined) {
                state.selectedObject.material.metalness = metalness;
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
            
            if (state.selectedObject && state.selectedObject.material.roughness !== undefined) {
                state.selectedObject.material.roughness = roughness;
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

// ===== APPLY MATERIAL TYPE =====
function applyMaterialType(object, type) {
    const currentColor = object.material.color.getHex();
    const geometry = object.geometry;
    
    // Dispose old material
    object.material.dispose();
    
    switch(type) {
        case 'standard':
            object.material = new THREE.MeshStandardMaterial({
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
            object.material = new THREE.MeshStandardMaterial({
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
            object.material = new THREE.MeshPhysicalMaterial({
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
            object.material = new THREE.MeshStandardMaterial({
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
    
    object.material.needsUpdate = true;
}

// ===== UPDATE APPEARANCE FROM OBJECT =====
function updateAppearanceFromObject(object) {
    // Color
    const colorHex = '#' + object.material.color.getHexString();
    const colorPicker = document.getElementById('object-color');
    const colorHexDisplay = document.getElementById('color-hex-display');
    
    if (colorPicker) colorPicker.value = colorHex;
    if (colorHexDisplay) colorHexDisplay.textContent = colorHex;
    
    // Opacity
    const opacity = (object.material.opacity !== undefined ? object.material.opacity : 1.0) * 100;
    const opacitySlider = document.getElementById('object-opacity');
    const opacityValue = document.getElementById('opacity-value');
    
    if (opacitySlider) opacitySlider.value = opacity.toFixed(0);
    if (opacityValue) opacityValue.textContent = opacity.toFixed(0);
    
    // Metalness & Roughness
    if (object.material.metalness !== undefined) {
        const metalness = object.material.metalness * 100;
        const metalnessSlider = document.getElementById('object-metalness');
        const metalnessValue = document.getElementById('metalness-value');
        
        if (metalnessSlider) metalnessSlider.value = metalness.toFixed(0);
        if (metalnessValue) metalnessValue.textContent = metalness.toFixed(0);
    }
    
    if (object.material.roughness !== undefined) {
        const roughness = object.material.roughness * 100;
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
    
    state.scene.add(pointLight);
    state.lights.points.push(pointLight);
    
    // Make it selectable
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
