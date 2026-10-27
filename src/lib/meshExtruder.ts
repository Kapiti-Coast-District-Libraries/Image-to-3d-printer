import * as THREE from 'three';
import { MultiColorTraceResult, TraceParameters } from './colorQuantizer';
import { Point, TracedPolygon } from './vectorTracer';

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
  const rawArtworkBaseSlot = Math.min(params.numColors - 1, Math.max(0, params.baseSlotIndex));
  const preferredArtworkBaseLayer = traceResult.layers.find(
    (l) => l.slotIndex === rawArtworkBaseSlot
  );
  const resolvedArtworkBaseSlot =
    preferredArtworkBaseLayer?.mergedIntoSlot != null
      ? preferredArtworkBaseLayer.mergedIntoSlot
      : rawArtworkBaseSlot;
  const activeArtworkBaseSlot =
    traceResult.layers.find(
      (l) =>
        l.slotIndex === resolvedArtworkBaseSlot && l.enabled && l.mergedIntoSlot == null
    )?.slotIndex ??
    traceResult.layers.find((l) => !l.isStrokeAndBase && l.enabled && l.mergedIntoSlot == null)
      ?.slotIndex ??
    0;

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

    const lidStyle = params.boxLidStyle || 'cap_with_plug';
    const rimExtraMm = lidStyle === 'raised_rim_recessed' ? 1.2 : 0;
    const minBoxHeightMm = floorThicknessMm + lidTotalThicknessMm + rimExtraMm + 3.0;
    const boxHeightMm = Math.max(minBoxHeightMm, params.boxHeightMm ?? 28.0);
    const toleranceMm = Math.max(0, params.boxLidToleranceMm ?? 0.2);
    const plateLayout = params.boxPlateLayout || 'assembled';
    const exportParts = params.boxExportParts || 'both';
    const lidLiftMm =
      plateLayout === 'assembled' ? Math.max(0, params.boxLidLiftMm ?? 16.0) : 0;

    const strokeWidthMm = Math.max(0.8, params.strokeWidthMm);
    const boxWidthMm = params.targetWidthMm;
    const approxLidWidthMm =
      lidStyle === 'cap_with_plug'
        ? boxWidthMm
        : Math.max(12, boxWidthMm - 2 * strokeWidthMm);

    const plugDepthMm = Math.min(2.2, Math.max(1.2, floorThicknessMm * 0.9));
    let boxOffsetX = 0;
    let lidOffsetX = 0;
    let lidZBase = 0;

    if (plateLayout === 'side_by_side' && exportParts === 'both') {
      const gapMm = 8;
      boxOffsetX = -(approxLidWidthMm + gapMm) * 0.5;
      lidOffsetX = (boxWidthMm + gapMm) * 0.5;
      lidZBase = lidStyle === 'cap_with_plug' ? plugDepthMm : 0;
    } else if (exportParts === 'lid_only') {
      lidZBase = lidStyle === 'cap_with_plug' ? plugDepthMm : 0;
    } else {
      // Assembled view: position lid inside/above the box at seated Z + lidLiftMm
      if (lidStyle === 'flush_recessed') {
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

      if (lidStyle === 'flush_recessed' || lidStyle === 'raised_rim_recessed') {
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
          const dividerMaxZ =
            lidStyle === 'cap_with_plug'
              ? Math.max(floorThicknessMm + 1.0, boxHeightMm - plugDepthMm - 0.2)
              : Math.max(floorThicknessMm + 1.0, boxHeightMm - lidTotalThicknessMm - rimExtraMm);
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
            // Anchor 1.2 to 2.2 mm into the outer wall (approx 75% of wall thickness)
            // guaranteeing 100% full contact and zero gap at all wall junctions
            const wallThickness = Math.max(0.8, params.strokeWidthMm || 2.5);
            const anchorMm = Math.max(1.2, Math.min(2.2, wallThickness * 0.75));

            // Vertical Dividers (dividing into 'cols' columns)
            if (cols > 1) {
              for (let c = 1; c < cols; c++) {
                const xCoord = cavityMinX + (c / cols) * cavitySpanX;
                let yStart = cavityMinY;
                let yEnd = cavityMaxY;

                if (innerHolePts.length >= 3) {
                  const ysCenter = getVerticalIntersections(innerHolePts, xCoord);
                  const ysLeft = getVerticalIntersections(
                    innerHolePts,
                    xCoord - dividerThickness * 0.5
                  );
                  const ysRight = getVerticalIntersections(
                    innerHolePts,
                    xCoord + dividerThickness * 0.5
                  );

                  const startCandidates: number[] = [];
                  const endCandidates: number[] = [];

                  if (ysCenter.length >= 2) {
                    startCandidates.push(ysCenter[0]);
                    endCandidates.push(ysCenter[ysCenter.length - 1]);
                  }
                  if (ysLeft.length >= 2) {
                    startCandidates.push(ysLeft[0]);
                    endCandidates.push(ysLeft[ysLeft.length - 1]);
                  }
                  if (ysRight.length >= 2) {
                    startCandidates.push(ysRight[0]);
                    endCandidates.push(ysRight[ysRight.length - 1]);
                  }

                  if (startCandidates.length > 0) {
                    yStart = Math.min(...startCandidates);
                  }
                  if (endCandidates.length > 0) {
                    yEnd = Math.max(...endCandidates);
                  }
                }

                if (yEnd > yStart) {
                  appendBoxMesh(
                    createBoxPrismMesh(
                      xCoord - dividerThickness * 0.5,
                      xCoord + dividerThickness * 0.5,
                      yStart - anchorMm,
                      yEnd + anchorMm,
                      dividerBottomZ,
                      dividerTopZ
                    )
                  );
                }
              }
            }

            // Horizontal Dividers (dividing into 'rows' rows)
            if (rows > 1) {
              for (let r = 1; r < rows; r++) {
                const yCoord = cavityMinY + (r / rows) * cavitySpanY;
                let xStart = cavityMinX;
                let xEnd = cavityMaxX;

                if (innerHolePts.length >= 3) {
                  const xsCenter = getHorizontalIntersections(innerHolePts, yCoord);
                  const xsBottom = getHorizontalIntersections(
                    innerHolePts,
                    yCoord - dividerThickness * 0.5
                  );
                  const xsTop = getHorizontalIntersections(
                    innerHolePts,
                    yCoord + dividerThickness * 0.5
                  );

                  const startCandidates: number[] = [];
                  const endCandidates: number[] = [];

                  if (xsCenter.length >= 2) {
                    startCandidates.push(xsCenter[0]);
                    endCandidates.push(xsCenter[xsCenter.length - 1]);
                  }
                  if (xsBottom.length >= 2) {
                    startCandidates.push(xsBottom[0]);
                    endCandidates.push(xsBottom[xsBottom.length - 1]);
                  }
                  if (xsTop.length >= 2) {
                    startCandidates.push(xsTop[0]);
                    endCandidates.push(xsTop[xsTop.length - 1]);
                  }

                  if (startCandidates.length > 0) {
                    xStart = Math.min(...startCandidates);
                  }
                  if (endCandidates.length > 0) {
                    xEnd = Math.max(...endCandidates);
                  }
                }

                if (xEnd > xStart) {
                  appendBoxMesh(
                    createBoxPrismMesh(
                      xStart - anchorMm,
                      xEnd + anchorMm,
                      yCoord - dividerThickness * 0.5,
                      yCoord + dividerThickness * 0.5,
                      dividerBottomZ,
                      dividerTopZ
                    )
                  );
                }
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
      const lidClearanceScale =
        lidStyle === 'cap_with_plug'
          ? 1.0
          : Math.max(0.92, (approxLidWidthMm - toleranceMm) / approxLidWidthMm);

      const transformLidPt = (pt: Point): Point => {
        const rx = (pt.x - centerX) * scaleMmPerPx * lidClearanceScale;
        const ry = -(pt.y - centerY) * scaleMmPerPx * lidClearanceScale;
        return {
          x: rx + lidOffsetX,
          y: ry,
        };
      };

      const lidBackingPolys =
        lidStyle === 'cap_with_plug'
          ? traceResult.silhouettePolygons
          : traceResult.lidSilhouettePolygons.length > 0
          ? traceResult.lidSilhouettePolygons
          : traceResult.silhouettePolygons;

      const lidOverallZMin =
        lidStyle === 'cap_with_plug'
          ? lidZBase - plugDepthMm
          : lidZBase;
      const lidOverallZMax = lidZBase + lidTotalThicknessMm;

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
          ? lidStyle === 'cap_with_plug'
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
          const topZ = lidZBase + lidBaseThicknessMm + lidInlayThicknessMm;
          if (isLidBackingSlot) {
            partZMin = lidStyle === 'cap_with_plug' ? lidZBase - plugDepthMm : lidZBase;
            partZMax = topZ;
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
                topZ,
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
            partZMax = topZ;
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

        if (lidVertices.length > 0 && lidTriangles.length > 0) {
          if (partZMax > maxZHeight) maxZHeight = partZMax;
          parts.push({
            slotIndex: layer.slotIndex,
            name: `Lid_Slot_${layer.slotIndex + 1}_${layer.printHex.replace('#', '')}`,
            colorHex: layer.printHex,
            partGroup: 'lid',
            offsetX: lidOffsetX,
            lidZMin: lidOverallZMin,
            lidZMax: lidOverallZMax,
            isPreFlippedFaceDown: false,
            vertices: lidVertices,
            triangles: lidTriangles,
            zMin: partZMin,
            zMax: partZMax,
            geometry: createBufferGeometryFromManifold(lidVertices, lidTriangles),
          });
        }
      }
    }

    let totalVertices = 0;
    let totalTriangles = 0;
    for (const part of parts) {
      totalVertices += part.vertices.length;
      totalTriangles += part.triangles.length;
    }

    const totalPlateWidth =
      plateLayout === 'side_by_side' && exportParts === 'both'
        ? boxWidthMm + approxLidWidthMm + 8
        : exportParts === 'lid_only'
        ? approxLidWidthMm
        : boxWidthMm;

    return {
      parts,
      dimensionsMm: {
        width: Math.round(totalPlateWidth * 10) / 10,
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
