#!/usr/bin/env node
/**
 * Renders the composition to an MP4 using Remotion's programmatic API.
 *
 * The CLI would do the same job, but the programmatic API reports real progress
 * for bundling, rendering and encoding, which the web application streams to the
 * browser while a generation is running.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { PATHS, ensureDir } from '../io/paths.mjs';
import { loadPlan, totalFrames, totalSeconds } from '../plan/store.mjs';
import { log, reportError, PipelineError } from '../io/log.mjs';

export const COMPOSITION_ID = 'Story';
export const DEFAULT_OUTPUT = path.join(PATHS.output, 'story.mp4');

/**
 * @param {object} options
 * @param {(e: {stage: string, progress: number, message?: string}) => void} [options.onProgress]
 * @param {string} [options.output] absolute path for the MP4
 * @returns {Promise<{output: string, frames: number, seconds: number, bytes: number}>}
 */
export async function renderVideo({ onProgress, output = DEFAULT_OUTPUT, concurrency } = {}) {
  const plan = loadPlan();
  ensureDir(PATHS.output);
  ensureDir(PATHS.temp);

  assertAssets(plan);

  const emit = (stage, progress, message) => onProgress?.({ stage, progress, message });

  emit('bundle', 0, 'Bundling the composition');
  let serveUrl;
  try {
    serveUrl = await bundle({
      entryPoint: path.join(PATHS.src, 'index.ts'),
      publicDir: PATHS.public,
      onProgress: (p) => emit('bundle', p / 100, 'Bundling the composition'),
    });
  } catch (cause) {
    throw new PipelineError('Failed to bundle the Remotion composition', {
      stage: 'bundle',
      hint: 'Run "npx tsc --noEmit" to surface the underlying TypeScript or import error.',
      cause,
    });
  }

  emit('compose', 1, 'Resolving the composition');
  let composition;
  try {
    composition = await selectComposition({ serveUrl, id: COMPOSITION_ID });
  } catch (cause) {
    throw new PipelineError(`Composition "${COMPOSITION_ID}" could not be resolved`, {
      stage: 'compose',
      hint: 'Check that src/Root.tsx still registers a Composition with this id.',
      cause,
    });
  }

  emit('render', 0, `Rendering ${composition.durationInFrames} frames`);
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: output,
      overwrite: true,
      jpegQuality: 96,
      crf: 18,
      audioCodec: 'aac',
      audioBitrate: '192k',
      concurrency,
      onProgress: ({ progress, renderedFrames, encodedFrames }) => {
        emit('render', progress, `Rendered ${renderedFrames}/${composition.durationInFrames} · encoded ${encodedFrames}`);
      },
    });
  } catch (cause) {
    throw new PipelineError('Rendering failed', {
      stage: 'render',
      hint: 'Most render failures are a missing asset in public/ or an error thrown inside a scene component. Run "npm run studio" to reproduce it interactively.',
      cause,
    });
  }

  if (!fs.existsSync(output)) {
    throw new PipelineError('Rendering reported success but produced no file', {
      stage: 'render',
      hint: `Expected ${output}. Check free disk space and write permissions.`,
    });
  }

  const bytes = fs.statSync(output).size;

  // Stamp the output with the plan it came from. Without this there is no way
  // to tell whether a file on disk belongs to the plan currently loaded, which
  // matters as soon as you render a second story.
  fs.writeFileSync(stampFor(output), JSON.stringify({
    planId: plan.meta.id,
    title: plan.meta.title,
    frames: totalFrames(plan),
    seconds: totalSeconds(plan),
    renderedAt: new Date().toISOString(),
  }, null, 2));

  emit('render', 1, 'Render complete');

  return {
    output,
    frames: totalFrames(plan),
    seconds: totalSeconds(plan),
    bytes,
  };
}

/** Path of the sidecar recording which plan produced a given video. */
export function stampFor(output = DEFAULT_OUTPUT) {
  return output.replace(/\.mp4$/, '') + '.render.json';
}

/**
 * Was `output` rendered from `plan`? Used by the tests and by anything that
 * needs to know whether a video on disk is current.
 */
export function isRenderOf(plan, output = DEFAULT_OUTPUT) {
  try {
    const stamp = JSON.parse(fs.readFileSync(stampFor(output), 'utf8'));
    return stamp.planId === plan.meta.id && stamp.frames === totalFrames(plan);
  } catch {
    return false;
  }
}

/** Fails fast with an actionable message when a generated asset is missing. */
function assertAssets(plan) {
  const missing = [];
  const platesDir = path.join(PATHS.public, 'plates');

  for (const scene of plan.scenes) {
    const svg = path.join(platesDir, `${scene.id}.svg`);
    const png = path.join(platesDir, `${scene.id}.png`);
    if (!fs.existsSync(svg) && !fs.existsSync(png)) missing.push(`public/plates/${scene.id}.(svg|png)`);

    for (const cue of scene.sfx ?? []) {
      const asset = plan.audio.sfx[cue.cue];
      if (!asset) { missing.push(`audio cue "${cue.cue}" is not defined in the plan`); continue; }
      if (!fs.existsSync(path.join(PATHS.audio, asset.file))) missing.push(`public/audio/${asset.file}`);
    }
    for (const line of scene.dialogue ?? []) {
      if (line.enabled === false) continue;
      if (!fs.existsSync(path.join(PATHS.audio, line.file))) missing.push(`public/audio/${line.file}`);
    }
  }

  const musicFile = path.join(PATHS.audio, plan.audio.music.file);
  if (!fs.existsSync(musicFile)) {
    missing.push(`public/audio/${plan.audio.music.file}`);
  } else if (plan.audio.music.volume > 0) {
    // The bed has a fixed name but a plan-dependent length. Rendering a longer
    // story against a shorter story's bed would silently drop the music before
    // the end, so check it rather than trusting the file name.
    const probe = spawnSync('ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', musicFile],
      { encoding: 'utf8', windowsHide: true });
    const seconds = parseFloat(String(probe.stdout).trim());
    if (Number.isFinite(seconds) && seconds + 0.5 < totalSeconds(plan)) {
      missing.push(
        `public/audio/${plan.audio.music.file} is ${seconds.toFixed(1)}s but this plan runs ` +
        `${totalSeconds(plan).toFixed(1)}s (it was built for a different story)`,
      );
    }
  }
  if (!fs.existsSync(path.join(platesDir, 'plate-manifest.json'))) {
    missing.push('public/plates/plate-manifest.json');
  }

  if (missing.length) {
    throw new PipelineError(`${missing.length} generated asset(s) are missing`, {
      stage: 'assets',
      hint: `Run "npm run assets" first. Missing:${[...new Set(missing)].map((m) => `
         - ${m}`).join('')}`,
    });
  }
}

if (process.argv[1]?.endsWith('render.mjs')) {
  log.banner('Rendering video');
  let last = -1;
  renderVideo({
    onProgress: ({ stage, progress, message }) => {
      const pct = Math.round(progress * 100);
      if (pct !== last || stage !== 'render') {
        last = pct;
        process.stdout.write(`\r  ${stage.padEnd(8)} ${String(pct).padStart(3)}%  ${message ?? ''}`.padEnd(78));
      }
    },
  })
    .then((r) => {
      process.stdout.write('\n');
      log.ok(`${path.relative(PATHS.root, r.output)} — ${r.seconds.toFixed(2)}s, ${r.frames} frames, ${(r.bytes / 1e6).toFixed(2)} MB`);
    })
    .catch((err) => { process.stdout.write('\n'); reportError(err); process.exit(1); });
}
