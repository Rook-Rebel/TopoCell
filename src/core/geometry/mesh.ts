// სამკუთხა ბადეები: ფართობი, მოცულობა, მრავალსახეობის (manifold) შემოწმება და ტოპოლოგიური ინვარიანტები.

export interface Mesh {
  positions: Float64Array; // xyz, მეტრებში
  indices: Uint32Array; // სამკუთხედები
  groups?: Uint8Array; // სამკუთხედის „გლუვი ჯგუფი“ (რენდერისთვის — მკვეთრი წიბოები)
}

export interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

export function meshArea(m: Mesh): number {
  const p = m.positions;
  const ix = m.indices;
  let a = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const i = ix[t] * 3,
      j = ix[t + 1] * 3,
      k = ix[t + 2] * 3;
    const ux = p[j] - p[i],
      uy = p[j + 1] - p[i + 1],
      uz = p[j + 2] - p[i + 2];
    const vx = p[k] - p[i],
      vy = p[k + 1] - p[i + 1],
      vz = p[k + 2] - p[i + 2];
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx;
    a += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }
  return a;
}

/** ნიშნიანი მოცულობა დივერგენციის თეორემით (ჩაკეტილი, თანმიმდევრულად ორიენტირებული ბადისთვის). */
export function meshVolume(m: Mesh): number {
  const p = m.positions;
  const ix = m.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const i = ix[t] * 3,
      j = ix[t + 1] * 3,
      k = ix[t + 2] * 3;
    v +=
      p[i] * (p[j + 1] * p[k + 2] - p[j + 2] * p[k + 1]) -
      p[i + 1] * (p[j] * p[k + 2] - p[j + 2] * p[k]) +
      p[i + 2] * (p[j] * p[k + 1] - p[j + 1] * p[k]);
  }
  return v / 6;
}

export function meshBBox(m: Mesh): BBox {
  const p = m.positions;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export function bboxVolume(b: BBox): number {
  return (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
}

export function flipMesh(m: Mesh): void {
  const ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const tmp = ix[t + 1];
    ix[t + 1] = ix[t + 2];
    ix[t + 2] = tmp;
  }
}

export function mergeMeshes(list: Mesh[]): Mesh {
  let nv = 0,
    ni = 0;
  for (const m of list) {
    nv += m.positions.length;
    ni += m.indices.length;
  }
  const positions = new Float64Array(nv);
  const indices = new Uint32Array(ni);
  const groups = new Uint8Array(ni / 3);
  let vo = 0,
    io = 0,
    go = 0;
  let gBase = 0;
  for (const m of list) {
    positions.set(m.positions, vo);
    const off = vo / 3;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + off;
    let gMax = 0;
    for (let t = 0; t < m.indices.length / 3; t++) {
      const g = m.groups ? m.groups[t] : 0;
      if (g > gMax) gMax = g;
      groups[go + t] = (gBase + g) & 255;
    }
    gBase += gMax + 1;
    vo += m.positions.length;
    io += m.indices.length;
    go += m.indices.length / 3;
  }
  return { positions, indices, groups };
}

export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** ბრუნვის მატრიცა R = Rz·Ry·Rx (გრადუსებში). */
export function rotationMatrix(rxDeg: number, ryDeg: number, rzDeg: number): Mat3 {
  const d = Math.PI / 180;
  const cx = Math.cos(rxDeg * d),
    sx = Math.sin(rxDeg * d);
  const cy = Math.cos(ryDeg * d),
    sy = Math.sin(ryDeg * d);
  const cz = Math.cos(rzDeg * d),
    sz = Math.sin(rzDeg * d);
  return [
    cz * cy,
    cz * sy * sx - sz * cx,
    cz * sy * cx + sz * sx,
    sz * cy,
    sz * sy * sx + cz * cx,
    sz * sy * cx - cz * sx,
    -sy,
    cy * sx,
    cy * cx,
  ];
}

export function transformPositions(p: Float64Array, R: Mat3, t: [number, number, number]): Float64Array {
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i],
      y = p[i + 1],
      z = p[i + 2];
    out[i] = R[0] * x + R[1] * y + R[2] * z + t[0];
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z + t[1];
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
  }
  return out;
}

export interface ManifoldReport {
  vertices: number;
  edges: number;
  faces: number;
  euler: number;
  closed: boolean; // ყველა წიბო ზუსტად ორ სამკუთხედს ეკუთვნის
  oriented: boolean; // მეზობელი სამკუთხედები თანმიმდევრულადაა ორიენტირებული
  boundaryEdges: number;
  nonManifoldEdges: number;
  components: number;
  genus: number | null; // ჩაკეტილი ორიენტირებადი ზედაპირისთვის (ყველა კომპონენტის ჯამი)
}

interface EdgeInfo {
  count: number;
  fwd: number;
  t0: number;
  d0: number;
  t1: number;
  d1: number;
}

function buildEdges(m: Mesh): { map: Map<number, EdgeInfo>; nv: number } {
  const ix = m.indices;
  const nv = m.positions.length / 3;
  const map = new Map<number, EdgeInfo>();
  for (let t = 0; t < ix.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = ix[t + e],
        b = ix[t + ((e + 1) % 3)];
      const lo = a < b ? a : b,
        hi = a < b ? b : a;
      const key = lo * nv + hi;
      const dir = a < b ? 1 : -1;
      let info = map.get(key);
      if (!info) {
        info = { count: 0, fwd: 0, t0: -1, d0: 0, t1: -1, d1: 0 };
        map.set(key, info);
      }
      if (info.count === 0) {
        info.t0 = t / 3;
        info.d0 = dir;
      } else if (info.count === 1) {
        info.t1 = t / 3;
        info.d1 = dir;
      }
      info.count++;
      if (dir === 1) info.fwd++;
    }
  }
  return { map, nv };
}

