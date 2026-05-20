import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { serializeScreen } from './snapshot.js';

function makeBox(name, id) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.position.set(1, 2, 3);
    m.userData.voidId = id;
    return m;
}

describe('serializeScreen', () => {
    it('emits objects with id, type, transform, color', () => {
        const screen = new THREE.Group();
        screen.userData.voidId = 'screen-1';
        const a = makeBox('A', 'obj-a');
        screen.add(a);
        const out = serializeScreen(screen);
        expect(out.id).toBe('screen-1');
        expect(out.objects).toHaveLength(1);
        expect(out.objects[0]).toMatchObject({
            id: 'obj-a',
            type: 'box',
            pos: [1, 2, 3],
            color: '#ff0000'
        });
    });
});
