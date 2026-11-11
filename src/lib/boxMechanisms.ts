/**
 * Geometry for the mechanical box lids:
 *  - Print-in-place hinge (knuckles + captive pin along the back edge)
 *  - Sliding lid (grooved side/back walls with an open front)
 *  - Screw-on cap (helical threads on a neck + a threaded skirt in the cap)
 *
 * Everything is built from closed, outward-facing triangle shells. Overlapping shells inside
 * one part are fused by the slicer (same approach the box floor / walls / dividers already use),
 * so no boolean CSG is needed. Clearances are always real gaps between separate shells.
 */
import * as THREE from 'three';

export interface P2 {
  x: number;
  y: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface RawMesh {
  vertices: V3[];
  triangles: [number, number, number][];
}

// ---------------------------------------------------------------------------
// Generic mesh helpers
// ---------------------------------------------------------------------------

export function emptyMesh(): RawMesh {
  return { vertices: [], triangles: [] };
}

export function appendInto(target: RawMesh, src: RawMesh): void {
  const off = target.vertices.length;
  for (const v of src.vertices) target.vertices.push(v);
  for (const [a, b, c] of src.triangles) target.triangles.push([a + off, b + off, c + off]);
}

export function mergeMeshes(...meshes: RawMesh[]): RawMesh {
  const out = emptyMesh();
  for (const m of meshes) appendInto(out, m);
  return out;
}

function signedVolume(m: RawMesh): number {
  let vol = 0;
  for (const [a, b, c] of m.triangles) {
    const p = m.vertices[a];
    const q = m.vertices[b];
    const r = m.vertices[c];
    vol +=
      (p.x * (q.y * r.z - q.z * r.y) - p.y * (q.x * r.z - q.z * r.x) + p.z * (q.x * r.y - q.y * r.x)) /
      6;
  }
  return vol;
}

/** Flips every triangle when a combinatorially-consistent closed shell is facing inward. */
export function ensureOutward(m: RawMesh): RawMesh {
  if (signedVolume(m) < 0) {
    m.triangles = m.triangles.map(([a, b, c]) => [a, c, b]);
  }
  return m;
}

export function mapVertices(m: RawMesh, fn: (v: V3) => V3): RawMesh {
  return { vertices: m.vertices.map(fn), triangles: m.triangles.map((t) => [...t] as [number, number, number]) };
}

/**
 * Rigid rotation about an axis parallel to +X passing through (y = yc, z = zc).
 * theta = 0 leaves the mesh untouched; theta = PI swings a closed lid over onto the print bed.
 * Points above the axis travel towards +Y first (i.e. away from the box body behind the hinge).
 */
export function rotateAboutXAxis(m: RawMesh, yc: number, zc: number, theta: number): RawMesh {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return mapVertices(m, (v) => {
    const dy = v.y - yc;
    const dz = v.z - zc;
    return { x: v.x, y: yc + dy * c + dz * s, z: zc - dy * s + dz * c };
  });
}

export function meshBounds(m: RawMesh) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const v of m.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// ---------------------------------------------------------------------------
// 2D polygon helpers
// ---------------------------------------------------------------------------

function area2D(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

function dedupe(pts: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-5) out.push(p);
  }
  if (out.length > 2) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-5) out.pop();
  }
  return out;
}

/** Extrudes a polygon (with optional holes) into a closed outward-facing prism between z0 and z1. */
export function extrudePoly2D(outerIn: P2[], holesIn: P2[][], z0: number, z1: number): RawMesh {
  const outer = dedupe(outerIn).map((p) => new THREE.Vector2(p.x, p.y));
  if (outer.length < 3 || Math.abs(z1 - z0) < 1e-6) return emptyMesh();
  if (area2D(outer) < 0) outer.reverse();
  const holes = holesIn
    .map((h) => dedupe(h).map((p) => new THREE.Vector2(p.x, p.y)))
    .filter((h) => h.length >= 3)
    .map((h) => (area2D(h) > 0 ? h.reverse() : h));

  let faces: number[][];
  try {
    faces = THREE.ShapeUtils.triangulateShape(outer, holes);
  } catch {
    return emptyMesh();
  }
  const all = [...outer, ...holes.flat()];
  const n = all.length;
  const zb = Math.min(z0, z1);
  const zt = Math.max(z0, z1);
  const vertices: V3[] = [];
  for (const p of all) vertices.push({ x: p.x, y: p.y, z: zb });
  for (const p of all) vertices.push({ x: p.x, y: p.y, z: zt });
  const triangles: [number, number, number][] = [];
  for (const f of faces) {
    let [a, b, c] = f;
    const pa = all[a];
    const pb = all[b];
    const pc = all[c];
    const cr = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    if (Math.abs(cr) < 1e-12) continue;
    if (cr < 0) [b, c] = [c, b];
    triangles.push([n + a, n + b, n + c]);
    triangles.push([a, c, b]);
  }
  const ring = (len: number, start: number) => {
    for (let i = 0; i < len; i++) {
      const cur = start + i;
      const nxt = start + ((i + 1) % len);
      triangles.push([cur, nxt, n + nxt]);
      triangles.push([cur, n + nxt, n + cur]);
    }
  };
  let cursor = 0;
  ring(outer.length, cursor);
  cursor += outer.length;
  for (const h of holes) {
    ring(h.length, cursor);
    cursor += h.length;
  }
  return { vertices, triangles };
}

export function boxPrism(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): RawMesh {
  if (x1 - x0 < 1e-5 || y1 - y0 < 1e-5) return emptyMesh();
  return extrudePoly2D(
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    [],
    z0,
    z1
  );
}

export function circlePts(cx: number, cy: number, r: number, segments: number): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Extrudes a profile drawn in the (Y, Z) plane along the X axis from x0 to x1. */
export function prismAlongX(outerYZ: P2[], holesYZ: P2[][], x0: number, x1: number): RawMesh {
  const m = extrudePoly2D(outerYZ, holesYZ, x0, x1);
  // (a, b, c) -> (x = c, y = a, z = b) is a cyclic axis permutation (a proper rotation), so winding is preserved.
  return mapVertices(m, (v) => ({ x: v.z, y: v.x, z: v.y }));
}

