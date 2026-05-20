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

export function serializeScreen(screenGroup) {
    const objects = [];
    screenGroup.traverse((obj) => {
        if (obj === screenGroup) return;
        if (!obj.userData?.voidId) return;
        objects.push({
            id: obj.userData.voidId,
            type: detectType(obj),
            pos: [obj.position.x, obj.position.y, obj.position.z],
            rot: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
            scale: [obj.scale.x, obj.scale.y, obj.scale.z],
            color: colorHex(obj.material),
            text: obj.userData.text ?? null,
            parentId: obj.parent?.userData?.voidId ?? null
        });
    });
    return {
        id: screenGroup.userData.voidId ?? 'screen-default',
        name: screenGroup.name ?? 'Screen',
        objects
    };
}
