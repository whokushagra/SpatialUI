/**
 * Void starter templates.
 *
 * Each template is a ready-to-import Void export object (same shape as buildVoidExport()
 * in main.js, consumed by applyVoidImport()). They give a new project a fully designed,
 * multi-screen, click-through prototype so the editor never opens empty and the phone
 * viewer always has something polished to show.
 *
 * Layout system: every screen is one dark "glass" card centered at the origin. Text is
 * positioned by an EDGE ANCHOR — `x` is the left edge for left-aligned text, the right
 * edge for right-aligned, the center for centered — so everything lines up inside the
 * card. Cards are portrait 1.9 x 2.3 (except the Orbit "Details" landscape card).
 */

// ---------- tokens ----------
const CARD = '#0e1320';
const CARD_BORDER = '#cbd5e1';
const TITLE = '#f5f7fa';
const SUBTLE = '#9aa6b8';
const ROW = '#171d2c';

// Portrait card geometry + inner content bounds.
const CW = 1.9;
const CH = 2.3;
const PAD = 0.15;
const IL = -CW / 2 + PAD; // inner-left  (-0.80)
const IR = CW / 2 - PAD;  // inner-right ( 0.80)
const IW = CW - PAD * 2;  // content width (1.60)

// ---------- element helpers ----------
const P = (x, y, z = 0) => ({ position: { x, y, z } });

function card(w, h, opts = {}) {
    return {
        type: 'panel',
        name: opts.name || 'Card',
        ...P(0, 0, -0.05),
        width: w,
        height: h,
        color: opts.color || CARD,
        opacity: opts.opacity != null ? opts.opacity : 0.92,
        radius: opts.radius != null ? opts.radius : 0.12,
        borderColor: CARD_BORDER,
        borderOpacity: 0.16,
        shadow: true
    };
}

function tile(x, y, w, h, opts = {}) {
    return {
        type: 'panel',
        name: opts.name || 'Tile',
        ...P(x, y, -0.02),
        width: w,
        height: h,
        color: opts.color || ROW,
        opacity: 0.97,
        radius: opts.radius != null ? opts.radius : 0.06,
        borderColor: CARD_BORDER,
        borderOpacity: 0.1,
        shadow: false
    };
}

function hero(x, y, w, h, art, accent, opts = {}) {
    return {
        type: 'image',
        name: opts.name || 'Hero',
        ...P(x, y, 0.0),
        width: w,
        height: h,
        art,
        color: accent,
        radius: opts.radius != null ? opts.radius : 0.07,
        border: opts.border,
        borderColor: '#ffffff',
        borderOpacity: 0.12
    };
}

// x = edge anchor based on alignment (left edge / right edge / center).
function txt(text, x, y, opts = {}) {
    const align = opts.align || 'left';
    const w = opts.w != null ? opts.w : IW;
    let cx = x;
    if (align === 'left') cx = x + w / 2;
    else if (align === 'right') cx = x - w / 2;
    return {
        type: 'text',
        name: (opts.name || String(text)).slice(0, 22),
        ...P(cx, y, opts.z != null ? opts.z : 0.02),
        text,
        textColor: opts.color || TITLE,
        textFontSize: opts.size || 40,
        align,
        weight: opts.weight || '600',
        width: w,
        height: opts.h != null ? opts.h : 0.22
    };
}

// Pill tag — x is the LEFT edge so tags flow left-to-right in a row.
function pill(text, x, y, opts = {}) {
    const w = opts.w != null ? opts.w : 0.42;
    const h = opts.h != null ? opts.h : 0.15;
    return {
        type: 'text',
        name: 'tag',
        ...P(x + w / 2, y, 0.03),
        text,
        textColor: opts.color || '#06121a',
        textFontSize: opts.size || 36,
        align: 'center',
        weight: '700',
        width: w,
        height: h,
        chip: opts.chip || '#f59e0b',
        chipOpacity: 1,
        radius: h / 2
    };
}