/** Counter-clockwise rounded rectangle. */
export function roundedRectPts(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  radius: number,
  segPerCorner = 10
): P2[] {
  const r = Math.max(0, Math.min(radius, halfW, halfH));
  if (r < 1e-3) {
    return [
      { x: cx - halfW, y: cy - halfH },
      { x: cx + halfW, y: cy - halfH },
      { x: cx + halfW, y: cy + halfH },
      { x: cx - halfW, y: cy + halfH },
    ];
  }
  const corners = [
    { x: cx + halfW - r, y: cy - halfH + r, a0: -Math.PI / 2 },
    { x: cx + halfW - r, y: cy + halfH - r, a0: 0 },
    { x: cx - halfW + r, y: cy + halfH - r, a0: Math.PI / 2 },
    { x: cx - halfW + r, y: cy - halfH + r, a0: Math.PI },
  ];
  const pts: P2[] = [];
  for (const c of corners) {
    for (let i = 0; i <= segPerCorner; i++) {
      const a = c.a0 + (i / segPerCorner) * (Math.PI / 2);
      pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
    }
  }
  return dedupe(pts);
}

/**
 * "D" shape: rounded back corners, perfectly straight sides running all the way to a square front
 * edge at yFront. Used for slide channels so nothing narrows towards the open front.
 */
export function slideChannelPts(
  cx: number,
  halfW: number,
  yFront: number,
  yBack: number,
  rBack: number,
  segPerCorner = 10
): P2[] {
  const r = Math.max(0, Math.min(rBack, halfW, (yBack - yFront) * 0.5));
  const pts: P2[] = [
    { x: cx - halfW, y: yFront },
    { x: cx + halfW, y: yFront },
  ];
  if (r < 1e-3) {
    pts.push({ x: cx + halfW, y: yBack }, { x: cx - halfW, y: yBack });
    return pts;
  }
  for (let i = 0; i <= segPerCorner; i++) {
    const a = (i / segPerCorner) * (Math.PI / 2);
    pts.push({ x: cx + halfW - r + r * Math.cos(a), y: yBack - r + r * Math.sin(a) });
  }
  for (let i = 0; i <= segPerCorner; i++) {
    const a = Math.PI / 2 + (i / segPerCorner) * (Math.PI / 2);
    pts.push({ x: cx - halfW + r + r * Math.cos(a), y: yBack - r + r * Math.sin(a) });
  }
  return dedupe(pts);
}

/** Sutherland-Hodgman clip of a convex polygon against y >= c (keepAbove) or y <= c. */
export function clipConvexY(poly: P2[], c: number, keepAbove: boolean): P2[] {
  const inside = (p: P2) => (keepAbove ? p.y >= c - 1e-9 : p.y <= c + 1e-9);
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % poly.length];
    const ci = inside(cur);
    const ni = inside(nxt);
    if (ci) out.push(cur);
    if (ci !== ni) {
      const t = (c - cur.y) / (nxt.y - cur.y);
      out.push({ x: cur.x + t * (nxt.x - cur.x), y: c });
    }
  }
  return dedupe(out);
}

/**
 * Builds a "U" shaped band = (outer convex polygon minus inner convex polygon), both already
 * clipped to y >= yCut so the band is open along the front edge yCut.
 */
export function uBandPts(outerClipped: P2[], innerClipped: P2[], yCut: number): P2[] {
  const onLine = (p: P2) => Math.abs(p.y - yCut) < 1e-6;
  const walk = (poly: P2[]): P2[] => {
    const ccw = area2D(poly) >= 0 ? poly : [...poly].reverse();
    let iR = -1;
    let iL = -1;
    for (let i = 0; i < ccw.length; i++) {
      if (!onLine(ccw[i])) continue;
      if (iR < 0 || ccw[i].x > ccw[iR].x) iR = i;
      if (iL < 0 || ccw[i].x < ccw[iL].x) iL = i;
    }
    if (iR < 0 || iL < 0) return [];
    const path: P2[] = [];
    for (let k = 0, i = iR; k <= ccw.length; k++, i = (i + 1) % ccw.length) {
      path.push(ccw[i]);
      if (i === iL) break;
    }
    return path; // bottom-right -> up the right side -> across the back -> down to bottom-left
  };
  const o = walk(outerClipped);
  const inn = walk(innerClipped);
  if (o.length < 2 || inn.length < 2) return [];
  return [...o, ...inn.reverse()];
}

/** Rounded finger-pull tab sticking out of the front edge (yFront) of a lid, centred on cx. */
export function gripTabPts(cx: number, yFront: number, halfW: number, depth: number, overlap: number): P2[] {
  const pts: P2[] = [{ x: cx - halfW, y: yFront + overlap }];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    pts.push({ x: cx + halfW * Math.cos(a), y: yFront + depth * Math.sin(a) });
  }
  pts.push({ x: cx + halfW, y: yFront + overlap });
  return pts;
}

export function verticalIntersections(ring: P2[], x: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (x >= Math.min(p.x, q.x) && x <= Math.max(p.x, q.x) && Math.abs(q.x - p.x) > 1e-7) {
      ys.push(p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y));
    }
  }
  return ys.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Revolved / helical solids (screw lid)
// ---------------------------------------------------------------------------

/** Revolves a closed (r, z) profile polygon (not touching the axis) 360 degrees around (cx, cy). */
export function revolveProfile(profile: { r: number; z: number }[], cx: number, cy: number, segments = 128): RawMesh {
  const np = profile.length;
  const vertices: V3[] = [];
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (const p of profile) vertices.push({ x: cx + p.r * ca, y: cy + p.r * sa, z: p.z });
  }
  for (let i = 0; i < segments; i++) {
    const i1 = (i + 1) % segments;
    for (let j = 0; j < np; j++) {
      const j1 = (j + 1) % np;
      const a = i * np + j;
      const b = i1 * np + j;
      const c = i1 * np + j1;
      const d = i * np + j1;
      triangles.push([a, b, c]);
      triangles.push([a, c, d]);
    }
  }
  return ensureOutward({ vertices, triangles });
}

/**
 * Sweeps a trapezoidal thread profile along a right-handed helix. rTip > rBase makes an external
 * (box neck) thread; rTip < rBase makes an internal (cap) thread. Both ends taper for a smooth lead-in.
 */
