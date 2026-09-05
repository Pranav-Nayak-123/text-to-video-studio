/**
 * Procedural location backdrops.
 *
 * One family per location kind the analyser can detect. Each returns SVG markup
 * for a 1536x1024 plate: architecture, light and foreground furniture, drawn
 * with soft gradients and blur so it reads as a shallow-focus photographic set
 * rather than a flat illustration.
 *
 * Characters are composited on top by engine/world/scene-plate.mjs, between the
 * background and the foreground layer, so furniture correctly occludes them.
 */

/** Every backdrop family the analyser can select. */
export const BACKDROP_KINDS = ['office', 'cafe', 'medical', 'classroom', 'retail', 'home', 'outdoor', 'generic'];

/**
 * @param {string} kind one of BACKDROP_KINDS
 * @param {object} palette style colours
 * @param {string} accent scene accent colour
 * @returns {{defs: string, background: string, foreground: string, groundY: number}}
 */
export function backdrop(kind, palette, accent) {
  const builder = BUILDERS[kind] ?? BUILDERS.generic;
  return builder(palette, accent);
}

/* ------------------------------------------------------------ shared parts -- */

/** Blend two hex colours, `amount` 0-1 towards `b`. */
function mix(a, b, amount) {
  const parse = (hex) => {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const c = (x, y) => Math.round(x + (y - x) * amount);
  return `#${((c(r1, r2) << 16) | (c(g1, g2) << 8) | c(b1, b2)).toString(16).padStart(6, '0')}`;
}

/**
 * The wall keeps the location's own colour identity - a clinic reads cool, a
 * café warm - while still being pulled towards the chosen style so the whole
 * film feels of a piece.
 */
const sharedDefs = (palette, accent, tint) => `
  <linearGradient id="wall" x1="0.05" y1="0" x2="0.95" y2="1">
    <stop offset="0%" stop-color="${mix(tint, palette.bgPanelAlt, 0.2)}"/>
    <stop offset="52%" stop-color="${mix(tint, palette.bgPanel, 0.55)}"/>
    <stop offset="100%" stop-color="${mix(tint, palette.bgDeep, 0.8)}"/>
  </linearGradient>
  <radialGradient id="keylight" cx="0.72" cy="0.16" r="0.84">
    <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.26"/>
    <stop offset="42%" stop-color="${accent}" stop-opacity="0.11"/>
    <stop offset="100%" stop-color="${palette.bgDeep}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${palette.surfaceAlt}"/>
    <stop offset="100%" stop-color="${palette.bgDeep}"/>
  </linearGradient>
  <linearGradient id="vignette" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${palette.bgDeep}" stop-opacity="0.30"/>
    <stop offset="36%" stop-color="${palette.bgDeep}" stop-opacity="0"/>
    <stop offset="100%" stop-color="${palette.bgDeep}" stop-opacity="0.22"/>
  </linearGradient>
  <filter id="deepblur" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="17"/></filter>
  <filter id="softblur" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="6"/></filter>`;

const bokeh = (accent, points) => `
  <g filter="url(#softblur)">
    ${points.map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${accent}" opacity="${o}"/>`).join('')}
  </g>`;

/* ---------------------------------------------------------------- families -- */

const BUILDERS = {
  /** Open-plan office: glass partitions, ceiling strips, a desk plane. */
  office: (p, accent) => ({
    groundY: 748,
    defs: sharedDefs(p, accent, '#0F1F36'),
    background: `
      <rect width="1536" height="1024" fill="url(#wall)"/>
      <rect width="1536" height="1024" fill="url(#keylight)"/>
      <g filter="url(#deepblur)" opacity="0.55">
        <rect x="128" y="-40" width="7" height="760" fill="#6E9AD4" opacity="0.26"/>
        <rect x="656" y="-40" width="7" height="760" fill="#6E9AD4" opacity="0.18"/>
        <rect x="1210" y="-40" width="7" height="760" fill="#6E9AD4" opacity="0.22"/>
        <rect x="150" y="150" width="480" height="380" rx="12" fill="#27507F" opacity="0.15"/>
        <rect x="684" y="120" width="500" height="410" rx="12" fill="#1F4270" opacity="0.13"/>
        <rect x="360" y="22" width="800" height="13" rx="6" fill="#A8CBF5" opacity="0.28"/>
      </g>
      ${bokeh(accent, [[1268, 176, 30, 0.10], [1352, 238, 19, 0.08], [212, 146, 22, 0.06]])}`,
    foreground: `
      <path d="M0 748 L1536 716 L1536 1024 L0 1024 Z" fill="url(#ground)"/>
      <path d="M0 748 L1536 716 L1536 730 L0 762 Z" fill="${accent}" opacity="0.24"/>
      <g filter="url(#deepblur)">
        <rect x="1146" y="676" width="150" height="66" rx="8" fill="${p.bgDeep}"/>
        <path d="M1188 600 L1258 600 L1272 690 L1174 690 Z" fill="${p.bgPanel}"/>
        <rect x="996" y="268" width="456" height="342" rx="16" fill="${p.bgDeep}"/>
        <rect x="1014" y="286" width="420" height="300" rx="10" fill="${accent}" opacity="0.34"/>
        <rect x="1046" y="324" width="188" height="18" rx="9" fill="${accent}" opacity="0.6"/>
        <rect x="1046" y="366" width="312" height="12" rx="6" fill="#AFD1FF" opacity="0.24"/>
        <rect x="1046" y="394" width="266" height="12" rx="6" fill="#AFD1FF" opacity="0.18"/>
      </g>
      <g filter="url(#softblur)" opacity="0.95">
        <path d="M556 786 L906 764 L944 826 L582 852 Z" fill="${p.surface}"/>
        <path d="M570 793 L895 772 L928 819 L594 844 Z" fill="${p.surfaceAlt}"/>
      </g>`,
  }),

  /** Café: service counter, warm pendant lights, bottle shelf. */
  cafe: (p, accent) => ({
    groundY: 726,
    defs: sharedDefs(p, accent, '#241812'),
    background: `
      <rect width="1536" height="1024" fill="url(#wall)"/>
      <rect width="1536" height="1024" fill="url(#keylight)"/>
      <g filter="url(#deepblur)" opacity="0.6">
        <rect x="120" y="150" width="520" height="330" rx="10" fill="#3A2A20" opacity="0.5"/>
        <rect x="140" y="196" width="480" height="12" rx="6" fill="#C9A278" opacity="0.32"/>
        <rect x="140" y="286" width="480" height="12" rx="6" fill="#C9A278" opacity="0.26"/>
        <rect x="140" y="376" width="480" height="12" rx="6" fill="#C9A278" opacity="0.2"/>
        ${[180, 260, 340, 420, 500].map((x) => `<rect x="${x}" y="150" width="26" height="44" rx="5" fill="#8C6A4A" opacity="0.5"/>`).join('')}
        <rect x="1180" y="140" width="300" height="360" rx="12" fill="#2E2018" opacity="0.4"/>
      </g>
      <g filter="url(#softblur)">
        ${[420, 700, 980].map((x) => `
          <line x1="${x}" y1="0" x2="${x}" y2="128" stroke="#6B5340" stroke-width="4" opacity="0.5"/>
          <path d="M${x - 42} 176 Q${x} 108 ${x + 42} 176 Z" fill="#F0C48A" opacity="0.34"/>
          <circle cx="${x}" cy="180" r="30" fill="#FFD9A0" opacity="0.30"/>`).join('')}
      </g>
      ${bokeh('#FFC98A', [[1300, 240, 34, 0.12], [1400, 320, 22, 0.09], [240, 120, 24, 0.08]])}`,
    foreground: `
      <path d="M0 726 L1536 700 L1536 1024 L0 1024 Z" fill="url(#ground)"/>
      <path d="M0 726 L1536 700 L1536 716 L0 742 Z" fill="#D9A566" opacity="0.4"/>
      <rect x="0" y="742" width="1536" height="26" fill="#1A120C" opacity="0.5"/>
      <g filter="url(#softblur)" opacity="0.95">
        <rect x="1040" y="600" width="150" height="130" rx="10" fill="#2A2018"/>
        <rect x="1058" y="622" width="114" height="70" rx="6" fill="#4A3626"/>
        <circle cx="1115" cy="596" r="16" fill="#3A2A1E"/>
        <path d="M240 660 h96 v66 a48 48 0 0 1 -96 0 Z" fill="#E8E2D8" opacity="0.85"/>
        <path d="M336 676 a26 26 0 0 1 0 40" stroke="#E8E2D8" stroke-width="9" fill="none" opacity="0.85"/>
        <ellipse cx="288" cy="660" rx="48" ry="12" fill="#FFFFFF" opacity="0.5"/>
      </g>`,
  }),

  /** Clinical room: curtain rail, monitor, bed rail in the foreground. */
  medical: (p, accent) => ({
    groundY: 760,
    defs: sharedDefs(p, accent, '#0E2029'),
    background: `
      <rect width="1536" height="1024" fill="url(#wall)"/>
      <rect width="1536" height="1024" fill="url(#keylight)"/>
      <g filter="url(#deepblur)" opacity="0.5">
        <rect x="0" y="0" width="1536" height="150" fill="#CFE6EE" opacity="0.06"/>
        <rect x="120" y="120" width="640" height="420" rx="8" fill="#20505E" opacity="0.2"/>
        ${Array.from({ length: 9 }, (_, i) => `<rect x="${140 + i * 68}" y="120" width="34" height="420" rx="6" fill="#8FC6D6" opacity="0.10"/>`).join('')}
        <rect x="1120" y="180" width="330" height="240" rx="12" fill="#0F2B33" opacity="0.7"/>
        <path d="M1150 320 l40 0 l18 -46 l24 78 l22 -110 l20 78 l16 0 l40 0" stroke="${accent}" stroke-width="4" fill="none" opacity="0.7"/>
      </g>
      ${bokeh('#9FE0EE', [[1300, 130, 26, 0.10], [180, 100, 20, 0.07]])}`,
    foreground: `
      <path d="M0 760 L1536 736 L1536 1024 L0 1024 Z" fill="url(#ground)"/>
      <path d="M0 760 L1536 736 L1536 748 L0 772 Z" fill="${accent}" opacity="0.2"/>
      <g filter="url(#softblur)" opacity="0.9">
        <rect x="120" y="806" width="720" height="26" rx="13" fill="#4E6B76"/>
        <rect x="150" y="832" width="14" height="120" rx="7" fill="#3A5058"/>
        <rect x="790" y="832" width="14" height="120" rx="7" fill="#3A5058"/>
        <rect x="120" y="854" width="720" height="86" rx="16" fill="#E8EFF1" opacity="0.9"/>
        <rect x="1150" y="700" width="120" height="60" rx="10" fill="#12303A"/>
      </g>`,
  }),

  /** Classroom: whiteboard, wall charts, desk row in the foreground. */
  classroom: (p, accent) => ({
    groundY: 754,
    defs: sharedDefs(p, accent, '#152238'),
    background: `
      <rect width="1536" height="1024" fill="url(#wall)"/>
      <rect width="1536" height="1024" fill="url(#keylight)"/>
      <g filter="url(#deepblur)" opacity="0.62">
        <rect x="180" y="120" width="760" height="400" rx="10" fill="#E9F0F5" opacity="0.14"/>
        <rect x="196" y="136" width="728" height="368" rx="6" fill="#12283A" opacity="0.55"/>
        <path d="M240 240 h240 M240 300 h380 M240 360 h300 M240 420 h180" stroke="#BFD8EA" stroke-width="9" opacity="0.26" stroke-linecap="round"/>
        <circle cx="760" cy="330" r="72" fill="none" stroke="${accent}" stroke-width="8" opacity="0.4"/>
        <path d="M700 400 l60 -110 l60 110 Z" fill="none" stroke="${accent}" stroke-width="7" opacity="0.32"/>
        <rect x="1040" y="150" width="300" height="200" rx="8" fill="#2A4A66" opacity="0.3"/>
        <rect x="1060" y="176" width="260" height="10" rx="5" fill="#BFD8EA" opacity="0.24"/>
        <rect x="1060" y="206" width="200" height="10" rx="5" fill="#BFD8EA" opacity="0.18"/>
      </g>
      ${bokeh(accent, [[1360, 200, 28, 0.10], [200, 140, 22, 0.07]])}`,
    foreground: `
      <path d="M0 754 L1536 728 L1536 1024 L0 1024 Z" fill="url(#ground)"/>
      <path d="M0 754 L1536 728 L1536 742 L0 768 Z" fill="${accent}" opacity="0.22"/>
      <g filter="url(#softblur)" opacity="0.92">
        <path d="M60 830 L620 806 L660 900 L84 930 Z" fill="#2A3A52"/>
        <path d="M80 838 L604 816 L636 888 L104 916 Z" fill="#3C5171"/>
        <path d="M900 812 L1440 792 L1476 878 L928 902 Z" fill="#2A3A52"/>
        <path d="M918 820 L1424 801 L1452 868 L944 890 Z" fill="#3C5171"/>
        <rect x="1010" y="770" width="120" height="26" rx="5" fill="#E9F0F5" opacity="0.55"/>
      </g>`,
  }),

  /** Retail floor: shelving, signage band, counter. */
  retail: (p, accent) => ({
    groundY: 742,
    defs: sharedDefs(p, accent, '#141B2E'),
    background: `
      <rect width="1536" height="1024" fill="url(#wall)"/>
      <rect width="1536" height="1024" fill="url(#keylight)"/>
      <g filter="url(#deepblur)" opacity="0.55">
        <rect x="0" y="60" width="1536" height="54" fill="${accent}" opacity="0.16"/>
        ${[120, 470, 820, 1170].map((x) => `
          <rect x="${x}" y="180" width="270" height="380" rx="8" fill="#22304E" opacity="0.4"/>
          ${[220, 300, 380, 460].map((y) => `<rect x="${x + 16}" y="${y}" width="238" height="14" rx="6" fill="#8FB4E0" opacity="0.2"/>`).join('')}
          ${[236, 316, 396].map((y) => `<rect x="${x + 30}" y="${y - 44}" width="42" height="42" rx="5" fill="${accent}" opacity="0.26"/>`).join('')}`).join('')}
      </g>
      ${bokeh(accent, [[1330, 150, 30, 0.10], [260, 120, 22, 0.07]])}`,
    foreground: `
      <path d="M0 742 L1536 716 L1536 1024 L0 1024 Z" fill="url(#ground)"/>
      <path d="M0 742 L1536 716 L1536 730 L0 756 Z" fill="${accent}" opacity="0.24"/>
      <g filter="url(#softblur)" opacity="0.94">
        <path d="M760 800 L1420 776 L1460 900 L790 930 Z" fill="#243350"/>
        <path d="M782 810 L1404 788 L1436 886 L810 914 Z" fill="#33456A"/>
        <rect x="1120" y="732" width="130" height="70" rx="8" fill="#1A2439"/>
      </g>`,
  }),

  /** Living space: window, sofa back, lamp, warm ground. */
  home: (p, accent) => ({
    groundY: 764,
    defs: sharedDefs(p, accent, '#20191C'),
    background: `
      <rect width="1536" height="1024" fill="url(#wall)"/>
      <rect width="1536" height="1024" fill="url(#keylight)"/>
      <g filter="url(#deepblur)" opacity="0.6">
        <rect x="880" y="110" width="500" height="420" rx="10" fill="#5C7FA8" opacity="0.22"/>
        <rect x="1120" y="110" width="12" height="420" fill="#26313F" opacity="0.6"/>
        <rect x="880" y="310" width="500" height="12" fill="#26313F" opacity="0.6"/>
        <rect x="180" y="200" width="300" height="220" rx="8" fill="#3A2C2A" opacity="0.45"/>
        <rect x="204" y="226" width="252" height="168" rx="4" fill="#6E5348" opacity="0.35"/>
      </g>
      <g filter="url(#softblur)">
        <path d="M600 220 l120 0 l34 96 l-188 0 Z" fill="#F3D5A6" opacity="0.28"/>
        <circle cx="660" cy="330" r="46" fill="#FFDFAE" opacity="0.22"/>
      </g>
      ${bokeh('#FFD9A0', [[1180, 200, 32, 0.10], [300, 160, 24, 0.07]])}`,
    foreground: `
      <path d="M0 764 L1536 740 L1536 1024 L0 1024 Z" fill="url(#ground)"/>
      <path d="M0 764 L1536 740 L1536 754 L0 778 Z" fill="#C9926A" opacity="0.3"/>
      <g filter="url(#softblur)" opacity="0.95">
        <path d="M120 860 q40 -80 140 -80 h540 q100 0 140 80 l24 164 l-868 0 Z" fill="#3B2F31"/>
        <path d="M180 880 q30 -46 110 -46 h480 q80 0 110 46" stroke="#5A4749" stroke-width="14" fill="none"/>
      </g>`,
  }),

  /** Exterior: sky gradient, skyline, pavement. */
  outdoor: (p, accent) => ({
    groundY: 790,
    defs: `${sharedDefs(p, accent, '#16233A')}
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2C4E7A"/>
        <stop offset="55%" stop-color="#1B3357"/>
        <stop offset="100%" stop-color="${p.bgPanel}"/>
      </linearGradient>`,
    background: `
      <rect width="1536" height="1024" fill="url(#sky)"/>
      <rect width="1536" height="1024" fill="url(#keylight)"/>
      <g filter="url(#deepblur)" opacity="0.7">
        ${[[60, 300], [220, 200], [360, 380], [520, 260], [700, 340], [880, 190], [1050, 300], [1240, 240], [1400, 350]]
          .map(([x, h]) => `<rect x="${x}" y="${790 - h}" width="120" height="${h}" fill="#101E33" opacity="0.85"/>`).join('')}
        ${[[92, 560], [252, 470], [392, 640], [552, 520], [732, 600], [912, 460], [1082, 560], [1272, 500]]
          .map(([x, y]) => `<rect x="${x}" y="${y}" width="16" height="20" fill="#FFD9A0" opacity="0.35"/>`).join('')}
      </g>
      ${bokeh('#FFD9A0', [[1320, 180, 30, 0.10], [180, 150, 22, 0.08], [760, 120, 18, 0.06]])}`,
    foreground: `
      <path d="M0 790 L1536 768 L1536 1024 L0 1024 Z" fill="url(#ground)"/>
      <path d="M0 790 L1536 768 L1536 782 L0 804 Z" fill="${accent}" opacity="0.2"/>
      <g filter="url(#softblur)" opacity="0.5">
        <path d="M0 880 L1536 856" stroke="#7C8B9E" stroke-width="4" opacity="0.35"/>
        <path d="M0 950 L1536 924" stroke="#7C8B9E" stroke-width="3" opacity="0.22"/>
      </g>`,
  }),

  /** Neutral stage used when no location can be identified. */
  generic: (p, accent) => ({
    groundY: 752,
    defs: sharedDefs(p, accent, '#131A2A'),
    background: `
      <rect width="1536" height="1024" fill="url(#wall)"/>
      <rect width="1536" height="1024" fill="url(#keylight)"/>
      <g filter="url(#deepblur)" opacity="0.4">
        <circle cx="1120" cy="330" r="260" fill="${accent}" opacity="0.12"/>
        <circle cx="360" cy="280" r="200" fill="${accent}" opacity="0.07"/>
      </g>
      ${bokeh(accent, [[1300, 200, 30, 0.09], [240, 160, 22, 0.06]])}`,
    foreground: `
      <path d="M0 752 L1536 728 L1536 1024 L0 1024 Z" fill="url(#ground)"/>
      <path d="M0 752 L1536 728 L1536 742 L0 766 Z" fill="${accent}" opacity="0.22"/>`,
  }),
};
