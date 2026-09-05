/**
 * Composites one plate per scene: the scene's location backdrop with the
 * scene's characters standing in it.
 *
 * Producing plates per scene rather than per character is what gives the video
 * visual continuity - the same people, drawn from the same identity attributes,
 * appear together in the right place, and the foreground furniture occludes
 * them correctly because it is drawn last.
 */
import { backdrop } from './backdrops.mjs';
import { figure } from '../cast/figures.mjs';

const WIDTH = 1536;
const HEIGHT = 1024;

/**
 * Where to place 1-4 figures so they read as a group without overlapping.
 * Feet sit below the frame so every plate is a medium shot: heads land in the
 * upper third where the eye goes, and the foreground furniture crops the body.
 */
const FEET_Y = 1190;
const ARRANGEMENTS = {
  1: [{ x: 452, scale: 1.42, facing: 1 }],
  2: [{ x: 372, scale: 1.40, facing: 1 }, { x: 856, scale: 1.34, facing: -1 }],
  3: [{ x: 300, scale: 1.30, facing: 1 }, { x: 660, scale: 1.36, facing: 1 }, { x: 1030, scale: 1.26, facing: -1 }],
  4: [{ x: 250, scale: 1.20, facing: 1 }, { x: 546, scale: 1.26, facing: 1 }, { x: 842, scale: 1.24, facing: -1 }, { x: 1140, scale: 1.16, facing: -1 }],
};

/**
 * @param {object} options
 * @param {{name: string, kind: string}} options.location
 * @param {object[]} options.characters render identities present in the scene
 * @param {object} options.palette style colours
 * @param {string} [options.accent] scene accent colour
 * @param {string|null} [options.speakingId] character given the light
 * @returns {string} an SVG document
 */
export function buildScenePlate({ location, characters, palette, accent, speakingId = null }) {
  const kind = location?.kind ?? 'generic';
  const tint = accent ?? palette.accent;
  const set = backdrop(kind, palette, tint);

  // Only people are drawn; a system participant has no body in the world.
  const people = characters.filter((c) => c.kind === 'person').slice(0, 4);
  const layout = ARRANGEMENTS[Math.max(1, people.length)] ?? ARRANGEMENTS[4];

  const figures = people.map((character, i) => {
    const spot = layout[i] ?? layout[layout.length - 1];
    return figure(character, {
      x: spot.x,
      feetY: FEET_Y,
      scale: spot.scale,
      facing: spot.facing,
      speaking: character.id === speakingId,
    });
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    ${set.defs}
    <radialGradient id="lift" cx="0.46" cy="0.4" r="0.72">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.07"/>
      <stop offset="55%" stop-color="#FFFFFF" stop-opacity="0.025"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${set.background}
  ${figures}
  ${set.foreground}
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#lift)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)"/>
</svg>`;
}

/**
 * A portrait plate for one character, used for avatars and cast lists.
 * Drawn from the same attributes as the scene figure, so the face matches.
 */
export function buildPortraitPlate({ character, palette, accent }) {
  const tint = accent ?? character.accent ?? palette.accent;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="pbg" cx="0.5" cy="0.35" r="0.75">
      <stop offset="0%" stop-color="${tint}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${palette.bgDeep}" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#pbg)"/>
  <g transform="translate(0 96) scale(1.5)">
    ${figure(character, { x: 170, groundY: 620, scale: 1, facing: 1, speaking: false })}
  </g>
</svg>`;
}
