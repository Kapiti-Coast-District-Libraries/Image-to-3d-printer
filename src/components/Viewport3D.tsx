import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ExtrudedModelResult } from '../lib/meshExtruder';
import { BoxPlateLayout } from '../lib/colorQuantizer';
import {
  Box,
  Eye,
  Layers,
  RotateCcw,
  FlipHorizontal,
  MousePointerClick,
  Undo2,
  X,
  PackageOpen,
} from 'lucide-react';

interface Viewport3DProps {
  model: ExtrudedModelResult | null;
  highlightedSlot: number | null;
  flipFaceDown: boolean;
  onToggleFlipFaceDown: () => void;
  mergeItemMode?: boolean;
  onToggleMergeItemMode?: () => void;
  onMergeItemAtPixel?: (pixelX: number, pixelY: number) => void;
  mergedRegionsCount?: number;
  onUndoLastMergedRegion?: () => void;
  onClearMergedRegions?: () => void;
  boxMode?: boolean;
  boxPlateLayout?: BoxPlateLayout;
  onChangeBoxPlateLayout?: (layout: BoxPlateLayout) => void;
  boxLidLiftMm?: number;
  onChangeBoxLidLiftMm?: (liftMm: number) => void;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  model,
  highlightedSlot,
  flipFaceDown,
  onToggleFlipFaceDown,
  mergeItemMode = false,
  onToggleMergeItemMode,
  onMergeItemAtPixel,
  mergedRegionsCount = 0,
  onUndoLastMergedRegion,
  onClearMergedRegions,
  boxMode = false,
  boxPlateLayout = 'assembled',
  onChangeBoxPlateLayout,
  boxLidLiftMm = 16,
  onChangeBoxLidLiftMm,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const [showWireframe, setShowWireframe] = useState(false);
  const [explodeAmount, setExplodeAmount] = useState(0); // 0 to 1
  const [webglLost, setWebglLost] = useState(false);

  // Initialize Three.js Scene, Camera, Renderer, and Build Plate
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0B0F17');
    scene.fog = new THREE.FogExp2('#0B0F17', 0.0014);
    sceneRef.current = scene;

