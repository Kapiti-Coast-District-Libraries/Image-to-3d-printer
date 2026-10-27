import * as THREE from 'three';
import JSZip from 'jszip';
import { ExtrudedModelResult, ManifoldMeshPart } from './meshExtruder';

export const DEFAULT_STL_HEADER =
  'Kāpiti Libraries NZ Street Sign Generator (3mm Bambu Studio Ready)';

/**
 * Converts a Three.js BufferGeometry to binary STL ArrayBuffer
 */
export function geometryToBinarySTL(
  geometry: THREE.BufferGeometry,
  headerText: string = DEFAULT_STL_HEADER
): ArrayBuffer {
  // Ensure we have non-indexed triangles
  let nonIndexed = geometry;
  if (geometry.index) {
    nonIndexed = geometry.toNonIndexed();
  }

  const posAttr = nonIndexed.getAttribute('position');
  const normAttr = nonIndexed.getAttribute('normal');

  const triangles = posAttr.count / 3;
  // Binary STL format: 80 bytes header + 4 bytes triangle count + 50 bytes per triangle
  const bufferLength = 80 + 4 + triangles * 50;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const dataView = new DataView(arrayBuffer);

  // 80-byte header
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(headerText.slice(0, 80));
  for (let i = 0; i < Math.min(80, headerBytes.length); i++) {
    dataView.setUint8(i, headerBytes[i]);
  }

  // 4-byte triangle count (Little-Endian)
  dataView.setUint32(80, triangles, true);

  let offset = 84;
  for (let i = 0; i < triangles; i++) {
    const i0 = i * 3;
    const i1 = i * 3 + 1;
    const i2 = i * 3 + 2;

    // Normal vector
    let nx = 0,
      ny = 0,
      nz = 1;
    if (normAttr) {
      nx = normAttr.getX(i0);
      ny = normAttr.getY(i0);
      nz = normAttr.getZ(i0);
    } else {
      // Calculate face normal
      const ax = posAttr.getX(i0),
        ay = posAttr.getY(i0),
        az = posAttr.getZ(i0);
      const bx = posAttr.getX(i1),
        by = posAttr.getY(i1),
        bz = posAttr.getZ(i1);
      const cx = posAttr.getX(i2),
        cy = posAttr.getY(i2),
        cz = posAttr.getZ(i2);
      const vax = bx - ax,
        vay = by - ay,
        vaz = bz - az;
      const vbx = cx - ax,
        vby = cy - ay,
        vbz = cz - az;
      nx = vay * vbz - vaz * vby;
      ny = vaz * vbx - vax * vbz;
      nz = vax * vby - vay * vbx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
    }

    dataView.setFloat32(offset, nx, true);
    dataView.setFloat32(offset + 4, ny, true);
    dataView.setFloat32(offset + 8, nz, true);
    offset += 12;

    // Vertex 1
    dataView.setFloat32(offset, posAttr.getX(i0), true);
    dataView.setFloat32(offset + 4, posAttr.getY(i0), true);
    dataView.setFloat32(offset + 8, posAttr.getZ(i0), true);
    offset += 12;

    // Vertex 2
    dataView.setFloat32(offset, posAttr.getX(i1), true);
    dataView.setFloat32(offset + 4, posAttr.getY(i1), true);
    dataView.setFloat32(offset + 8, posAttr.getZ(i1), true);
    offset += 12;

    // Vertex 3
    dataView.setFloat32(offset, posAttr.getX(i2), true);
    dataView.setFloat32(offset + 4, posAttr.getY(i2), true);
    dataView.setFloat32(offset + 8, posAttr.getZ(i2), true);
    offset += 12;

    // 2-byte attribute byte count
    dataView.setUint16(offset, 0, true);
    offset += 2;
  }

  return arrayBuffer;
}

/**
 * Merges two or more BufferGeometries into a single BufferGeometry
 */