export function helixThread(o: {
  cx: number;
  cy: number;
  rBase: number;
  rTip: number;
  zStart: number;
  pitch: number;
  turns: number;
  baseW: number;
  tipW: number;
  segPerTurn?: number;
  taperRad?: number;
}): RawMesh {
  const segPerTurn = o.segPerTurn ?? 96;
  const taper = o.taperRad ?? Math.PI / 5;
  const total = Math.max(0.1, o.turns) * Math.PI * 2;
  const steps = Math.max(8, Math.ceil((total / (Math.PI * 2)) * segPerTurn));
  const vertices: V3[] = [];
  const triangles: [number, number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * total;
    const k = Math.max(0.12, Math.min(1, a / taper, (total - a) / taper));
    const rT = o.rBase + (o.rTip - o.rBase) * k;
    const tw = o.baseW - (o.baseW - o.tipW) * k;
    const z0 = o.zStart + (a / (Math.PI * 2)) * o.pitch;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const prof = [
      { r: o.rBase, dz: -o.baseW / 2 },
      { r: rT, dz: -tw / 2 },
      { r: rT, dz: tw / 2 },
      { r: o.rBase, dz: o.baseW / 2 },
    ];
    for (const p of prof) vertices.push({ x: o.cx + p.r * ca, y: o.cy + p.r * sa, z: z0 + p.dz });
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < 4; j++) {
      const j1 = (j + 1) % 4;
      const a = i * 4 + j;
      const b = (i + 1) * 4 + j;
      const c = (i + 1) * 4 + j1;
      const d = i * 4 + j1;
      triangles.push([a, b, c]);
      triangles.push([a, c, d]);
    }
  }
  const s = 0;
  const e = steps * 4;
  triangles.push([s, s + 1, s + 2], [s, s + 2, s + 3]);
  triangles.push([e, e + 2, e + 1], [e, e + 3, e + 2]);
  return ensureOutward({ vertices, triangles });
}

// ---------------------------------------------------------------------------
// 1) PRINT-IN-PLACE HINGE
// ---------------------------------------------------------------------------

/**
 * Rigid rotation about an arbitrary axis (through `point`, along unit `dir`), using the same sense as
 * rotateAboutXAxis when dir = +X: theta = PI swings a closed lid over the hinge onto the bed.
 */
export function rotateAboutAxis(m: RawMesh, point: V3, dir: V3, theta: number): RawMesh {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const k = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const a = -theta;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return mapVertices(m, (v) => {
    const px = v.x - point.x;
    const py = v.y - point.y;
    const pz = v.z - point.z;
    const kxv = { x: k.y * pz - k.z * py, y: k.z * px - k.x * pz, z: k.x * py - k.y * px };
    const kd = k.x * px + k.y * py + k.z * pz;
    return {
      x: point.x + px * c + kxv.x * s + k.x * kd * (1 - c),
      y: point.y + py * c + kxv.y * s + k.y * kd * (1 - c),
      z: point.z + pz * c + kxv.z * s + k.z * kd * (1 - c),
    };
  });
}

function convexHull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper]; // counter-clockwise
}

const rot2 = (p: P2, ang: number): P2 => ({
  x: p.x * Math.cos(ang) - p.y * Math.sin(ang),
  y: p.x * Math.sin(ang) + p.y * Math.cos(ang),
});

interface BackEdgeScan {
  xs: number[];
  yb: number[];
  lineY: number;
  runs: { x0: number; x1: number }[];
  minX: number;
  maxX: number;
}

/** Samples the back (+Y) boundary of a ring and finds the stretches lying on its supporting line. */
function scanBackEdge(ring: P2[], tol: number): BackEdgeScan | null {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  if (!(maxX - minX > 10)) return null;
  const N = 300;
  const xs: number[] = [];
  const yb: number[] = [];
  let lineY = -Infinity;
  for (let i = 0; i <= N; i++) {
    const x = minX + 0.3 + ((maxX - minX - 0.6) * i) / N;
    const ys = verticalIntersections(ring, x);
    const y = ys.length ? ys[ys.length - 1] : -Infinity;
    xs.push(x);
    yb.push(y);
    if (y > lineY) lineY = y;
  }
  if (!isFinite(lineY)) return null;
  const runs: { x0: number; x1: number }[] = [];
  let start = -1;
  for (let i = 0; i <= N + 1; i++) {
    const ok = i <= N && yb[i] >= lineY - tol;
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      runs.push({ x0: xs[start], x1: xs[i - 1] });
      start = -1;
    }
  }
  return { xs, yb, lineY, runs, minX, maxX };
}

/** Picks the knuckle groups (x ranges) along the back edge: two short "jewellery box" hinges when possible. */
function planHingeGroups(scan: BackEdgeScan): { x0: number; x1: number }[] {
  const gMin = 12;
  const gMax = 24;
  const runs = scan.runs.filter((r) => r.x1 - r.x0 >= 2.5);
  const all = runs.length > 0 ? runs : scan.runs;
  const centred = (cx: number, len: number) => ({ x0: cx - len / 2, x1: cx + len / 2 });
  const clampLen = (len: number) => Math.max(gMin, Math.min(gMax, len));

  if (all.length >= 2) {
    const left = all[0];
    const right = all[all.length - 1];
    const lc = (left.x0 + left.x1) / 2;
    const rc = (right.x0 + right.x1) / 2;
    const gl = clampLen(left.x1 - left.x0 + 4);
    const gr = clampLen(right.x1 - right.x0 + 4);
    if (rc - lc > (gl + gr) / 2 + 6) return [centred(lc, gl), centred(rc, gr)];
    return [centred((lc + rc) / 2, clampLen(rc - lc + gl))];
  }
  const run = all[0];
  if (!run) return [centred((scan.minX + scan.maxX) / 2, gMin)];
  const len = run.x1 - run.x0;
  const inset = 2.0;
  if (len >= 2 * gMin + 24) {
    const g = clampLen(len * 0.28);
    return [
      { x0: run.x0 + inset, x1: run.x0 + inset + g },
      { x0: run.x1 - inset - g, x1: run.x1 - inset },
    ];
  }
  return [centred((run.x0 + run.x1) / 2, Math.max(gMin, Math.min(gMax * 1.3, len - 2 * inset)))];
}

/**
 * Chooses the hinge direction: the supporting line of the outline's back side that touches the most
 * outline (so contour shapes hinge along their flattest / most prominent back edge). Returns the angle
 * (radians) the hinge axis makes with +X.
 */
