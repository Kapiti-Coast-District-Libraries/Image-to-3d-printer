import * as THREE from 'three';
import { BoxLidStyle, MultiColorTraceResult, TraceParameters } from './colorQuantizer';
import { Point, TracedPolygon } from './vectorTracer';
import {
  RawMesh,
  appendInto,
  buildPrintInPlaceHinge,
  buildScrewLid,
  buildSlidingLid,
  emptyMesh,
  extrudeClippedToHalfPlane,
  extrudePoly2D,
  gripTabPts,
  mapVertices,
  meshBounds,
  rotateAboutAxis,
  verticalIntersections,
  HingeResult,
  SlidingLidGeometry,
  ScrewLidGeometry,
  SCREW_NECK_HEIGHT_MM,
} from './boxMechanisms';

/**
 * Lid styles that need a particular box outline fall back to 'cap_with_plug' when the outline
 * doesn't suit them: sliding needs straight parallel walls (square / rectangle), screw needs a circle.
 */
export function resolveBoxLidStyle(params: TraceParameters): BoxLidStyle {
  const requested = params.boxLidStyle || 'cap_with_plug';
  const shape = params.strokeShape || 'contour';
  if (requested === 'sliding' && shape !== 'square' && shape !== 'rectangle') return 'cap_with_plug';
  if (requested === 'screw' && shape !== 'circle') return 'cap_with_plug';
  return requested;
}

/**
 * The artwork colour slot that forms the lid's backing plate - and therefore the lid's outer edge
 * (all lid styles fuse their rim / gap-fill into this slot).
 */
export function resolveArtworkBaseSlot(
  traceResult: MultiColorTraceResult,
  params: TraceParameters
): number {
  const raw = Math.min(params.numColors - 1, Math.max(0, params.baseSlotIndex));
  const preferred = traceResult.layers.find((l) => l.slotIndex === raw);
  const resolved = preferred?.mergedIntoSlot != null ? preferred.mergedIntoSlot : raw;
  return (
    traceResult.layers.find(
      (l) => l.slotIndex === resolved && l.enabled && l.mergedIntoSlot == null
    )?.slotIndex ??
    traceResult.layers.find((l) => !l.isStrokeAndBase && l.enabled && l.mergedIntoSlot == null)
      ?.slotIndex ??
    0
  );
}

/**
 * Default backing / lid-surround colour: the artwork colour that matches the picture's own background
 * (e.g. a logo drawn on white paper gets a white lid surround, so the lid looks like the original image).
 * Returns null when no artwork colour is close to the background, in which case slot 1 is used as before.
 */
export function pickAutoBaseSlot(traceResult: MultiColorTraceResult): number | null {
  const bg = traceResult.detectedBgHex;
  if (!bg) return null;
  const toRgb = (hex: string) => {
    const h = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const b = toRgb(bg);
  let best: number | null = null;
  let bestD = 60 * 60;
  for (const l of traceResult.layers) {
    if (l.isStrokeAndBase || !l.enabled || l.mergedIntoSlot != null || l.pixelCount <= 0) continue;
    const c = toRgb(l.detectedHex);
    const d = (c[0] - b[0]) ** 2 + (c[1] - b[1]) ** 2 + (c[2] - b[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = l.slotIndex;
    }
  }
  return best;
}

/** Colour of the lid's outer edge, which the box body follows by default. */
export function getLidEdgeColorHex(
  traceResult: MultiColorTraceResult,
  params: TraceParameters
): string | null {
  const slot = resolveArtworkBaseSlot(traceResult, params);
  const layer = traceResult.layers.find((l) => l.slotIndex === slot);
  return layer ? layer.printHex.toUpperCase() : null;
}

export function lidStyleSupportsShape(style: BoxLidStyle, shape: TraceParameters['strokeShape']): boolean {
  const s = shape || 'contour';
  if (style === 'sliding') return s === 'square' || s === 'rectangle';
  if (style === 'screw') return s === 'circle';
  return true;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ManifoldMeshPart {
  slotIndex: number; // 0..3 (AMS Slot 1..4) or 4 (Stroke / Box)
  name: string;
  colorHex: string;
  partGroup?: 'box' | 'lid' | 'plaque';
  offsetX?: number;
  lidZMin?: number;
  lidZMax?: number;
  isPreFlippedFaceDown?: boolean;
  printInPlaceLinked?: boolean; // Box + lid are mechanically linked (hinge) and must export as one object
  vertices: Vec3[];
  triangles: [number, number, number][]; // 0-indexed into `vertices`
  zMin: number;
  zMax: number;
  geometry: THREE.BufferGeometry;
}

export interface ExtrudedModelResult {
  parts: ManifoldMeshPart[];
  dimensionsMm: {
    width: number;
    depth: number;
    height: number;
  };
  pixelTransform: {
    centerX: number;
    centerY: number;
    scaleMmPerPx: number;
    imageWidth: number;
    imageHeight: number;
  };
  totalVertices: number;
  totalTriangles: number;
  /** Two-piece hinged box: filament pin length to cut for each hinge (mm) */
  hingePinLengthsMm?: number[];
}

function cleanRing2D(ring: Point[]): THREE.Vector2[] {
  if (ring.length < 3) return [];
  const pts: THREE.Vector2[] = [];

  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (pts.length > 0) {
      const prev = pts[pts.length - 1];
      if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-4) {
        continue;
      }
    }
    pts.push(new THREE.Vector2(p.x, p.y));
  }

  // Remove closing duplicate if identical to start
  if (pts.length > 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) {
      pts.pop();
    }
  }

  return pts.length >= 3 ? pts : [];
}

function signedAreaVec2(pts: THREE.Vector2[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return area * 0.5;
}

/**
 * Offsets a 2D closed ring along its outward miter normals by `offsetMm`.
 * Used when the user requests extra positive seam overlap for Bambu slicer wall fusion.
 */
function offsetRingVec2(ring: THREE.Vector2[], offsetMm: number): THREE.Vector2[] {
  if (Math.abs(offsetMm) < 1e-5 || ring.length < 3) return ring;

  const n = ring.length;
  const result: THREE.Vector2[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.hypot(dx1, dy1) || 1;
    // Outward right-hand normal for CCW ring in 3D XY plane is (dy, -dx)
    const nx1 = dy1 / len1;
    const ny1 = -dx1 / len1;

    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2) || 1;
    const nx2 = dy2 / len2;
    const ny2 = -dx2 / len2;

    let mx = nx1 + nx2;
    let my = ny1 + ny2;
    const mLen = Math.hypot(mx, my);
    if (mLen < 1e-4) {
      mx = nx1;
      my = ny1;
    } else {
      mx /= mLen;
      my /= mLen;
    }

    // Clamp miter scale to avoid spikes at sharp acute corners
    const dot = mx * nx1 + my * ny1;
    const miterScale = Math.min(1.6, 1 / Math.max(0.4, dot));

    result[i] = new THREE.Vector2(
      curr.x + mx * offsetMm * miterScale,
      curr.y + my * offsetMm * miterScale
    );
  }

  return result;
}

/**
 * Creates a watertight 2-manifold indexed 3D box prism [x0..x1, y0..y1, z0..z1]
 * with strictly outward-oriented face normals.
 */
function createBoxPrismMesh(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number
): { vertices: Vec3[]; triangles: [number, number, number][] } {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const minZ = Math.min(z0, z1);
  const maxZ = Math.max(z0, z1);

  const vertices: Vec3[] = [
    { x: minX, y: minY, z: minZ }, // 0
    { x: maxX, y: minY, z: minZ }, // 1
    { x: maxX, y: maxY, z: minZ }, // 2
    { x: minX, y: maxY, z: minZ }, // 3
    { x: minX, y: minY, z: maxZ }, // 4
    { x: maxX, y: minY, z: maxZ }, // 5
    { x: maxX, y: maxY, z: maxZ }, // 6
    { x: minX, y: maxY, z: maxZ }, // 7
  ];

  const triangles: [number, number, number][] = [
    // Bottom (-Z)
    [0, 2, 1],
    [0, 3, 2],
    // Top (+Z)
    [4, 5, 6],
    [4, 6, 7],
    // Front (-Y)
    [0, 1, 5],
    [0, 5, 4],
    // Back (+Y)
    [2, 3, 7],
    [2, 7, 6],
    // Left (-X)
    [0, 7, 3],
    [0, 4, 7],
    // Right (+X)
    [1, 2, 6],
    [1, 6, 5],
  ];

  return { vertices, triangles };
}

function getVerticalIntersections(ring: Point[], xCoord: number): number[] {
  const n = ring.length;
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    if (xCoord >= minX && xCoord <= maxX && Math.abs(p2.x - p1.x) > 1e-5) {
      const t = (xCoord - p1.x) / (p2.x - p1.x);
      const y = p1.y + t * (p2.y - p1.y);
      ys.push(y);
    }
  }
  ys.sort((a, b) => a - b);
  const uniqueYs: number[] = [];
  for (const y of ys) {
    if (uniqueYs.length === 0 || Math.abs(y - uniqueYs[uniqueYs.length - 1]) > 1e-3) {
      uniqueYs.push(y);
    }
  }
  return uniqueYs;
}

