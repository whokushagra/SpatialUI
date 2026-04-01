# Void — Project Status

**Last updated:** April 2026

---

## What is Void?

Void is your tool for designing XR app interfaces without needing to write any code.

Think of it like **Figma** — but instead of designing flat websites, you're designing menus and interfaces that float in 3D space for devices like **Meta Quest** and **Apple Vision Pro**.

With Void, a designer can:
- Build menus and UI screens visually, drag-and-drop style
- Connect buttons to other screens ("Settings button → opens Settings screen")
- Connect buttons to game events ("Start button → starts the Unity experience")
- Preview everything live on a real headset
- Export to Unity without writing a single line of code

---

## How to Run Void on Your Computer

**First time setup (do this once):**
1. Make sure **Node.js** is installed → [nodejs.org](https://nodejs.org) (download the LTS version)
2. Open **Terminal** and navigate to this project folder
3. Run: `npm install`

**Every time you want to work:**
1. Open Terminal in the project folder
2. Run: `npm run dev`
3. Open your browser to: **http://localhost:8000**

To stop: press `Ctrl + C` in Terminal

---

## What's Already Built ✅

These features are fully working in the app right now:

- **Editor Layout** — The full Figma-like interface: left sidebar, 3D canvas in the center, properties panel on the right, tool bar at the bottom
- **3D Viewport** — A real 3D scene using Three.js where you can see and design your XR space
- **Camera Controls** — Orbit, zoom, pan around your scene with the mouse
- **3D Objects** — Create boxes, spheres, and cylinders and place them in 3D space
- **Select & Transform** — Click to select objects, then move (G), rotate (R), or scale (S) with gizmos
- **Materials** — 4 visual styles for objects: Flat, Metallic, Glass, Glow
- **Lighting** — Ambient light, directional sun light, add point lights anywhere
- **Dark Premium UI** — The editor already looks like a professional design tool

---

## What We're Building Now — Phase 1 MVP

These are the features that turn this from a 3D sandbox into a real XR design tool:

- [ ] **Screens System** — Create multiple named XR screens ("Main Menu", "Settings", "Game Over"). Each screen is its own layout. Switch between them in the editor just like switching pages in Figma.

- [ ] **XR UI Components** — A library of actual interface pieces: Button (with label), Panel (background container), Text Label, Image Placeholder. These replace the raw 3D boxes — they're what real XR UIs are made of.

- [ ] **Screen Linking** — The core Void feature: click a button, then in the Properties panel say "When clicked → go to Settings screen." No code. The button now knows where it leads.

- [ ] **Spatial Properties** — Show positioning in XR terms: "2 meters in front of user, 1.6m high, facing the user." Not confusing X/Y/Z coordinates — designer language.

- [ ] **Save to File** — Export your design as a `.void.json` file. This is the first step toward Unity integration.

---

## What Comes After Phase 1

**Phase 2 — Live Preview & First Export**
- See your design live on Meta Quest wirelessly while you edit
- Apple Vision Pro support
- First Unity export — import your Void design into a Unity project

**Phase 3 — The Full Platform**
- Design with teammates in real-time (like Figma collaboration)
- Component marketplace
- Full Unity + Unreal Engine bridge
- Deploy directly to headsets without Unity

---

## The Big Picture

**Gap Void fills:** No tool today combines visual spatial UI design + drag-and-drop screen linking + live XR testing + Unity export in one designer-friendly package. That's exactly what Void is building.

**Who it's for:** UI/UX designers, product designers, and creative people who want to build XR experiences without becoming Unity/Unreal engineers.

---

*Note for AI assistants: When you finish building a feature from the Phase 1 list above, check the box (change `- [ ]` to `- [x]`) and add a short note about what was built. Keep this file accurate.*