// Button box is centered on x. Text alignment is internal to the button.
function btn(label, x, y, link, opts = {}) {
    return {
        type: 'button',
        name: label,
        label,
        ...P(x, y, 0.05),
        onClickScreenId: link || '',
        color: opts.color || '#4f46e5',
        textColor: opts.textColor || '#ffffff',
        textFontSize: opts.size || 36,
        width: opts.w != null ? opts.w : IW,
        height: opts.h != null ? opts.h : 0.26,
        radius: opts.radius != null ? opts.radius : 0.13,
        variant: opts.variant || 'solid',
        align: opts.align || 'center',
        weight: opts.weight || '600',
        glow: opts.glow,
        transitionType: opts.transition || 'fade',
        transitionDuration: opts.dur != null ? opts.dur : 320,
        transitionEasing: 'ease-in-out'
    };
}

function ghost(label, x, y, link, opts = {}) {
    return btn(label, x, y, link, { ...opts, variant: 'ghost', textColor: opts.textColor || '#dbe2ea' });
}

// Circular back button at the card's top-left.
function back(link) {
    const s = 0.17;
    return btn('‹', IL + s / 2, CH / 2 - PAD - s / 2 + 0.02, link, {
        w: s, h: s, radius: s / 2, color: '#1b2334', textColor: '#cbd5e1', size: 34, transition: 'slideRight'
    });
}

// A list row: full-width left-aligned button + right-aligned meta text.
function listRow(label, meta, y, link, accent, opts = {}) {
    return [
        btn(label, 0, y, link, {
            color: ROW, align: 'left', w: IW, h: 0.32, size: 31, radius: 0.08, transition: 'slideLeft'
        }),
        txt(meta, IR - 0.04, y, { size: 24, color: accent, align: 'right', w: 0.6, z: 0.06 })
    ];
}

function screen(id, name, components) {
    return { id, name, components };
}

function project(name, activeScreenId, screens) {
    return { version: 1, void: true, exportedAt: new Date().toISOString(), projectName: name, activeScreenId, screens };
}

// ============================================================
// 1) AURA — Calm / meditation. Accent: teal.
// ============================================================
const AURA = '#2dd4bf';
const AURA_INK = '#04231f';

function templateAura() {
    return project('Aura', 'aura-home', [
        screen('aura-home', 'Home', [
            card(CW, CH),
            hero(0, 0.58, IW, 0.84, 'calm', AURA),
            txt('Aura', IL, 0.04, { size: 66, weight: '700' }),
            txt('Daily calm, breathwork & sleep', IL, -0.14, { size: 30, color: SUBTLE }),
            pill('10 MIN', IL, -0.4, { chip: AURA, w: 0.46 }),
            pill('BEGINNER', IL + 0.54, -0.4, { chip: '#1f2a3a', color: '#cbd5e1', w: 0.66 }),
            btn('Begin Session', 0, -0.74, 'aura-sessions', { color: AURA, textColor: AURA_INK, glow: 0.16, size: 36 }),
            ghost('Breathwork', 0, -1.02, 'aura-player', { color: AURA })
        ]),
        screen('aura-sessions', 'Sessions', [
            card(CW, CH),
            back('aura-home'),
            txt('Sessions', 0, 0.92, { size: 48, weight: '700', align: 'center' }),
            ...listRow('Morning Calm', '10 min', 0.5, 'aura-player', AURA),
            ...listRow('Deep Focus', '20 min', 0.12, 'aura-player', AURA),
            ...listRow('Sleep Drift', '30 min', -0.26, 'aura-player', AURA),
            ...listRow('Stress Reset', '5 min', -0.64, 'aura-player', AURA)
        ]),
        screen('aura-player', 'Now Playing', [
            card(CW, CH, { color: '#0a1018' }),
            back('aura-home'),
            txt('NOW PLAYING', 0, 0.92, { size: 22, color: AURA, align: 'center', weight: '700' }),
            hero(0, 0.36, 0.98, 0.98, 'calm', AURA, { radius: 0.49, border: false }),
            txt('Morning Calm', 0, -0.36, { size: 44, align: 'center', weight: '700' }),
            txt('06:24 remaining', 0, -0.58, { size: 26, color: SUBTLE, align: 'center' }),
            btn('Pause', 0, -0.82, 'aura-player', { color: AURA, textColor: AURA_INK }),
            ghost('End Session', 0, -1.08, 'aura-home', { color: '#94a3b8', transition: 'scaleDown' })
        ])
    ]);
}

