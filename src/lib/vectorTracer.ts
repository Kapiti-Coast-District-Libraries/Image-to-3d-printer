export interface Point {
  x: number;
  y: number;
}

interface Segment {
  p1: Point;
  p2: Point;
}

export interface TracedPolygon {
  outer: Point[];
  holes: Point[][];
  area: number;
}

/**
 * Linear interpolation offset along a Marching Squares cell edge.
 * Clamped away from 0 and 1 to guarantee topological manifold separation.
 */
function getLerpOffset(valA: number, valB: number, t: number): number {
  if (Math.abs(valA - valB) < 0.001) return 0.5;
  const fraction = (t - valA) / (valB - valA);
  return Math.max(0.01, Math.min(0.99, fraction));
}

/**
 * Subdivision algorithm (Chaikin's corner cutting) for smooth quadratic B-spline curves.
 * For open arcs between triple-junctions, endpoints remain strictly pinned so adjacent
 * colour regions stay 100% locked together without gaps.
 */
export function chaikinSubdivide(path: Point[], iterations: number = 2): Point[] {
  if (path.length <= 2 || iterations <= 0) return path;

  let current = [...path];
  const isClosed =
    current.length > 3 &&
    Math.abs(current[0].x - current[current.length - 1].x) < 1e-4 &&
    Math.abs(current[0].y - current[current.length - 1].y) < 1e-4;

  for (let iter = 0; iter < iterations; iter++) {
    const next: Point[] = [];
    const len = current.length;

    if (isClosed) {
      const cycleLen = len - 1;
      if (cycleLen < 3) return current;
      for (let i = 0; i < cycleLen; i++) {
        const pA = current[i];
        const pB = current[(i + 1) % cycleLen];

        next.push({
          x: 0.75 * pA.x + 0.25 * pB.x,
          y: 0.75 * pA.y + 0.25 * pB.y,
        });
        next.push({
          x: 0.25 * pA.x + 0.75 * pB.x,
          y: 0.25 * pA.y + 0.75 * pB.y,
        });
      }
      if (next.length > 0) {
        next.push({ ...next[0] });
      }
    } else {
      // Open path: keep start and end junction vertices strictly fixed
      next.push({ ...current[0] });
      for (let i = 0; i < len - 1; i++) {
        const pA = current[i];
        const pB = current[i + 1];

        const q = {
          x: 0.75 * pA.x + 0.25 * pB.x,
          y: 0.75 * pA.y + 0.25 * pB.y,
        };
        const r = {
          x: 0.25 * pA.x + 0.75 * pB.x,
          y: 0.25 * pA.y + 0.75 * pB.y,
        };

        if (i === 0 && len === 2) {
          next.push(q, r);
        } else if (i === 0) {
          next.push(r);
        } else if (i === len - 2) {
          next.push(q);
        } else {
          next.push(q);
          next.push(r);
        }
      }
      next.push({ ...current[len - 1] });
    }
    current = next;
  }
  return current;
}

/**
 * Smooths a 2D path's coordinates using a binomial low-pass filter (1-2-1 kernel).
 * Supports wrapping for closed loops and pinned endpoints for open shared arcs.
 */
export function smoothPathCoordinates(path: Point[], iterations: number = 3): Point[] {
  if (path.length <= 2 || iterations <= 0) return path;

  const isClosed =
    path.length > 3 &&
    Math.abs(path[0].x - path[path.length - 1].x) < 1e-4 &&
    Math.abs(path[0].y - path[path.length - 1].y) < 1e-4;
  let current = [...path];

  for (let iter = 0; iter < iterations; iter++) {
    const next: Point[] = [];
    const len = current.length;

    for (let i = 0; i < len; i++) {
      if (isClosed) {
        const nCycle = len - 1;
        if (nCycle < 3) return current;
        const idx = i === len - 1 ? 0 : i;

        const prevIdx = (idx - 1 + nCycle) % nCycle;
        const nextIdx = (idx + 1) % nCycle;

        const prevPt = current[prevIdx];
        const currPt = current[idx];
        const nextPt = current[nextIdx];

        next.push({
          x: 0.25 * prevPt.x + 0.5 * currPt.x + 0.25 * nextPt.x,
          y: 0.25 * prevPt.y + 0.5 * currPt.y + 0.25 * nextPt.y,
        });
      } else {
        if (i === 0 || i === len - 1) {
          next.push({ ...current[i] });
        } else {
          const prevPt = current[i - 1];
          const currPt = current[i];
          const nextPt = current[i + 1];

          next.push({
            x: 0.25 * prevPt.x + 0.5 * currPt.x + 0.25 * nextPt.x,
            y: 0.25 * prevPt.y + 0.5 * currPt.y + 0.25 * nextPt.y,
          });
        }
      }
    }

    if (isClosed && next.length > 0) {
      next[next.length - 1] = { ...next[0] };
    }
    current = next;
  }

  return current;
}

