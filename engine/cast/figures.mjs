/**
 * Procedural character figures.
 *
 * A figure is drawn entirely from a character's identity attributes (garment
 * palette, hair, skin, build, hair style), so the same character renders
 * identically in every scene they appear in. Nothing here is story-specific.
 *
 * Design notes:
 *  - Proportions are adult: a head roughly one seventh of standing height, and
 *    shoulders wider than hips. Large heads are what make figures read as
 *    cartoons.
 *  - Facial detail is deliberately minimal and low contrast - a suggestion of
 *    eyes and a neutral mouth. At the scale these appear, behind a scrim and
 *    under a text panel, that reads as stylised editorial illustration rather
 *    than an uncanny face.
 *  - The figure is authored feet-down from a 0,0 origin at the head top, then
 *    placed so the scene's foreground furniture crops it naturally.
 */

/** Authoring height of one figure, from crown to sole. */
export const FIGURE_HEIGHT = 640;

/**
 * @param {object} character a render identity from engine/cast/identity.mjs
 * @param {object} options
 * @param {number} options.x horizontal centre in plate coordinates
 * @param {number} options.feetY y where the figure's feet sit
 * @param {number} [options.scale]
 * @param {boolean} [options.speaking] give the active speaker more presence
 * @param {number} [options.facing] -1 faces left, 1 faces right
 * @returns {string} SVG markup
 */
export function figure(character, { x, feetY, scale = 1, speaking = false, facing = 1 }) {
  const a = character.appearance ?? {};
  const garment = a.garment ?? { base: '#24466F', dark: '#14273F', light: '#3E72B4' };
  const skin = a.skin ?? '#D2A077';
  const hair = a.hair ?? '#2E2119';
  const long = a.hairStyle === 'long';
  const id = character.id.replace(/[^a-z0-9]/gi, '') || 'c';
  const accent = character.accent ?? '#3E8BFF';

  const build = a.build === 'slim' ? 0.94 : a.build === 'slight' ? 0.9 : 1;
  const s = scale * build;
  const top = feetY - FIGURE_HEIGHT * s;

  const featureInk = darken(skin, 96);

  return `
  <g transform="translate(${x} ${top}) scale(${s * facing} ${s})">
    <defs>
      <linearGradient id="g-${id}" x1="0.05" y1="0.05" x2="0.95" y2="0.7">
        <stop offset="0%" stop-color="${garment.dark}"/>
        <stop offset="50%" stop-color="${garment.base}"/>
        <stop offset="100%" stop-color="${garment.light}"/>
      </linearGradient>
      <linearGradient id="h-${id}" x1="0.1" y1="0.05" x2="0.9" y2="0.9">
        <stop offset="0%" stop-color="${hair}"/>
        <stop offset="68%" stop-color="${hair}"/>
        <stop offset="100%" stop-color="${lighten(hair, 42)}"/>
      </linearGradient>
      <linearGradient id="s-${id}" x1="0" y1="0" x2="1" y2="0.5">
        <stop offset="0%" stop-color="${darken(skin, 34)}"/>
        <stop offset="65%" stop-color="${skin}"/>
        <stop offset="100%" stop-color="${lighten(skin, 18)}"/>
      </linearGradient>
      <linearGradient id="rim-${id}" x1="0.3" y1="0" x2="1" y2="0.35">
        <stop offset="0%" stop-color="${garment.light}" stop-opacity="0"/>
        <stop offset="62%" stop-color="${garment.light}" stop-opacity="0.42"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0.45"/>
      </linearGradient>
    </defs>

    ${speaking ? `
      <radialGradient id="glow-${id}" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.16"/>
        <stop offset="60%" stop-color="${accent}" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
      <ellipse cx="0" cy="300" rx="230" ry="330" fill="url(#glow-${id})"/>` : ''}

    <!-- legs -->
    <path d="M-58 404 L-66 640 L-16 640 L-8 406 Z" fill="${darken(garment.dark, 14)}"/>
    <path d="M58 404 L66 640 L16 640 L8 406 Z" fill="${darken(garment.dark, 4)}"/>

    <!-- arms, hanging close to the body -->
    <path d="M-86 214 C-112 244 -120 324 -114 392 C-112 408 -92 410 -90 394 C-86 332 -78 272 -62 244 Z"
          fill="${darken(garment.base, 22)}"/>
    <path d="M86 214 C112 244 120 324 114 392 C112 408 92 410 90 394 C86 332 78 272 62 244 Z"
          fill="${lighten(garment.base, 14)}"/>
    <ellipse cx="-102" cy="404" rx="15" ry="18" fill="${darken(skin, 18)}"/>
    <ellipse cx="102" cy="404" rx="15" ry="18" fill="${skin}"/>

    <!-- torso: shoulders wider than hips -->
    <path d="M-94 228 C-88 198 -46 180 0 180 C46 180 88 198 94 228 L84 412 L-84 412 Z" fill="url(#g-${id})"/>
    <path d="M94 228 C88 198 46 180 0 180 C34 196 66 210 74 236 L70 412 L84 412 Z" fill="url(#rim-${id})"/>

    <!-- collar and neck -->
    <path d="M-30 188 C-16 214 16 214 30 188 C16 178 -16 178 -30 188 Z" fill="${lighten(garment.light, 72)}" opacity="0.62"/>
    <path d="M-22 146 L22 146 L22 188 C22 200 -22 200 -22 188 Z" fill="${darken(skin, 22)}"/>

    <!-- head -->
    <ellipse cx="0" cy="92" rx="56" ry="68" fill="url(#s-${id})"/>
    <!-- ear -->
    <ellipse cx="${52}" cy="98" rx="9" ry="14" fill="${darken(skin, 12)}"/>

    ${long
      ? `<path d="M-58 88 C-64 38 -34 8 0 8 C34 8 64 38 58 88 C54 50 30 32 0 32 C-30 32 -54 50 -58 88 Z" fill="url(#h-${id})"/>
         <path d="M-60 80 C-74 148 -68 198 -52 218 L-28 212 C-44 180 -50 132 -46 84 Z" fill="url(#h-${id})"/>
         <path d="M60 80 C74 148 68 198 52 218 L28 212 C44 180 50 132 46 84 Z" fill="url(#h-${id})"/>`
      : `<path d="M-58 92 C-63 40 -34 12 0 12 C34 12 63 40 58 92 C52 54 28 36 0 36 C-28 36 -52 54 -58 92 Z" fill="url(#h-${id})"/>`}

    <!-- key light along the hair -->
    <path d="M16 18 C44 30 58 56 60 92 C66 54 47 20 20 11 Z" fill="${lighten(hair, 58)}" opacity="0.6"/>

    <!-- minimal features -->
    <g opacity="0.42">
      <ellipse cx="-19" cy="94" rx="5" ry="3.2" fill="${featureInk}"/>
      <ellipse cx="19" cy="94" rx="5" ry="3.2" fill="${featureInk}"/>
      <path d="M-9 124 L9 124" stroke="${featureInk}" stroke-width="3" stroke-linecap="round"/>
    </g>
    ${speaking
      ? `<ellipse cx="0" cy="125" rx="9" ry="6" fill="${featureInk}" opacity="0.34"/>`
      : ''}
  </g>`;
}

/* ------------------------------------------------------------ colour utils -- */

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function parse(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]) {
  return `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, '0')}`;
}

export function lighten(hex, amount) {
  return toHex(parse(hex).map((c) => c + amount));
}

export function darken(hex, amount) {
  return toHex(parse(hex).map((c) => c - amount));
}