function getHorizontalIntersections(ring: Point[], yCoord: number): number[] {
  const n = ring.length;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    if (yCoord >= minY && yCoord <= maxY && Math.abs(p2.y - p1.y) > 1e-5) {
      const t = (yCoord - p1.y) / (p2.y - p1.y);
      const x = p1.x + t * (p2.x - p1.x);
      xs.push(x);
    }
  }
  xs.sort((a, b) => a - b);
  const uniqueXs: number[] = [];
  for (const x of xs) {
    if (uniqueXs.length === 0 || Math.abs(x - uniqueXs[uniqueXs.length - 1]) > 1e-3) {
      uniqueXs.push(x);
    }
  }
  return uniqueXs;
}

/**
 * Extrudes a set of 2D TracedPolygons (with holes) into a watertight indexed 3D mesh
 * between zBottom and zTop.
 */
/**
 * Position (0..1 across the cavity) of divider i (1-based) of a grid with n compartments: the user's dragged
 * position when one is stored for this count, otherwise even spacing.
 */
export function dividerFrac(fracs: number[] | undefined, n: number, i: number): number {
  if (fracs && fracs.length === n - 1 && Number.isFinite(fracs[i - 1])) {
    return Math.max(0.03, Math.min(0.97, fracs[i - 1]));
  }
  return i / n;
}

function extrudePolygonsToManifold(
  polygons: TracedPolygon[],
  transformPt: (p: Point) => Point,
  zBottom: number,
  zTop: number,
  seamOverlapMm: number = 0,
  holeOffsetMm?: number,
  outerOffsetMm?: number
): { vertices: Vec3[]; triangles: [number, number, number][] } {
  const vertices: Vec3[] = [];
  const triangles: [number, number, number][] = [];

  for (const poly of polygons) {
    const transformedOuter = poly.outer.map(transformPt);
    let outerRing = cleanRing2D(transformedOuter);
    if (outerRing.length < 3) continue;

    // Ensure outer ring is Counter-Clockwise (signedArea > 0) in right-handed 3D XY plane
    if (signedAreaVec2(outerRing) < 0) {
      outerRing.reverse();
    }
    const outOff = outerOffsetMm !== undefined ? outerOffsetMm : seamOverlapMm * 0.5;
    if (Math.abs(outOff) > 1e-5) {
      outerRing = offsetRingVec2(outerRing, outOff);
    }

    const holeRings: THREE.Vector2[][] = [];
    for (const h of poly.holes) {
      const transformedHole = h.map(transformPt);
      let holeRing = cleanRing2D(transformedHole);
      if (holeRing.length >= 3) {
        // Ensure hole ring is Clockwise (signedArea < 0)
        if (signedAreaVec2(holeRing) > 0) {
          holeRing.reverse();
        }
        const hOff = holeOffsetMm !== undefined ? holeOffsetMm : seamOverlapMm * 0.5;
        if (Math.abs(hOff) > 1e-5) {
          holeRing = offsetRingVec2(holeRing, hOff);
        }
        holeRings.push(holeRing);
      }
    }

    // Triangulate 2D shape with holes using Three.js Earcut triangulator
    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(outerRing, holeRings);
    } catch {
      continue;
    }
    if (!faces || faces.length === 0) continue;

    const allPts2D: THREE.Vector2[] = [...outerRing];
    for (const h of holeRings) {
      allPts2D.push(...h);
    }

    const n = allPts2D.length;
    const baseVertexOffset = vertices.length;

    // Bottom vertices: baseVertexOffset + [0 .. n-1]
    for (let i = 0; i < n; i++) {
      vertices.push({ x: allPts2D[i].x, y: allPts2D[i].y, z: zBottom });
    }
    // Top vertices: baseVertexOffset + [n .. 2n-1]
    for (let i = 0; i < n; i++) {
      vertices.push({ x: allPts2D[i].x, y: allPts2D[i].y, z: zTop });
    }

    // Add Top & Bottom Cap Triangles with verified outward normal orientation
    for (const face of faces) {
      let [a, b, c] = face;
      const pa = allPts2D[a];
      const pb = allPts2D[b];
      const pc = allPts2D[c];

      const cross2D = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      if (Math.abs(cross2D) < 1e-9) continue;

      // Ensure (a, b, c) is strictly CCW in XY so top cap normal points +Z
      if (cross2D < 0) {
        const tmp = b;
        b = c;
        c = tmp;
      }

      // Top face (+Z normal)
      triangles.push([
        baseVertexOffset + n + a,
        baseVertexOffset + n + b,
        baseVertexOffset + n + c,
      ]);

      // Bottom face (-Z normal, reversed winding)
      triangles.push([
        baseVertexOffset + a,
        baseVertexOffset + c,
        baseVertexOffset + b,
      ]);
    }

    // Add Side Wall Triangles for outer ring and each hole ring
    const addRingWalls = (ringLength: number, ringStartIdx: number) => {
      for (let i = 0; i < ringLength; i++) {
        const curr = ringStartIdx + i;
        const next = ringStartIdx + ((i + 1) % ringLength);

        const bCurr = baseVertexOffset + curr;
        const bNext = baseVertexOffset + next;
        const tCurr = baseVertexOffset + n + curr;
        const tNext = baseVertexOffset + n + next;

        triangles.push([bCurr, bNext, tNext]);
        triangles.push([bCurr, tNext, tCurr]);
      }
    };

    let ringCursor = 0;
    addRingWalls(outerRing.length, ringCursor);
    ringCursor += outerRing.length;

    for (const h of holeRings) {
      addRingWalls(h.length, ringCursor);
      ringCursor += h.length;
    }
  }

  return { vertices, triangles };
}

/**
 * Converts indexed vertices & triangles into a Three.js BufferGeometry with crisp flat/creased shading normals.
 */
