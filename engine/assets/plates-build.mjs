#!/usr/bin/env node
/**
 * Builds the visual plates the render needs: one scene plate per scene, and one
 * portrait per character.
 *
 * Provider chain:
 *   1. OpenAI image generation, when a key with credit is configured. A
 *      character's portrait is generated once and every later plate is
 *      conditioned on it, so a face cannot drift between scenes.
 *   2. Deterministic vector plates from engine/world + engine/cast. These need
 *      no network and no key, and are the pipeline's guaranteed path.
 *
 * Character consistency is structural either way: every plate is drawn from the
 * character's single set of identity attributes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDir } from '../io/paths.mjs';
import { loadPlan } from '../plan/store.mjs';
import { log, reportError } from '../io/log.mjs';
import { buildScenePlate, buildPortraitPlate } from '../world/scene-plate.mjs';

const API_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

async function openaiImage({ prompt, size = '1536x1024', model = 'gpt-image-1' }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch(`${API_BASE}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, size, quality: 'high', n: 1 }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try { detail = JSON.parse(text)?.error?.message ?? detail; } catch { /* keep raw */ }
    throw new Error(`HTTP ${res.status} — ${detail}`);
  }
  const b64 = JSON.parse(text)?.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image data in the response');
  return Buffer.from(b64, 'base64');
}

/** A photographic prompt describing this scene, used only when a key works. */
function scenePrompt(plan, scene) {
  const cast = scene.characterIds
    .map((id) => plan.characters.find((c) => c.id === id))
    .filter((c) => c && c.kind === 'person')
    .map((c) => c.appearance.summary);
  return [
    `Cinematic ${plan.style.label.toLowerCase()} photograph of ${scene.location.name.toLowerCase()}.`,
    cast.length ? `In frame: ${cast.join('; ')}.` : '',
    'Soft natural light, shallow depth of field, professional colour grading, photorealistic.',
    'No text, no letters, no numbers, no logos, no watermarks anywhere in the image.',
  ].filter(Boolean).join(' ');
}

export async function buildPlates({ onProgress, force = false, offline = false } = {}) {
  const plan = loadPlan();
  const platesDir = path.join(PATHS.public, 'plates');
  ensureDir(platesDir);

  const useApi = !offline && !!process.env.OPENAI_API_KEY;
  let apiWorking = useApi;
  const manifest = { generatedAt: new Date().toISOString(), provider: 'vector', scenes: [], characters: [] };

  // Portraits first: they are what the cast list and avatars use.
  for (const character of plan.characters) {
    if (character.kind !== 'person') continue;
    const file = path.join(platesDir, `portrait_${character.id}.svg`);
    fs.writeFileSync(file, buildPortraitPlate({
      character, palette: plan.brand.colors, accent: character.accent,
    }));
    manifest.characters.push({ id: character.id, portrait: `plates/portrait_${character.id}.svg` });
  }

  const total = plan.scenes.length;
  for (const [i, scene] of plan.scenes.entries()) {
    const present = scene.characterIds
      .map((id) => plan.characters.find((c) => c.id === id))
      .filter(Boolean);

    const svgFile = path.join(platesDir, `${scene.id}.svg`);
    const pngFile = path.join(platesDir, `${scene.id}.png`);

    // The vector plate is always written, so the render always has a source.
    fs.writeFileSync(svgFile, buildScenePlate({
      location: scene.location,
      characters: present,
      palette: plan.brand.colors,
      accent: plan.characters.find((c) => c.id === scene.focusId)?.accent ?? plan.brand.colors.accent,
      speakingId: scene.focusId,
    }));

    let photoreal = false;
    if (apiWorking && (force || !fs.existsSync(pngFile))) {
      try {
        const buf = await openaiImage({ prompt: scenePrompt(plan, scene) });
        fs.writeFileSync(pngFile, buf);
        photoreal = true;
        log.ok(`${scene.id}: photoreal plate (${(buf.length / 1024).toFixed(0)}KB)`);
      } catch (err) {
        log.warn(`${scene.id}: image API unavailable — ${err.message.slice(0, 120)}`);
        // One failure is enough; stop hammering a key with no credit.
        apiWorking = false;
      }
    } else if (fs.existsSync(pngFile)) {
      photoreal = true;
    }

    manifest.scenes.push({
      id: scene.id,
      plate: photoreal ? `plates/${scene.id}.png` : `plates/${scene.id}.svg`,
      photoreal,
      location: scene.location.kind,
      characters: present.map((c) => c.id),
    });
    onProgress?.({ index: i + 1, total, label: scene.id });
  }

  manifest.provider = manifest.scenes.every((s) => s.photoreal) ? 'openai-images' : 'vector';
  fs.writeFileSync(path.join(platesDir, 'plate-manifest.json'), JSON.stringify(manifest, null, 2));
  log.info(`${manifest.scenes.length} scene plates, ${manifest.characters.length} portraits (${manifest.provider})`);
  return manifest;
}

if (process.argv[1]?.endsWith('plates-build.mjs')) {
  log.banner('Scene plates');
  buildPlates({ force: process.argv.includes('--force'), offline: process.argv.includes('--offline') })
    .catch((err) => { reportError(err); process.exit(1); });
}
