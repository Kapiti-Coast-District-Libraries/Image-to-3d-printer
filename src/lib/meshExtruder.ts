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
    const lidInlayThicknessMm = Math.max(0.4, params.inlayThicknessMm);
    const artworkLayers = traceResult.layers.filter(
      (l) => !l.isStrokeAndBase && l.enabled && l.mergedIntoSlot == null
    );

    const lidTotalThicknessMm =
      params.extrusionMode === 'full_flush'
        ? lidBaseThicknessMm
        : params.extrusionMode === 'stepped_relief'
        ? lidBaseThicknessMm + Math.max(1, artworkLayers.length - 1) * lidInlayThicknessMm
        : lidBaseThicknessMm + lidInlayThicknessMm;

    const lidStyle = params.boxLidStyle || 'flush_recessed';
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

    let boxOffsetX = 0;
    let lidOffsetX = 0;
    let lidZBase = 0;

    if (plateLayout === 'side_by_side' && exportParts === 'both') {
      const gapMm = 8;
      boxOffsetX = -(approxLidWidthMm + gapMm) * 0.5;
      lidOffsetX = (boxWidthMm + gapMm) * 0.5;
      lidZBase = 0;
    } else if (exportParts === 'lid_only') {
      lidZBase = 0;
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

      // In 'cap_with_plug' when laid out on the print plate (Z=0), orient the cap lid face-down so the
      // narrower locking plug sits on top (Z = lidTotalThicknessMm .. lidTotalThicknessMm + plugDepthMm)
      // for 100% support-free printing.
      const isCapOnPrintPlate =
        lidStyle === 'cap_with_plug' &&
        (plateLayout === 'side_by_side' || exportParts === 'lid_only');

      const transformLidPt = (pt: Point): Point => {
        const rx = (pt.x - centerX) * scaleMmPerPx * lidClearanceScale;
        const ry = -(pt.y - centerY) * scaleMmPerPx * lidClearanceScale;
        return {
          x: (isCapOnPrintPlate ? -rx : rx) + lidOffsetX,
          y: ry,
        };
      };

      const plugDepthMm = Math.min(2.2, Math.max(1.2, floorThicknessMm * 0.9));
      const lidBackingPolys =
        lidStyle === 'cap_with_plug'
          ? traceResult.silhouettePolygons
          : traceResult.lidSilhouettePolygons.length > 0
          ? traceResult.lidSilhouettePolygons
          : traceResult.silhouettePolygons;

      const lidOverallZMin =
        lidStyle === 'cap_with_plug' && !isCapOnPrintPlate
          ? lidZBase - plugDepthMm
          : lidZBase;
      const lidOverallZMax =
        lidStyle === 'cap_with_plug' && isCapOnPrintPlate
          ? lidZBase + lidTotalThicknessMm + plugDepthMm
          : lidZBase + lidTotalThicknessMm;

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
        const extraFillPolys: TracedPolygon[] = isLidBackingSlot
          ? lidStyle === 'cap_with_plug'
            ? [...traceResult.lidInnerFillPolygons, ...traceResult.boxUpperWallPolygons]
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
          if (isCapOnPrintPlate) {
            // Face-down Cap Lid on print plate:
            // Inlays at Z = 0 .. lidInlayThicknessMm, Backing at lidInlayThicknessMm .. lidTotalThicknessMm, Plug on top
            if (isLidBackingSlot) {
              partZMin = lidZBase;
              partZMax = lidZBase + lidTotalThicknessMm + plugDepthMm;
              appendLidMesh(
                extrudePolygonsToManifold(
                  combinedLayerPolys,
                  transformLidPt,
                  lidZBase,
                  lidZBase + lidInlayThicknessMm,
                  params.seamOverlapMm
                )
              );
              appendLidMesh(
                extrudePolygonsToManifold(
                  lidBackingPolys,
                  transformLidPt,
                  lidZBase + lidInlayThicknessMm,
                  lidZBase + lidTotalThicknessMm,
                  0
                )
              );
              if (traceResult.boxInnerPlugPolygons.length > 0) {
                appendLidMesh(
                  extrudePolygonsToManifold(
                    traceResult.boxInnerPlugPolygons,
                    transformLidPt,
                    lidZBase + lidTotalThicknessMm,
                    lidZBase + lidTotalThicknessMm + plugDepthMm,
                    0,
                    0,
                    -toleranceMm * 0.5
                  )
                );
              }
            } else {
              partZMin = lidZBase;
              partZMax = lidZBase + lidInlayThicknessMm;
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
          } else {
            // Upright Lid (either drop-in recessed lid or assembled cap lid)
            const topZ = lidZBase + lidBaseThicknessMm + lidInlayThicknessMm;
            if (isLidBackingSlot) {
              partZMin = lidZBase;
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
              // If 'cap_with_plug' in assembled preview mode, add downward locking plug lip
              if (
                lidStyle === 'cap_with_plug' &&
                traceResult.boxInnerPlugPolygons.length > 0
              ) {
                partZMin = lidZBase - plugDepthMm;
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
            isPreFlippedFaceDown: isCapOnPrintPlate,
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
  // STANDARD PLAQUE / EMBLEM MODE
  // ============================================================================
  const strokeLayer = traceResult.layers.find((l) => l.isStrokeAndBase && l.enabled);
  const activeBaseSlot = strokeLayer ? strokeLayer.slotIndex : activeArtworkBaseSlot;

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
    let zMax = params.baseThicknessMm;

    // When Logo Stroke & Base is enabled, the stroke layer always forms the full underlying base (0 -> baseThicknessMm)
    // AND wraps around the logo perimeter up to the top surface (or raised rim).
    if (params.strokeEnabled && params.strokeWidthMm > 0) {
      const topZ = params.baseThicknessMm + params.inlayThicknessMm;
      if (layer.isStrokeAndBase) {
        zMin = 0;
        // 1. Solid unified base underneath the entire design (logo + stroke)
        const baseSilhouetteMesh = extrudePolygonsToManifold(
          traceResult.silhouettePolygons,
          transformPt,
          0,
          params.baseThicknessMm,
          0
        );
        appendMesh(baseSilhouetteMesh);

        // 2. Outer Stroke Outline rising around the logo perimeter
        if (params.strokeProfileStyle !== 'stepped_base_only') {
          const strokeTopZ =
            params.strokeProfileStyle === 'raised_rim_and_base' ? topZ + 0.6 : topZ;
          zMax = strokeTopZ;
          const strokeCollarMesh = extrudePolygonsToManifold(
            layer.polygons,
            transformPt,
            params.baseThicknessMm,
            strokeTopZ,
            params.seamOverlapMm
          );
          appendMesh(strokeCollarMesh);
        } else {
          zMax = params.baseThicknessMm;
        }
      } else {
        // Interior logo colour layers sit on top of the stroke base (baseThicknessMm -> topZ)
        zMin = params.baseThicknessMm;
        zMax = topZ;
        const inlayMesh = extrudePolygonsToManifold(
          layer.polygons,
          transformPt,
          params.baseThicknessMm,
          topZ,
          params.seamOverlapMm
        );
        appendMesh(inlayMesh);
      }
    } else if (params.extrusionMode === 'full_flush') {
      // Every colour is extruded full height from Z = 0 to Z = baseThicknessMm
      zMin = 0;
      zMax = params.baseThicknessMm;
      const m = extrudePolygonsToManifold(
        layer.polygons,
        transformPt,
        zMin,
        zMax,
        params.seamOverlapMm
      );
      appendMesh(m);
    } else if (params.extrusionMode === 'backed_inlay') {
      // The designated Base Slot forms the unified silhouette backing (0 -> baseThicknessMm)
      // plus its own top colour layer (baseThicknessMm -> baseThicknessMm + inlayThicknessMm)
      const topZ = params.baseThicknessMm + params.inlayThicknessMm;
      if (layer.slotIndex === activeBaseSlot) {
        zMin = 0;
        zMax = topZ;
        const baseSilhouetteMesh = extrudePolygonsToManifold(
          traceResult.silhouettePolygons,
          transformPt,
          0,
          params.baseThicknessMm,
          0
        );
        appendMesh(baseSilhouetteMesh);

        const topLayerMesh = extrudePolygonsToManifold(
          layer.polygons,
          transformPt,
          params.baseThicknessMm,
          topZ,
          params.seamOverlapMm
        );
        appendMesh(topLayerMesh);
      } else {
        zMin = params.baseThicknessMm;
        zMax = topZ;
        const inlayMesh = extrudePolygonsToManifold(
          layer.polygons,
          transformPt,
          params.baseThicknessMm,
          topZ,
          params.seamOverlapMm
        );
        appendMesh(inlayMesh);
      }
    } else if (params.extrusionMode === 'stepped_relief') {
      // Cumulative Inkscape stack where each colour steps up by inlayThicknessMm
      const step = params.inlayThicknessMm;
      if (layer.slotIndex === 0) {
        zMin = 0;
        zMax = params.baseThicknessMm;
      } else {
        zMin = params.baseThicknessMm + (layer.slotIndex - 1) * step;
        zMax = zMin + step;
      }
      const stepMesh = extrudePolygonsToManifold(
        layer.polygons,
        transformPt,
        zMin,
        zMax,
        params.seamOverlapMm
      );
      appendMesh(stepMesh);
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
