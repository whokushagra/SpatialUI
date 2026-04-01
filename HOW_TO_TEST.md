# 🎨 How to Test Your XR Spatial UI Designer

## ✅ Quick Start

Your 3D viewport should now be **fully working**! 

**Refresh your browser**: http://localhost:8000

---

## 🧪 What You Should See

### ✨ 3D Viewport (Center Area)
You should see a **3D scene** with:
- ✅ **Dark background** (not just text!)
- ✅ **Grid floor** (purple/gray lines)
- ✅ **3 colorful 3D objects**:
  - Purple **cube** on the left
  - Pink **sphere** in the middle  
  - Purple **cylinder** on the right
- ✅ **They're rotating** slowly
- ✅ **Green wireframe box** (safe zone)

### 🖱️ Camera Controls
- **Left-click + drag** = Rotate camera
- **Right-click + drag** = Pan camera
- **Scroll wheel** = Zoom in/out

---

## 🎯 Test Phase 5-6: Materials & Appearance

### Step 1: Select an Object
1. **Click the pink sphere** in the 3D viewport
2. ✅ It should **glow blue** (selected state)
3. ✅ Properties panel appears on the right
4. ✅ Transform gizmo appears on the object

### Step 2: Change Color
1. **Scroll down** in properties panel to "Appearance" section
2. **Click the color picker** (colored square)
3. **Choose a new color** (try cyan or orange)
4. ✅ Sphere changes color immediately!
5. ✅ Hex value updates next to picker

### Step 3: Adjust Opacity
1. **Find "Opacity" slider** (under color picker)
2. **Drag it to 50%**
3. ✅ Sphere becomes half-transparent
4. ✅ You can see through it!

### Step 4: Try Material Types
**Click each button** and watch the sphere change:

1. **"Flat"** button:
   - ✅ Matte, non-reflective surface
   - ✅ Looks like painted plastic

2. **"Metallic"** button:
   - ✅ Shiny, chrome-like surface
   - ✅ Shows reflections
   - ✅ Sliders auto-adjust

3. **"Glass"** button:
   - ✅ Transparent, glass-like
   - ✅ You can see through it
   - ✅ Opacity auto-sets to 50%

4. **"Glow"** button:
   - ✅ Emits light
   - ✅ Bright, neon effect
   - ✅ Looks like it's glowing!

### Step 5: Fine Control Sliders
After selecting **"Metallic"** material:

1. **Metalness slider**:
   - Drag to **0%** = Looks like plastic
   - Drag to **100%** = Looks like polished chrome

2. **Roughness slider**:
   - Drag to **0%** = Mirror-smooth, sharp reflections
   - Drag to **100%** = Rough, diffuse surface

---

## ⌨️ Keyboard Shortcuts

### Transform Objects (with object selected):
- **G** = Move (translate) mode
- **R** = Rotate mode
- **S** = Scale mode
- **Delete** = Delete object

### Create Objects:
- **B** = Create box
- **Shift+S** or click sphere icon = Create sphere

### Tools:
- **V** = Select tool
- **F** = Focus camera on selected object (double-click also works)

---

## 🎨 Try This Workflow!

**Create a Colorful Scene:**

1. **Press B** three times to create 3 boxes
2. **Click first box** → **Metallic material** → **Red color**
3. **Click second box** → **Glass material** → **Blue color** + 30% opacity
4. **Click third box** → **Glow material** → **Green color**
5. **Press G** on each box and **move them apart**
6. **Rotate camera** to see materials from different angles

---

## 🐛 Troubleshooting

### Still see "3D Viewport" text only?
1. **Open browser console** (F12)
2. Look for error messages (red text)
3. Check console logs that say "✅" (should see initialization messages)
4. Tell me what errors you see!

### Objects not visible?
- Try **zooming out** (scroll wheel)
- Try clicking **"Isometric" view** button (top of viewport)
- Check browser console for errors

### Color picker doesn't work?
- Make sure object is **selected** (glowing blue)
- Check that "Appearance" section is **expanded** (visible)
- Try **refreshing** the page

---

## 🌟 What's Working Now

| Feature | Status |
|---------|--------|
| 3D Scene Rendering | ✅ |
| Sample Objects | ✅ |
| Camera Controls | ✅ |
| Object Selection | ✅ |
| Transform Gizmos | ✅ |
| Color Picker | ✅ |
| Opacity Slider | ✅ |
| Material Types (4) | ✅ |
| Metalness/Roughness | ✅ |
| Keyboard Shortcuts | ✅ |

---

## 📝 Let Me Know

**After testing, tell me:**
1. ✅ Can you see the 3D scene? (not just text)
2. ✅ Can you select objects?
3. ✅ Does the color picker work?
4. ✅ Do material types look different?
5. ✅ Any errors in console?

**Then we'll proceed to the next features!**
