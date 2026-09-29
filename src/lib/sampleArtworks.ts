export interface SampleArtwork {
  id: string;
  title: string;
  subtitle: string;
  recommendedSlots: string[];
  renderToCanvas: (canvas: HTMLCanvasElement) => void;
}

export const SAMPLE_ARTWORKS: SampleArtwork[] = [
  {
    id: 'kitsune_emblem',
    title: 'Kitsune Mask Emblem',
    subtitle: 'Shaded crimson & gold fox crest with clean silhouette outline',
    recommendedSlots: ['#141821', '#E12D39', '#F59E0B', '#F8FAFC'],
    renderToCanvas: (canvas: HTMLCanvasElement) => {
      const size = 440;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      // Removable light neutral background
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(0, 0, size, size);

      ctx.save();
      ctx.translate(size / 2, size / 2 + 12);

      // Helper for symmetric drawing
      const drawSymmetricPolygon = (pts: [number, number][], fill: string | CanvasGradient) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        pts.forEach(([x, y], idx) => (idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        for (let i = pts.length - 1; i >= 0; i--) {
          ctx.lineTo(-pts[i][0], pts[i][1]);
        }
        ctx.closePath();
        ctx.fill();
      };

      // 1. Outer Dark Obsidian Silhouette (Fox Head + Ears + Cheek Tufts)
      drawSymmetricPolygon(
        [
          [0, -135],
          [38, -128],
          [115, -195],
          [148, -180],
          [136, -65],
          [175, -18],
          [150, 22],
          [168, 46],
          [112, 92],
          [38, 168],
          [0, 182],
        ],
        '#141821'
      );

      // 2. Inner Ivory Face Shield (with slight gradient to demonstrate gradient flattening!)
      const ivoryGrad = ctx.createLinearGradient(0, -120, 0, 160);
      ivoryGrad.addColorStop(0, '#FFFFFF');
      ivoryGrad.addColorStop(1, '#F1F5F9');
      drawSymmetricPolygon(
        [
          [0, -112],
          [34, -104],
          [106, -166],
          [124, -156],
          [114, -62],
          [146, -20],
          [124, 15],
          [138, 36],
          [92, 76],
          [26, 144],
          [0, 156],
        ],
        ivoryGrad
      );

      // 3. Crimson Flame Markings (Ears, Cheek Stripes, Forehead Diamond) with gradient shading
      const redGrad = ctx.createLinearGradient(0, -160, 0, 130);
      redGrad.addColorStop(0, '#EF4444');
      redGrad.addColorStop(1, '#B91C1C');

      // Ear interiors
      for (const sign of [-1, 1]) {
        ctx.fillStyle = redGrad;
        ctx.beginPath();
        ctx.moveTo(sign * 46, -104);
        ctx.lineTo(sign * 102, -152);
        ctx.lineTo(sign * 114, -142);
        ctx.lineTo(sign * 98, -72);
        ctx.closePath();
        ctx.fill();

        // Cheek markings
        ctx.beginPath();
        ctx.moveTo(sign * 134, -18);
        ctx.lineTo(sign * 68, 12);
        ctx.lineTo(sign * 78, 34);
        ctx.lineTo(sign * 124, 22);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(sign * 116, 42);
        ctx.lineTo(sign * 56, 62);
        ctx.lineTo(sign * 64, 82);
        ctx.lineTo(sign * 98, 70);
        ctx.closePath();
        ctx.fill();
      }

      // Forehead Flame Crest
      drawSymmetricPolygon(
        [
          [0, -98],
          [26, -68],
          [16, -24],
          [0, -8],
        ],
        redGrad
      );

      // 4. Amber Gold Eyes, Brow & Sun Disc
      const goldGrad = ctx.createLinearGradient(-80, -80, 80, 80);
      goldGrad.addColorStop(0, '#FBBF24');
      goldGrad.addColorStop(1, '#D97706');

      // Center forehead sun orb
      ctx.fillStyle = goldGrad;
      ctx.beginPath();
      ctx.arc(0, -58, 13, 0, Math.PI * 2);
      ctx.fill();

      // Fierce geometric eyes with dark border
      for (const sign of [-1, 1]) {
        ctx.fillStyle = '#141821';
        ctx.beginPath();
        ctx.moveTo(sign * 24, -12);
        ctx.lineTo(sign * 76, -42);
        ctx.lineTo(sign * 96, -24);
        ctx.lineTo(sign * 54, 4);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = goldGrad;
        ctx.beginPath();
        ctx.moveTo(sign * 32, -14);
        ctx.lineTo(sign * 72, -36);
        ctx.lineTo(sign * 86, -24);
        ctx.lineTo(sign * 52, -2);
        ctx.closePath();
        ctx.fill();
      }

      // Dark nose tip
      drawSymmetricPolygon(
        [
          [0, 96],
          [26, 102],
          [18, 128],
          [0, 138],
        ],
        '#141821'
      );

      ctx.restore();
    },
  },
  {
    id: 'alpine_badge',
    title: 'Alpine Summit Patch',
    subtitle: '4-colour hexagonal outdoor emblem with sunset gradient & peaks',
    recommendedSlots: ['#0F172A', '#EA580C', '#FACC15', '#F8FAFC'],
    renderToCanvas: (canvas: HTMLCanvasElement) => {
      const size = 440;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      // Transparent / white exterior background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;

      const drawHex = (radius: number, fill: string | CanvasGradient) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      };

      // 1. Outer Dark Navy Hex Frame
      drawHex(192, '#0F172A');

      // 2. Inner Warm Terracotta Sky
      const skyGrad = ctx.createLinearGradient(0, cy - 160, 0, cy + 120);
      skyGrad.addColorStop(0, '#EA580C');
      skyGrad.addColorStop(1, '#C2410C');
      drawHex(166, skyGrad);

      // 3. Golden Sun Orb
      const sunGrad = ctx.createRadialGradient(cx, cy - 35, 10, cx, cy - 35, 95);
      sunGrad.addColorStop(0, '#FEF08A');
      sunGrad.addColorStop(1, '#EAB308');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(cx, cy - 32, 82, 0, Math.PI * 2);
      ctx.fill();

      // 4. Mountain Range Base (Dark Navy)
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.moveTo(cx - 150, cy + 78);
      ctx.lineTo(cx - 72, cy - 42);
      ctx.lineTo(cx - 18, cy + 16);
      ctx.lineTo(cx + 42, cy - 68);
      ctx.lineTo(cx + 150, cy + 78);
      ctx.lineTo(cx, cy + 168);
      ctx.closePath();
      ctx.fill();

      // 5. Crisp Snow Caps (Pure White)
      ctx.fillStyle = '#F8FAFC';
      // Main right peak snow cap
      ctx.beginPath();
      ctx.moveTo(cx + 42, cy - 68);
      ctx.lineTo(cx + 88, cy + 4);
      ctx.lineTo(cx + 58, cy - 6);
      ctx.lineTo(cx + 42, cy + 14);
      ctx.lineTo(cx + 16, cy - 12);
      ctx.closePath();
      ctx.fill();

      // Left peak snow cap
      ctx.beginPath();
      ctx.moveTo(cx - 72, cy - 42);
      ctx.lineTo(cx - 34, cy + 8);
      ctx.lineTo(cx - 58, cy + 2);
      ctx.lineTo(cx - 76, cy + 18);
      ctx.lineTo(cx - 98, cy - 2);
      ctx.closePath();
      ctx.fill();

      // Foreground Golden Trail Ribbon
      ctx.fillStyle = '#EAB308';
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy + 56);
      ctx.lineTo(cx + 22, cy + 56);
      ctx.lineTo(cx + 48, cy + 142);
      ctx.lineTo(cx - 38, cy + 142);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: 'cyber_bot',
    title: 'Mecha Core Insignia',
    subtitle: 'Geometric sci-fi emblem with internal cutouts & 4-colour visor',
    recommendedSlots: ['#1E293B', '#06B6D4', '#F97316', '#F8FAFC'],
    renderToCanvas: (canvas: HTMLCanvasElement) => {
      const size = 440;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      // Clean background
      ctx.fillStyle = '#DCE4EE';
      ctx.fillRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;

      // 1. Outer Dark Slate Mecha Helmet Silhouette
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.roundRect(cx - 145, cy - 135, 290, 260, 48);
      ctx.fill();

      // Side antenna wings
      ctx.beginPath();
      ctx.roundRect(cx - 182, cy - 55, 45, 110, 18);
      ctx.roundRect(cx + 137, cy - 55, 45, 110, 18);
      ctx.fill();

      // Top crest
      ctx.beginPath();
      ctx.roundRect(cx - 42, cy - 172, 84, 52, 16);
      ctx.fill();

      // 2. White Ceramic Faceplate
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.roundRect(cx - 118, cy - 106, 236, 202, 32);
      ctx.fill();

      // 3. Dark Visor Cavity
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.roundRect(cx - 94, cy - 68, 188, 86, 22);
      ctx.fill();

      // 4. Glowing Cyan Optics & Core
      const cyanGrad = ctx.createLinearGradient(cx - 80, cy - 50, cx + 80, cy + 20);
      cyanGrad.addColorStop(0, '#22D3EE');
      cyanGrad.addColorStop(1, '#0891B2');
      ctx.fillStyle = cyanGrad;
      ctx.beginPath();
      ctx.arc(cx - 44, cy - 25, 24, 0, Math.PI * 2);
      ctx.arc(cx + 44, cy - 25, 24, 0, Math.PI * 2);
      ctx.fill();

      // 5. Coral Orange Chest / Chin Accents & Crest Light
      ctx.fillStyle = '#F97316';
      ctx.beginPath();
      ctx.roundRect(cx - 22, cy - 156, 44, 28, 8);
      ctx.roundRect(cx - 56, cy + 44, 112, 26, 10);
      ctx.roundRect(cx - 168, cy - 32, 18, 64, 6);
      ctx.roundRect(cx + 150, cy - 32, 18, 64, 6);
      ctx.fill();
    },
  },
  {
    id: 'monstera_leaf',
    title: 'Botanical Monstera',
    subtitle: 'Organic curved leaf with multi-tone green shading & cutout holes',
    recommendedSlots: ['#064E3B', '#10B981', '#A3E635', '#FEF3C7'],
    renderToCanvas: (canvas: HTMLCanvasElement) => {
      const size = 440;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bgColor = '#FFFFFF';
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;

      // 1. Deep Forest Green Leaf Silhouette
      ctx.fillStyle = '#064E3B';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 6, 156, 178, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Emerald Mid-Layer Leaf Body
      ctx.fillStyle = '#10B981';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 6, 134, 154, 0, 0, Math.PI * 2);
      ctx.fill();

      // 3. Lime Inner Highlights
      ctx.fillStyle = '#84CC16';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 12, 86, 108, 0, 0, Math.PI * 2);
      ctx.fill();

      // 4. Warm Cream Central Stem & Veins
      ctx.fillStyle = '#FEF3C7';
      ctx.beginPath();
      ctx.roundRect(cx - 11, cy - 125, 22, 280, 11);
      ctx.fill();

      for (const yOff of [-65, 0, 65]) {
        ctx.save();
        ctx.translate(cx, cy + yOff);
        ctx.rotate(-0.35);
        ctx.beginPath();
        ctx.roundRect(0, -8, 95, 16, 8);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.translate(cx, cy + yOff);
        ctx.rotate(Math.PI + 0.35);
        ctx.beginPath();
        ctx.roundRect(0, -8, 95, 16, 8);
        ctx.fill();
        ctx.restore();
      }

      // 5. Cutout Monstera Fenestrations (Background colour so global/hole cutout demonstrates internal holes)
      ctx.fillStyle = bgColor;
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + sign * 125, cy - 35, 48, 18, sign * -0.25, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(cx + sign * 128, cy + 35, 52, 18, sign * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
];