/**
 * Simplifies a 2D path of points using the Ramer-Douglas-Peucker algorithm.
 */
export function ramerDouglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2 || epsilon <= 0) return points;

  const isClosed =
    points.length > 3 &&
    Math.abs(points[0].x - points[points.length - 1].x) < 1e-4 &&
    Math.abs(points[0].y - points[points.length - 1].y) < 1e-4;

  if (isClosed && points.length > 4) {
    let maxDist = -1;
    let splitIdx = Math.floor(points.length / 2);
    for (let i = 1; i < points.length - 1; i++) {
      const d = (points[i].x - points[0].x) ** 2 + (points[i].y - points[0].y) ** 2;
      if (d > maxDist) {
        maxDist = d;
        splitIdx = i;
      }
    }
    const part1 = rdpOpen(points.slice(0, splitIdx + 1), epsilon);
    const part2 = rdpOpen(points.slice(splitIdx), epsilon);
    const combined = part1.slice(0, part1.length - 1).concat(part2);
    if (combined.length >= 4) {
      combined[combined.length - 1] = { ...combined[0] };
      return combined;
    }
    return points;
  }

  return rdpOpen(points, epsilon);
}

function rdpOpen(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const results1 = rdpOpen(points.slice(0, index + 1), epsilon);
    const results2 = rdpOpen(points.slice(index), epsilon);
    return results1.slice(0, results1.length - 1).concat(results2);
  } else {
    return [points[0], points[end]];
  }
}

function perpendicularDistance(p: Point, p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (dx === 0 && dy === 0) {
    return Math.sqrt((p.x - p1.x) ** 2 + (p.y - p1.y) ** 2);
  }
  const num = Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x);
  const den = Math.sqrt(dx * dx + dy * dy);
  return num / den;
}

/**
 * Compute signed area of a closed 2D polygon using the Shoelace formula.
 */