function chooseHingeAngle(ring: P2[]): { phi: number; score: number } {
  const hull = convexHull(ring);
  const candidates = new Set<number>([0]);
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 1.5) continue;
    const normalAng = Math.atan2(-dx, dy); // outward normal of a CCW hull edge
    const phi = normalAng - Math.PI / 2;
    if (Math.abs(phi) <= Math.PI / 4 + 1e-6) candidates.add(Math.round((phi * 180) / Math.PI));
  }
  let best = 0;
  let bestScore = -Infinity;
  for (const deg of candidates) {
    const phi = (deg * Math.PI) / 180;
    const scan = scanBackEdge(ring.map((p) => rot2(p, -phi)), 1.5);
    if (!scan) continue;
    const runs = scan.runs.filter((r) => r.x1 - r.x0 >= 2.5);
    const covered = runs.reduce((s, r) => s + (r.x1 - r.x0), 0);
    const spread = runs.length >= 2 ? runs[runs.length - 1].x1 - runs[0].x0 : 0;
    const score = Math.min(covered, 60) + Math.min(spread, 60) * 0.35 - Math.abs(deg) * 0.45;
    if (score > bestScore) {
      bestScore = score;
      best = phi;
    }
  }
  return { phi: best, score: bestScore };
}

export type HingeSide = 'back' | 'front' | 'left' | 'right' | 'auto';

/** Outward direction (radians from +X) of each box side, as seen from above with the artwork upright. */
const SIDE_NORMAL: Record<Exclude<HingeSide, 'auto'>, number> = {
  back: Math.PI / 2,
  right: 0,
  front: -Math.PI / 2,
  left: Math.PI,
};

/**
 * Angle of the hinge axis for the requested side. Each side is evaluated by turning the outline so that
 * side faces +Y and picking the flattest supporting edge within +/-45 degrees of it. 'auto' picks the
 * side with the best edge (ties go to the back).
 */
function chooseHingeAngleForSide(ring: P2[], side: HingeSide): number {
  const evalSide = (s: Exclude<HingeSide, 'auto'>) => {
    const psi = Math.PI / 2 - SIDE_NORMAL[s]; // rotation that turns this side to face +Y
    const r = chooseHingeAngle(ring.map((p) => rot2(p, psi)));
    // In the turned frame the hinge angle is r.phi; undo the turn for box coordinates
    return { phi: r.phi - psi, score: r.score + (s === 'back' ? 1.5 : 0) };
  };
  if (side !== 'auto') return evalSide(side).phi;
  let best = evalSide('back');
  for (const s of ['front', 'left', 'right'] as const) {
    const c = evalSide(s);
    if (c.score > best.score) best = c;
  }
  return best.phi;
}

export interface HingeResult {
  bodyMesh: RawMesh; // knuckles, brackets & captive pins fused to the box body (static)
  lidMeshClosed: RawMesh; // lid-side knuckles & tabs, in the CLOSED lid pose
  axisPoint: V3; // a point on the hinge axis
  axisDir: V3; // unit direction of the hinge axis
  gripTabPts: P2[] | null; // finger-pull tab outline on the front edge, opposite the hinge
  groupCount: number;
  /** Top band of the box walls (wallSplitZ..H) with 45-degree slots for the lid gussets; null = plain walls */
  wallTopMesh: RawMesh | null;
  /** Two-piece hinge: length of filament pin to cut for each hinge group (mm) */
  pinLengthsMm: number[];
  /** How far the lid's knuckles reach below the closed lid's underside (mm) */
  lidHangBelowRim: number;
  /** Build the plain walls only up to this height when wallTopMesh is used */
  wallSplitZ: number;
}

/** Sutherland-Hodgman clip of a convex polygon to the half-plane nx*x + ny*y >= d. */
function clipHalfPlane(poly: P2[], nx: number, ny: number, d: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = nx * a.x + ny * a.y - d;
    const db = nx * b.x + ny * b.y - d;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return out.length >= 3 && Math.abs(area2D(out)) > 1e-6 ? out : [];
}

/**
 * Extrudes the part of a polygon (with holes) lying in the half-plane nx*x + ny*y >= d, as small convex
 * prisms from its triangulation (touching prisms fuse in the slicer).
 */
export function extrudeClippedToHalfPlane(
  outer: P2[],
  holes: P2[][],
  z0: number,
  z1: number,
  nx: number,
  ny: number,
  d: number
): RawMesh {
  const m = emptyMesh();
  for (const tri of triangulatePolygon(outer, holes)) {
    const piece = clipHalfPlane(tri, nx, ny, d);
    if (piece.length) appendInto(m, extrudePoly2D(piece, [], z0, z1));
  }
  return m;
}

/** Triangulates a polygon with holes into triangles (as point triples). */
function triangulatePolygon(outerIn: P2[], holesIn: P2[][]): P2[][] {
  const outer = dedupe(outerIn).map((p) => new THREE.Vector2(p.x, p.y));
  if (outer.length < 3) return [];
  if (area2D(outer) < 0) outer.reverse();
  const holes = holesIn
    .map((h) => dedupe(h).map((p) => new THREE.Vector2(p.x, p.y)))
    .filter((h) => h.length >= 3)
    .map((h) => (area2D(h) > 0 ? h.reverse() : h));
  let faces: number[][];
  try {
    faces = THREE.ShapeUtils.triangulateShape(outer, holes);
  } catch {
    return [];
  }
  const all = [...outer, ...holes.flat()];
  return faces.map((f) => f.map((i) => ({ x: all[i].x, y: all[i].y })));
}

/**
 * Box wall top band with 45-degree slots. Each slot removes wall where y >= yCutAt(z) inside its x range
 * (local hinge frame). The band is rebuilt from the wall's triangulation; triangles away from the slots
 * are extruded through the whole band, triangles touching a slot are cut slice by slice.
 */
function buildSlottedWallTop(
  wallPolys: { outer: P2[]; holes: P2[][] }[],
  slots: { x0: number; x1: number }[],
  zBottom: number,
  zTop: number,
  yCutAt: (z: number) => number
): RawMesh {
  const mesh = emptyMesh();
  const sliceH = 0.4;
  const slices = Math.max(1, Math.ceil((zTop - zBottom) / sliceH));
  const yCutMin = yCutAt(zTop);
  for (const wp of wallPolys) {
    for (const tri of triangulatePolygon(wp.outer, wp.holes)) {
      let minX = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of tri) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const touches = slots.some((s) => maxX > s.x0 && minX < s.x1) && maxY > yCutMin;
      if (!touches) {
        appendInto(mesh, extrudePoly2D(tri, [], zBottom, zTop));
        continue;
      }
      for (let k = 0; k < slices; k++) {
        const z0 = zBottom + ((zTop - zBottom) * k) / slices;
        const z1 = zBottom + ((zTop - zBottom) * (k + 1)) / slices;
        const yCut = yCutAt(z1); // the slot is widest at the top of each slice
        let pieces: P2[][] = [tri];
        for (const s of slots) {
          const next: P2[][] = [];
          for (const p of pieces) {
            // p minus {x0 <= x <= x1, y >= yCut} = three convex pieces
            const left = clipHalfPlane(p, -1, 0, -s.x0); // x <= x0
            const right = clipHalfPlane(p, 1, 0, s.x1); // x >= x1
            let mid = clipHalfPlane(p, 1, 0, s.x0);
            if (mid.length) mid = clipHalfPlane(mid, -1, 0, -s.x1);
            if (mid.length) mid = clipHalfPlane(mid, 0, -1, -yCut); // y <= yCut
            for (const q of [left, right, mid]) if (q.length) next.push(q);
          }
          pieces = next;
        }
        for (const p of pieces) appendInto(mesh, extrudePoly2D(p, [], z0, z1));
      }
    }
  }
  return mesh;
}

