#!/usr/bin/env python3
"""Build Void Cursor Prompts documentation (Markdown)."""
import json
import re
from datetime import date

PROMPTS_PATH = "/Users/kushagrakaushik/SpatialUI/docs/_prompts_raw.json"
OUT_MD = "/Users/kushagrakaushik/SpatialUI/docs/Void-Cursor-Prompts.md"

# (keyword in prompt lowercased, 2-word title, bullet summary)
CATEGORIES = [
    (["figma-style visual prototype", "drag-to-connect", "connection handle"], "Prototype Links",
     "Figma-style drag-to-connect, transitions, interaction for all element types, canvas overlay."),
    (["remove the drag-to-connect", "restore and expand the dropdown"], "Prototype Fix",
     "Remove broken drag-connect; restore dropdown interactions for all UI types."),
    (["supabase", "database schema", "excel"], "Data / Supabase",
     "Schema analysis, Supabase live save, connection status checks."),
    (["login screen", "loginscene", "shooting star", "solar eclipse", "floating ui"], "Login Scene",
     "3D login, stars, glass debris, dashboard polish, theme restore."),
    (["visionos", "glassmorphism", "ui/ux audit", "nielsen"], "visionOS UI",
     "visionOS redesign, usability audit, theme and layout fixes."),
    (["preview in space", "spatial preview", "camera", "ar ", "ikea", "qr"], "Spatial Preview",
     "Camera AR preview, floor hide, depth, IKEA-style anchoring, QR on camera."),
    (["prototype mode", "play mode", "design mode"], "Play Mode",
     "Design vs Prototype toggle, button navigation, click fixes."),
    (["2d mode", "orthographic", "figma-style direct", "planar"], "2D Canvas",
     "Orthographic Figma-like drag/resize, grid hide, default 2D view."),
    (["createframe", "frames system", "frame is a named"], "Frames System",
     "Named rectangular frames, parenting, presets."),
    (["onboarding", "login screen", "dashboard", "tutorial"], "Onboarding",
     "Login → dashboard → editor flow, tutorial every open."),
    (["environment preset", "hdr"], "Environments",
     "HDR environment presets for design context."),
    (["mesh", "grid", "safe zone", "floor"], "Grid / Mesh",
     "Independent grid vs safe zone toggles, hide mesh by default."),
    (["sample objects", "addsampleobjects"], "Startup Cleanup",
     "Remove default cube/sphere/cylinder on load."),
    (["undo all", "broke the app", "urgent"], "Recovery",
     "Restore lost UI work, fix broken interactions and login."),
    (["document all the prompts", "pdf"], "Meta / Docs",
     "This documentation request."),
    (["push", "pull", "branch"], "Git Ops",
     "Push/pull branches (operational)."),
]

GIT_COMMITS = [
    ("8773298", "Initial commit"),
    ("0d9b0b2", "Add SpatialUI app, styles, testing docs"),
    ("810becb", "Rebrand to Void and project foundation"),
    ("148666c", "Onboarding, planar 2D/preview, prototype fixes, XR anchors, link lines"),
    ("a7e4951", "Backup before new features"),
    ("4150ea6", "Figma-style prototype linking, canvas overlay, transitions"),
    ("8f2d35a", "Login scene and editor UI/onboarding expansion"),
]


def classify(prompt: str) -> tuple[str, str]:
    low = prompt.lower()
    for keys, title, summary in CATEGORIES:
        if any(k in low for k in keys):
            return title, summary
    # fallback from first line
    line = prompt.split("\n")[0].strip()[:60]
    words = re.findall(r"[A-Za-z]+", line)[:2]
    short = " ".join(words).title() if words else "General"
    if len(short) > 24:
        short = short[:22] + "…"
    return short, "See full prompt for scope and requirements."


