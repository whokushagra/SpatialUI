function detectType(object) {
    if (object.userData?.voidType) return object.userData.voidType;
    if (object.geometry?.type === 'BoxGeometry') return 'box';
    if (object.geometry?.type === 'SphereGeometry') return 'sphere';
    if (object.geometry?.type === 'PlaneGeometry') return 'plane';
    return 'group';
}

function colorHex(material) {
    if (!material || !material.color) return null;
    return '#' + material.color.getHexString();
}

/** For groups (button, panel, frame), get color from the first child that has one. */
function colorHexOf(object) {
    const direct = colorHex(object.material);
    if (direct) return direct;
    for (const child of object.children ?? []) {
        const c = colorHex(child.material);
        if (c) return c;
    }
    return null;
}

export function serializeScreen(screenGroup) {
    const objects = [];
    screenGroup.traverse((obj) => {
        if (obj === screenGroup) return;
        if (!obj.userData?.voidId) return;

        // Dimensions: prefer planarBaseHalf (button/panel), fall back to frameWidth/frameHeight (frame).
        const half = obj.userData.planarBaseHalf;
        const w = half ? half.x * 2 : (obj.userData.frameWidth ?? null);
        const h = half ? half.y * 2 : (obj.userData.frameHeight ?? null);

        objects.push({
            id: obj.userData.voidId,
            type: detectType(obj),
            pos: [obj.position.x, obj.position.y, obj.position.z],
            rot: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
            scale: [obj.scale.x, obj.scale.y, obj.scale.z],
            color: colorHexOf(obj),
            text: obj.userData.text ?? obj.userData.label ?? null,
            w,
            h,
            parentId: obj.parent?.userData?.voidId ?? null
        });
    });
    return {
        id: screenGroup.userData.voidId ?? 'screen-default',
        name: screenGroup.name ?? 'Screen',
        objects
    };
}