/**
 * Print-in-place hinge. In a local frame where the hinge runs along +X behind the back (+Y) edge,
 * the axis sits at height (H + T) / 2 so a 180 degree swing lays the closed lid (z = H..H+T, art up)
 * exactly onto the bed (z = 0..T, art face-down). Knuckles go body / lid / body ... (odd count per
 * group so every pin is anchored at both ends). Body knuckles hang off the wall on 45 degree brackets
 * (support-free); lid knuckles sit on slim rounded posts. The local frame is rotated to follow the
 * flattest stretch of the outline, so contour boxes can be hinged too.
 */
export function buildPrintInPlaceHinge(o: {
  outerRing: P2[]; // box outer outline (mm, box coordinates)
  boxHeight: number;
  lidThickness: number;
  wall: number;
  clearance: number;
  gripTab?: boolean;
  side?: HingeSide;
  /** Box wall polygons (box coordinates). When given, lid knuckles get gussets and the wall gets slots. */
  wallPolys?: { outer: P2[]; holes: P2[][] }[];
  /**
   * Clamshell: the lid has its own walls and boxHeight/lidThickness are the box-half and lid-half depths.
   * With equal halves the pin sits right at the rim, so both halves get short 45-degree wall brackets
   * instead of long lid posts (strong at any box height).
   */
  clamshell?: boolean;
  /**
   * Vertical gap between the box rim and the closed lid rim. The pin needs clearance in its hole, so a
   * closed lid hanging on the pin sags at the hinge end; with zero gap the rims collide there first and
   * lever the lid open. The hinge axis is raised by half this gap so the closed lid clears the rim.
   */
  rimGap?: number;
  /**
   * Two-piece hinge: the lid is printed separately and joined with a 1.75 mm filament offcut pushed through
   * the knuckles. The pin can then sit right at the rim (like the clamshell) even for a flat lid.
   */
  pin?: boolean;
  /**
   * Floating hinge: the lid's knuckle hole is a vertical slot this much taller than round, so the closed
   * lid always rests flat on the rim (front and back) and simply rides up a little at the hinge end if the
   * print comes out slightly tall, instead of jamming and springing open.
   */
  slotLift?: number;
}): HingeResult | null {
  if (o.outerRing.length < 3) return null;
  const phi = chooseHingeAngleForSide(o.outerRing, o.side ?? 'back');
  const ring = o.outerRing.map((p) => rot2(p, -phi)); // local frame: hinge along +X at the back
  const scan = scanBackEdge(ring, 1.5);
  if (!scan) return null;

  const yBackAt = (x: number) => {
    const ys = verticalIntersections(ring, x);
    return ys.length ? ys[ys.length - 1] : -Infinity;
  };

  const c = Math.max(0.2, Math.min(0.8, o.clearance));
  const pinMode = !!o.pin;
  const slotLift = Math.max(0, o.slotLift ?? 0.5);
  const rPin = 1.35;
  const rIn = rPin + c;
  // Two-piece: 1.75 mm filament pin, snug in the box knuckles and free in the lid knuckles
  const FIL_R = 0.875;
  const rBoxHole = FIL_R + 0.05;
  const rLidHole = pinMode ? FIL_R + Math.max(0.2, c * 0.6) : rIn;
  const rOut = pinMode ? Math.max(2.6, rLidHole + slotLift + 1.2) : Math.max(2.8, rIn + slotLift + 1.2);
  const gap = 0.6;
  const H = o.boxHeight;
  const T = o.lidThickness;
  const ya = scan.lineY + rOut + gap;
  const rimGap = Math.max(0, o.rimGap ?? 0);
  const Hc = H + rimGap; // closed lid rim height (box rim is H)
  // Print-in-place: halfway between bed and closed lid. Two-piece: at the rim (kept inside the lid plate).
  const za = pinMode ? Math.min(Hc, Hc + T - rOut - 0.2) : (H + T + rimGap) / 2;
  if (za - rOut < 0.6) return null;
  const rimStyle = !!o.clamshell || pinMode; // box brackets must stay below a lid that sits on the rim
  /** Lid knuckle hole: a vertical slot (rides up when the lid sits on a slightly tall rim) */
  const lidSlot = (cy: number, cz: number, r: number, dz: number, apex: number) => {
    const pts = [...circlePts(cy, cz, r, circSeg), ...circlePts(cy, cz + dz, r, circSeg)];
    if (apex) pts.push({ x: cy, y: cz + (apex > 0 ? Math.max(0, dz) + r * Math.SQRT2 : Math.min(0, dz) - r * Math.SQRT2) });
    return convexHull(pts);
  };
  const pinLengthsMm: number[] = [];
  const ov = Math.max(0.4, Math.min(1.2, o.wall * 0.5));
  const SQ2 = Math.SQRT2;
  const circSeg = 48;

  const body = emptyMesh();
  const lidPrint = emptyMesh();
  const circle = circlePts(ya, za, rOut, circSeg);
  const groups = planHingeGroups(scan);
  // Gusset size: up to 4 mm, limited by the post height available under the barrel
  const gussetL = o.wallPolys && !o.clamshell ? Math.max(0, Math.min(4, 0.4 * (za - rIn - T))) : 0;
  const slots: { x0: number; x1: number }[] = [];
  const lidClosedDirect = emptyMesh(); // clamshell lid knuckles, built straight in the closed pose

  /** Thin slices along a knuckle, each with its own wall root so brackets hug curved outlines. */
  const knuckleSlices = (sx0: number, sx1: number, yMinSeg: number) => {
    const out: { a: number; b: number; yW: number; sMax: number }[] = [];
    const slices = Math.max(1, Math.ceil((sx1 - sx0) / 0.6));
    for (let s = 0; s < slices; s++) {
      const a = sx0 + ((sx1 - sx0) * s) / slices;
      const b = sx0 + ((sx1 - sx0) * (s + 1)) / slices;
      let sMin = Infinity;
      let sMax = -Infinity;
      for (let k = 0; k <= 2; k++) {
        const y = yBackAt(a + ((b - a) * k) / 2);
        if (!isFinite(y)) continue;
        sMin = Math.min(sMin, y);
        sMax = Math.max(sMax, y);
      }
      if (!isFinite(sMin)) {
        sMin = yMinSeg;
        sMax = yMinSeg;
      }
      const depth = Math.max(0.2, Math.min(ov, sMin - (sMax - o.wall) - 0.3));
      out.push({ a, b, yW: sMin - depth, sMax });
    }
    return out;
  };

  for (const g of groups) {
    let holeReach = g.x0 + g.x1 <= 0 ? -Infinity : Infinity; // how far the pin hole goes in from the entry end
    const L = g.x1 - g.x0;
    let n = L >= 20 ? 5 : 3;
    while (n > 3 && (L - (n - 1) * c) / n < 4) n -= 2;
    const seg = (L - (n - 1) * c) / n;
    if (seg < 2) continue;

    for (let i = 0; i < n; i++) {
      const sx0 = g.x0 + i * (seg + c);
      const sx1 = sx0 + seg;
      let yMin = Infinity;
      let yMax = -Infinity;
      for (let k = 0; k <= 10; k++) {
        const y = yBackAt(sx0 + ((sx1 - sx0) * k) / 10);
        if (!isFinite(y)) continue;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
      if (!isFinite(yMin)) {
        yMin = scan.lineY - 2;
        yMax = scan.lineY;
      }

      if (i % 2 === 0) {
        // Body knuckle: barrel + 45 degree gusset bracket rooted in the back wall (no web to the bed).
        // The bracket is built in thin slices so on curved outlines each slice roots into the wall
        // without poking through the inside face into the box cavity.
        if (!pinMode) appendInto(body, prismAlongX(circle, [], sx0, sx1));
        // Clamshell / two-piece: the lid sits directly on the rim, so the bracket must stay below it
        const zT = rimStyle ? H - c : Math.min(H - 0.5, za + rOut * 0.35);
        // Two-piece: snug filament hole (teardrop, prints cleanly sideways). Entry from the outer end of the
        // group; the inner end is closed off so the pin can't push through.
        const entryFromLeft = g.x0 + g.x1 <= 0;
        const blindX = entryFromLeft ? g.x1 - 1.0 : g.x0 + 1.0; // closed end wall at least ~1 mm
        const boxHole = convexHull([...circlePts(ya, za, rBoxHole, 24), { x: ya, y: za + rBoxHole * SQ2 }]);
        // 45-degree underside: z = za - (ya - y) - rOut*sqrt2 (tangent to the barrel)
        const zUnder = (y: number) => Math.max(0, za - (ya - y) - rOut * SQ2);
        for (const sl of knuckleSlices(sx0, sx1, yMin)) {
          if (!rimStyle) {
            const pts = [...circle, { x: sl.yW, y: zUnder(sl.yW) }, { x: sl.yW, y: zT }];
            appendInto(body, prismAlongX(convexHull(pts), [], sl.a, sl.b));
            continue;
          }
          // Clamshell: two convex pieces so the top stays flat just under the rim across the wall
          // (one hull would slope up from the wall root and poke into the lid half's wall).
          const yo = sl.sMax + 0.3; // just outside the wall face
          appendInto(
            body,
            prismAlongX(
              [
                { x: sl.yW, y: zUnder(sl.yW) },
                { x: yo, y: zUnder(yo) },
                { x: yo, y: zT },
                { x: sl.yW, y: zT },
              ],
              [],
              sl.a,
              sl.b
            )
          );
          // A slice is solid (closed end) only once it lies entirely past the end-wall line
          const blind = entryFromLeft ? sl.a >= blindX - 1e-6 : sl.b <= blindX + 1e-6;
          const holes = pinMode && !blind ? [boxHole] : [];
          if (pinMode && !blind) holeReach = entryFromLeft ? Math.max(holeReach, sl.b) : Math.min(holeReach, sl.a);
          appendInto(
            body,
            prismAlongX(convexHull([...circle, { x: yo, y: zUnder(yo) }, { x: yo, y: zT }]), holes, sl.a, sl.b)
          );
        }
      } else if (o.clamshell) {
        // Clamshell lid knuckle (closed pose): the mirror image of a body knuckle, hanging off the lid
        // half's own back wall just above the rim, with the pin hole through the barrel.
        const hole = lidSlot(ya, za, rIn, -slotLift, 0);
        const lidTop = Hc + T - 0.6;
        const zOver = (y: number) => Math.min(lidTop, za + (ya - y) + rOut * SQ2);
        for (const sl of knuckleSlices(sx0, sx1, yMin)) {
          const yo = sl.sMax + 0.3;
          // Root block inside the lid half's wall (flat just above the rim) + barrel piece outside it
          appendInto(
            lidClosedDirect,
            prismAlongX(
              [
                { x: sl.yW, y: Hc + c },
                { x: yo, y: Hc + c },
                { x: yo, y: zOver(yo) },
                { x: sl.yW, y: zOver(sl.yW) },
              ],
              [],
              sl.a,
              sl.b
            )
          );
          appendInto(
            lidClosedDirect,
            prismAlongX(convexHull([...circle, { x: yo, y: Hc + c }, { x: yo, y: zOver(yo) }]), [hole], sl.a, sl.b)
          );
        }
      } else if (pinMode) {
        // Two-piece lid knuckle (closed pose): barrel with a free-turning slot for the filament pin, joined
        // to the flat lid by a tab that stays clear of the hole. The lid prints face-down, so the slot's
        // lower end (closed) is its top when printing: teardrop apex that way.
        const hole = lidSlot(ya, za, rLidHole, -slotLift, -1);
        for (const sl of knuckleSlices(sx0, sx1, yMin)) {
          const yo = sl.sMax + 0.3; // just behind the box wall
          // Root: continues the lid plate back to the knuckle (inside the plate's thickness)
          appendInto(lidClosedDirect, boxPrism(sl.a, sl.b, sl.yW, yo + 0.2, Hc, Hc + T));
          // One smooth knuckle: flat on top (level with the lid, so it prints on the bed), round at the
          // back, and sloping cleanly underneath from the rim edge down to the barrel
          const profile = convexHull([...circle, { x: yo, y: Hc }, { x: yo, y: Hc + T }, { x: ya + rOut, y: Hc + T }]);
          appendInto(lidClosedDirect, prismAlongX(profile, [hole], sl.a, sl.b));
        }
      } else {
        // Lid knuckle (print pose = lid face-down at +Y): tube on a slim rounded post + flat tab into the lid
        // (slot points up while printing = down when closed)
        appendInto(lidPrint, prismAlongX(circle, [lidSlot(ya, za, rIn, slotLift, 0)], sx0, sx1));
        // Post = lower part of the barrel (kept fully below the pin hole) flaring down to the bed
        const post = convexHull([
          ...circle.filter((p) => p.y <= za - rIn - 0.2),
          { x: ya - rOut * 0.85, y: 0 },
          { x: ya + rOut, y: 0 },
        ]);
        appendInto(lidPrint, prismAlongX(post, [], sx0, sx1));
        appendInto(lidPrint, boxPrism(sx0, sx1, ya, 2 * ya - yMin + ov, 0, T));
        // 45-degree gusset where the post meets the tab: spreads the opening/closing load over many
        // layers instead of one sharp corner. When closed it nests in a matching slot in the box wall.
        if (gussetL > 0.5) {
          appendInto(
            lidPrint,
            prismAlongX(
              [
                { x: ya + rOut - 1.0, y: T - 0.05 },
                { x: ya + rOut + gussetL, y: T - 0.05 },
                { x: ya + rOut - 1.0, y: T + gussetL + 1.0 },
              ],
              [],
              sx0,
              sx1
            )
          );
          slots.push({ x0: sx0 - c, x1: sx1 + c });
        }
      }
    }
    if (pinMode) {
      const entryFromLeft = g.x0 + g.x1 <= 0;
      const depth = entryFromLeft ? holeReach - g.x0 : g.x1 - holeReach;
      if (isFinite(depth)) pinLengthsMm.push(Math.floor((depth - 0.3) * 2) / 2); // flush at the entry end
    } else {
      // Captive pin through the group, anchored in its two end body knuckles
      appendInto(body, prismAlongX(circlePts(ya, za, rPin, 32), [], g.x0, g.x1));
    }
  }

  if (body.vertices.length === 0) return null;

  // Finger-pull tab at the front (opposite the hinge), in the local frame then back to box coordinates
  let tab: P2[] | null = null;
  if (o.gripTab !== false) {
    const mid = groups.length ? (groups[0].x0 + groups[groups.length - 1].x1) / 2 : 0;
    const ys = verticalIntersections(ring, mid);
    if (ys.length) {
      const halfW = Math.max(5, Math.min(9, (scan.maxX - scan.minX) * 0.12));
      tab = gripTabPts(mid, ys[0], halfW, 3.5, 1.5).map((p) => rot2(p, phi));
    }
  }

  const toBox = (m: RawMesh) =>
    mapVertices(m, (v) => {
      const p = rot2({ x: v.x, y: v.y }, phi);
      return { x: p.x, y: p.y, z: v.z };
    });
  const axisXY = rot2({ x: 0, y: ya }, phi);

  // Slotted wall top: the closed gusset occupies y >= (ya - rOut - L) + (H - z) above z = H - L - 1, so the
  // wall is cut back along that 45-degree line (plus clearance) under each lid knuckle. While opening the
  // gusset moves up and away from the wall, so the slot never needs to be bigger than its closed shape.
  let wallTopMesh: RawMesh | null = null;
  let wallSplitZ = H;
  if (o.wallPolys && slots.length > 0) {
    wallSplitZ = Math.min(H - 0.5, Hc - gussetL - 1.0 - c);
    const slack = c * Math.SQRT2;
    const yCutAt = (z: number) => ya - rOut - gussetL + (Hc - z) - slack;
    const localWalls = o.wallPolys.map((w) => ({
      outer: w.outer.map((p) => rot2(p, -phi)),
      holes: w.holes.map((h) => h.map((p) => rot2(p, -phi))),
    }));
    wallTopMesh = toBox(buildSlottedWallTop(localWalls, slots, wallSplitZ, H, yCutAt));
  }

  return {
    bodyMesh: toBox(body),
    lidMeshClosed: toBox(mergeMeshes(rotateAboutXAxis(lidPrint, ya, za, Math.PI), lidClosedDirect)),
    axisPoint: { x: axisXY.x, y: axisXY.y, z: za },
    axisDir: { x: Math.cos(phi), y: Math.sin(phi), z: 0 },
    gripTabPts: tab,
    groupCount: groups.length,
    wallTopMesh,
    wallSplitZ,
    pinLengthsMm,
    lidHangBelowRim: Math.max(0, Hc - (za - rOut)),
  };
}

// ---------------------------------------------------------------------------
// 2) SLIDING LID (square / rectangle)
// ---------------------------------------------------------------------------

export interface SlidingLidGeometry {
  boxWalls: RawMesh; // walls from floorTop to H (floor is built separately)
  grooveBottomZ: number;
  buildLidExtras: (lidZBase: number, xOff: number) => RawMesh; // tongue, front block & bridge (lid-local)
  tongueThickness: number;
  frontY: number;
}

export function buildSlidingLid(o: {
  cx: number;
  cy: number;
  outerHalfW: number;
  outerHalfH: number;
  outerR: number;
  innerHalfW: number;
  innerHalfH: number;
  innerR: number;
  boxHeight: number;
  lidThickness: number;
  floorTop: number;
  tolerance: number;
  boxOffsetX: number;
}): SlidingLidGeometry {
  const { cx, cy } = o;
  const wall = Math.max(0.8, o.outerHalfW - o.innerHalfW);
  const gd = Math.max(0.6, Math.min(1.4, wall - 1.0)); // groove depth into each wall
  const tol = Math.max(0.25, o.tolerance);
  const vt = 0.25; // vertical clearance
  const tongueT = 1.6;
  const H = o.boxHeight;
  const T = o.lidThickness;
  const lidBaseClosed = H - T;
  const zg1 = lidBaseClosed + vt; // underside of the retaining lip
  const zg0 = lidBaseClosed - tongueT - vt; // groove floor (= front wall top)

  const outer = roundedRectPts(cx, cy, o.outerHalfW, o.outerHalfH, o.outerR, 12);
  const inner = roundedRectPts(cx, cy, o.innerHalfW, o.innerHalfH, o.innerR, 12);

  const frontInner = cy - o.innerHalfH;
  const grooveHalfW = o.innerHalfW + gd;
  // Cut line where the side walls stop: no further forward than the inner front face, and far enough
  // back that the outer corner fillet still leaves >= 0.8mm of wall beside the groove.
  let yCut = frontInner;
  const r = Math.min(o.outerR, o.outerHalfW, o.outerHalfH);
  const need = grooveHalfW + 0.8 - (cx + o.outerHalfW - r - cx);
  if (r > 0 && need > 0) {
    const cyc = cy - o.outerHalfH + r;
    const dy = Math.sqrt(Math.max(0, r * r - need * need));
    yCut = Math.max(yCut, cyc - dy);
  }

  const boxWalls = emptyMesh();
  const bx = (m: RawMesh) => mapVertices(m, (v) => ({ x: v.x + o.boxOffsetX, y: v.y, z: v.z }));
  // Lower full ring
  appendInto(boxWalls, bx(extrudePoly2D(outer, [inner], o.floorTop - 0.05, zg0)));
  // Groove band (inner face cut back by gd, open at the front)
  const outerClip = clipConvexY(outer, yCut, true);
  const grooveInner = slideChannelPts(cx, grooveHalfW, yCut - 2, cy + o.innerHalfH + gd, o.innerR + gd, 12);
  const grooveBand = uBandPts(outerClip, clipConvexY(grooveInner, yCut, true), yCut);
  if (grooveBand.length >= 3) appendInto(boxWalls, bx(extrudePoly2D(grooveBand, [], zg0, zg1)));
  // Retaining lip band (normal inner face, straight to the front so the lid can slide out)
  const lipInner = slideChannelPts(cx, o.innerHalfW, yCut - 2, cy + o.innerHalfH, o.innerR, 12);
  const lipBand = uBandPts(outerClip, clipConvexY(lipInner, yCut, true), yCut);
  if (lipBand.length >= 3) appendInto(boxWalls, bx(extrudePoly2D(lipBand, [], zg1, H)));

  const frontBlock = clipConvexY(outer, yCut - tol, false);
  const tongue = slideChannelPts(
    cx,
    grooveHalfW - tol,
    yCut - tol - 0.6,
    cy + o.innerHalfH + gd - tol,
    Math.max(0, o.innerR + gd - tol),
    12
  );

  const buildLidExtras = (lidZBase: number, xOff: number): RawMesh => {
    const lid = emptyMesh();
    const lx = (m: RawMesh) => mapVertices(m, (v) => ({ x: v.x + xOff, y: v.y, z: v.z }));
    appendInto(lid, lx(extrudePoly2D(tongue, [], lidZBase - tongueT, lidZBase + 0.05)));
    if (frontBlock.length >= 3) appendInto(lid, lx(extrudePoly2D(frontBlock, [], lidZBase - tongueT, lidZBase + T)));
    appendInto(
      lid,
      lx(boxPrism(cx - (o.innerHalfW - tol), cx + (o.innerHalfW - tol), yCut - tol - 0.4, frontInner + 1.0, lidZBase, lidZBase + T))
    );
    return lid;
  };

  return {
    boxWalls,
    grooveBottomZ: zg0,
    buildLidExtras,
    tongueThickness: tongueT,
    frontY: cy - o.outerHalfH,
  };
}

// ---------------------------------------------------------------------------
// 3) SCREW-ON CAP (circle)
// ---------------------------------------------------------------------------

export interface ScrewLidGeometry {
  boxWalls: RawMesh;
  dividerMaxZ: number;
  skirtHeight: number;
  buildLidExtras: (lidZBase: number, xOff: number) => RawMesh; // skirt + internal thread (lid-local)
}

export const SCREW_NECK_HEIGHT_MM = 8.5;

export function buildScrewLid(o: {
  cx: number;
  cy: number;
  outerR: number;
  innerR: number;
  boxHeight: number;
  floorTop: number;
  tolerance: number;
}): ScrewLidGeometry {
  const { cx, cy } = o;
  const H = o.boxHeight;
  const pitch = 3.0;
  const td = 1.0; // thread depth
  const baseW = 2.4;
  const tipW = 0.4;
  const c = Math.max(0.25, o.tolerance + 0.1); // radial clearance
  const capWall = 1.6;
  const neckWall = 1.6;
  const Ro = o.outerR;
  const Rc = Ro - capWall; // cap skirt inner face
  const Rn = Rc - td - c; // neck outer face
  const neckInner = Math.min(o.innerR, Rn - neckWall);
  const hn = Math.min(SCREW_NECK_HEIGHT_MM, Math.max(5, H - o.floorTop - 4));
  const zn = H - hn; // shoulder
  const chamfer = Math.max(0, o.innerR - neckInner);
  const zChamferBottom = Math.max(o.floorTop + 0.5, zn - chamfer);

  const profile = [
    { r: o.innerR, z: o.floorTop - 0.05 },
    { r: Ro, z: o.floorTop - 0.05 },
    { r: Ro, z: zn },
    { r: Rn, z: zn },
    { r: Rn, z: H },
    { r: neckInner, z: H },
    { r: neckInner, z: zn },
  ];
  if (chamfer > 1e-3) profile.push({ r: o.innerR, z: zChamferBottom });

  const boxWalls = revolveProfile(profile, cx, cy, 128);
  const zStart = zn + 1.0 + baseW / 2;
  const turns = Math.max(0.75, (H - 0.6 - baseW / 2 - zStart) / pitch);
  appendInto(
    boxWalls,
    helixThread({ cx, cy, rBase: Rn - 0.3, rTip: Rn + td, zStart, pitch, turns, baseW, tipW })
  );

  const skirtH = H - (zn + 0.4);
  const zStartL = zStart + pitch / 2;
  const turnsL = Math.max(0.75, (H - 0.3 - baseW / 2 - zStartL) / pitch);

  const buildLidExtras = (lidZBase: number, xOff: number): RawMesh => {
    const dz = lidZBase - H;
    const skirt = revolveProfile(
      [
        { r: Rc, z: lidZBase - skirtH },
        { r: Ro, z: lidZBase - skirtH },
        { r: Ro, z: lidZBase + 0.05 },
        { r: Rc, z: lidZBase + 0.05 },
      ],
      cx + xOff,
      cy,
      128
    );
    const thread = helixThread({
      cx: cx + xOff,
      cy,
      rBase: Rc + 0.3,
      rTip: Rc - td,
      zStart: zStartL + dz,
      pitch,
      turns: turnsL,
      baseW,
      tipW,
    });
    return mergeMeshes(skirt, thread);
  };

  return {
    boxWalls,
    dividerMaxZ: zChamferBottom - 0.2,
    skirtHeight: skirtH,
    buildLidExtras,
  };
}
