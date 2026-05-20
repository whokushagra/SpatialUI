import * as THREE from 'three';

export class DeltaApplier {
    constructor(scene) {
        this.scene = scene;
        this.byId = new Map();
    }
    get(id) { return this.byId.get(id); }
    apply(ops) {
        const creates = [], updates = [], xforms = [], deletes = [];
        const createdIds = new Set();
        for (const o of ops) {
            if (o.op === 'create') { creates.push(o); createdIds.add(o.id); }
            else if (o.op === 'update') updates.push(o);
            else if (o.op === 'transform') xforms.push(o);
            else if (o.op === 'delete') deletes.push(o);
        }
        // Deletes with a same-batch create are treated as replace: remove old first.
        for (const op of deletes) {
            if (createdIds.has(op.id)) this._delete(op);
        }
        for (const op of creates) this._create(op);
        for (const op of updates) this._update(op);
        for (const op of xforms) this._transform(op);
        for (const op of deletes) {
            if (!createdIds.has(op.id)) this._delete(op);
        }
    }
    _create(op) {
        let geo, mat;
        const w = op.w, h = op.h;

        if (op.type === 'button') {
            geo = new THREE.BoxGeometry(w ?? 0.72, h ?? 0.22, 0.03);
            mat = new THREE.MeshStandardMaterial({ color: op.color || '#4f46e5' });
        } else if (op.type === 'panel') {
            geo = new THREE.BoxGeometry(w ?? 1.2, h ?? 0.8, 0.04);
            mat = new THREE.MeshStandardMaterial({
                color: op.color || '#1e293b',
                transparent: true,
                opacity: 0.92
            });
        } else if (op.type === 'frame') {
            geo = new THREE.PlaneGeometry(w ?? 1, h ?? 1);
            mat = new THREE.MeshStandardMaterial({
                color: op.color || '#0f172a',
                transparent: true,
                opacity: 0.45,
                side: THREE.DoubleSide
            });
        } else if (op.type === 'text') {
            geo = new THREE.PlaneGeometry(w ?? 0.8, h ?? 0.15);
            mat = new THREE.MeshStandardMaterial({
                color: op.color || '#e2e8f0',
                transparent: true,
                opacity: 0.35
            });
        } else if (op.type === 'sphere') {
            geo = new THREE.SphereGeometry(0.5, 16, 16);
            mat = new THREE.MeshStandardMaterial({ color: op.color || '#6366f1' });
        } else if (op.type === 'plane') {
            geo = new THREE.PlaneGeometry(w ?? 1, h ?? 1);
            mat = new THREE.MeshStandardMaterial({ color: op.color || '#ffffff' });
        } else {
            // 'box', 'primitive', or unknown
            geo = new THREE.BoxGeometry(w ?? 0.5, h ?? 0.5, 0.5);
            mat = new THREE.MeshStandardMaterial({ color: op.color || '#6366f1' });
        }

        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.voidId = op.id;
        if (op.pos) mesh.position.fromArray(op.pos);
        if (op.rot) mesh.quaternion.fromArray(op.rot);
        if (op.scale) mesh.scale.fromArray(op.scale);
        this.byId.set(op.id, mesh);
        this.scene.add(mesh);
    }
    _update(op) {
        const m = this.byId.get(op.id);
        if (!m) return;
        if (op.props?.color && m.material) m.material.color.set(op.props.color);
        if (op.props?.text !== undefined) m.userData.text = op.props.text;
    }
    _transform(op) {
        const m = this.byId.get(op.id);
        if (!m) return;
        if (op.pos) m.position.fromArray(op.pos);
        if (op.rot) m.quaternion.fromArray(op.rot);
        if (op.scale) m.scale.fromArray(op.scale);
    }
    _delete(op) {
        const m = this.byId.get(op.id);
        if (!m) return;
        this.scene.remove(m);
        m.geometry?.dispose?.();
        m.material?.dispose?.();
        this.byId.delete(op.id);
    }
}