function createBufferGeometryFromManifold(
  vertices: Vec3[],
  triangles: [number, number, number][]
): THREE.BufferGeometry {
  const positions = new Float32Array(triangles.length * 9);
  let ptr = 0;

  for (let i = 0; i < triangles.length; i++) {
    const [i0, i1, i2] = triangles[i];
    const v0 = vertices[i0];
    const v1 = vertices[i1];
    const v2 = vertices[i2];

    positions[ptr++] = v0.x;
    positions[ptr++] = v0.y;
    positions[ptr++] = v0.z;

    positions[ptr++] = v1.x;
    positions[ptr++] = v1.y;
    positions[ptr++] = v1.z;

    positions[ptr++] = v2.x;
    positions[ptr++] = v2.y;
    positions[ptr++] = v2.z;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds the complete multi-colour 3D assembly from traced vector contours.
 */
export function buildExtrudedModel(
  traceResult: MultiColorTraceResult,
  params: TraceParameters
): ExtrudedModelResult {
  // 1. Find bounding box of all traced polygons in image pixel space
  let minPxX = Infinity;
  let minPxY = Infinity;
  let maxPxX = -Infinity;
  let maxPxY = -Infinity;

  const inspectPolys = (polys: TracedPolygon[]) => {
    for (const poly of polys) {
      for (const pt of poly.outer) {
        if (pt.x < minPxX) minPxX = pt.x;
        if (pt.y < minPxY) minPxY = pt.y;
        if (pt.x > maxPxX) maxPxX = pt.x;
        if (pt.y > maxPxY) maxPxY = pt.y;
      }
    }
  };

  inspectPolys(traceResult.silhouettePolygons);
  for (const layer of traceResult.layers) {
    if (layer.enabled) inspectPolys(layer.polygons);
  }

  if (!isFinite(minPxX) || maxPxX <= minPxX) {
    minPxX = 0;
    minPxY = 0;
    maxPxX = traceResult.width;
    maxPxY = traceResult.height;
  }

  const pxWidth = Math.max(1, maxPxX - minPxX);
  const pxHeight = Math.max(1, maxPxY - minPxY);
  const centerX = (minPxX + maxPxX) * 0.5;
  const centerY = (minPxY + maxPxY) * 0.5;

  const scaleMmPerPx = params.targetWidthMm / pxWidth;
  const depthMm = pxHeight * scaleMmPerPx;

  // Transform image (x, y) -> centered 3D millimeter (X right, Y up)
  const transformPt = (pt: Point): Point => ({
    x: (pt.x - centerX) * scaleMmPerPx,
    y: -(pt.y - centerY) * scaleMmPerPx,
  });

  const parts: ManifoldMeshPart[] = [];
  let maxZHeight = 0;

  // Determine active artwork backing slot (from 0 .. numColors - 1)
  const activeArtworkBaseSlot = resolveArtworkBaseSlot(traceResult, params);

  // ============================================================================
  // BOX MODE: Stroke Outline becomes a Hollow 3D Box & Traced Image is the Lid
  // ============================================================================
  if (params.boxMode) {
    const floorThicknessMm = Math.max(0.8, params.baseThicknessMm);
    const lidBaseThicknessMm = Math.max(0.8, params.baseThicknessMm);
    const lidInlayThicknessMm = Math.max(0.2, params.inlayThicknessMm);
    const artworkLayers = traceResult.layers.filter(
      (l) => !l.isStrokeAndBase && l.enabled && l.mergedIntoSlot == null
    );

    const lidTotalThicknessMm =
      params.extrusionMode === 'full_flush'
        ? lidBaseThicknessMm
        : params.extrusionMode === 'stepped_relief'
        ? lidBaseThicknessMm + Math.max(1, artworkLayers.length - 1) * lidInlayThicknessMm
        : lidBaseThicknessMm + lidInlayThicknessMm;

    const lidStyle = resolveBoxLidStyle(params);
    const isCapLike =
      lidStyle === 'cap_with_plug' || lidStyle === 'hinged' || lidStyle === 'screw';
    const isMechanical = lidStyle === 'hinged' || lidStyle === 'sliding' || lidStyle === 'screw';
    const rimExtraMm = lidStyle === 'raised_rim_recessed' ? 1.2 : 0;
    const SLIDE_TONGUE_MM = 1.6;
    let minBoxHeightMm = floorThicknessMm + lidTotalThicknessMm + rimExtraMm + 3.0;
    if (lidStyle === 'sliding') minBoxHeightMm += SLIDE_TONGUE_MM + 1.0;
    if (lidStyle === 'screw') minBoxHeightMm = Math.max(minBoxHeightMm, floorThicknessMm + SCREW_NECK_HEIGHT_MM + 5);
    if (lidStyle === 'hinged') minBoxHeightMm = Math.max(minBoxHeightMm, 12);
    // Clamshell hinged box: the closed height (walls + lid plate) is split into two equal halves, a box
    // half and a lid half with its own walls, so the hinge pin sits right at the rim between them.
    // Hinged lid shape: clamshell (deep lid, print-in-place), flat lid joined by a filament pin (two
    // pieces), or flat lid printed in place (long arms)
    const hingeLidMode =
      params.boxHingeLidMode ?? (params.boxHingeClamshell === false ? 'flat' : 'clamshell');
    const clamshell = lidStyle === 'hinged' && hingeLidMode === 'clamshell';
    const pinHinge = lidStyle === 'hinged' && hingeLidMode === 'flat_pin';
    if (clamshell) {
      minBoxHeightMm = Math.max(minBoxHeightMm, 2 * (floorThicknessMm + 4) - lidTotalThicknessMm, 2 * (lidTotalThicknessMm + 3) - lidTotalThicknessMm);
    }
    const boxHeightMm = Math.max(minBoxHeightMm, params.boxHeightMm ?? 28.0);
    const measuredWallForLip = () => Math.max(0.8, params.strokeWidthMm || 2.5);
    /** Depth of each half (box half and lid half) of a clamshell hinged box */
    const clamshellHalfMm = (boxHeightMm + lidTotalThicknessMm) / 2;

    // ---- Clamshell rim lip: the inner part of the box half's wall rises above the rim and the lid half's
    // wall (thinned at its bottom) drops over it. Optional snap: a 45-degree bead round the lip near its top
    // clicks into a matching groove inside the lid wall. The flex is tiny and shared round the whole rim.
    // Flat + pin lid: same lip. The lid gets a short skirt (pinSkirtMm) that drops over the lip and the box
    // rim is lowered by the same amount, so the closed box keeps its height.
    const rimLipMode = clamshell || pinHinge ? params.boxRimLip ?? 'snap_light' : 'none';
    const lipOn = rimLipMode !== 'none';
    const lipC = 0.2; // sliding clearance between lip and lid wall
    // Lip: stands just INSIDE the box wall on a 45-degree ledge, so the lid wall that drops over it only
    // loses the sliding clearance (a lip cut from the wall left the lid wall ~0.7 mm thin at the groove).
    const lipT = 1.2;
    void measuredWallForLip;
    const lipH = clamshell
      ? Math.min(3.2, Math.max(2.0, clamshellHalfMm - floorThicknessMm - 6)) // lip height above the rim
      : Math.min(3.2, Math.max(2.0, boxHeightMm - floorThicknessMm - 9));
    /** Flat + pin lid with a lip: depth of the lid's skirt (the box rim drops by this much) */
    const pinSkirtMm = pinHinge && lipOn ? lipH + lipC + 0.4 : 0;
    /** Height of the box rim where box and lid meet */
    const splitRimZ = clamshell ? clamshellHalfMm : boxHeightMm - pinSkirtMm;
    const lidHasSkirt = clamshell || pinSkirtMm > 0;
    // interference the bead has to push past (Light was too stiff at 0.15 in testing; that is now Firm)
    const snapMm = rimLipMode === 'snap_firm' ? 0.15 : rimLipMode === 'snap_light' ? 0.08 : 0;
    // bead: 45-degree flanks up to (clearance + snap) proud of the lip face, with a short flat top
    const beadDepth = snapMm > 0 ? lipC + snapMm : 0;
    const beadH = 2 * beadDepth + 0.3;
    const beadZ0 = splitRimZ + lipH - 0.5 - beadH;
    const beadAt = (z: number) =>
      beadDepth <= 0 ? 0 : Math.max(0, Math.min(beadDepth, z - beadZ0, beadZ0 + beadH - z));
    // Rim clearance for hinged lids: grows with the hinge gap (a looser pin lets the lid sag further)
    // Closed lids sit flush on the rim; the lid knuckles' slotted holes absorb any print variation
    const hingeRimGapMm = 0;
    const toleranceMm = Math.max(0, params.boxLidToleranceMm ?? 0.2);
    const plateLayout = params.boxPlateLayout || 'assembled';
    // A print-in-place hinge joins box & lid, so they can't be exported separately
    const exportParts = lidStyle === 'hinged' && !pinHinge ? 'both' : params.boxExportParts || 'both';
    const lidLiftMm =
      plateLayout === 'assembled' ? Math.max(0, params.boxLidLiftMm ?? 16.0) : 0;

    const strokeWidthMm = Math.max(0.8, params.strokeWidthMm);
    const boxWidthMm = params.targetWidthMm;
    const approxLidWidthMm = isCapLike
      ? boxWidthMm
      : Math.max(12, boxWidthMm - 2 * strokeWidthMm);

    const plugDepthMm = Math.min(2.2, Math.max(1.2, floorThicknessMm * 0.9));
    let boxOffsetX = 0;
    let lidOffsetX = 0;
    let lidZBase = 0;

    /** Rings that run along the inside face of the box wall (outer = hole = inner face); offset to make lips */
    const innerFaceRings = (): TracedPolygon[] =>
      upperWallsForMeasure
        .filter((p) => p.holes.length > 0 && p.holes[0].length >= 3)
        .map((p) => ({ outer: p.holes[0], holes: [p.holes[0]], area: 1 }));
    const upperWallsForMeasure =
      traceResult.boxUpperWallPolygons.length > 0
        ? traceResult.boxUpperWallPolygons
        : traceResult.silhouettePolygons;

    // ---- Measure the box outline in millimetres (un-offset box coordinates) ----
    let outerRingMm: Point[] = [];
    {
      let bestArea = -1;
      for (const poly of traceResult.silhouettePolygons) {
        const ring = poly.outer.map(transformPt);
        let a = 0;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i];
          const q = ring[(i + 1) % ring.length];
          a += p.x * q.y - q.x * p.y;
        }
        if (Math.abs(a) > bestArea) {
          bestArea = Math.abs(a);
          outerRingMm = ring;
        }
      }
    }
    const ringBounds = (ring: Point[]) => {
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity;
      for (const p of ring) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
      return { x0, x1, y0, y1 };
    };
    const ob = ringBounds(outerRingMm);
    const shapeCx = isFinite(ob.x0) ? (ob.x0 + ob.x1) / 2 : 0;
    const shapeCy = isFinite(ob.y0) ? (ob.y0 + ob.y1) / 2 : 0;
    const outerHalfW = isFinite(ob.x0) ? (ob.x1 - ob.x0) / 2 : boxWidthMm / 2;
    const outerHalfH = isFinite(ob.y0) ? (ob.y1 - ob.y0) / 2 : depthMm / 2;
    let innerHalfW = outerHalfW - strokeWidthMm;
    let innerHalfH = outerHalfH - strokeWidthMm;
    for (const poly of upperWallsForMeasure) {
      if (poly.holes.length > 0 && poly.holes[0].length >= 3) {
        const ib = ringBounds(poly.holes[0].map(transformPt));
        innerHalfW = (ib.x1 - ib.x0) / 2;
        innerHalfH = (ib.y1 - ib.y0) / 2;
        break;
      }
    }
    const measuredWall = Math.max(0.8, outerHalfW - innerHalfW);
    const cornerMm = Math.max(0, params.shapeCornerRadiusMm ?? 4.0);
    const innerCornerMm = Math.max(
      0,
      Math.min(Math.min(cornerMm, outerHalfW, outerHalfH) - measuredWall, innerHalfW - 0.5, innerHalfH - 0.5)
    );
    const outerCornerMm = innerCornerMm > 0 ? innerCornerMm + measuredWall : 0;

    if (plateLayout === 'side_by_side' && exportParts === 'both' && (lidStyle !== 'hinged' || pinHinge)) {
      const gapMm = 8;
      boxOffsetX = -(approxLidWidthMm + gapMm) * 0.5;
      lidOffsetX = (boxWidthMm + gapMm) * 0.5;
    }

    // ---- Mechanical lid geometry ----
    let hinge: HingeResult | null = null;
    let sliding: SlidingLidGeometry | null = null;
    let screw: ScrewLidGeometry | null = null;
    if (lidStyle === 'hinged') {
      hinge = buildPrintInPlaceHinge({
        outerRing: outerRingMm,
        boxHeight: splitRimZ,
        lidThickness: clamshell ? clamshellHalfMm : lidTotalThicknessMm + pinSkirtMm,
        clamshell,
        // with a rim lip the lid wall is thinner at the bottom, so brackets must root in the outer part
        wall: lipOn ? Math.max(0.6, measuredWall - lipC - 0.2) : measuredWall,
        clearance: params.boxHingeClearanceMm ?? 0.4,
        rimGap: hingeRimGapMm,
        pin: pinHinge,
        gripTab: params.boxLidGripTab !== false,
        side: params.boxHingeSide ?? 'back',
        // Wall outline lets the hinge add strengthening gussets to the lid knuckles and cut matching slots
        wallPolys: clamshell || pinHinge
          ? undefined
          : upperWallsForMeasure.map((poly) => ({
          outer: poly.outer.map(transformPt),
          holes: poly.holes.map((h) => h.map(transformPt)),
        })),
      });
    } else if (lidStyle === 'sliding') {
      sliding = buildSlidingLid({
        cx: shapeCx,
        cy: shapeCy,
        outerHalfW,
        outerHalfH,
        outerR: outerCornerMm,
        innerHalfW,
        innerHalfH,
        innerR: innerCornerMm,
        boxHeight: boxHeightMm,
        lidThickness: lidTotalThicknessMm,
        floorTop: floorThicknessMm,
        tolerance: toleranceMm,
        boxOffsetX,
      });
    } else if (lidStyle === 'screw') {
      screw = buildScrewLid({
        cx: shapeCx,
        cy: shapeCy,
        outerR: Math.min(outerHalfW, outerHalfH),
        innerR: Math.min(innerHalfW, innerHalfH),
        boxHeight: boxHeightMm,
        floorTop: floorThicknessMm,
        tolerance: toleranceMm,
      });
    }

    // Hinged lids are always built CLOSED (sitting on the box) and then swung open about the hinge axis:
    // 180 degrees is the print layout (lid face-down on the bed behind the box).
    const hingeOpenAngle =
      plateLayout === 'side_by_side'
        ? Math.PI
        : Math.min(Math.PI, (Math.max(0, params.boxLidLiftMm ?? 16) / 45) * Math.PI);

    // Two-piece lid on the plate: lying flat on its own, lowest point (the knuckles) at Z = 0
    const pinLidOnPlate =
      pinHinge && ((plateLayout === 'side_by_side' && exportParts === 'both') || exportParts === 'lid_only');
    if (pinLidOnPlate && hinge) {
      lidZBase = hinge.lidHangBelowRim + pinSkirtMm;
    } else if (lidStyle === 'hinged') {
      lidZBase = boxHeightMm + hingeRimGapMm; // closed lid sits on the rim
    } else if (
      (plateLayout === 'side_by_side' && exportParts === 'both') ||
      exportParts === 'lid_only'
    ) {
      // Flat on the plate: the lowest point of the lid sits at Z = 0
      lidZBase =
        lidStyle === 'cap_with_plug'
          ? plugDepthMm
          : lidStyle === 'sliding'
          ? SLIDE_TONGUE_MM
          : lidStyle === 'screw' && screw
          ? screw.skirtHeight
          : 0;
    } else {
      // Assembled view: position lid inside/above the box at seated Z + lidLiftMm
      if (lidStyle === 'flush_recessed' || lidStyle === 'sliding') {
        lidZBase = boxHeightMm - lidTotalThicknessMm + lidLiftMm;
      } else if (lidStyle === 'raised_rim_recessed') {
        lidZBase = boxHeightMm - lidTotalThicknessMm - rimExtraMm + lidLiftMm;
      } else {
        lidZBase = boxHeightMm + lidLiftMm;
      }
    }

    // --------------------------------------------------------------------------
    // PART A: Build the Hollow Box Body from the Stroke Outline (`partGroup: 'box'`)
    // --------------------------------------------------------------------------
    if (exportParts !== 'lid_only') {
      const boxVertices: Vec3[] = [];
      const boxTriangles: [number, number, number][] = [];
      const appendBoxMesh = (mesh: {
        vertices: Vec3[];
        triangles: [number, number, number][];
      }) => {
        const offset = boxVertices.length;
        for (const v of mesh.vertices) boxVertices.push(v);
        for (const [a, b, c] of mesh.triangles) {
          boxTriangles.push([a + offset, b + offset, c + offset]);
        }
      };

      const transformBoxPt = (pt: Point): Point => ({
        x: (pt.x - centerX) * scaleMmPerPx + boxOffsetX,
        y: -(pt.y - centerY) * scaleMmPerPx,
      });

      // 1. Solid Box Floor (0 -> floorThicknessMm)
      appendBoxMesh(
        extrudePolygonsToManifold(
          traceResult.silhouettePolygons,
          transformBoxPt,
          0,
          floorThicknessMm,
          0
        )
      );

      const upperWalls =
        traceResult.boxUpperWallPolygons.length > 0
          ? traceResult.boxUpperWallPolygons
          : traceResult.silhouettePolygons;
      const ledgeWalls =
        traceResult.boxLedgeWallPolygons.length > 0
          ? traceResult.boxLedgeWallPolygons
          : upperWalls;

      if (sliding) {
        // Grooved side/back walls with an open front for the slide-in lid
        appendBoxMesh(sliding.boxWalls);
      } else if (screw) {
        // Revolved wall with a threaded neck on top
        appendBoxMesh(
          mapVertices(screw.boxWalls, (v) => ({ x: v.x + boxOffsetX, y: v.y, z: v.z }))
        );
      } else if (lidStyle === 'hinged') {
        // Plain walls; the lid sits on top of the rim. With gusseted lid knuckles the top band of the
        // wall comes from the hinge, with 45-degree slots the gussets nest into when the lid closes.
        const plainWallTop = lidHasSkirt
          ? splitRimZ
          : hinge?.wallTopMesh
          ? hinge.wallSplitZ
          : boxHeightMm;
        appendBoxMesh(
          extrudePolygonsToManifold(upperWalls, transformBoxPt, floorThicknessMm, plainWallTop, 0, 0, 0)
        );
        if (lipOn) {
          // ring along the wall's inner face reaching lipT into the cavity (outer edge = wall face, or pushed
          // into the wall for overlap below the rim)
          // Built by stitching the two offset rings directly (same vertex count) rather than earcut, which can
          // mis-bridge a hole that sits this close to its outer ring and fill the box opening with a triangle.
          const lipRing = (outerOff: number, inward: number, z0: number, z1: number) => {
            const vertices: Vec3[] = [];
            const triangles: [number, number, number][] = [];
            for (const poly of innerFaceRings()) {
              const face = cleanRing2D(poly.outer.map(transformBoxPt));
              if (face.length < 3) continue;
              if (signedAreaVec2(face) < 0) face.reverse();
              const o = offsetRingVec2(face, outerOff);
              const n = offsetRingVec2(face, -inward);
              const m = face.length;
              const b = vertices.length;
              // indices: outer bottom b+i, outer top b+m+i, inner bottom b+2m+i, inner top b+3m+i
              for (const [ring, z] of [[o, z0], [o, z1], [n, z0], [n, z1]] as const) {
                for (const v of ring) vertices.push({ x: v.x, y: v.y, z });
              }
              for (let i = 0; i < m; i++) {
                const j = (i + 1) % m;
                const ob = b + i, obj = b + j, ot = b + m + i, otj = b + m + j;
                const ib = b + 2 * m + i, ibj = b + 2 * m + j, it = b + 3 * m + i, itj = b + 3 * m + j;
                triangles.push([ob, obj, otj], [ob, otj, ot]); // outer side (faces outward)
                triangles.push([ibj, ib, it], [ibj, it, itj]); // inner side (faces the cavity)
                triangles.push([ot, otj, itj], [ot, itj, it]); // top
                triangles.push([ob, ibj, obj], [ob, ib, ibj]); // bottom
              }
            }
            return { vertices, triangles };
          };
          appendBoxMesh(lipRing(0, lipT, splitRimZ - 0.05, splitRimZ + lipH));
          // 45-degree ledge under the lip so it prints without support (grows out of the wall face)
          {
            const ledgeSteps = 6;
            const z0 = splitRimZ - lipT - 0.05;
            for (let k = 0; k < ledgeSteps; k++) {
              const za = z0 + (lipT * k) / ledgeSteps;
              const zb = z0 + (lipT * (k + 1)) / ledgeSteps;
              appendBoxMesh(lipRing(0.4, (lipT * (k + 1)) / ledgeSteps, za, zb + 0.01));
            }
          }
          if (beadDepth > 0 && hinge) {
            // Bead only on the front and sides: near the hinge the lid wall swings in on an arc rather than
            // dropping straight down, so a bead there would drag instead of clicking (the hinge holds that side).
            const u = hinge.axisDir;
            const A = hinge.axisPoint;
            let nx = -u.y;
            let ny = u.x;
            const cxy = outerRingMm.reduce((acc, p) => ({ x: acc.x + p.x / outerRingMm.length, y: acc.y + p.y / outerRingMm.length }), { x: 0, y: 0 });
            if (nx * (cxy.x - A.x) + ny * (cxy.y - A.y) < 0) {
              nx = -nx;
              ny = -ny;
            }
            const reach = Math.max(...outerRingMm.map((p) => nx * (p.x - A.x) + ny * (p.y - A.y)));
            const keepFrom = nx * (A.x + boxOffsetX) + ny * A.y + Math.max(18, 0.45 * reach);
            const steps = Math.max(4, Math.round(beadH / 0.1));
            for (const poly of innerFaceRings()) {
              const face = cleanRing2D(poly.outer.map(transformBoxPt));
              if (face.length < 3) continue;
              if (signedAreaVec2(face) < 0) face.reverse();
              for (let k = 0; k < steps; k++) {
                const z0 = beadZ0 + (beadH * k) / steps;
                const z1 = beadZ0 + (beadH * (k + 1)) / steps;
                const p = beadAt((z0 + z1) / 2);
                if (p <= 0.01) continue;
                const out = offsetRingVec2(face, p).map((v) => ({ x: v.x, y: v.y }));
                const hole = offsetRingVec2(face, -0.3).map((v) => ({ x: v.x, y: v.y })); // overlaps the lip
                appendBoxMesh(extrudeClippedToHalfPlane(out, [hole], z0, z1, nx, ny, keepFrom));
              }
            }
          }
        }
        if (hinge?.wallTopMesh) {
          appendBoxMesh(
            mapVertices(hinge.wallTopMesh, (v) => ({ x: v.x + boxOffsetX, y: v.y, z: v.z }))
          );
        }
        if (hinge) {
          appendBoxMesh(
            mapVertices(hinge.bodyMesh, (v) => ({ x: v.x + boxOffsetX, y: v.y, z: v.z }))
          );
        }
      } else if (lidStyle === 'flush_recessed' || lidStyle === 'raised_rim_recessed') {
        const ledgeTopZ = Math.max(
          floorThicknessMm + 1.0,
          boxHeightMm - lidTotalThicknessMm - rimExtraMm
        );
        // 2. Lower Hollow Box Wall + Internal Support Ledge (floorThicknessMm -> ledgeTopZ)
        appendBoxMesh(
          extrudePolygonsToManifold(
            ledgeWalls,
            transformBoxPt,
            floorThicknessMm,
            ledgeTopZ,
            0
          )
        );
        // 3. Upper Framed Stroke Rim Collar (ledgeTopZ -> boxHeightMm) with half-tolerance hole clearance
        appendBoxMesh(
          extrudePolygonsToManifold(
            upperWalls,
            transformBoxPt,
            ledgeTopZ,
            boxHeightMm,
            0,
            -toleranceMm * 0.5,
            0
          )
        );
      } else {
        // 'cap_with_plug': Full-height hollow stroke outline wall from floorThicknessMm -> boxHeightMm
        appendBoxMesh(
          extrudePolygonsToManifold(
            upperWalls,
            transformBoxPt,
            floorThicknessMm,
            boxHeightMm,
            0,
            -toleranceMm * 0.5,
            0
          )
        );
      }

      // 4. Internal Divider Walls (Compartment Grid)
      if (params.boxDividersEnabled) {
        const cols = Math.max(1, Math.min(8, Math.round(params.boxDividerCols ?? 1)));
        const rows = Math.max(1, Math.min(8, Math.round(params.boxDividerRows ?? 1)));
        const dividerThickness = Math.max(0.6, Math.min(3.5, params.boxDividerThicknessMm ?? 1.0));
        const heightRatio = Math.max(0.2, Math.min(1.0, params.boxDividerHeightRatio ?? 1.0));

        if (cols > 1 || rows > 1) {
          // Top Z for internal dividers: flush with support ledge or clearance below lid plug
          const dividerMaxZ = Math.max(
            floorThicknessMm + 1.0,
            lidStyle === 'cap_with_plug'
              ? boxHeightMm - plugDepthMm - 0.2
              : lidStyle === 'hinged'
              ? lidHasSkirt
                ? splitRimZ - 0.3
                : hinge?.wallTopMesh
                ? hinge.wallSplitZ - 0.2
                : boxHeightMm - 0.3
              : sliding
              ? sliding.grooveBottomZ - 0.2
              : screw
              ? screw.dividerMaxZ
              : boxHeightMm - lidTotalThicknessMm - rimExtraMm
          );
          const dividerTopZ = floorThicknessMm + (dividerMaxZ - floorThicknessMm) * heightRatio;
          const dividerBottomZ = Math.max(0.2, floorThicknessMm - 0.4);

          // Obtain the true inner wall cavity ring of the box in mm coordinates:
          // upperWalls contains the actual inner face of the outer box walls (lidHoleRing).
          // We always prefer upperWalls so dividers reach all the way to the actual walls!
          let innerHolePts: Point[] = [];
          for (const poly of upperWalls) {
            if (poly.holes && poly.holes.length > 0 && poly.holes[0].length >= 3) {
              innerHolePts = poly.holes[0].map(transformBoxPt);
              break;
            }
          }
          if (innerHolePts.length === 0) {
            for (const poly of ledgeWalls) {
              if (poly.holes && poly.holes.length > 0 && poly.holes[0].length >= 3) {
                innerHolePts = poly.holes[0].map(transformBoxPt);
                break;
              }
            }
          }

          let cavityMinX = Infinity;
          let cavityMaxX = -Infinity;
          let cavityMinY = Infinity;
          let cavityMaxY = -Infinity;

          if (innerHolePts.length >= 3) {
            for (const p of innerHolePts) {
              if (p.x < cavityMinX) cavityMinX = p.x;
              if (p.x > cavityMaxX) cavityMaxX = p.x;
              if (p.y < cavityMinY) cavityMinY = p.y;
              if (p.y > cavityMaxY) cavityMaxY = p.y;
            }
          } else {
            for (const poly of traceResult.silhouettePolygons) {
              for (const p of poly.outer) {
                const tp = transformBoxPt(p);
                if (tp.x < cavityMinX) cavityMinX = tp.x;
                if (tp.x > cavityMaxX) cavityMaxX = tp.x;
                if (tp.y < cavityMinY) cavityMinY = tp.y;
                if (tp.y > cavityMaxY) cavityMaxY = tp.y;
              }
            }
            const wallW = params.strokeWidthMm || 2.5;
            cavityMinX += wallW;
            cavityMaxX -= wallW;
            cavityMinY += wallW;
            cavityMaxY -= wallW;
          }

          const cavitySpanX = cavityMaxX - cavityMinX;
          const cavitySpanY = cavityMaxY - cavityMinY;

          if (cavitySpanX > 4 && cavitySpanY > 4) {
            // Anchor up to ~75% of the wall thickness into the wall for a solid joint, but never past
            // the outside of the box. Each grid line is split into separate pieces wherever it leaves
            // the cavity, so on contour boxes (hearts, animals, lettering...) a divider never crosses
            // a notch or concave dip in the outline and pokes out of the box.
            const wallThickness = Math.max(0.8, params.strokeWidthMm || 2.5);
            const anchorMm = Math.max(1.2, Math.min(2.2, wallThickness * 0.75));
            const half = dividerThickness * 0.5;

            let outerRingPts: Point[] = [];
            for (const poly of upperWalls) {
              if (poly.holes && poly.holes.length > 0 && poly.outer.length >= 3) {
                outerRingPts = poly.outer.map(transformBoxPt);
                break;
              }
            }
            if (outerRingPts.length < 3) outerRingPts = outerRingMm.map((p) => ({ x: p.x + boxOffsetX, y: p.y }));

            // Even-odd "inside" intervals of a ring along a line
            const insideIntervals = (crossings: number[]): [number, number][] => {
              const out: [number, number][] = [];
              for (let i = 0; i + 1 < crossings.length; i += 2) out.push([crossings[i], crossings[i + 1]]);
              return out;
            };
            // Intersect two interval lists
            const intersectIntervals = (a: [number, number][], b: [number, number][]) => {
              const out: [number, number][] = [];
              for (const [a0, a1] of a)
                for (const [b0, b1] of b) {
                  const lo = Math.max(a0, b0);
                  const hi = Math.min(a1, b1);
                  if (hi > lo) out.push([lo, hi]);
                }
              return out;
            };

            /**
             * Pieces of one divider line. `cross(ring, c)` returns sorted crossings of a ring with the line
             * at coordinate c. The divider must be inside the outer outline along both of its faces (c ± half),
             * and gets one piece per stretch where its centre line runs through the cavity.
             */
            const dividerPieces = (
              coord: number,
              cross: (ring: Point[], c: number) => number[]
            ): [number, number][] => {
              if (innerHolePts.length < 3) return [];
              let solid = insideIntervals(cross(outerRingPts, coord));
              for (const c of [coord - half, coord + half]) {
                solid = intersectIntervals(solid, insideIntervals(cross(outerRingPts, c)));
              }
              const pieces: [number, number][] = [];
              for (const [a, b] of insideIntervals(cross(innerHolePts, coord))) {
                if (b - a < 2.0) continue; // sliver of cavity: not worth a wall
                const host = solid.find(([s0, s1]) => s0 <= a + 0.05 && s1 >= b - 0.05);
                if (!host) continue;
                const start = Math.max(a - anchorMm, host[0] + 0.35);
                const end = Math.min(b + anchorMm, host[1] - 0.35);
                if (end - start > 2.0) pieces.push([start, end]);
              }
              return pieces;
            };

            // Vertical Dividers (dividing into 'cols' columns)
            for (let c = 1; c < cols; c++) {
              const xCoord = cavityMinX + dividerFrac(params.boxDividerXFracs, cols, c) * cavitySpanX;
              for (const [y0, y1] of dividerPieces(xCoord, getVerticalIntersections)) {
                appendBoxMesh(
                  createBoxPrismMesh(xCoord - half, xCoord + half, y0, y1, dividerBottomZ, dividerTopZ)
                );
              }
            }

            // Horizontal Dividers (dividing into 'rows' rows)
            for (let r = 1; r < rows; r++) {
              const yCoord = cavityMinY + dividerFrac(params.boxDividerYFracs, rows, r) * cavitySpanY;
              for (const [x0, x1] of dividerPieces(yCoord, getHorizontalIntersections)) {
                appendBoxMesh(
                  createBoxPrismMesh(x0, x1, yCoord - half, yCoord + half, dividerBottomZ, dividerTopZ)
                );
              }
            }
          }
        }
      }

      if (boxVertices.length > 0 && boxTriangles.length > 0) {
        if (boxHeightMm > maxZHeight) maxZHeight = boxHeightMm;
        const strokeHex = (params.strokeColorHex || '#F8FAFC').toUpperCase();
        parts.push({
          slotIndex: 4,
          name: `Hollow_Box_${strokeHex.replace('#', '')}`,
          colorHex: strokeHex,
          partGroup: 'box',
          printInPlaceLinked: lidStyle === 'hinged' && !pinHinge ? true : undefined,
          offsetX: boxOffsetX,
          lidZMin: 0,
          lidZMax: boxHeightMm,
          vertices: boxVertices,
          triangles: boxTriangles,
          zMin: 0,
          zMax: boxHeightMm,
          geometry: createBufferGeometryFromManifold(boxVertices, boxTriangles),
        });
      }
    }

    // --------------------------------------------------------------------------
    // PART B: Build the Traced Image Lid (`partGroup: 'lid'`)
    // --------------------------------------------------------------------------
    if (exportParts !== 'box_only') {
      // For drop-in recessed lids, scale the lid XY slightly around its center by half the clearance
      // (while the box upper rim hole was widened by the other half), preserving 100% shared internal colour seams.
      const lidClearanceScale = isCapLike
        ? 1.0
        : Math.max(
            0.92,
            (approxLidWidthMm - Math.max(toleranceMm, lidStyle === 'sliding' ? 0.25 : 0)) /
              approxLidWidthMm
          );

      const transformLidPt = (pt: Point): Point => {
        const rx = (pt.x - centerX) * scaleMmPerPx * lidClearanceScale;
        const ry = -(pt.y - centerY) * scaleMmPerPx * lidClearanceScale;
        return {
          x: rx + lidOffsetX,
          y: ry,
        };
      };

      const lidBackingPolys = isCapLike
        ? traceResult.silhouettePolygons
        : traceResult.lidSilhouettePolygons.length > 0
        ? traceResult.lidSilhouettePolygons
        : traceResult.silhouettePolygons;

      const lidOverallZMin =
        lidStyle === 'cap_with_plug'
          ? lidZBase - plugDepthMm
          : lidStyle === 'sliding'
          ? lidZBase - SLIDE_TONGUE_MM
          : screw
          ? lidZBase - screw.skirtHeight
          : lidZBase;
      const lidOverallZMax = lidZBase + lidTotalThicknessMm;

      // Structural lid pieces (hinge knuckles, slide tongue, screw skirt, grip tab) are fused into the
      // lid's backing-colour part so the lid stays one solid colour underneath the artwork.
      const lidExtras: RawMesh = emptyMesh();
      const topZ = lidZBase + lidTotalThicknessMm;
      const gripTab = params.boxLidGripTab !== false;
      const addGripTab = (yFront: number) => {
        if (!isFinite(yFront)) return;
        const tabT = Math.min(1.6, lidTotalThicknessMm);
        const halfW = Math.max(5, Math.min(9, outerHalfW * 0.25));
        appendInto(
          lidExtras,
          extrudePoly2D(
            gripTabPts(shapeCx + lidOffsetX, yFront, halfW, 3.5, 1.5),
            [],
            topZ - tabT,
            topZ
          )
        );
      };
      if (lidStyle === 'hinged') {
        if (hinge) {
          // Knuckles were built for the closed lid; move them with a separately placed two-piece lid
          const dzLid = lidZBase - (boxHeightMm + hingeRimGapMm);
          appendInto(
            lidExtras,
            dzLid !== 0 || lidOffsetX !== 0
              ? mapVertices(hinge.lidMeshClosed, (v) => ({ x: v.x + lidOffsetX, y: v.y, z: v.z + dzLid }))
              : hinge.lidMeshClosed
          );
          // Clamshell lid half: its own walls from the rim up to the underside of the art plate
          if (lidHasSkirt) {
            // the lid may be laid beside the box on the plate (two-piece lid): follow it sideways
            const skirtPt = (p: Point): Point => {
              const q = transformPt(p);
              return { x: q.x + lidOffsetX, y: q.y };
            };
            const rimZ = splitRimZ + hingeRimGapMm + dzLid;
            const bZ0 = beadZ0 + dzLid;
            if (!lipOn) {
              appendInto(
                lidExtras,
                extrudePolygonsToManifold(upperWallsForMeasure, skirtPt, rimZ, lidZBase + 0.05, 0, 0, 0)
              );
            } else {
              // inner face pushed out by lipT + clearance over the lip; groove (bead + clearance) at the bead
              const band = (holeWiden: number, z0: number, z1: number) =>
                appendInto(
                  lidExtras,
                  extrudePolygonsToManifold(upperWallsForMeasure, skirtPt, z0, z1, 0, -holeWiden, 0)
                );
              const bandTop = rimZ + lipH + lipC;
              if (beadDepth > 0) {
                band(lipC, rimZ, bZ0);
                const steps = Math.max(4, Math.round(beadH / 0.1));
                for (let k = 0; k < steps; k++) {
                  const z0 = bZ0 + (beadH * k) / steps;
                  const z1 = bZ0 + (beadH * (k + 1)) / steps;
                  // the groove follows the bead's 45-degree profile, widened by the clearance
                  const p = Math.max(beadAt(z0 - dzLid), beadAt(z1 - dzLid));
                  band(lipC + p + (p > 0.01 ? lipC : 0), z0, z1);
                }
                band(lipC, bZ0 + beadH, bandTop);
              } else {
                band(lipC, rimZ, bandTop);
              }
              appendInto(
                lidExtras,
                extrudePolygonsToManifold(upperWallsForMeasure, skirtPt, bandTop - 0.02, lidZBase + 0.05, 0, 0, 0)
              );
            }
          }
          // Tab sits opposite the hinge, which may follow an angled edge on contour boxes
          if (gripTab && hinge.gripTabPts) {
            const tabT = Math.min(1.6, lidTotalThicknessMm);
            appendInto(
              lidExtras,
              extrudePoly2D(
                hinge.gripTabPts.map((p) => ({ x: p.x + lidOffsetX, y: p.y })),
                [],
                topZ - tabT,
                topZ
              )
            );
          }
        }
      } else if (sliding) {
        appendInto(lidExtras, sliding.buildLidExtras(lidZBase, lidOffsetX));
        if (gripTab) addGripTab(sliding.frontY);
      } else if (screw) {
        appendInto(lidExtras, screw.buildLidExtras(lidZBase, lidOffsetX));
      }
      const extrasHostSlot = artworkLayers.some((l) => l.slotIndex === activeArtworkBaseSlot)
        ? activeArtworkBaseSlot
        : artworkLayers[0]?.slotIndex;

      for (const layer of artworkLayers) {
        const lidVertices: Vec3[] = [];
        const lidTriangles: [number, number, number][] = [];
        const appendLidMesh = (mesh: {
          vertices: Vec3[];
          triangles: [number, number, number][];
        }) => {
          const offset = lidVertices.length;
          for (const v of mesh.vertices) lidVertices.push(v);
          for (const [a, b, c] of mesh.triangles) {
            lidTriangles.push([a + offset, b + offset, c + offset]);
          }
        };

        const isLidBackingSlot = layer.slotIndex === activeArtworkBaseSlot;
        let partZMin = lidZBase;
        let partZMax = lidZBase + lidTotalThicknessMm;

        // Include any enclosed interior gap-fill islands (and outer collar for cap_with_plug) in the backing slot
        const strokeAndBaseLayer = traceResult.layers.find((l) => l.isStrokeAndBase);
        const extraFillPolys: TracedPolygon[] = isLidBackingSlot
          ? isCapLike
            ? strokeAndBaseLayer?.polygons && strokeAndBaseLayer.polygons.length > 0
              ? strokeAndBaseLayer.polygons
              : [...traceResult.lidInnerFillPolygons, ...traceResult.boxUpperWallPolygons]
            : traceResult.lidInnerFillPolygons
          : [];
        const combinedLayerPolys =
          extraFillPolys.length > 0
            ? [...layer.polygons, ...extraFillPolys]
            : layer.polygons;

        if (params.extrusionMode === 'full_flush') {
          partZMin = lidZBase;
          partZMax = lidZBase + lidBaseThicknessMm;
          appendLidMesh(
            extrudePolygonsToManifold(
              combinedLayerPolys,
              transformLidPt,
              partZMin,
              partZMax,
              params.seamOverlapMm
            )
          );
        } else if (params.extrusionMode === 'backed_inlay') {
          // Upright Lid: Solid backing plate on bottom, multi-colour inlays on top (+Z) facing user
          const inlayTopZ = lidZBase + lidBaseThicknessMm + lidInlayThicknessMm;
          if (isLidBackingSlot) {
            partZMin = lidStyle === 'cap_with_plug' ? lidZBase - plugDepthMm : lidZBase;
            partZMax = inlayTopZ;
            // Solid lid backing plate
            appendLidMesh(
              extrudePolygonsToManifold(
                lidBackingPolys,
                transformLidPt,
                lidZBase,
                lidZBase + lidBaseThicknessMm,
                0
              )
            );
            // Top colour inlay for the backing slot
            appendLidMesh(
              extrudePolygonsToManifold(
                combinedLayerPolys,
                transformLidPt,
                lidZBase + lidBaseThicknessMm,
                inlayTopZ,
                params.seamOverlapMm
              )
            );
            // If 'cap_with_plug', add downward locking plug lip
            if (
              lidStyle === 'cap_with_plug' &&
              traceResult.boxInnerPlugPolygons.length > 0
            ) {
              appendLidMesh(
                extrudePolygonsToManifold(
                  traceResult.boxInnerPlugPolygons,
                  transformLidPt,
                  lidZBase - plugDepthMm,
                  lidZBase,
                  0,
                  0,
                  -toleranceMm * 0.5
                )
              );
            }
          } else {
            partZMin = lidZBase + lidBaseThicknessMm;
            partZMax = inlayTopZ;
            appendLidMesh(
              extrudePolygonsToManifold(
                combinedLayerPolys,
                transformLidPt,
                partZMin,
                partZMax,
                params.seamOverlapMm
              )
            );
          }
        } else if (params.extrusionMode === 'stepped_relief') {
          const step = lidInlayThicknessMm;
          if (layer.slotIndex === 0) {
            partZMin = lidZBase;
            partZMax = lidZBase + lidBaseThicknessMm;
          } else {
            partZMin = lidZBase + lidBaseThicknessMm + (layer.slotIndex - 1) * step;
            partZMax = partZMin + step;
          }
          appendLidMesh(
            extrudePolygonsToManifold(
              combinedLayerPolys,
              transformLidPt,
              partZMin,
              partZMax,
              params.seamOverlapMm
            )
          );
        }

        let partMesh: RawMesh = { vertices: lidVertices, triangles: lidTriangles };
        if (layer.slotIndex === extrasHostSlot && lidExtras.vertices.length > 0) {
          appendInto(partMesh, lidExtras);
          const eb = meshBounds(lidExtras);
          partZMin = Math.min(partZMin, eb.minZ);
          partZMax = Math.max(partZMax, eb.maxZ);
        }
        let preFlipped = false;
        if (lidStyle === 'hinged' && hinge && partMesh.vertices.length > 0 && !pinLidOnPlate) {
          // Swing the closed lid open about the hinge axis (180 degrees = face-down print layout)
          partMesh = rotateAboutAxis(partMesh, hinge.axisPoint, hinge.axisDir, hingeOpenAngle);
          const rb = meshBounds(partMesh);
          partZMin = rb.minZ;
          partZMax = rb.maxZ;
          // Print-in-place lids are already face-down; a two-piece lid preview is just for show
          preFlipped = !pinHinge;
        }

        if (partMesh.vertices.length > 0 && partMesh.triangles.length > 0) {
          if (partZMax > maxZHeight) maxZHeight = partZMax;
          parts.push({
            slotIndex: layer.slotIndex,
            name: `Lid_Slot_${layer.slotIndex + 1}_${layer.printHex.replace('#', '')}`,
            colorHex: layer.printHex,
            partGroup: 'lid',
            offsetX: lidOffsetX,
            lidZMin: preFlipped ? partZMin : Math.min(lidOverallZMin, partZMin),
            lidZMax: preFlipped ? partZMax : Math.max(lidOverallZMax, partZMax),
            isPreFlippedFaceDown: preFlipped,
            printInPlaceLinked: lidStyle === 'hinged' && !pinHinge ? true : undefined,
            vertices: partMesh.vertices,
            triangles: partMesh.triangles,
            zMin: partZMin,
            zMax: partZMax,
            geometry: createBufferGeometryFromManifold(partMesh.vertices, partMesh.triangles),
          });
        }
      }
    }

    // A lid is exported face-down by flipping every part around the SAME plane. Give all (non pre-flipped)
    // lid parts the lid's overall height range, so hinge knuckles, plugs or skirts carried by the backing
    // colour can't shift the flip plane for the inlay colours (which would leave them floating mid-lid).
    {
      const lidParts = parts.filter((p) => p.partGroup === 'lid' && !p.isPreFlippedFaceDown);
      if (lidParts.length > 0) {
        const zLo = Math.min(...lidParts.map((p) => Math.min(p.zMin, p.lidZMin ?? p.zMin)));
        const zHi = Math.max(...lidParts.map((p) => Math.max(p.zMax, p.lidZMax ?? p.zMax)));
        for (const p of lidParts) {
          p.lidZMin = zLo;
          p.lidZMax = zHi;
        }
      }
    }

    let totalVertices = 0;
    let totalTriangles = 0;
    for (const part of parts) {
      totalVertices += part.vertices.length;
      totalTriangles += part.triangles.length;
    }

    let totalPlateWidth =
      plateLayout === 'side_by_side' && exportParts === 'both'
        ? boxWidthMm + approxLidWidthMm + 8
        : exportParts === 'lid_only'
        ? approxLidWidthMm
        : boxWidthMm;
    let totalPlateDepth = depthMm;

    if (isMechanical && parts.length > 0) {
      // Measure the real footprint (hinge knuckles, grip tabs and the swung-open lid extend past the outline)
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity;
      for (const part of parts) {
        for (const v of part.vertices) {
          if (v.x < x0) x0 = v.x;
          if (v.x > x1) x1 = v.x;
          if (v.y < y0) y0 = v.y;
          if (v.y > y1) y1 = v.y;
        }
      }
      if (isFinite(x0)) {
        totalPlateWidth = x1 - x0;
        totalPlateDepth = y1 - y0;
      }
    }

    return {
      parts,
      dimensionsMm: {
        width: Math.round(totalPlateWidth * 10) / 10,
        depth: Math.round(totalPlateDepth * 10) / 10,
        height: Math.round(maxZHeight * 100) / 100,
      },
      pixelTransform: {
        centerX,
        centerY,
        scaleMmPerPx,
        imageWidth: traceResult.width,
        imageHeight: traceResult.height,
      },
      totalVertices,
      totalTriangles,
      hingePinLengthsMm: pinHinge && hinge ? hinge.pinLengthsMm : undefined,
    };
  }

  // ============================================================================
  // ============================================================================
  // STANDARD PLAQUE / EMBLEM MODE (Built Facing UP for crystal-clear 3D preview)
  // Non-base colors sit flush on the top surface, strictly 0.4mm thick (2 layers @ 0.2mm).
  // When exported with flipFaceDown (default true), exporter flips them face-down onto Z = 0..0.4mm.
  // ============================================================================
  const strokeLayer = traceResult.layers.find((l) => l.isStrokeAndBase && l.enabled);
  const activeBaseSlot = strokeLayer ? strokeLayer.slotIndex : activeArtworkBaseSlot;

  // Sign dimensions:
  // - totalDepth: total sign thickness (e.g. 3.0mm)
  // - inlayDepth: surface inlay thickness (strictly 0.4mm = 2 layers @ 0.2mm)
  // - backingThickness: solid silhouette backing plate under the inlays (e.g. 3.0 - 0.4 = 2.6mm)
  const inlayDepth = Math.max(0.1, params.inlayThicknessMm);
  const totalDepth = Math.max(inlayDepth + 0.2, params.baseThicknessMm);
  const backingThickness = Math.max(0.2, totalDepth - inlayDepth);
  const topSurfaceZ = totalDepth;

  for (const layer of traceResult.layers) {
    if (!layer.enabled || layer.mergedIntoSlot != null) continue;

    const combinedVertices: Vec3[] = [];
    const combinedTriangles: [number, number, number][] = [];

    const appendMesh = (mesh: { vertices: Vec3[]; triangles: [number, number, number][] }) => {
      const offset = combinedVertices.length;
      for (const v of mesh.vertices) combinedVertices.push(v);
      for (const [a, b, c] of mesh.triangles) {
        combinedTriangles.push([a + offset, b + offset, c + offset]);
      }
    };

    let zMin = 0;
    let zMax = topSurfaceZ;

    if (params.strokeEnabled && params.strokeWidthMm > 0) {
      // ------------------------------------------------------------------------
      // STROKE & BASE EMBLEM MODE (Facing UP)
      // ------------------------------------------------------------------------
      if (layer.isStrokeAndBase) {
        zMin = 0;
        // 1. Solid unified silhouette backing plate underneath (0 -> backingThickness)
        const baseSilhouetteMesh = extrudePolygonsToManifold(
          traceResult.silhouettePolygons,
          transformPt,
          0,
          backingThickness,
          0
        );
        appendMesh(baseSilhouetteMesh);

        // 2. Front perimeter collar and inner fill flush with top surface
        if (params.strokeProfileStyle !== 'stepped_base_only') {
          if (
            params.strokeProfileStyle === 'raised_rim_and_base' &&
            traceResult.boxUpperWallPolygons.length > 0
          ) {
            const rimTopZ = topSurfaceZ + 0.6;
            zMax = rimTopZ;
            // Inner margin / gap fill stays flush with the inlay surface
            if (traceResult.lidInnerFillPolygons.length > 0) {
              appendMesh(
                extrudePolygonsToManifold(
                  traceResult.lidInnerFillPolygons,
                  transformPt,
                  backingThickness,
                  topSurfaceZ,
                  params.seamOverlapMm
                )
              );
            }
            // Outer border ring rises above the inlay surface
            appendMesh(
              extrudePolygonsToManifold(
                traceResult.boxUpperWallPolygons,
                transformPt,
                backingThickness,
                rimTopZ,
                params.seamOverlapMm
              )
            );
          } else {
            zMax = topSurfaceZ;
            const strokeCollarMesh = extrudePolygonsToManifold(
              layer.polygons,
              transformPt,
              backingThickness,
              topSurfaceZ,
              params.seamOverlapMm
            );
            appendMesh(strokeCollarMesh);
            if (traceResult.lidInnerFillPolygons.length > 0) {
              appendMesh(
                extrudePolygonsToManifold(
                  traceResult.lidInnerFillPolygons,
                  transformPt,
                  backingThickness,
                  topSurfaceZ,
                  params.seamOverlapMm
                )
              );
            }
          }
        } else {
          zMax = backingThickness;
        }
      } else {
        // Interior artwork color layers sit flush on top of backing plate: strictly 0.4mm thick (backingThickness -> topSurfaceZ)
        zMin = backingThickness;
        zMax = topSurfaceZ;
        const inlayMesh = extrudePolygonsToManifold(
          layer.polygons,
          transformPt,
          backingThickness,
          topSurfaceZ,
          params.seamOverlapMm
        );
        appendMesh(inlayMesh);
      }
    } else if (params.extrusionMode === 'full_flush') {
      // Every active color extrudes full depth from Z = 0 to Z = totalDepth
      zMin = 0;
      zMax = totalDepth;
      const m = extrudePolygonsToManifold(
        layer.polygons,
        transformPt,
        0,
        totalDepth,
        params.seamOverlapMm
      );
      appendMesh(m);
    } else if (params.extrusionMode === 'stepped_relief') {
      // Stepped relief Inkscape stack
      const step = inlayDepth;
      if (layer.slotIndex === activeBaseSlot) {
        zMin = 0;
        zMax = totalDepth;
        appendMesh(
          extrudePolygonsToManifold(
            traceResult.silhouettePolygons,
            transformPt,
            0,
            totalDepth,
            0
          )
        );
      } else {
        zMin = backingThickness;
        zMax = Math.min(totalDepth + 1.2, backingThickness + layer.slotIndex * step);
        appendMesh(
          extrudePolygonsToManifold(
            layer.polygons,
            transformPt,
            zMin,
            zMax,
            params.seamOverlapMm
          )
        );
      }
    } else {
      // ------------------------------------------------------------------------
      // BACKED SILHOUETTE + SURFACE INLAY (Standard Street Sign default, Facing UP)
      // Total height = totalDepth (e.g. 3.0mm)
      // Inlays = strictly inlayDepth (0.4mm thick, exactly 2 layers @ 0.2mm)
      // Backing = backingThickness (e.g. 2.6mm solid silhouette)
      // ------------------------------------------------------------------------
      if (layer.slotIndex === activeBaseSlot) {
        zMin = 0;
        zMax = topSurfaceZ;
        // 1. Solid unified silhouette backing plate behind everything (0 -> backingThickness)
        const baseSilhouetteMesh = extrudePolygonsToManifold(
          traceResult.silhouettePolygons,
          transformPt,
          0,
          backingThickness,
          0
        );
        appendMesh(baseSilhouetteMesh);

        // 2. Front surface tiles of the base color flush with the inlays (backingThickness -> topSurfaceZ)
        const baseTopMesh = extrudePolygonsToManifold(
          layer.polygons,
          transformPt,
          backingThickness,
          topSurfaceZ,
          params.seamOverlapMm
        );
        appendMesh(baseTopMesh);
      } else {
        // Any non-base color: strictly inlayDepth (0.4mm) on the surface (backingThickness -> topSurfaceZ)
        zMin = backingThickness;
        zMax = topSurfaceZ;
        const inlayMesh = extrudePolygonsToManifold(
          layer.polygons,
          transformPt,
          backingThickness,
          topSurfaceZ,
          params.seamOverlapMm
        );
        appendMesh(inlayMesh);
      }
    }

    if (combinedVertices.length > 0 && combinedTriangles.length > 0) {
      if (zMax > maxZHeight) maxZHeight = zMax;
      const geometry = createBufferGeometryFromManifold(combinedVertices, combinedTriangles);

      parts.push({
        slotIndex: layer.slotIndex,
        name: `Slot_${layer.slotIndex + 1}_${layer.printHex.replace('#', '')}`,
        colorHex: layer.printHex,
        partGroup: 'plaque',
        offsetX: 0,
        lidZMin: 0,
        lidZMax: maxZHeight,
        isPreFlippedFaceDown: false,
        vertices: combinedVertices,
        triangles: combinedTriangles,
        zMin,
        zMax,
        geometry,
      });
    }
  }

  let totalVertices = 0;
  let totalTriangles = 0;
  for (const part of parts) {
    totalVertices += part.vertices.length;
    totalTriangles += part.triangles.length;
  }

  return {
    parts,
    dimensionsMm: {
      width: Math.round(params.targetWidthMm * 10) / 10,
      depth: Math.round(depthMm * 10) / 10,
      height: Math.round(maxZHeight * 100) / 100,
    },
    pixelTransform: {
      centerX,
      centerY,
      scaleMmPerPx,
      imageWidth: traceResult.width,
      imageHeight: traceResult.height,
    },
    totalVertices,
    totalTriangles,
  };
}
