#XR Spatial UI Designer

A web-based design platform for creating spatial user interfaces for XR devices (Meta Quest, Apple Vision Pro).

## 🚀 Testing the UI (Current Phase 1)

### How to Run

Since this is a vanilla HTML/CSS/JavaScript application, no build tools or Node.js are required!

**Option 1: Open Directly in Browser**
1. Navigate to the project folder: `/Users/kushagrakaushik/SpatialUI`
2. Double-click `index.html` to open it in your default browser
3. The application will load immediately

**Option 2: Use a Simple HTTP Server (Recommended)**
If you have Python installed:
```bash
cd /Users/kushagrakaushik/SpatialUI
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

---

## ✅ What's Implemented (Phase 1 - UI Layout)

### Interface Components
- ✅ **Top Menu Bar** - File, Edit, View, Transform, Object, Spatial (highlighted), Plugins, Help
- ✅ **Left Sidebar** - Tabbed interface with:
  - Layers tab with sample hierarchy
  - Assets tab with component cards
  - Colors tab with color palette
  - Pages tab with page list
- ✅ **Center Viewport** - 3D canvas placeholder with:
  - Viewport header with position display
  - Device selector (Meta Quest 3, Vision Pro, Generic XR)
  - View controls (Top, Front, Side, Isometric)
  - Grid and Safe Zone toggles
- ✅ **Right Properties Panel** - Dynamic properties (shown when object selected)
- ✅ **Bottom Toolbar** - Tool selection:
  - Select, Frame, Text, Shape, 3D Box, Image, Comment, Measure
  - Zoom controls

### Interactive Features
- ✅ **Tab Switching** - Click tabs in left sidebar to switch between Layers/Assets/Colors/Pages
- ✅ **Tool Selection** - Click toolbar buttons to select tools
- ✅ **Layer Selection** - Click layers to select (shows properties panel)
- ✅ **Viewport Controls** - Click view buttons to switch camera angles
- ✅ **Zoom Controls** - Use +/- buttons or scroll in viewport
- ✅ **Keyboard Shortcuts**:
  - `V` - Select tool
  - `F` - Frame tool
  - `T` - Text tool
  - `R` - Shape tool
  - `B` - 3D Box tool
  - `I` - Image tool
  - `C` - Comment tool
  - `Cmd/Ctrl + N` - New file
  - `Cmd/Ctrl + S` - Save
  - `Cmd/Ctrl + O` - Open
- ✅ **Viewport Interaction** - Click and drag to rotate view (simulated)
- ✅ **Notifications** - Toast messages for actions

---

## 🎨 Design Features

### Dark Theme
- Premium dark interface inspired by Figma
- Vibrant primary color (indigo #6366f1)
- Clean, modern typography (Inter font)

### Responsive Elements
- Hover effects on all interactive elements
- Smooth transitions and animations
- Active state indicators

### Visual Hierarchy
- Clear separation of interface zones
- Proper use of borders and elevation
- Consistent spacing and sizing

---

## 🧪 What to Test

### 1. Interface Layout
- [ ] Check if all panels are visible (menu bar, sidebars, viewport, toolbar)
- [ ] Verify the Figma-like layout matches your expectations
- [ ] Test responsiveness by resizing the browser window

### 2. Sidebar Tabs
- [ ] Click "Layers" tab - should show layer hierarchy
- [ ] Click "Assets" tab - should show component cards
- [ ] Click "Colors" tab - should show color swatches
- [ ] Click "Pages" tab - should show page list
- [ ] Active tab should be highlighted

### 3. Toolbar Tools
- [ ] Click each tool button (Select, Frame, Text, etc.)
- [ ] Active tool should be highlighted in blue
- [ ] Notification should appear showing tool name

### 4. Layer Interaction
- [ ] Click on any layer item in the Layers tab
- [ ] Layer should highlight
- [ ] Properties panel on right should show Transform properties
- [ ] Empty state message should disappear

### 5. Viewport Controls
- [ ] Click view buttons (Top, Front, Side, Isometric)
- [ ] Active view should be highlighted
- [ ] Click Grid toggle
- [ ] Click Safe Zone toggle
- [ ] Notification should show status

### 6. Keyboard Shortcuts
- [ ] Press `V` - should select "Select" tool
- [ ] Press `T` - should select "Text" tool
- [ ] Press `B` - should select "3D Box" tool
- [ ] Try other shortcuts listed above

### 7. Zoom Controls
- [ ] Click + button - zoom should increase
- [ ] Click - button - zoom should decrease
- [ ] Scroll in viewport - zoom should change
- [ ] Zoom percentage should update

### 8. Visual Polish
- [ ] Hover over buttons - should show hover effect
- [ ] Check animations are smooth
- [ ] Verify colors match dark theme aesthetic
- [ ] Check font rendering (Inter font loads from Google Fonts)

---

## 🔜 Next Steps (Phase 2 - 3D Integration)

Once you approve the UI layout, we'll add:
1. Three.js integration for real 3D viewport
2. Actual 3D objects (cube, sphere, cylinder)
3. Transform gizmos (move, rotate, scale)
4. Real camera controls
5. Grid and safe zone visualization

---

## 📝 Notes

- This is Phase 1: UI Layout only
- 3D rendering is not yet implemented (placeholder shown)
- All interactions are UI-only (no real object manipulation yet)
- The viewport shows a placeholder with grid overlay
- To add Node.js/npm support later, install Node.js and we can convert to a Vite-based build

---

## 🐛 Known Limitations (Phase 1)

- No actual 3D rendering (coming in Phase 2)
- No file save/load functionality
- No actual object creation
- Properties panel values are static
- Device selector doesn't change anything yet

---

## 💡 Feedback Welcome!

Test the interface and let me know:
1. Does the layout match your vision?
2. Are any UI elements missing?
3. Do the interactions feel smooth?
4. Any design changes needed before implementing 3D?