export function computeSignedArea(path: Point[]): number {
  if (path.length < 3) return 0;
  let area = 0;
  const isClosed =
    Math.abs(path[0].x - path[path.length - 1].x) < 1e-4 &&
    Math.abs(path[0].y - path[path.length - 1].y) < 1e-4;
  const n = isClosed ? path.length - 1 : path.length;
  for (let i = 0; i < n; i++) {
    const p1 = path[i];
    const p2 = path[(i + 1) % n];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return area * 0.5;
}

/**
 * Ray-casting Point-in-Polygon check.
 */
export function isPointInPolygon(pt: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Organizes a list of closed 2D loops into an Even-Odd Polygon-with-Holes hierarchy.
 */
export function buildPolygonHierarchy(closedLoops: Point[][], minAreaPx: number = 1.5): TracedPolygon[] {
  interface LoopMeta {
    id: number;
    points: Point[];
    signedArea: number;
    absArea: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    testPt: Point;
  }

  const metas: LoopMeta[] = [];

  for (let idx = 0; idx < closedLoops.length; idx++) {
    const pts = closedLoops[idx];
    if (pts.length < 4) continue;
    const sArea = computeSignedArea(pts);
    const absArea = Math.abs(sArea);
    if (absArea < minAreaPx) continue;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const pt of pts) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }

    // Pick a vertex that is not on the bounding box corner or average two consecutive vertices nudged inward
    const p0 = pts[0];
    const p1 = pts[1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    // Normal pointing into the interior of the loop
    const sign = sArea > 0 ? 1 : -1;
    const testPt = {
      x: (p0.x + p1.x) * 0.5 + (-dy / len) * 0.05 * sign,
      y: (p0.y + p1.y) * 0.5 + (dx / len) * 0.05 * sign,
    };

    metas.push({
      id: idx,
      points: pts,
      signedArea: sArea,
      absArea,
      bbox: { minX, minY, maxX, maxY },
      testPt,
    });
  }

  // Separate Outer Contours (signedArea > 0 in screen coords) and Holes (signedArea < 0)
  const outers = metas
    .filter((m) => m.signedArea > 0)
    .sort((a, b) => a.absArea - b.absArea); // Smallest outer first so holes bind to immediate enclosing outer
  const holes = metas.filter((m) => m.signedArea < 0);

  const polygonMap = new Map<number, TracedPolygon>();
  for (const o of outers) {
    polygonMap.set(o.id, {
      outer: o.points,
      holes: [],
      area: o.absArea,
    });
  }

  for (const h of holes) {
    // Find the smallest Outer Contour that contains this hole
    for (const candidate of outers) {
      if (candidate.absArea <= h.absArea) continue;
      if (
        h.testPt.x >= candidate.bbox.minX &&
        h.testPt.x <= candidate.bbox.maxX &&
        h.testPt.y >= candidate.bbox.minY &&
        h.testPt.y <= candidate.bbox.maxY
      ) {
        if (isPointInPolygon(h.testPt, candidate.points)) {
          polygonMap.get(candidate.id)!.holes.push(h.points);
          break;
        }
      }
    }
  }

  // Return sorted largest outer first
  return Array.from(polygonMap.values()).sort((a, b) => b.area - a.area);
}

/**
 * ZERO-GAP SHARED-BOUNDARY PLANAR PARTITION TRACER:
 * Traces all active colour regions simultaneously from the 2D label grid by decomposing
 * the inter-colour boundaries into pinned Triple-Junction Nodes and Shared Boundary Chains.
 *
 * Every shared boundary chain between Colour A and Colour B is smoothed ONCE (via RDP + Chaikin + Binomial)
 * and reused in exact reverse vertex order by the adjacent colour.
 * This mathematically guarantees 0.0000mm gap between adjacent colours on both top and bottom faces!
 */
export function subtractInnerPolygons(
  outerPolys: TracedPolygon[],
  innerHolePolys: TracedPolygon[]
): TracedPolygon[] {
  if (innerHolePolys.length === 0) {
    return outerPolys.map((p) => ({
      outer: p.outer,
      holes: [...p.holes],
      area: p.area,
    }));
  }

  return outerPolys.map((oPoly) => {
    const extraHoles: Point[][] = [];
    for (const hPoly of innerHolePolys) {
      if (hPoly.outer.length >= 3 && isPointInPolygon(hPoly.outer[0], oPoly.outer)) {
        extraHoles.push(hPoly.outer);
      }
    }
    return {
      outer: oPoly.outer,
      holes: [...oPoly.holes, ...extraHoles],
      area: oPoly.area,
    };
  });
}

export function tracePlanarColorPartition(
  labels: Int8Array,
  width: number,
  height: number,
  numColors: number,
  options: {
    smoothEpsilon: number;
    cornerSimplify: number;
    fieldBlurPasses: number;
    minIslandPx: number;
    strokeSlotIdx?: number;
    innerDeepCavityMask?: Uint8Array;
  }
): {
  layerPolygons: TracedPolygon[][];
  silhouettePolygons: TracedPolygon[];
  lidSilhouettePolygons: TracedPolygon[];
  boxUpperWallPolygons: TracedPolygon[];
  boxLedgeWallPolygons: TracedPolygon[];
  boxInnerPlugPolygons: TracedPolygon[];
  combinedStrokePolygons: TracedPolygon[];
} {
  const {
    smoothEpsilon = 1.15,
    cornerSimplify = 0.32,
    fieldBlurPasses = 1,
  } = options;

  const W1 = width + 1;
  const H1 = height + 1;
  const numGridVerts = W1 * H1;

  const getLabel = (x: number, y: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) return -1;
    return labels[y * width + x];
  };

  // 1. Build undirected boundary adjacency graph on the (W+1)x(H+1) pixel corner grid
  const adj: number[][] = Array.from({ length: numGridVerts }, () => []);
  const addUndirectedEdge = (u: number, v: number) => {
    adj[u].push(v);
    adj[v].push(u);
  };

  // Horizontal grid segments: (x, y) <-> (x + 1, y)
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x < width; x++) {
      const topL = getLabel(x, y - 1);
      const botL = getLabel(x, y);
      if (topL !== botL) {
        const u = y * W1 + x;
        const v = y * W1 + (x + 1);
        addUndirectedEdge(u, v);
      }
    }
  }

  // Vertical grid segments: (x, y) <-> (x, y + 1)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x <= width; x++) {
      const leftL = getLabel(x - 1, y);
      const rightL = getLabel(x, y);
      if (leftL !== rightL) {
        const u = y * W1 + x;
        const v = (y + 1) * W1 + x;
        addUndirectedEdge(u, v);
      }
    }
  }

  // 2. Mark Junction Vertices (where 3 or 4 boundary segments meet)
  const isJunction = new Uint8Array(numGridVerts);
  for (let vid = 0; vid < numGridVerts; vid++) {
    if (adj[vid].length > 0 && adj[vid].length !== 2) {
      isJunction[vid] = 1;
    }
  }

  // 3. Relax Planar Graph Vertex Coordinates globally so all shared edges and junctions
  // sit at smooth sub-pixel positions before chain curve subdivision.
  const posX = new Float32Array(numGridVerts);
  const posY = new Float32Array(numGridVerts);
  for (let vy = 0; vy <= height; vy++) {
    for (let vx = 0; vx <= width; vx++) {
      const vid = vy * W1 + vx;
      posX[vid] = vx;
      posY[vid] = vy;
    }
  }

  const relaxPasses = Math.max(1, fieldBlurPasses * 2);
  const nextX = new Float32Array(posX);
  const nextY = new Float32Array(posY);

  for (let p = 0; p < relaxPasses; p++) {
    for (let vid = 0; vid < numGridVerts; vid++) {
      const neighbors = adj[vid];
      const deg = neighbors.length;
      if (deg === 0) continue;

      let sumX = 0;
      let sumY = 0;
      for (let i = 0; i < deg; i++) {
        const nVid = neighbors[i];
        sumX += posX[nVid];
        sumY += posY[nVid];
      }
      const avgX = sumX / deg;
      const avgY = sumY / deg;

      // Junction vertices relax gently (0.35 weight) so they don't drift far, while degree-2 vertices relax by 0.5
      const alpha = isJunction[vid] ? 0.35 : 0.5;
      nextX[vid] = (1 - alpha) * posX[vid] + alpha * avgX;
      nextY[vid] = (1 - alpha) * posY[vid] + alpha * avgY;
    }
    posX.set(nextX);
    posY.set(nextY);
  }

  // 4. Shared Canonical Arc & Closed-Loop Smoothing Caches
  const openArcCache = new Map<string, Point[]>();
  const closedLoopCache = new Map<string, Point[]>();

  const smoothOpenChainOnce = (chainPts: Point[]): Point[] => {
    if (chainPts.length <= 2 || smoothEpsilon <= 0) return chainPts;
    let p = ramerDouglasPeucker(chainPts, Math.max(0.12, cornerSimplify));
    const chaikinIters = Math.min(3, Math.max(1, Math.round(smoothEpsilon * 1.4)));
    p = chaikinSubdivide(p, chaikinIters);
    const binomialIters = Math.min(4, Math.max(1, Math.round(smoothEpsilon * 1.5)));
    p = smoothPathCoordinates(p, binomialIters);
    p = ramerDouglasPeucker(p, Math.max(0.06, smoothEpsilon * 0.1));
    // Guarantee exact start/end junction preservation
    p[0] = { ...chainPts[0] };
    p[p.length - 1] = { ...chainPts[chainPts.length - 1] };
    return p;
  };

  const smoothClosedLoopOnce = (loopPts: Point[]): Point[] => {
    if (loopPts.length <= 3 || smoothEpsilon <= 0) return loopPts;
    let p = ramerDouglasPeucker(loopPts, Math.max(0.12, cornerSimplify));
    const chaikinIters = Math.min(3, Math.max(1, Math.round(smoothEpsilon * 1.4)));
    p = chaikinSubdivide(p, chaikinIters);
    const binomialIters = Math.min(4, Math.max(1, Math.round(smoothEpsilon * 1.5)));
    p = smoothPathCoordinates(p, binomialIters);
    p = ramerDouglasPeucker(p, Math.max(0.06, smoothEpsilon * 0.1));
    if (p.length > 2) {
      p[p.length - 1] = { ...p[0] };
    }
    return p;
  };

  const getSmoothedSharedArc = (arcVids: number[]): Point[] => {
    const n = arcVids.length;
    if (n === 0) return [];
    if (n === 1) return [{ x: posX[arcVids[0]], y: posY[arcVids[0]] }];

    // Compare forward vs reverse vertex ID sequence to pick canonical orientation
    let isForwardCanonical = true;
    for (let i = 0; i < n; i++) {
      const a = arcVids[i];
      const b = arcVids[n - 1 - i];
      if (a !== b) {
        isForwardCanonical = a < b;
        break;
      }
    }

    const canonVids = isForwardCanonical ? arcVids : [...arcVids].reverse();
    const key = canonVids.join(',');

    let smoothedCanon = openArcCache.get(key);
    if (!smoothedCanon) {
      const rawPts: Point[] = canonVids.map((vid) => ({
        x: posX[vid],
        y: posY[vid],
      }));
      smoothedCanon = smoothOpenChainOnce(rawPts);
      openArcCache.set(key, smoothedCanon);
    }

    return isForwardCanonical ? smoothedCanon : [...smoothedCanon].reverse();
  };

  const getSmoothedSharedClosedLoop = (loopVids: number[]): Point[] => {
    const m = loopVids.length;
    if (m < 3) return [];

    // 1. Find index of minimum vertex ID to normalize cyclic starting point
    let minIdx = 0;
    for (let i = 1; i < m; i++) {
      if (loopVids[i] < loopVids[minIdx]) {
        minIdx = i;
      }
    }

    const rotatedFwd: number[] = new Array(m);
    for (let i = 0; i < m; i++) {
      rotatedFwd[i] = loopVids[(minIdx + i) % m];
    }

    const rotatedRev: number[] = new Array(m);
    rotatedRev[0] = rotatedFwd[0];
    for (let i = 1; i < m; i++) {
      rotatedRev[i] = rotatedFwd[m - i];
    }

    // Pick canonical orientation by comparing second vertex ID
    const isForwardCanonical = rotatedFwd[1] < rotatedRev[1];
    const canonVids = isForwardCanonical ? rotatedFwd : rotatedRev;
    const key = canonVids.join(',');

    let smoothedCanon = closedLoopCache.get(key);
    if (!smoothedCanon) {
      const closedRawPts: Point[] = canonVids.map((vid) => ({
        x: posX[vid],
        y: posY[vid],
      }));
      closedRawPts.push({ ...closedRawPts[0] });
      smoothedCanon = smoothClosedLoopOnce(closedRawPts);
      closedLoopCache.set(key, smoothedCanon);
    }

    return isForwardCanonical ? smoothedCanon : [...smoothedCanon].reverse();
  };

  // 5. Helper to extract and smooth all closed boundary loops for any predicate `isInside(x, y)`
  interface DirectedEdge {
    u: number;
    v: number;
    dir: number; // 0: E, 1: S, 2: W, 3: N
    visited: boolean;
  }

  const tracePredicateLoops = (isInside: (x: number, y: number) => boolean): TracedPolygon[] => {
    const edgesByStart = new Map<number, DirectedEdge[]>();
    const allEdges: DirectedEdge[] = [];

    const addEdge = (u: number, v: number, dir: number) => {
      const edge: DirectedEdge = { u, v, dir, visited: false };
      allEdges.push(edge);
      const list = edgesByStart.get(u);
      if (list) list.push(edge);
      else edgesByStart.set(u, [edge]);
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isInside(x, y)) continue;

        const tl = y * W1 + x;
        const tr = y * W1 + (x + 1);
        const br = (y + 1) * W1 + (x + 1);
        const bl = (y + 1) * W1 + x;

        if (!isInside(x, y - 1)) addEdge(tl, tr, 0); // Top edge (East)
        if (!isInside(x + 1, y)) addEdge(tr, br, 1); // Right edge (South)
        if (!isInside(x, y + 1)) addEdge(br, bl, 2); // Bottom edge (West)
        if (!isInside(x - 1, y)) addEdge(bl, tl, 3); // Left edge (North)
      }
    }

    const smoothedClosedLoops: Point[][] = [];

    for (const startEdge of allEdges) {
      if (startEdge.visited) continue;

      const loopVids: number[] = [];
      let curr: DirectedEdge | undefined = startEdge;

      while (curr && !curr.visited) {
        curr.visited = true;
        loopVids.push(curr.u);

        const candidates = edgesByStart.get(curr.v);
        if (!candidates || candidates.length === 0) break;

        if (candidates.length === 1) {
          curr = candidates[0].visited ? undefined : candidates[0];
        } else {
          // At a diagonal saddle vertex, turn right ((dir + 1) % 4) to stay around the interior pixel
          const preferredDir = (curr.dir + 1) % 4;
          let chosen: DirectedEdge | undefined = candidates.find(
            (c) => !c.visited && c.dir === preferredDir
          );
          if (!chosen) {
            chosen = candidates.find((c) => !c.visited);
          }
          curr = chosen;
        }
      }

      if (loopVids.length < 3) continue;

      // Find all Junction Vertex positions along this loop
      const junctionPositions: number[] = [];
      for (let i = 0; i < loopVids.length; i++) {
        if (isJunction[loopVids[i]]) {
          junctionPositions.push(i);
        }
      }

      let finalLoopPts: Point[] = [];

      if (junctionPositions.length === 0) {
        finalLoopPts = getSmoothedSharedClosedLoop(loopVids);
      } else {
        const k = junctionPositions.length;
        const m = loopVids.length;
        for (let s = 0; s < k; s++) {
          const startIdx = junctionPositions[s];
          const endIdx = junctionPositions[(s + 1) % k];

          const arcVids: number[] = [];
          let idx = startIdx;
          while (true) {
            arcVids.push(loopVids[idx]);
            if (idx === endIdx && arcVids.length > 1) break;
            idx = (idx + 1) % m;
          }

          const smoothedArc = getSmoothedSharedArc(arcVids);
          for (let pIdx = 0; pIdx < smoothedArc.length - 1; pIdx++) {
            finalLoopPts.push(smoothedArc[pIdx]);
          }
        }
        if (finalLoopPts.length > 0) {
          finalLoopPts.push({ ...finalLoopPts[0] });
        }
      }

      if (finalLoopPts.length >= 4) {
        smoothedClosedLoops.push(finalLoopPts);
      }
    }

    return buildPolygonHierarchy(smoothedClosedLoops, 1.5);
  };

  // 6. Trace each colour slot using the shared canonical arc cache
  const layerPolygons: TracedPolygon[][] = [];
  for (let c = 0; c < numColors; c++) {
    const polys = tracePredicateLoops((x, y) => getLabel(x, y) === c);
    layerPolygons.push(polys);
  }

  // 7. Trace the unified foreground silhouette using the exact same vertex positions & shared arcs
  const silhouettePolygons = tracePredicateLoops((x, y) => getLabel(x, y) >= 0);

  let lidSilhouettePolygons: TracedPolygon[] = silhouettePolygons;
  let boxUpperWallPolygons: TracedPolygon[] = [];
  let boxLedgeWallPolygons: TracedPolygon[] = [];
  let boxInnerPlugPolygons: TracedPolygon[] = [];
  let combinedStrokePolygons: TracedPolygon[] = [];

  if (options.strokeSlotIdx !== undefined && options.strokeSlotIdx >= 0) {
    const strokeIdx = options.strokeSlotIdx;
    const lidFillIdx = strokeIdx + 1;

    lidSilhouettePolygons = tracePredicateLoops((x, y) => {
      const l = getLabel(x, y);
      return l >= 0 && l !== strokeIdx;
    });

    combinedStrokePolygons = tracePredicateLoops((x, y) => {
      const l = getLabel(x, y);
      return l === strokeIdx || l === lidFillIdx;
    });

    boxUpperWallPolygons = subtractInnerPolygons(silhouettePolygons, lidSilhouettePolygons);

    if (options.innerDeepCavityMask) {
      const deepCavityPolygons = traceBinaryMaskToPolygons(
        options.innerDeepCavityMask,
        width,
        height,
        {
          smoothEpsilon,
          cornerSimplify,
          fieldBlurPasses,
          turdSizePx: Math.max(4, options.minIslandPx),
        }
      );
      boxLedgeWallPolygons = subtractInnerPolygons(silhouettePolygons, deepCavityPolygons);
      boxInnerPlugPolygons = subtractInnerPolygons(lidSilhouettePolygons, deepCavityPolygons);
    } else {
      boxLedgeWallPolygons = boxUpperWallPolygons;
    }
  }

  return {
    layerPolygons,
    silhouettePolygons,
    lidSilhouettePolygons,
    boxUpperWallPolygons,
    boxLedgeWallPolygons,
    boxInnerPlugPolygons,
    combinedStrokePolygons,
  };
}

/**
 * Legacy single-mask Marching Squares tracer kept for standalone binary masks.
 */
export function traceBinaryMaskToPolygons(
  mask: Uint8Array,
  width: number,
  height: number,
  options: {
    smoothEpsilon: number;
    turdSizePx: number;
    fieldBlurPasses?: number;
    cornerSimplify?: number;
  }
): TracedPolygon[] {
  const labels = new Int8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    labels[i] = mask[i] ? 0 : -1;
  }
  const res = tracePlanarColorPartition(labels, width, height, 1, {
    smoothEpsilon: options.smoothEpsilon,
    cornerSimplify: options.cornerSimplify ?? 0.32,
    fieldBlurPasses: options.fieldBlurPasses ?? 1,
    minIslandPx: options.turdSizePx,
  });
  return res.layerPolygons[0] || [];
}
