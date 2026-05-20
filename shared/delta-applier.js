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
        // Deletes that also have a same-batch create are treated as "replace":
        // remove the old object first so the create starts fresh.
        // Deletes with no same-batch create run after updates/transforms.
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
        let geo;
        if (op.type === 'sphere') geo = new THREE.SphereGeometry(0.5, 16, 16);
        else if (op.type === 'plane') geo = new THREE.PlaneGeometry(1, 1);
        else geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshStandardMaterial({ color: op.color || '#ffffff' });
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