def bullets_from_prompt(prompt: str, default: str) -> list[str]:
    bullets = [default]
    if "CHANGE" in prompt or "FIX" in prompt or "FEATURE" in prompt:
        parts = re.findall(r"(?:CHANGE|FIX|FEATURE|PART)\s*\d+[:\s]*([^\n]+)", prompt, re.I)
        for p in parts[:6]:
            t = p.strip()[:120]
            if t:
                bullets.append(t)
    elif "Requirements:" in prompt or "requirements:" in prompt:
        bullets.append("Includes a detailed requirements block (see full prompt).")
    if len(bullets) == 1 and len(prompt) > 500:
        bullets.append("Large structured spec — read full prompt for acceptance criteria.")
    return bullets[:8]


def escape_md(s: str) -> str:
    return s


def main():
    with open(PROMPTS_PATH, encoding="utf-8") as f:
        prompts = json.load(f)

    sections: dict[str, list] = {}
    meta_order = []
    for i, prompt in enumerate(prompts, 1):
        title, summary = classify(prompt)
        key = title
        if key not in sections:
            sections[key] = []
            meta_order.append(key)
        sections[key].append((i, title, summary, prompt))

    lines = [
        "# Void — Cursor Prompts Documentation",
        "",
        f"**Generated:** {date.today().isoformat()}  ",
        "**Project:** Void (SpatialUI) — Figma-like XR UI design tool  ",
        "**Stack:** Vite · Vanilla JavaScript · Three.js · CSS",
        "",
        "---",
        "",
        "## How to use this document",
        "",
        "- **Short title** — two-word overview so you can scan quickly.",
        "- **What this adds** — bullet summary of intent and outcomes.",
        "- **Full prompt** — exact text sent in Cursor (lightly trimmed only if duplicate).",
        "",
        "**Also included:** project overview, git milestone map, and suggested additions for future docs.",
        "",
        "---",
        "",
        "## Project overview",
        "",
        "Void is a designer-first web tool for building XR (Quest / Vision Pro) interfaces without code.",
        "Designers create **screens**, place **frames** and UI components (button, panel, text, image),",
        "link screens in **prototype mode**, preview in **2D** or **3D**, and export **`.void.json`**.",
        "",
        "Primary files: `main.js`, `index.html`, `styles.css`, `loginScene.js`, `voidRemoteSync.js`.",
        "",
        "---",
        "",
        "## Git milestones (Void-SpatialUI-new-updates)",
        "",
    ]
    for sha, msg in GIT_COMMITS:
        lines.append(f"- `{sha[:7]}` — {msg}")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Prompt index")
    lines.append("")
    n = 0
    for cat in meta_order:
        for item in sections[cat]:
            n += 1
            idx, title, _, _ = item
            lines.append(f"{n}. **{title}** — Prompt #{idx}")
    lines.append("")
    lines.append("---")
    lines.append("")

    global_n = 0
    for cat in meta_order:
        lines.append(f"## Category: {cat}")
        lines.append("")
        for idx, title, summary, prompt in sections[cat]:
            global_n += 1
            lines.append(f"### {global_n}. {title}")
            lines.append("")
            lines.append("**What this adds**")
            lines.append("")
            for b in bullets_from_prompt(prompt, summary):
                lines.append(f"- {b}")
            lines.append("")
            lines.append("**Full prompt**")
            lines.append("")
            lines.append("```text")
            lines.append(prompt)
            lines.append("```")
            lines.append("")
            lines.append("---")
            lines.append("")

    lines.extend([
        "## Suggested additions (future versions of this doc)",
        "",
        "- **Screenshots** — one image per major feature (login, 2D canvas, prototype mode).",
        "- **Outcome column** — “Shipped / Reverted / Partial” per prompt after each release.",
        "- **File touch map** — which files each prompt usually changed (`main.js`, etc.).",
        "- **Cursor rules** — link to `.cursor/rules/void-project.mdc` as standing instructions.",
        "- **Changelog sync** — auto-append from `git log` on each export.",
        "",
        "---",
        "",
        "*End of document — Void Cursor Prompts*",
    ])

    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Wrote {OUT_MD} ({len(prompts)} prompts, {global_n} sections)")


if __name__ == "__main__":
    main()
