import * as THREE from 'three';

// Mesh for a voxel object: only the faces between a block and empty space are made,
// each block coloured from the palette, with a touch of darkening in inner corners.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

export function voxelGeometry({ voxelSize: s, voxels, palette }) {
  const filled = new Set(voxels.map((v) => `${v[0]},${v[1]},${v[2]}`));
  const has = (x, y, z) => filled.has(`${x},${y},${z}`);
  const colors = palette.map((c) => new THREE.Color(c));
  const pos = [], nor = [], col = [], uv = [], idx = [];
  for (const [x, y, z, ci] of voxels) {
    const color = colors[ci] ?? colors[0];
    for (const f of FACES) {
      const [nx, ny, nz] = f.n;
      if (has(x + nx, y + ny, z + nz)) continue;
      const base = pos.length / 3;
      for (const [cx, cy, cz] of f.c) {
        const vx = x + cx, vy = y + cy, vz = z + cz;
        pos.push(vx * s, vy * s, vz * s);
        nor.push(nx, ny, nz);
        // corner darkening: count filled blocks touching this corner in front of the face
        const ox = cx ? 1 : -1, oy = cy ? 1 : -1, oz = cz ? 1 : -1;
        let occ = 0;
        if (nx) occ = +has(x + nx, y + oy, z) + +has(x + nx, y, z + oz) + +has(x + nx, y + oy, z + oz);
        else if (ny) occ = +has(x + ox, y + ny, z) + +has(x, y + ny, z + oz) + +has(x + ox, y + ny, z + oz);
        else occ = +has(x + ox, y, z + nz) + +has(x, y + oy, z + nz) + +has(x + ox, y + oy, z + nz);
        const k = 1 - occ * 0.12;
        col.push(color.r * k, color.g * k, color.b * k);
        uv.push(nx ? vz : vx, ny ? vz : vy);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Which block a click hit (and the empty cell in front of that face), in voxel coordinates.
export function voxelHit(hit, object, voxelSize) {
  const local = object.worldToLocal(hit.point.clone()).divideScalar(voxelSize);
  const n = hit.face.normal;
  const cell = [local.x - n.x * 0.5, local.y - n.y * 0.5, local.z - n.z * 0.5].map(Math.floor);
  return { cell, front: [cell[0] + n.x, cell[1] + n.y, cell[2] + n.z].map(Math.round) };
}