export function mergeBufferGeometries(
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry {
  const validGeoms = geometries.filter(
    (g) => g && g.getAttribute('position') && g.getAttribute('position').count > 0
  );
  if (validGeoms.length === 0) {
    return new THREE.BufferGeometry();
  }

  const positions: number[] = [];
  const normals: number[] = [];

  for (const geom of validGeoms) {
    let nonIndexed = geom;
    if (geom.index) {
      nonIndexed = geom.toNonIndexed();
    }
    const pos = nonIndexed.getAttribute('position');
    const norm = nonIndexed.getAttribute('normal');

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (norm) {
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      } else {
        normals.push(0, 0, 1);
      }
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}

/**
 * Triggers a browser download for a Blob
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Transforms a BufferGeometry for face-down 3D printing if flipFaceDown is true:
 * - Inverts Z around maxZ: z' = maxZ - z (inlays land on Z = 0..0.4mm, exactly 2 layers @ 0.2mm)
 * - Inverts X around pivotX: x' = 2 * pivotX - x (rotates 180 deg around Y, preserving triangle winding)
 */
export function getExportGeometry(
  part: ManifoldMeshPart,
  flipFaceDown: boolean,
  maxZ: number
): THREE.BufferGeometry {
  if (!flipFaceDown || part.partGroup === 'box' || part.isPreFlippedFaceDown) {
    return part.geometry;
  }
  const pivotX = part.offsetX || 0;
  const zSum =
    part.partGroup === 'lid'
      ? (part.lidZMin ?? 0) + (part.lidZMax ?? maxZ)
      : maxZ;

  const clone = part.geometry.clone();
  const posAttr = clone.getAttribute('position');
  if (!posAttr) return clone;

  const newPositions = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    newPositions[i * 3] = 2 * pivotX - x;
    newPositions[i * 3 + 1] = y;
    newPositions[i * 3 + 2] = zSum - z;
  }
  clone.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
  clone.computeVertexNormals();
  return clone;
}

/**
 * Exports a single part to binary STL Blob
 */
export function exportPartToSTL(
  part: ManifoldMeshPart,
  flipFaceDown: boolean = true,
  maxZ: number = 3.0,
  headerText: string = DEFAULT_STL_HEADER
): Blob {
  const geom = getExportGeometry(part, flipFaceDown, maxZ);
  const arrayBuffer = geometryToBinarySTL(geom, headerText);
  return new Blob([arrayBuffer], { type: 'application/octet-stream' });
}

/**
 * Exports all parts as individual binary STL files packaged inside a single ZIP.
 * In Bambu Studio, users drop all STLs together and click "Yes" to "Load as single object with multiple parts".
 */
export async function exportAllPartsToStlZip(
  model: ExtrudedModelResult,
  projectName: string,
  flipFaceDown: boolean = true,
  headerText: string = DEFAULT_STL_HEADER
): Promise<Blob> {
  const zip = new JSZip();
  const cleanProjectName = projectName.replace(/[\s\W]+/g, '_');
  const maxZ = model.dimensionsMm.height;

  for (let i = 0; i < model.parts.length; i++) {
    const part = model.parts[i];
    const cleanPartName = part.name.replace(/[\s\W]+/g, '_');
    const geom = getExportGeometry(part, flipFaceDown, maxZ);
    const stlBuffer = geometryToBinarySTL(geom, headerText);
    zip.file(`${cleanProjectName}_${i + 1}_${cleanPartName}.stl`, stlBuffer);
  }

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Exports a 2-part sign STL ZIP:
 * 1. Base Part: Solid backing plate and base-colored face tiles
 * 2. Inlays Part: All non-base artwork colors merged together into a single geometry (strictly 0.4mm thick = 2 layers @ 0.2mm)
 */
export async function exportTwoPartSignStlZip(
  model: ExtrudedModelResult,
  projectName: string,
  activeBaseSlot: number,
  flipFaceDown: boolean = true,
  headerText: string = DEFAULT_STL_HEADER
): Promise<Blob> {
  const zip = new JSZip();
  const cleanProjectName = projectName.replace(/[\s\W]+/g, '_');
  const maxZ = model.dimensionsMm.height;

  // Identify base part vs non-base inlay parts
  const basePart =
    model.parts.find((p) => p.slotIndex === activeBaseSlot) ||
    model.parts.find((p) => p.partGroup === 'plaque' && p.slotIndex === 4) ||
    model.parts[0];

  const inlayParts = model.parts.filter((p) => p !== basePart);

  // 1. Base STL: exported with identical (0, 0, 0) origin as inlays
  if (basePart) {
    const baseGeom = getExportGeometry(basePart, flipFaceDown, maxZ);
    const baseBuffer = geometryToBinarySTL(baseGeom, headerText);
    zip.file(`${cleanProjectName}_Base_Plate_${maxZ.toFixed(0)}mm.stl`, baseBuffer);
  }

  // 2. Merged Inlays STL: strictly 0.4mm thick for 2 layers on build bed
  if (inlayParts.length > 0) {
    const flippedInlayGeoms = inlayParts.map((p) => getExportGeometry(p, flipFaceDown, maxZ));
    const mergedInlayGeom = mergeBufferGeometries(flippedInlayGeoms);
    const inlayBuffer = geometryToBinarySTL(mergedInlayGeom, headerText);
    zip.file(`${cleanProjectName}_Text_Inlay_FirstLayer_0.4mm.stl`, inlayBuffer);
  }

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Exports a Single Merged STL:
 * Merges everything into a single uniform 3.0mm mesh for single-colour prints or CNC/laser toolpaths.
 */
export function exportSingleMergedStl(
  model: ExtrudedModelResult,
  projectName: string,
  flipFaceDown: boolean = true,
  headerText: string = DEFAULT_STL_HEADER
): Blob {
  const maxZ = model.dimensionsMm.height;
  const flippedGeoms = model.parts.map((p) => getExportGeometry(p, flipFaceDown, maxZ));
  const mergedGeom = mergeBufferGeometries(flippedGeoms);
  const arrayBuffer = geometryToBinarySTL(mergedGeom, headerText);
  return new Blob([arrayBuffer], { type: 'application/octet-stream' });
}
