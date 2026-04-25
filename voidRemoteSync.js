/**
 * Supabase live sync: debounced full project save on user activity.
 * Requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_VOID_DOCUMENT_ID in .env
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const DOCUMENT_ID = import.meta.env.VITE_VOID_DOCUMENT_ID;

const supabaseClient =
    SUPABASE_URL && SUPABASE_ANON_KEY && DOCUMENT_ID ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const DEBOUNCE_MS = 550;

let debounceTimer = null;
let remoteInitDone = false;
let remoteLoadRequested = false;

function getApi() {
    return typeof window !== 'undefined' ? window.XRSpatialUI : null;
}

function shouldSync() {
    if (window.__voidImportInFlight) return false;
    const api = getApi();
    return !!(api?.state?.scene && api.state.editorExperienceInitialized && api.state.appPhase === 'editor');
}

function collectNormalized(documentId, payload, viewport, editorMode) {
    const screens = [];
    const elements = [];
    const interactions = [];

    payload.screens.forEach((sc, order) => {
        screens.push({
            document_id: documentId,
            screen_key: sc.id,
            name: sc.name,
            sort_order: order
        });

        function walk(comp, parentUuid) {
            const rest = { ...comp };
            delete rest.children;
            elements.push({
                document_id: documentId,
                element_uuid: comp.id,
                screen_key: sc.id,
                parent_element_uuid: parentUuid,
                void_type: comp.type,
                props: rest
            });
            if (comp.type === 'button' && comp.onClickScreenId) {
                interactions.push({
                    document_id: documentId,
                    source_element_uuid: comp.id,
                    target_screen_key: comp.onClickScreenId,
                    click_animation: comp.clickAnimation || 'none'
                });
            }
            if (comp.type === 'frame' && Array.isArray(comp.children)) {
                comp.children.forEach((ch) => walk(ch, comp.id));
            }
        }

        (sc.components || []).forEach((c) => walk(c, null));
    });

    const flow = {
        document_id: documentId,
        active_screen_key: payload.activeScreenId || '',
        exported_at: payload.exportedAt || null
    };

    const env = {
        document_id: documentId,
        viewport: viewport || {},
        extras: { editor_mode: editorMode || 'design' }
    };

    return { screens, elements, interactions, flow, env };
}

async function insertChunks(client, table, rows, chunkSize = 200) {
    for (let i = 0; i < rows.length; i += chunkSize) {
        const slice = rows.slice(i, i + chunkSize);
        const { error } = await client.from(table).insert(slice);
        if (error) throw error;
    }
}

async function performSave() {
    if (!supabaseClient || !shouldSync()) return;

    const api = getApi();
    if (!api?.buildVoidExport) return;

    const payload = api.buildVoidExport();
    const viewport = api.state?.viewport ? { ...api.state.viewport } : {};
    const editorMode = api.state?.editorMode || 'design';

    const { screens, elements, interactions, flow, env } = collectNormalized(
        DOCUMENT_ID,
        payload,
        viewport,
        editorMode
    );

    await supabaseClient.from('interactions').delete().eq('document_id', DOCUMENT_ID);
    await supabaseClient.from('ui_elements').delete().eq('document_id', DOCUMENT_ID);
    await supabaseClient.from('screens').delete().eq('document_id', DOCUMENT_ID);
    await supabaseClient.from('screen_flow_runtime').delete().eq('document_id', DOCUMENT_ID);
    await supabaseClient.from('scene_environment').delete().eq('document_id', DOCUMENT_ID);

    const { error: docErr } = await supabaseClient.from('void_board_documents').upsert(
        {
            id: DOCUMENT_ID,
            title: 'Void Project',
            payload,
            exported_at: payload.exportedAt,
            updated_at: new Date().toISOString()
        },
        { onConflict: 'id' }
    );
    if (docErr) throw docErr;

    if (screens.length) await insertChunks(supabaseClient, 'screens', screens);
    if (elements.length) await insertChunks(supabaseClient, 'ui_elements', elements);
    if (interactions.length) await insertChunks(supabaseClient, 'interactions', interactions);

    const { error: flowErr } = await supabaseClient.from('screen_flow_runtime').insert(flow);
    if (flowErr) throw flowErr;

    const { error: envErr } = await supabaseClient.from('scene_environment').insert(env);
    if (envErr) throw envErr;
}

/** Coalesce rapid edits (transform drags, typing, clicks) into one network write. */
export function scheduleRemoteProjectSave() {
    if (!supabaseClient) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        performSave().catch((err) => {
            console.warn('[voidRemoteSync] save failed', err);
            getApi()?.showNotification?.('Cloud save failed');
        });
    }, DEBOUNCE_MS);
}

/** Immediate write (e.g. before tab close). */
export function flushRemoteProjectSave() {
    if (!supabaseClient) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    if (!shouldSync()) return;
    return performSave().catch((err) => {
        console.warn('[voidRemoteSync] flush failed', err);
        getApi()?.showNotification?.('Cloud save failed');
    });
}

export async function loadVoidDocument() {
    if (!supabaseClient) return;
    const api = getApi();
    if (!api?.applyVoidImport) return;

    const { data, error } = await supabaseClient
        .from('void_board_documents')
        .select('payload')
        .eq('id', DOCUMENT_ID)
        .maybeSingle();

    if (error) throw error;
    if (!data?.payload) return;

    const ok = api.applyVoidImport(data.payload);
    if (!ok) return;

    const { data: envRow } = await supabaseClient
        .from('scene_environment')
        .select('viewport')
        .eq('document_id', DOCUMENT_ID)
        .maybeSingle();

    if (envRow?.viewport && api.state?.viewport) {
        Object.assign(api.state.viewport, envRow.viewport);
        api.applyViewportZoomToCameras?.();
    }
}

function attachLiveSyncListeners() {
    const editorRoot = document.getElementById('phase-editor');
    if (!editorRoot) return;

    const onEditorActivity = () => scheduleRemoteProjectSave();

    editorRoot.addEventListener('input', onEditorActivity, true);
    editorRoot.addEventListener('change', onEditorActivity, true);

    document.addEventListener(
        'pointerup',
        () => {
            if (shouldSync()) scheduleRemoteProjectSave();
        },
        true
    );

    document.addEventListener(
        'keydown',
        (e) => {
            if (!shouldSync()) return;
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.key === 'Delete' || e.key === 'Backspace') scheduleRemoteProjectSave();
        },
        true
    );

    document.getElementById('menu-save-void')?.addEventListener(
        'click',
        () => {
            flushRemoteProjectSave();
        },
        true
    );

    document.addEventListener(
        'keydown',
        (e) => {
            if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
            if (!shouldSync()) return;
            flushRemoteProjectSave();
        },
        false
    );

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && shouldSync()) flushRemoteProjectSave();
    });
}

export function initVoidRemoteSync() {
    if (!supabaseClient || remoteInitDone) return;
    remoteInitDone = true;

    attachLiveSyncListeners();

    let pollAttempts = 0;
    const pollEditor = setInterval(() => {
        pollAttempts++;
        const api = getApi();
        if (api?.state?.editorExperienceInitialized) {
            clearInterval(pollEditor);
            if (!remoteLoadRequested) {
                remoteLoadRequested = true;
                loadVoidDocument().catch((err) => {
                    console.warn('[voidRemoteSync] load failed', err);
                    api.showNotification?.('Cloud load failed (check .env + Supabase row)');
                });
            }
            return;
        }
        if (pollAttempts > 2500) clearInterval(pollEditor);
    }, 120);
}
