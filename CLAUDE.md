# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
npm install        # first time only
npm run dev        # dev server at http://localhost:8000
npm run build      # production build to dist/
```

## Architecture

**Stack:** Vite + Vanilla ES6 JS + Three.js (npm) + CSS3. No frameworks.

**Three files are the entire app:**
- `index.html` — all DOM structure (editor layout, sidebars, viewport, panels, toolbar)
- `main.js` — all JavaScript (~1150 lines, single ES6 module)
- `styles.css` — all styling (dark theme, CSS custom properties)

**main.js internals:** One centralized `state` object owns all mutable state (activeTool, selectedObject, Three.js scene/camera/renderer/controls, objects array). Everything initializes on `DOMContentLoaded`. Exposes `window.VoidApp` for browser console access.

**Three.js setup:** `initialize3DViewport()` creates scene, PerspectiveCamera, WebGLRenderer, lights, grid. Object selection uses `state.raycaster` on canvas click. `OrbitControls` handles camera; `TransformControls` handles move/rotate/scale gizmos.

**UI wiring:** `setupEventListeners()` wires everything using `data-*` HTML attributes (`data-tool`, `data-tab`, etc.). Properties panel refreshes via `updatePropertiesPanel()` reading `state.selectedObject`. User feedback via `showNotification(message, type)`.

**Materials:** Flat / Metallic / Glass / Glow presets applied to `MeshStandardMaterial` or `MeshPhysicalMaterial`.

## What Phase 1 MVP Needs Next

Refer to `PROJECT_STATUS.md` and `.cursor/rules/void-project.mdc` for the full build list. In short:
1. Screens system (multiple named XR screens per project)
2. XR UI components (Button, Panel, Text Label — not raw 3D primitives)
3. Screen linking (Button → navigate to Screen X, no code)
4. Spatial properties panel (distance/height/angle, not raw XYZ)
5. JSON export / save scene

Do not add React/Vue/TypeScript. Do not add a backend. Keep vanilla JS.