    // Z-up convention to match 3D printing & Bambu Studio build plate (XY plane, Z up)
    const camera = new THREE.PerspectiveCamera(38, width / height, 1, 2000);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -145, 135);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
    } catch {
      setWebglLost(true);
      return;
    }

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const handleContextRestored = () => {
      setWebglLost(false);
    };

    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 1.5);
    controls.maxDistance = 550;
    controls.minDistance = 25;
    controls.update();
    controlsRef.current = controls;

    // Three-Point Studio Lighting calibrated for PLA/Matte 3D Filament Visualization
    const hemiLight = new THREE.HemisphereLight('#F8FAFC', '#1E293B', 0.85);
    hemiLight.position.set(0, 0, 200);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#FFFBEB', 1.6);
    keyLight.position.set(110, -130, 180);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 20;
    keyLight.shadow.camera.far = 500;
    const d = 140;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight('#93C5FD', 0.65);
    fillLight.position.set(-140, -60, 90);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight('#F1F5F9', 0.75);
    rimLight.position.set(0, 160, 110);
    scene.add(rimLight);

    // Bambu 256 x 256 mm Build Plate Surface
    const plateSize = 256;
    const plateGroup = new THREE.Group();

    const plateGeo = new THREE.PlaneGeometry(plateSize, plateSize);
    const plateMat = new THREE.MeshStandardMaterial({
      color: '#131B28',
      roughness: 0.85,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const plateMesh = new THREE.Mesh(plateGeo, plateMat);
    plateMesh.position.set(0, 0, -0.08);
    plateMesh.receiveShadow = true;
    plateGroup.add(plateMesh);

    // Build Plate Grid (rotated to XY plane)
    const gridHelper = new THREE.GridHelper(plateSize, 25, '#334155', '#1E293B');
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.set(0, 0, -0.02);
    plateGroup.add(gridHelper);

    // Border Frame of Build Plate
    const borderPts = [
      new THREE.Vector3(-128, -128, 0.02),
      new THREE.Vector3(128, -128, 0.02),
      new THREE.Vector3(128, 128, 0.02),
      new THREE.Vector3(-128, 128, 0.02),
      new THREE.Vector3(-128, -128, 0.02),
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
    const borderMat = new THREE.LineBasicMaterial({ color: '#10B981', transparent: true, opacity: 0.45 });
    plateGroup.add(new THREE.Line(borderGeo, borderMat));

    scene.add(plateGroup);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: cw, height: ch } = entry.contentRect;
        if (cw > 0 && ch > 0) {
          camera.aspect = cw / ch;
          camera.updateProjectionMatrix();
          renderer.setSize(cw, ch);
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Rebuild or update 3D extruded meshes whenever model, explode, wireframe, or highlightedSlot changes
  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group) return;

    // Clear previous meshes
    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Mesh;
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
      group.remove(child);
    }

    if (!model) return;

    const maxZ = model.dimensionsMm.height;

    model.parts.forEach((part, idx) => {
      const isDimmed = highlightedSlot !== null && highlightedSlot !== part.slotIndex;

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.colorHex),
        roughness: 0.38,
        metalness: 0.06,
        transparent: isDimmed,
        opacity: isDimmed ? 0.18 : 1.0,
        polygonOffset: true,
        polygonOffsetFactor: idx * -0.5,
      });

      const mesh = new THREE.Mesh(part.geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Apply exploded Z offset for layer inspection
      const zExplodeOffset =
        part.partGroup === 'box'
          ? 0
          : part.partGroup === 'lid'
          ? explodeAmount * (10 + idx * 3.5)
          : explodeAmount * idx * 4.5;

      // In the 3D preview stage, plaque sign parts ALWAYS stay facing UP so the user
      // can inspect their artwork, colours, and text right side up on the plate.
      // (On export, parts are automatically flipped face-down onto the PEI bed when flipFaceDown is active).
      const shouldFlipPartInPreview =
        flipFaceDown &&
        part.partGroup === 'lid' &&
        !part.isPreFlippedFaceDown;
      const pivotX = part.offsetX || 0;
      const zSum =
        part.partGroup === 'lid'
          ? (part.lidZMin ?? 0) + (part.lidZMax ?? maxZ)
          : maxZ;

      mesh.position.set(0, 0, zExplodeOffset);

      if (shouldFlipPartInPreview) {
        mesh.scale.set(-1, 1, -1);
        mesh.position.set(2 * pivotX, 0, zSum + zExplodeOffset);
      }

      mesh.userData = {
        offsetX: pivotX,
        isFlippedFaceDown: Boolean(shouldFlipPartInPreview || part.isPreFlippedFaceDown),
        partGroup: part.partGroup,
      };

      group.add(mesh);

      if (showWireframe) {
        const wireMat = new THREE.MeshBasicMaterial({
          color: '#F8FAFC',
          wireframe: true,
          transparent: true,
          opacity: isDimmed ? 0.05 : 0.28,
        });
        const wireMesh = new THREE.Mesh(part.geometry, wireMat);
        wireMesh.position.copy(mesh.position);
        wireMesh.scale.copy(mesh.scale);
        group.add(wireMesh);
      }
    });
  }, [model, showWireframe, explodeAmount, highlightedSlot, flipFaceDown]);

  const setCameraView = (preset: 'iso' | 'top' | 'front' | 'bottom') => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;

    ctrl.target.set(0, 0, 1.5);
    switch (preset) {
      case 'iso':
        cam.up.set(0, 0, 1);
        cam.position.set(0, -145, 135);
        break;
      case 'top':
        cam.up.set(0, 1, 0);
        cam.position.set(0, -0.01, 185);
        break;
      case 'front':
        cam.up.set(0, 0, 1);
        cam.position.set(0, -175, 18);
        break;
      case 'bottom':
        cam.up.set(0, -1, 0);
        cam.position.set(0, 0.01, -185);
        break;
    }
    ctrl.update();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!down || !mergeItemMode || !onMergeItemAtPixel || !model) return;

    // Ignore drags / camera orbits
    const moveDist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moveDist > 5) return;

    const container = mountRef.current;
    const camera = cameraRef.current;
    const modelGroup = modelGroupRef.current;
    if (!container || !camera || !modelGroup) return;

    const rect = container.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    const solidMeshes = modelGroup.children.filter(
      (c): c is THREE.Mesh =>
        c instanceof THREE.Mesh &&
        !(c.material instanceof THREE.MeshBasicMaterial && c.material.wireframe)
    );
    const hits = raycaster.intersectObjects(solidMeshes, false);
    if (hits.length === 0) return;

    const hitPt = hits[0].point;
    const hitMesh = hits[0].object as THREE.Mesh;
    const { centerX, centerY, scaleMmPerPx, imageWidth, imageHeight } = model.pixelTransform;
    if (scaleMmPerPx <= 0) return;

    // Reverse the 3D XY transform back into sourceImageData pixel coordinates
    const partOffsetX = hitMesh.userData?.offsetX || 0;
    const isFlipped = Boolean(hitMesh.userData?.isFlippedFaceDown);
    const relX = hitPt.x - partOffsetX;
    const localX = isFlipped ? -relX : relX;
    const localY = hitPt.y;

    const px = Math.max(
      0,
      Math.min(imageWidth - 1, Math.round(localX / scaleMmPerPx + centerX))
    );
    const py = Math.max(
      0,
      Math.min(imageHeight - 1, Math.round(-localY / scaleMmPerPx + centerY))
    );

    onMergeItemAtPixel(px, py);
  };

  if (webglLost) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#0B0F17] p-8 text-center">
        <Box className="w-10 h-10 text-emerald-400 mb-3" />
        <p className="text-sm font-medium text-slate-200">3D WebGL Viewport Paused</p>
        <p className="text-xs text-slate-400 mt-1 max-w-md">
          Switch to the 2D Vector Paths view to inspect contours or export your .3MF file directly.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden select-none bg-[#0B0F17]">
      {/* WebGL Canvas Container */}
      <div
        ref={mountRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className={`w-full h-full ${
          mergeItemMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
      />

      {/* Active Click-to-Merge Item Banner */}
      {mergeItemMode && (
        <div className="absolute top-4 right-4 z-20 max-w-md bg-cyan-950/90 backdrop-blur-md border border-cyan-400/50 rounded-lg px-3.5 py-2.5 text-xs text-cyan-100 shadow-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <MousePointerClick className="w-4 h-4 text-cyan-300 shrink-0 animate-pulse" />
            <span className="font-medium leading-snug">
              Click any unwanted detail or part on the 3D model to merge it into its surrounding colour
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {mergedRegionsCount > 0 && onUndoLastMergedRegion && (
              <button
                type="button"
                onClick={onUndoLastMergedRegion}
                className="flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium cursor-pointer whitespace-nowrap"
                title="Undo last merged item"
              >
                <Undo2 className="w-3 h-3" />
                <span>Undo ({mergedRegionsCount})</span>
              </button>
            )}
            {onToggleMergeItemMode && (
              <button
                type="button"
                onClick={onToggleMergeItemMode}
                className="px-2 py-1 rounded bg-cyan-400 text-slate-950 hover:bg-cyan-300 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top-Left Dimension & Mesh Summary HUD */}
      {model && (
        <div className="absolute top-4 left-4 z-10 pointer-events-none bg-slate-950/75 backdrop-blur-md border border-white/10 rounded-lg px-3.5 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-slate-200 font-medium">
            <span>Bambu 256×256 mm Plate</span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-emerald-400">
              {model.dimensionsMm.width.toFixed(1)} × {model.dimensionsMm.depth.toFixed(1)} × {model.dimensionsMm.height.toFixed(2)} mm
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-400 mt-1 font-mono tabular-nums text-[11px]">
            <span>{model.parts.length} AMS Bodies</span>
            <span aria-hidden="true">·</span>
            <span>{model.totalVertices.toLocaleString()} Vertices</span>
            <span aria-hidden="true">·</span>
            <span>{model.totalTriangles.toLocaleString()} Triangles</span>
            {boxMode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-300">Hollow Box + Lid Mode</span>
              </>
            )}
            {flipFaceDown && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-300">
                  {boxMode ? 'Lid Face-Down PEI' : 'Face-Down PEI Mode'}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Top-Right Interactive Box Mode Bar (when Box Mode is active and Merge Item Banner is not covering it) */}
      {boxMode && !mergeItemMode && (
        <div className="absolute top-4 right-4 z-15 bg-slate-950/85 backdrop-blur-md border border-emerald-500/40 rounded-lg px-3.5 py-2 text-xs flex flex-wrap items-center gap-3 shadow-lg">
          <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
            <PackageOpen className="w-4 h-4" />
            <span>Box + Lid</span>
          </div>

          {onChangeBoxPlateLayout && (
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-md border border-white/10">
              <button
                type="button"
                onClick={() => onChangeBoxPlateLayout('assembled')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  boxPlateLayout === 'assembled'
                    ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/50'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Fit Preview
              </button>
              <button
                type="button"
                onClick={() => onChangeBoxPlateLayout('side_by_side')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  boxPlateLayout === 'side_by_side'
                    ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/50'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Side-by-Side Plate
              </button>
            </div>
          )}

          {boxPlateLayout === 'assembled' && onChangeBoxLidLiftMm && (
            <div className="flex items-center gap-2 pl-1 border-l border-white/10">
              <span className="text-[11px] text-slate-300 whitespace-nowrap">
                {boxLidLiftMm === 0 ? 'Lid Closed' : `Lid Lift +${boxLidLiftMm}mm`}
              </span>
              <input
                type="range"
                min={0}
                max={45}
                step={1}
                value={boxLidLiftMm}
                onChange={(e) => onChangeBoxLidLiftMm(parseFloat(e.target.value))}
                className="w-20 accent-emerald-400 cursor-pointer"
                title="Slide to open or close the Traced Image Lid on the Hollow Box"
              />
              <button
                type="button"
                onClick={() => onChangeBoxLidLiftMm(boxLidLiftMm > 0 ? 0 : 18)}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-medium text-slate-200 border border-white/10 cursor-pointer whitespace-nowrap"
              >
                {boxLidLiftMm > 0 ? 'Close Lid' : 'Open Lid'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom Floating Camera & Inspection Controls Bar */}
      <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Camera Angle Presets */}
        <div className="pointer-events-auto flex items-center gap-1 bg-slate-950/80 backdrop-blur-md border border-white/10 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setCameraView('iso')}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-md transition-colors whitespace-nowrap"
          >
            Isometric
          </button>
          <button
            type="button"
            onClick={() => setCameraView('top')}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-md transition-colors whitespace-nowrap"
          >
            Top Plan
          </button>
          <button
            type="button"
            onClick={() => setCameraView('front')}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-md transition-colors whitespace-nowrap"
          >
            Front Z
          </button>
          <button
            type="button"
            onClick={() => setCameraView('bottom')}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-md transition-colors whitespace-nowrap"
          >
            Bottom Plate
          </button>
        </div>

        {/* Merge Item Tool, Explode Z-Layers, Face-Down Flip, and Wireframe Toggle */}
        <div className="pointer-events-auto flex items-center gap-2.5 bg-slate-950/80 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5">
          {onToggleMergeItemMode && (
            <>
              <button
                type="button"
                onClick={onToggleMergeItemMode}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  mergeItemMode
                    ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/60 ring-1 ring-cyan-400/40'
                    : 'text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25'
                }`}
                title="Click any unwanted detail or island on the model to merge it into its surrounding colour"
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                <span>{mergeItemMode ? 'Merging Items (Click Model)...' : 'Merge Item'}</span>
              </button>

              {mergedRegionsCount > 0 && onUndoLastMergedRegion && (
                <button
                  type="button"
                  onClick={onUndoLastMergedRegion}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/15 border border-white/10 transition-colors whitespace-nowrap cursor-pointer"
                  title="Undo last merged item"
                >
                  <Undo2 className="w-3 h-3 text-cyan-300" />
                  <span>Undo ({mergedRegionsCount})</span>
                </button>
              )}

              {mergedRegionsCount > 1 && onClearMergedRegions && (
                <button
                  type="button"
                  onClick={onClearMergedRegions}
                  className="p-1 text-slate-400 hover:text-rose-300 rounded-md transition-colors cursor-pointer"
                  title="Restore all manually merged items"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              <div className="h-4 w-px bg-white/10" />
            </>
          )}

          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <label htmlFor="explode-slider" className="text-xs text-slate-300 whitespace-nowrap">
              Explode Layers
            </label>
            <input
              id="explode-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={explodeAmount}
              onChange={(e) => setExplodeAmount(parseFloat(e.target.value))}
              className="w-20 accent-emerald-500 cursor-pointer"
            />
          </div>

          <div className="h-4 w-px bg-white/10" />

          <button
            type="button"
            onClick={onToggleFlipFaceDown}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              flipFaceDown
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
            title="Flip artwork face-down onto the build plate for textured PEI surface finish"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span>Face-Down PEI</span>
          </button>

          <button
            type="button"
            onClick={() => setShowWireframe((w) => !w)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              showWireframe
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Wireframe</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setExplodeAmount(0);
              setCameraView('iso');
            }}
            className="p-1 text-slate-400 hover:text-white rounded-md transition-colors"
            title="Reset camera view"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
