import JSZip from 'jszip';
import { ColorSlotConfig, MultiColorTraceResult } from './colorQuantizer';
import { ExtrudedModelResult } from './meshExtruder';
import { Point } from './vectorTracer';
import { findClosestBambuFilament } from './bambuFilaments';

export type Bambu3mfColorFormat = 'standard_colorgroup' | 'bambu_project';

export interface Export3mfOptions {
  projectName?: string;
  flipFaceDown?: boolean;
  slotConfigs?: ColorSlotConfig[];
  snapToOfficialBambuHex?: boolean;
  colorFormat?: Bambu3mfColorFormat;
}

interface ExportFilamentSlot {
  extruderIndex: number; // 1-based (1..4+)
  colorIndex: number; // 0-based index into <m:colorgroup> and filament_colour[]
  hex: string; // #RRGGBB
  rgbaHex: string; // #RRGGBBFF
  bambuName: string;
  bambuSeries: string;
  bambuCode: string;
  filamentId: string;
  settingsId: string;
}

// Function removed: Bambu Studio slicer uses part-level extruder metadata instead of paint_color
// which previously caused colors to scramble or slice with default filament.

/**
 * Generates a Bambu Studio / OrcaSlicer / PrusaSlicer compatible multi-colour .3mf archive
 * that automatically loads the correct filament colours upon import or project open.
 *
 * Includes:
 * 1. `<m:colorgroup id="1">` bound directly to every `<object>` (`pid="1" pindex="N"`) and
 *    every `<triangle>` (`pid="1" p1="N" p2="N" p3="N"`), enabling Bambu Studio's Standard 3MF Color Importer.
 * 2. `<basematerials id="2">` with `displaycolor="#RRGGBBFF"` and official Bambu filament names.
 * 3. `Metadata/project_settings.config` (JSON) containing `filament_colour`, `default_filament_colour`,
 *    `filament_type`, `filament_settings_id`, and `filament_ids` so Bambu Studio / OrcaSlicer project
 *    loading populates the left-sidebar Filament Slots 1-4 with the exact colours.
 * 4. `Metadata/model_settings.config` (XML) binding each manifold mesh part to its corresponding AMS Extruder.
 */
