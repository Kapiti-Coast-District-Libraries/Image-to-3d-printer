import { RGB, hexToRgb } from './colorQuantizer';

export interface BambuFilamentPreset {
  code: string;
  name: string;
  series: 'PLA Basic' | 'PLA Matte' | 'PLA Silk';
  hex: string;
  filamentId: string;
  settingsId: string;
}

/**
 * Official Bambu Lab PLA Basic, PLA Matte, and PLA Silk filament catalogue
 * with authentic Bambu Studio hex codes, filament IDs, and preset names.
 */
export const OFFICIAL_BAMBU_FILAMENTS: BambuFilamentPreset[] = [
  // Bambu PLA Basic (GFA00)
  {
    code: '10100',
    name: 'Jade White',
    series: 'PLA Basic',
    hex: '#FFFFFF',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10101',
    name: 'Black',
    series: 'PLA Basic',
    hex: '#161618',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10104',
    name: 'Light Gray',
    series: 'PLA Basic',
    hex: '#D1D3D5',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10103',
    name: 'Gray',
    series: 'PLA Basic',
    hex: '#8E9089',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10105',
    name: 'Dark Gray',
    series: 'PLA Basic',
    hex: '#54545A',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10102',
    name: 'Silver',
    series: 'PLA Basic',
    hex: '#A6A9AA',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10200',
    name: 'Red',
    series: 'PLA Basic',
    hex: '#C12E1F',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10202',
    name: 'Magenta',
    series: 'PLA Basic',
    hex: '#EC008C',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10203',
    name: 'Pink',
    series: 'PLA Basic',
    hex: '#F55A74',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10300',
    name: 'Orange',
    series: 'PLA Basic',
    hex: '#FF6A13',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10301',
    name: 'Pumpkin Orange',
    series: 'PLA Basic',
    hex: '#FF9016',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10400',
    name: 'Yellow',
    series: 'PLA Basic',
    hex: '#F4EE2A',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10402',
    name: 'Sunflower Yellow',
    series: 'PLA Basic',
    hex: '#FEC600',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10401',
    name: 'Gold',
    series: 'PLA Basic',
    hex: '#E4BD68',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10501',
    name: 'Bambu Green',
    series: 'PLA Basic',
    hex: '#00AE42',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10502',
    name: 'Mistletoe Green',
    series: 'PLA Basic',
    hex: '#3F8E43',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10503',
    name: 'Bright Green',
    series: 'PLA Basic',
    hex: '#BECF00',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10605',
    name: 'Turquoise',
    series: 'PLA Basic',
    hex: '#00B1B7',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10603',
    name: 'Cyan',
    series: 'PLA Basic',
    hex: '#0086D6',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10604',
    name: 'Cobalt Blue',
    series: 'PLA Basic',
    hex: '#0056B8',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10601',
    name: 'Blue',
    series: 'PLA Basic',
    hex: '#0A2989',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10602',
    name: 'Blue Grey',
    series: 'PLA Basic',
    hex: '#5B6579',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10700',
    name: 'Purple',
    series: 'PLA Basic',
    hex: '#5E43B7',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10701',
    name: 'Indigo Purple',
    series: 'PLA Basic',
    hex: '#482960',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '11700',
    name: 'Lilac Purple',
    series: 'PLA Matte',
    hex: '#AE96D4',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11701',
    name: 'Dark Purple',
    series: 'PLA Matte',
    hex: '#6E3F74',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '13700',
    name: 'Silk Purple',
    series: 'PLA Silk',
    hex: '#7F3FBF',
    filamentId: 'GFA02',
    settingsId: 'Bambu PLA Silk @BBL X1C',
  },
  {
    code: '13701',
    name: 'Violet Purple',
    series: 'PLA Silk',
    hex: '#9B4F96',
    filamentId: 'GFA02',
    settingsId: 'Bambu PLA Silk @BBL X1C',
  },
  {
    code: '11702',
    name: 'Soft Lavender',
    series: 'PLA Matte',
    hex: '#C9B6E4',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '10201',
    name: 'Beige',
    series: 'PLA Basic',
    hex: '#F7E6DE',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10800',
    name: 'Brown',
    series: 'PLA Basic',
    hex: '#9D432C',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10802',
    name: 'Cocoa Brown',
    series: 'PLA Basic',
    hex: '#6F5034',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    code: '10801',
    name: 'Bronze',
    series: 'PLA Basic',
    hex: '#847D48',
    filamentId: 'GFA00',
    settingsId: 'Bambu PLA Basic @BBL X1C',
  },

  // Bambu PLA Matte (GFA01)
  {
    code: '11100',
    name: 'Ivory White',
    series: 'PLA Matte',
    hex: '#F8F7F2',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11101',
    name: 'Charcoal',
    series: 'PLA Matte',
    hex: '#1D1E20',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11102',
    name: 'Ash Gray',
    series: 'PLA Matte',
    hex: '#9B9EA0',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11103',
    name: 'Nardo Gray',
    series: 'PLA Matte',
    hex: '#757575',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11200',
    name: 'Scarlet Red',
    series: 'PLA Matte',
    hex: '#DE4343',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11202',
    name: 'Dark Red',
    series: 'PLA Matte',
    hex: '#BB3D43',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11203',
    name: 'Terracotta',
    series: 'PLA Matte',
    hex: '#B15533',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11201',
    name: 'Sakura Pink',
    series: 'PLA Matte',
    hex: '#E8AFCF',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11300',
    name: 'Mandarin Orange',
    series: 'PLA Matte',
    hex: '#F99963',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11400',
    name: 'Lemon Yellow',
    series: 'PLA Matte',
    hex: '#F7D959',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11401',
    name: 'Desert Tan',
    series: 'PLA Matte',
    hex: '#E8DBB7',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11500',
    name: 'Grass Green',
    series: 'PLA Matte',
    hex: '#61C680',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11501',
    name: 'Dark Green',
    series: 'PLA Matte',
    hex: '#68724D',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11601',
    name: 'Ice Blue',
    series: 'PLA Matte',
    hex: '#A3D8E1',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11600',
    name: 'Marine Blue',
    series: 'PLA Matte',
    hex: '#0078BF',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11602',
    name: 'Dark Blue',
    series: 'PLA Matte',
    hex: '#042F56',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11800',
    name: 'Latte Brown',
    series: 'PLA Matte',
    hex: '#D3B7A7',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
  {
    code: '11801',
    name: 'Dark Brown',
    series: 'PLA Matte',
    hex: '#7D6556',
    filamentId: 'GFA01',
    settingsId: 'Bambu PLA Matte @BBL X1C',
  },
];

interface LabColor {
  L: number;
  a: number;
  b: number;
}

function rgbToLab({ r, g, b }: RGB): LabColor {
  const toLinear = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  // sRGB to XYZ (D65)
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl) / 1.0;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883;

  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * Perceptual CIELAB colour distance with hue-angle preservation so purple/violet shades
 * (negative b*, positive a*) never cross-match to red, terracotta, or orange (positive b*).
 */
export function perceptualColorDistance(c1: RGB, c2: RGB): number {
  const lab1 = rgbToLab(c1);
  const lab2 = rgbToLab(c2);

  const dL = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;

  const chroma1 = Math.hypot(lab1.a, lab1.b);
  const chroma2 = Math.hypot(lab2.a, lab2.b);

  let huePenalty = 0;
  if (chroma1 > 10 && chroma2 > 10) {
    const cosHue = (lab1.a * lab2.a + lab1.b * lab2.b) / (chroma1 * chroma2);
    // Penalize cross-quadrant hue shifts (e.g. purple b* < 0 vs red/orange b* > 0)
    const clampedCos = Math.max(-1, Math.min(1, cosHue));
    huePenalty = (1 - clampedCos) * Math.min(chroma1, chroma2) * 0.85;
  }

  return Math.sqrt(dL * dL * 0.85 + da * da + db * db * 1.25 + huePenalty * huePenalty) * 3.5;
}

export interface BambuFilamentMatch {
  preset: BambuFilamentPreset;
  distance: number;
  similarityPercent: number;
}

/**
 * Finds the closest official Bambu Lab filament preset to any target hex colour.
 */
export function findClosestBambuFilament(targetHex: string): BambuFilamentMatch {
  const targetRgb = hexToRgb(targetHex);
  let bestPreset = OFFICIAL_BAMBU_FILAMENTS[0];
  let bestDist = Infinity;

  for (const preset of OFFICIAL_BAMBU_FILAMENTS) {
    const presetRgb = hexToRgb(preset.hex);
    const dist = perceptualColorDistance(targetRgb, presetRgb);
    if (dist < bestDist) {
      bestDist = dist;
      bestPreset = preset;
    }
  }

  const similarityPercent = Math.max(0, Math.min(100, Math.round((1 - bestDist / 500) * 100)));

  return {
    preset: bestPreset,
    distance: bestDist,
    similarityPercent,
  };
}