function find(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

/** ჩაკეტილი სხეულის საზღვრის შემოწმება: წყალგაუმტარობა, ორიენტაცია, ეილერის მახასიათებელი. */
export function checkManifold(m: Mesh): ManifoldReport {
  const { map, nv } = buildEdges(m);
  const used = new Uint8Array(nv);
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  for (let i = 0; i < m.indices.length; i++) used[m.indices[i]] = 1;
  let boundary = 0,
    nonManifold = 0,
    badOrient = 0;
  for (const [key, info] of map) {
    const lo = Math.floor(key / nv),
      hi = key - lo * nv;
    const a = find(parent, lo),
      b = find(parent, hi);
    if (a !== b) parent[a] = b;
    if (info.count === 1) boundary++;
    else if (info.count > 2) nonManifold++;
    else if (info.fwd !== 1) badOrient++;
  }
  let vUsed = 0,
    comps = 0;
  for (let i = 0; i < nv; i++) {
    if (used[i]) {
      vUsed++;
      if (find(parent, i) === i) comps++;
    }
  }
  const faces = m.indices.length / 3;
  const edges = map.size;
  const euler = vUsed - edges + faces;
  const closed = boundary === 0 && nonManifold === 0;
  const oriented = badOrient === 0;
  return {
    vertices: vUsed,
    edges,
    faces,
    euler,
    closed,
    oriented,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    components: comps,
    genus: closed && oriented ? (2 * comps - euler) / 2 : null,
  };
}

export interface SurfaceTopology {
  euler: number;
  orientable: boolean;
  boundaryComponents: number;
  closed: boolean;
  nonManifoldEdges: number;
}

/**
 * შუა ზედაპირის ტოპოლოგია (შეიძლება არაორიენტირებადი და საზღვრიანი იყოს).
 * ორიენტირებადობა მოწმდება სამკუთხედებზე ორიენტაციის გავრცელებით: კონფლიქტი ⇒ არაორიენტირებადი.
 */
export function surfaceTopology(m: Mesh): SurfaceTopology {
  const { map, nv } = buildEdges(m);
  const nt = m.indices.length / 3;
  const adj: number[][] = Array.from({ length: nt }, () => []);
  // adj ჩანაწერი: მეზობელი*2 + (1, თუ ორიენტაცია ერთმანეთს ეწინააღმდეგება)
  let boundary = 0,
    nonManifold = 0;
  const bParent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) bParent[i] = i;
  const bUsed = new Uint8Array(nv);
  for (const [key, info] of map) {
    if (info.count === 1) {
      boundary++;
      const lo = Math.floor(key / nv),
        hi = key - lo * nv;
      bUsed[lo] = 1;
      bUsed[hi] = 1;
      const a = find(bParent, lo),
        b = find(bParent, hi);
      if (a !== b) bParent[a] = b;
    } else if (info.count === 2) {
      const conflict = info.d0 === info.d1 ? 1 : 0;
      adj[info.t0].push(info.t1 * 2 + conflict);
      adj[info.t1].push(info.t0 * 2 + conflict);
    } else nonManifold++;
  }
  const flip = new Int8Array(nt).fill(-1);
  let orientable = true;
  for (let s = 0; s < nt && orientable; s++) {
    if (flip[s] !== -1) continue;
    flip[s] = 0;
    const stack = [s];
    while (stack.length) {
      const t = stack.pop()!;
      for (const e of adj[t]) {
        const n = e >> 1,
          c = e & 1;
        const want = c ? 1 - flip[t] : flip[t];
        if (flip[n] === -1) {
          flip[n] = want;
          stack.push(n);
        } else if (flip[n] !== want) {
          orientable = false;
        }
      }
    }
  }
  let bComps = 0;
  for (let i = 0; i < nv; i++) if (bUsed[i] && find(bParent, i) === i) bComps++;
  const used = new Uint8Array(nv);
  for (let i = 0; i < m.indices.length; i++) used[m.indices[i]] = 1;
  let vUsed = 0;
  for (let i = 0; i < nv; i++) vUsed += used[i];
  return {
    euler: vUsed - map.size + nt,
    orientable,
    boundaryComponents: bComps,
    closed: boundary === 0,
    nonManifoldEdges: nonManifold,
  };
}

/** წერტილიდან სამკუთხედამდე მანძილის კვადრატი (Ericson, Real-Time Collision Detection). */
export function pointTriDist2(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az;
  const acx = cx - ax,
    acy = cy - ay,
    acz = cz - az;
  const apx = px - ax,
    apy = py - ay,
    apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) {
    qx = ax;
    qy = ay;
    qz = az;
  } else {
    const bpx = px - bx,
      bpy = py - by,
      bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) {
      qx = bx;
      qy = by;
      qz = bz;
    } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        qx = ax + v * abx;
        qy = ay + v * aby;
        qz = az + v * abz;
      } else {
        const cpx = px - cx,
          cpy = py - cy,
          cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) {
          qx = cx;
          qy = cy;
          qz = cz;
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + w * acx;
            qy = ay + w * acy;
            qz = az + w * acz;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              qx = bx + w * (cx - bx);
              qy = by + w * (cy - by);
              qz = bz + w * (cz - bz);
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom,
                w = vc * denom;
              qx = ax + abx * v + acx * w;
              qy = ay + aby * v + acy * w;
              qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  const dx = px - qx,
    dy = py - qy,
    dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}