export async function generateBambu3mfBlob(
  model: ExtrudedModelResult,
  options: Export3mfOptions = {}
): Promise<Blob> {
  const {
    projectName = 'PolyTrace_Bambu_4Color',
    flipFaceDown = false,
    snapToOfficialBambuHex = false,
    colorFormat = 'bambu_project',
  } = options;

  const zip = new JSZip();

  // 1. Build consolidated filament palette so AMS Slots 1..4 map cleanly and predictably.
  // Always use `part.colorHex` which is built directly from `traceResult.layers[i].printHex`
  // (preserving the exact K-Means detected shades from the image as well as any user overrides).
  const filamentSlots: ExportFilamentSlot[] = [];
  const partToFilamentIdx: number[] = new Array(model.parts.length).fill(0);

  const registerColorAsFilament = (rawHex: string): number => {
    const match = findClosestBambuFilament(rawHex);
    const finalHex = (snapToOfficialBambuHex ? match.preset.hex : rawHex).toUpperCase();
    const hexClean = finalHex.replace('#', '');
    const normalizedHex = `#${hexClean}`;

    // Reuse existing filament slot if identical hex is already registered
    const existingIdx = filamentSlots.findIndex(
      (f) => f.hex.toUpperCase() === normalizedHex
    );
    if (existingIdx !== -1) {
      return existingIdx;
    }

    const colorIndex = filamentSlots.length;
    filamentSlots.push({
      extruderIndex: colorIndex + 1,
      colorIndex,
      hex: normalizedHex,
      rgbaHex: `#${hexClean}FF`,
      bambuName: match.preset.name,
      bambuSeries: match.preset.series,
      bambuCode: match.preset.code,
      filamentId: match.preset.filamentId,
      settingsId: match.preset.settingsId,
    });
    return colorIndex;
  };

  // If slotConfigs is provided, register active slots in exact slot order (AMS Slots 1..4)
  if (options.slotConfigs && options.slotConfigs.length > 0) {
    for (const slot of options.slotConfigs) {
      if (slot.mergedIntoSlot != null) continue;
      registerColorAsFilament(slot.printHex);
    }
  }

  // Register parts in slot order (0..3+) using each part's authoritative colorHex
  const sortedPartsWithOriginalIndex = model.parts
    .map((part, idx) => ({ part, idx }))
    .sort((a, b) => a.part.slotIndex - b.part.slotIndex);

  for (const { part, idx } of sortedPartsWithOriginalIndex) {
    const hexToUse = part.colorHex;
    const filIdx = registerColorAsFilament(hexToUse);
    partToFilamentIdx[idx] = filIdx;
  }

  // Ensure at least 1 filament exists
  if (filamentSlots.length === 0) {
    registerColorAsFilament('#161618');
  }

  // 2. [Content_Types].xml
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="config" ContentType="text/xml" />
</Types>`;
  zip.file('[Content_Types].xml', contentTypesXml);

  // 3. _rels/.rels
  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;
  zip.file('_rels/.rels', relsXml);

  // 4. Build 3D/3dmodel.model XML
  // Resource id="1" is <m:colorgroup id="1"> so every <object> and <triangle> referencing pid="1"
  // directly supplies per-face and per-vertex sRGB colours to Bambu Studio's 3MF Color Importer.
  // Resource id="2" is <basematerials id="2"> for standard 3MF Core material readers.
  const maxZ = model.dimensionsMm.height;

  const colorGroupLines: string[] = [];
  const baseMaterialsLines: string[] = [];

  for (const fil of filamentSlots) {
    colorGroupLines.push(`      <m:color color="${fil.rgbaHex}" />`);
    baseMaterialsLines.push(
      `      <base name="AMS ${fil.extruderIndex} - ${fil.bambuName} (${fil.hex})" displaycolor="${fil.rgbaHex}" />`
    );
  }

  const objectXmlBlocks: string[] = [];
  const hasBoxParts = model.parts.some((p) => p.partGroup === 'box');
  const hasLidParts = model.parts.some((p) => p.partGroup === 'lid');
  const splitBoxAndLidAssemblies = hasBoxParts && hasLidParts;

  const mainComponentLines: string[] = [];
  const mainBambuPartBlocks: string[] = [];
  const lidComponentLines: string[] = [];
  const lidBambuPartBlocks: string[] = [];

  const assemblyObjectId = 100;
  const lidAssemblyObjectId = 101;

  for (let i = 0; i < model.parts.length; i++) {
    const part = model.parts[i];
    const objectId = i + 1;
    const filIdx = partToFilamentIdx[i];
    const fil = filamentSlots[filIdx];
    const extruderNum = fil.extruderIndex;
    const partDisplayName =
      part.partGroup === 'box'
        ? `Hollow_Box_${fil.bambuName.replace(/\s+/g, '_')}_${fil.hex.replace('#', '')}`
        : part.partGroup === 'lid'
        ? `Lid_Slot_${extruderNum}_${fil.bambuName.replace(/\s+/g, '_')}_${fil.hex.replace('#', '')}`
        : part.slotIndex === 4
        ? `Stroke_Base_${fil.bambuName.replace(/\s+/g, '_')}_${fil.hex.replace('#', '')}`
        : `Slot_${extruderNum}_${fil.bambuName.replace(/\s+/g, '_')}_${fil.hex.replace('#', '')}`;

    // Determine whether this specific part should be rotated 180 deg around Y for face-down PEI printing:
    // - Hollow Box ('box') always stays upright with its solid floor on Z=0.
    // - Lid ('lid') flips around its own offsetX and (lidZMin + lidZMax) if flipFaceDown && !isPreFlippedFaceDown.
    // - Standard Plaque ('plaque') flips around X=0 and maxZ if flipFaceDown.
    const shouldFlipPart =
      flipFaceDown &&
      part.partGroup !== 'box' &&
      !part.isPreFlippedFaceDown;
    const pivotX = part.offsetX || 0;
    const zSum =
      part.partGroup === 'lid'
        ? (part.lidZMin ?? 0) + (part.lidZMax ?? maxZ)
        : maxZ;

    const vertexLines: string[] = new Array(part.vertices.length);
    for (let vIdx = 0; vIdx < part.vertices.length; vIdx++) {
      const v = part.vertices[vIdx];
      const vx = shouldFlipPart ? 2 * pivotX - v.x : v.x;
      const vy = v.y;
      const vz = shouldFlipPart ? zSum - v.z : v.z;
      vertexLines[vIdx] = `          <vertex x="${vx.toFixed(4)}" y="${vy.toFixed(4)}" z="${vz.toFixed(4)}" />`;
    }

    const triangleLines: string[] = new Array(part.triangles.length);
    for (let tIdx = 0; tIdx < part.triangles.length; tIdx++) {
      const [v1, v2, v3] = part.triangles[tIdx];
      triangleLines[tIdx] =
        `          <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="1" p1="${filIdx}" p2="${filIdx}" p3="${filIdx}" />`;
    }

    objectXmlBlocks.push(`    <object id="${objectId}" name="${partDisplayName}" type="model" pid="1" pindex="${filIdx}">
      <mesh>
        <vertices>
${vertexLines.join('\n')}
        </vertices>
        <triangles>
${triangleLines.join('\n')}
        </triangles>
      </mesh>
    </object>`);

    const partConfigXml = `    <part id="${objectId}" subtype="normal_part">
      <metadata key="name" value="${partDisplayName}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="${extruderNum}"/>
      <metadata key="source_object_id" value="${objectId}"/>
    </part>`;

    if (splitBoxAndLidAssemblies && part.partGroup === 'lid') {
      lidComponentLines.push(`        <component objectid="${objectId}" />`);
      lidBambuPartBlocks.push(partConfigXml);
    } else {
      mainComponentLines.push(`        <component objectid="${objectId}" />`);
      mainBambuPartBlocks.push(partConfigXml);
    }
  }

  const mainAssemblyName = splitBoxAndLidAssemblies
    ? `${projectName}_Hollow_Box`
    : projectName;
  const lidAssemblyName = `${projectName}_Traced_Lid`;

  const assemblyObjectsXml = splitBoxAndLidAssemblies
    ? `    <object id="${assemblyObjectId}" name="${mainAssemblyName}" type="model">
      <components>
${mainComponentLines.join('\n')}
      </components>
    </object>
    <object id="${lidAssemblyObjectId}" name="${lidAssemblyName}" type="model">
      <components>
${lidComponentLines.join('\n')}
      </components>
    </object>`
    : `    <object id="${assemblyObjectId}" name="${mainAssemblyName}" type="model">
      <components>
${mainComponentLines.join('\n')}
      </components>
    </object>`;

  const buildItemsXml = splitBoxAndLidAssemblies
    ? `    <item objectid="${assemblyObjectId}" transform="1 0 0 0 1 0 0 0 1 128 128 0" />
    <item objectid="${lidAssemblyObjectId}" transform="1 0 0 0 1 0 0 0 1 128 128 0" />`
    : `    <item objectid="${assemblyObjectId}" transform="1 0 0 0 1 0 0 0 1 128 128 0" />`;

  // Note on BambuStudio:3mfVersion:
  // - In 'standard_colorgroup' mode, omitting BambuStudio:3mfVersion ensures Bambu Studio triggers its
  //   built-in 3MF Color Importer (<m:colorgroup id="1">), automatically loading all 4 exact hex colours
  //   into the filament slots while keeping the user's current printer (A1 / P1S / X1C) & process settings intact.
  // - In 'bambu_project' mode, BambuStudio:3mfVersion is included alongside Metadata/project_settings.config
  //   so opening as a project directly populates filament_colour[] and part extruders.
  const versionMetaLine =
    colorFormat === 'bambu_project'
      ? '\n  <metadata name="BambuStudio:3mfVersion">1</metadata>'
      : '';

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"
  xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
  <metadata name="Application">PolyTrace 3MF Studio</metadata>
  <metadata name="Title">${projectName}</metadata>${versionMetaLine}
  <resources>
    <m:colorgroup id="1">
${colorGroupLines.join('\n')}
    </m:colorgroup>
    <basematerials id="2">
${baseMaterialsLines.join('\n')}
    </basematerials>
${objectXmlBlocks.join('\n')}
${assemblyObjectsXml}
  </resources>
  <build>
${buildItemsXml}
  </build>
</model>`;

  zip.file('3D/3dmodel.model', modelXml);

  // 5. Metadata/model_settings.config for Bambu Studio / OrcaSlicer multi-extruder part binding
  const modelSettingsObjectsXml = splitBoxAndLidAssemblies
    ? `  <object id="${assemblyObjectId}">
    <metadata key="name" value="${mainAssemblyName}"/>
    <metadata key="extruder" value="1"/>
${mainBambuPartBlocks.join('\n')}
  </object>
  <object id="${lidAssemblyObjectId}">
    <metadata key="name" value="${lidAssemblyName}"/>
    <metadata key="extruder" value="1"/>
${lidBambuPartBlocks.join('\n')}
  </object>`
    : `  <object id="${assemblyObjectId}">
    <metadata key="name" value="${mainAssemblyName}"/>
    <metadata key="extruder" value="1"/>
${mainBambuPartBlocks.join('\n')}
  </object>`;

  const modelInstancesXml = splitBoxAndLidAssemblies
    ? `    <model_instance>
      <metadata key="object_id" value="${assemblyObjectId}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
    <model_instance>
      <metadata key="object_id" value="${lidAssemblyObjectId}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>`
    : `    <model_instance>
      <metadata key="object_id" value="${assemblyObjectId}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>`;

  const modelSettingsXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${modelSettingsObjectsXml}
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="Bambu Textured PEI Plate"/>
${modelInstancesXml}
  </plate>
</config>`;

  zip.file('Metadata/model_settings.config', modelSettingsXml);

  // 6. Metadata/project_settings.config (JSON)
  // Authoritative source for filament_colour, filament_type, and official Bambu filament preset IDs
  // when opened as a project in Bambu Studio or OrcaSlicer.
  const projectSettingsJson = {
    from: 'project',
    name: projectName,
    printer_model: 'Bambu Lab X1 Carbon',
    printer_settings_id: 'Bambu Lab X1 Carbon 0.4 nozzle',
    print_settings_id: '0.20mm Standard @BBL X1C',
    curr_bed_type: 'Textured PEI Plate',
    nozzle_diameter: ['0.4'],
    filament_colour: filamentSlots.map((f) => f.hex),
    default_filament_colour: filamentSlots.map((f) => f.hex),
    filament_type: filamentSlots.map(() => 'PLA'),
    filament_vendor: filamentSlots.map(() => 'Bambu Lab'),
    filament_ids: filamentSlots.map((f) => f.filamentId),
    filament_settings_id: filamentSlots.map((f) => f.settingsId),
    filament_soluble: filamentSlots.map(() => '0'),
    filament_is_support: filamentSlots.map(() => '0'),
    filament_diameter: filamentSlots.map(() => '1.75'),
    filament_density: filamentSlots.map(() => '1.24'),
    filament_cost: filamentSlots.map(() => '24.99'),
    nozzle_temperature: filamentSlots.map(() => '220'),
    nozzle_temperature_initial_layer: filamentSlots.map(() => '220'),
    cool_plate_temp: filamentSlots.map(() => '35'),
    eng_plate_temp: filamentSlots.map(() => '0'),
    hot_plate_temp: filamentSlots.map(() => '55'),
    textured_plate_temp: filamentSlots.map(() => '55'),
    cool_plate_temp_initial_layer: filamentSlots.map(() => '35'),
    eng_plate_temp_initial_layer: filamentSlots.map(() => '0'),
    hot_plate_temp_initial_layer: filamentSlots.map(() => '55'),
    textured_plate_temp_initial_layer: filamentSlots.map(() => '55'),
    enable_prime_tower: '1',
    Flush_into_infill: '1',
  };

  zip.file('Metadata/project_settings.config', JSON.stringify(projectSettingsJson, null, 2));

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Exports clean Inkscape-compatible SVG paths for the traced colour layers.
 */
export function generateCleanSvgString(traceResult: MultiColorTraceResult): string {
  const { width, height, layers } = traceResult;

  const ringToSvgD = (ring: Point[]): string => {
    if (ring.length < 3) return '';
    const coords = ring.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`);
    return `${coords.join(' ')} Z`;
  };

  const layerGroups: string[] = [];

  for (const layer of layers) {
    if (!layer.enabled || layer.polygons.length === 0) continue;

    const dParts: string[] = [];
    for (const poly of layer.polygons) {
      dParts.push(ringToSvgD(poly.outer));
      for (const hole of poly.holes) {
        dParts.push(ringToSvgD(hole));
      }
    }

    layerGroups.push(
      `  <g id="ams_slot_${layer.slotIndex + 1}" inkscape:label="AMS Slot ${layer.slotIndex + 1} (${layer.printHex})">
    <path fill="${layer.printHex}" fill-rule="evenodd" d="${dParts.join(' ')}" />
  </g>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     viewBox="0 0 ${width} ${height}"
     width="${width}"
     height="${height}">
${layerGroups.join('\n')}
</svg>`;
}