// ============================================================
// 2) ORBIT — Product showcase. Accent: amber.
// ============================================================
const ORBIT = '#f59e0b';
const ORBIT_INK = '#231806';

function templateOrbit() {
    return project('Orbit One', 'orbit-showcase', [
        screen('orbit-showcase', 'Showcase', [
            card(CW, CH),
            hero(0, 0.58, IW, 0.84, 'product', ORBIT),
            txt('Orbit One', IL, 0.04, { size: 58, weight: '700' }),
            txt('Spatial audio, reimagined', IL, -0.14, { size: 30, color: SUBTLE }),
            pill('NEW', IL, -0.4, { chip: ORBIT, w: 0.4 }),
            pill('$349', IL + 0.48, -0.4, { chip: '#1f2a3a', color: '#fcd34d', w: 0.52 }),
            btn('View Details', 0, -0.74, 'orbit-details', { color: ORBIT, textColor: ORBIT_INK, glow: 0.16 }),
            ghost('Add to Cart', 0, -1.02, 'orbit-cart', { color: ORBIT })
        ]),
        // Landscape detail card.
        screen('orbit-details', 'Details', [
            card(2.5, 1.6),
            btn('‹', -1.06, 0.62, 'orbit-showcase', { w: 0.17, h: 0.17, radius: 0.085, color: '#1b2334', textColor: '#cbd5e1', size: 34, transition: 'slideRight' }),
            hero(-0.6, 0, 1.04, 1.3, 'product', ORBIT),
            txt('Orbit One', 0.04, 0.52, { size: 44, weight: '700', w: 1.05 }),
            txt('Head-tracked spatial sound\nthat stays locked in place\nas you move around.', 0.04, 0.18, {
                size: 24, color: SUBTLE, w: 1.12, h: 0.46
            }),
            pill('40h BATTERY', 0.04, -0.28, { chip: '#1f2a3a', color: '#fcd34d', w: 0.74 }),
            btn('Buy · $349', 0.58, -0.58, 'orbit-cart', { color: ORBIT, textColor: ORBIT_INK, w: 1.04, glow: 0.16 })
        ]),
        screen('orbit-cart', 'Checkout', [
            card(CW, CH, { color: '#0a0f17' }),
            back('orbit-showcase'),
            txt('Order Summary', 0, 0.92, { size: 42, weight: '700', align: 'center' }),
            tile(0, 0.42, IW, 0.66, { name: 'Receipt' }),
            txt('Orbit One', IL + 0.08, 0.56, { size: 28, color: '#e7eaf0', w: 1.0, z: 0.04 }),
            txt('Qty 1', IL + 0.08, 0.32, { size: 22, color: SUBTLE, w: 1.0, z: 0.04 }),
            txt('$349', IR - 0.08, 0.56, { size: 30, color: ORBIT, align: 'right', weight: '700', w: 0.6, z: 0.04 }),
            txt('Free shipping · 2-year warranty', 0, -0.04, { size: 23, color: SUBTLE, align: 'center' }),
            btn('Place Order', 0, -0.46, 'orbit-showcase', { color: ORBIT, textColor: ORBIT_INK, glow: 0.18, transition: 'scaleUp' }),
            ghost('Cancel', 0, -0.74, 'orbit-showcase', { color: '#94a3b8', transition: 'slideRight' })
        ])
    ]);
}

