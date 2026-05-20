import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DeltaApplier } from './delta-applier.js';

describe('DeltaApplier', () => {
    it('creates an object', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([{ op: 'create', id: 'x', type: 'box', pos: [1, 2, 3], color: '#00ff00' }]);
        const o = a.get('x');
        expect(o).toBeDefined();
        expect(o.position.x).toBe(1);
    });
    it('updates color via update op', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([{ op: 'create', id: 'x', type: 'box', color: '#000000' }]);
        a.apply([{ op: 'update', id: 'x', props: { color: '#ff00ff' } }]);
        const hex = a.get('x').material.color.getHexString();
        expect(hex).toBe('ff00ff');
    });
    it('transforms position', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([{ op: 'create', id: 'x', type: 'box' }]);
        a.apply([{ op: 'transform', id: 'x', pos: [10, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1] }]);
        expect(a.get('x').position.x).toBe(10);
    });
    it('deletes', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([{ op: 'create', id: 'x', type: 'box' }]);
        a.apply([{ op: 'delete', id: 'x' }]);
        expect(a.get('x')).toBeUndefined();
    });
    it('orders create→update→delete within one batch', () => {
        const scene = new THREE.Group();
        const a = new DeltaApplier(scene);
        a.apply([
            { op: 'delete', id: 'x' },
            { op: 'update', id: 'x', props: { color: '#ffffff' } },
            { op: 'create', id: 'x', type: 'box', color: '#000000' }
        ]);
        expect(a.get('x')).toBeDefined();
        expect(a.get('x').material.color.getHexString()).toBe('ffffff');
    });
});
