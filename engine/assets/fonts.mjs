#!/usr/bin/env node
/**
 * Downloads the two typefaces the video uses into public/fonts.
 *
 * Self-hosting matters here: pulling webfonts at render time made several
 * hundred network requests per render and made every render depend on Google
 * Fonts being reachable. Fetched once, the render is fully offline and the
 * glyphs are identical on every machine.
 *
 * Variable font files are requested, so every weight the composition uses
 * (400 through 800, including the in-between values) renders exactly rather
 * than being synthesised by the browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDir } from '../io/paths.mjs';
import { log, reportError, PipelineError } from '../io/log.mjs';

const FONTS_DIR = path.join(PATHS.public, 'fonts');

// A modern browser UA is required or the API replies with legacy TTF sources.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const FAMILIES = [
  { family: 'Inter', css: 'Inter:wght@100..900', slug: 'inter' },
  { family: 'JetBrains Mono', css: 'JetBrains+Mono:wght@100..800', slug: 'jetbrains-mono' },
];

async function fetchCss(spec) {
  const url = `https://fonts.googleapis.com/css2?family=${spec}&display=block`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

/** Pull the latin @font-face block out of a Google Fonts css2 response. */
function extractLatinFace(css) {
  const blocks = css.split('@font-face').slice(1).map((b) => `@font-face${b.split('}')[0]}}`);
  // css2 emits a comment naming each subset immediately before its block.
  const withSubset = css.split('/*').slice(1);
  for (const chunk of withSubset) {
    const name = chunk.split('*/')[0].trim();
    if (name === 'latin') {
      const face = chunk.slice(chunk.indexOf('@font-face'));
      const end = face.indexOf('}');
      const src = /src:\s*url\((https:[^)]+)\)/.exec(face);
      const weight = /font-weight:\s*([^;]+);/.exec(face);
      if (src) return { url: src[1], weight: weight?.[1]?.trim() ?? '400', block: face.slice(0, end + 1) };
    }
  }
  // Fall back to the first block if the subset comments are absent.
  const src = /src:\s*url\((https:[^)]+)\)/.exec(blocks[0] ?? '');
  if (src) return { url: src[1], weight: '400', block: blocks[0] };
  return null;
}

export async function generateFonts({ force = false } = {}) {
  ensureDir(FONTS_DIR);
  const manifestFile = path.join(FONTS_DIR, 'font-manifest.json');

  if (!force && fs.existsSync(manifestFile)) {
    const cached = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const allPresent = cached.fonts.every((f) => fs.existsSync(path.join(FONTS_DIR, f.file)));
    if (allPresent) {
      cached.fonts.forEach((f) => log.info(`${f.family.padEnd(16)} cached (${f.file})`));
      return cached;
    }
  }

  const manifest = { generatedAt: new Date().toISOString(), fonts: [] };

  for (const entry of FAMILIES) {
    try {
      const css = await fetchCss(entry.css);
      const face = extractLatinFace(css);
      if (!face) throw new Error('no latin @font-face found in the stylesheet');

      const res = await fetch(face.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} downloading the font file`);
      const bytes = Buffer.from(await res.arrayBuffer());

      const ext = face.url.endsWith('.woff2') ? 'woff2' : face.url.split('.').pop();
      const file = `${entry.slug}-variable.${ext}`;
      fs.writeFileSync(path.join(FONTS_DIR, file), bytes);

      manifest.fonts.push({ family: entry.family, file, weight: face.weight, bytes: bytes.length });
      log.ok(`${entry.family.padEnd(16)} ${file} (${(bytes.length / 1024).toFixed(0)}KB, weight ${face.weight})`);
    } catch (cause) {
      throw new PipelineError(`Could not download the "${entry.family}" webfont`, {
        stage: 'fonts',
        hint: 'The render falls back to system fonts without it. Re-run with a network connection, or edit src/fonts.ts to use a locally installed family.',
        cause,
      });
    }
  }

  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1]?.endsWith('fonts.mjs')) {
  log.banner('Typefaces');
  generateFonts({ force: process.argv.includes('--force') })
    .then((m) => { log.blank(); log.info(`${m.fonts.length} font files in public/fonts`); })
    .catch((err) => { reportError(err); process.exit(1); });
}