// ============================================================
// 3) FORGE — Collaborative workshop. Accent: indigo.
// ============================================================
const FORGE = '#6366f1';
const CYAN = '#22d3ee';

function templateForge() {
    return project('Forge', 'forge-hub', [
        screen('forge-hub', 'Hub', [
            card(CW, CH),
            hero(0, 0.58, IW, 0.84, 'map', FORGE),
            txt('Forge', IL, 0.04, { size: 64, weight: '700' }),
            txt('Build together in shared space', IL, -0.14, { size: 28, color: SUBTLE }),
            pill('LIVE · 4', IL, -0.4, { chip: CYAN, w: 0.54 }),
            btn('Join Live Room', 0, -0.74, 'forge-room', { color: FORGE, glow: 0.16 }),
            ghost('Browse Lessons', 0, -1.02, 'forge-lessons', { color: '#a5b4fc' })
        ]),
        screen('forge-lessons', 'Lessons', [
            card(CW, CH),
            back('forge-hub'),
            txt('Lessons', 0, 0.92, { size: 48, weight: '700', align: 'center' }),
            ...listRow('01 · Spatial Basics', '8 min', 0.5, 'forge-room', '#a5b4fc'),
            ...listRow('02 · Hand Tracking', '12 min', 0.12, 'forge-room', '#a5b4fc'),
            ...listRow('03 · Building UI', '15 min', -0.26, 'forge-room', '#a5b4fc'),
            ...listRow('04 · Publishing', '6 min', -0.64, 'forge-room', '#a5b4fc')
        ]),
        screen('forge-room', 'Live Room', [
            card(CW, CH, { color: '#090d18' }),
            back('forge-hub'),
            txt('Live Room', 0, 0.92, { size: 44, weight: '700', align: 'center' }),
            txt('Spatial Basics · 4 here', 0, 0.66, { size: 24, color: '#a5b4fc', align: 'center' }),
            hero(-0.46, 0.26, 0.4, 0.4, 'avatar', FORGE, { radius: 0.2, border: false }),
            hero(0, 0.26, 0.4, 0.4, 'avatar', CYAN, { radius: 0.2, border: false }),
            hero(0.46, 0.26, 0.4, 0.4, 'avatar', '#a855f7', { radius: 0.2, border: false }),
            tile(0, -0.28, IW, 0.5, { name: 'Whiteboard', color: '#10172a' }),
            txt('Shared whiteboard', 0, -0.28, { size: 25, color: SUBTLE, align: 'center', z: 0.04 }),
            btn('Raise Hand', 0, -0.74, 'forge-room', { color: FORGE, glow: 0.14 }),
            ghost('Leave Room', 0, -1.02, 'forge-hub', { color: '#94a3b8', transition: 'scaleDown' })
        ])
    ]);
}

// ---------- public catalog ----------
export const VOID_TEMPLATES = [
    {
        id: 'aura',
        name: 'Meditation App',
        projectName: 'Aura',
        tagline: 'Calm, breathwork & guided sessions',
        device: 'Meta Quest 3',
        accent: AURA,
        screens: 3,
        build: templateAura
    },
    {
        id: 'orbit',
        name: 'Product Demo',
        projectName: 'Orbit One',
        tagline: 'Spatial product showcase & checkout',
        device: 'Apple Vision Pro',
        accent: ORBIT,
        screens: 3,
        build: templateOrbit
    },
    {
        id: 'forge',
        name: 'XR Workshop',
        projectName: 'Forge',
        tagline: 'Collaborative lessons & live rooms',
        device: 'Meta Quest 3',
        accent: FORGE,
        screens: 3,
        build: templateForge
    }
];

export function getTemplateById(id) {
    return VOID_TEMPLATES.find((t) => t.id === id) || null;
}

export function buildTemplateExport(id) {
    const t = getTemplateById(id);
    return t ? t.build() : null;
}
