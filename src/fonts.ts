import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

/**
 * Registers the self-hosted variable typefaces.
 *
 * The files are downloaded once by scripts/generate-fonts.mjs, so a render
 * makes no network requests for text and produces identical glyphs on every
 * machine. loadFont registers a delayRender handle internally, which means
 * Remotion will not capture a frame until the faces are ready.
 */
export const fontsReady = Promise.all([
  loadFont({
    family: 'Inter',
    url: staticFile('fonts/inter-variable.woff2'),
    weight: '100 900',
    format: 'woff2',
  }),
  loadFont({
    family: 'JetBrains Mono',
    url: staticFile('fonts/jetbrains-mono-variable.woff2'),
    weight: '100 800',
    format: 'woff2',
  }),
]).catch((err) => {
  // Never fail the render over a font: the stacks in theme.ts fall back to
  // system UI and monospace faces.
  // eslint-disable-next-line no-console
  console.warn('[fonts] falling back to system typefaces:', err?.message ?? err);
});
