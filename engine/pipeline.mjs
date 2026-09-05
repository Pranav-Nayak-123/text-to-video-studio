/**
 * The text-to-video pipeline.
 *
 *   story text
 *     -> analysis        characters, scenes, dialogue, locations
 *     -> plan            identities, voices, timings, transitions, cue sheet
 *     -> assets          scene plates, portraits, music, UI sounds, voices
 *     -> render          Remotion composition to H.264
 *     -> verify          probe the file and check it against the plan
 *
 * Every stage is independently callable, and every stage degrades rather than
 * aborting when an optional provider is unavailable.
 */
import { analyseStory } from './analysis/heuristic.mjs';
import { analyseWithLlm, llmAvailable } from './analysis/llm.mjs';
import { compilePlan } from './plan/compile.mjs';
import { savePlan, loadPlan, planExists } from './plan/store.mjs';
import { retimePlan } from './plan/retime.mjs';
import { generateFonts } from './assets/fonts.mjs';
import { buildPlates } from './assets/plates-build.mjs';
import { generateSfx } from './audio/sfx.mjs';
import { generateVoice } from './audio/tts.mjs';
import { renderVideo } from './render/render.mjs';
import { verifyOutput } from './render/verify.mjs';
import { log } from './io/log.mjs';
import { STYLES } from './analysis/lexicon.mjs';

export { STYLES };

/**
 * Analyse a story and compile a render plan, without producing any assets.
 *
 * @param {string} text the user's story
 * @param {object} [options]
 * @param {number|null} [options.targetSeconds]
 * @param {string|null} [options.styleId]
 * @param {string|null} [options.title]
 * @param {[number, number]} [options.resolution]
 * @param {number} [options.fps]
 * @param {string} [options.voiceStyle]
 * @param {boolean} [options.music]
 * @param {boolean} [options.useLlm] allow the model-backed analyser
 * @returns {Promise<object>} the render plan (also written to disk)
 */
export async function planStory(text, options = {}) {
  const {
    targetSeconds = null,
    maxScenes = 8,
    useLlm = true,
    ...compileOptions
  } = options;

  let story;
  if (useLlm && llmAvailable()) {
    try {
      story = await analyseWithLlm(text, { targetSeconds, maxScenes });
      log.ok('analysed with the language model');
    } catch (err) {
      log.warn(`model analysis unavailable — using the built-in analyser (${err.message.slice(0, 110)})`);
      story = analyseStory(text, { targetSeconds, maxScenes });
    }
  } else {
    story = analyseStory(text, { targetSeconds, maxScenes });
  }

  const plan = compilePlan(story, { targetSeconds, ...compileOptions });
  savePlan(plan);
  return plan;
}

/**
 * Build every asset the current plan needs.
 * Each stage falls back rather than aborting, and reports what it fell back to.
 */
export async function buildAssets({ onProgress, force = false, offline = false } = {}) {
  const report = { stages: [], warnings: [] };

  const stages = [
    {
      id: 'fonts', label: 'Typefaces', optional: true,
      run: () => generateFonts({ force }),
      summarise: (r) => `${r.fonts.length} font file(s)`,
    },
    {
      id: 'plates', label: 'Scene plates',
      run: () => buildPlates({ force, offline }),
      summarise: (r) => `${r.scenes.length} scenes, ${r.characters.length} portraits (${r.provider})`,
    },
    {
      id: 'sfx', label: 'Music & UI sounds',
      run: () => generateSfx({}),
      summarise: (r) => `${r.length} audio assets`,
    },
    {
      id: 'voice', label: 'Character voices',
      run: () => generateVoice({ force }),
      summarise: (r) => Object.entries(r.providerSummary).map(([k, v]) => `${k}×${v}`).join(', ') || 'cached',
    },
  ];

  for (const [i, stage] of stages.entries()) {
    log.step(`${i + 1}/${stages.length}  ${stage.label}`);
    onProgress?.({ stage: stage.id, label: stage.label, progress: i / stages.length });
    try {
      const result = await stage.run();
      report.stages.push({ id: stage.id, ok: true, summary: stage.summarise(result) });
      if (result?.warnings?.length) report.warnings.push(...result.warnings);
      log.info(stage.summarise(result));
    } catch (err) {
      report.stages.push({ id: stage.id, ok: false, summary: err.message });
      if (stage.optional) {
        report.warnings.push(`${stage.label}: ${err.message} (continuing without it)`);
        log.warn(`${stage.label} unavailable — continuing`);
      } else {
        throw err;
      }
    }
  }

  // The voices now exist, so replace every estimated beat length with the
  // measured one. This is what keeps speech from being clipped by its scene.
  try {
    const retimed = retimePlan();
    if (retimed.adjusted) {
      log.info(`retimed ${retimed.adjusted} beat(s): ${retimed.before}s → ${retimed.after}s`);
    }
    report.stages.push({ id: 'retime', ok: true, summary: `${retimed.adjusted} beats retimed, ${retimed.after}s` });
  } catch (err) {
    report.warnings.push(`Retiming skipped: ${err.message}`);
  }

  onProgress?.({ stage: 'done', progress: 1 });
  return report;
}

/**
 * The whole pipeline, from raw text to a verified MP4.
 *
 * @param {string} text
 * @param {object} [options] planStory options plus:
 * @param {(e: object) => void} [options.onProgress]
 * @param {boolean} [options.forceAssets]
 * @param {boolean} [options.offline]
 */
export async function generateVideo(text, options = {}) {
  const { onProgress, forceAssets = false, offline = false, ...planOptions } = options;

  const emit = (stage, progress, message, extra = {}) =>
    onProgress?.({ stage, progress, message, ...extra });

  emit('analyse', 0, 'Analysing the story');
  const plan = await planStory(text, { ...planOptions, useLlm: !offline && planOptions.useLlm !== false });
  emit('analyse', 1, `${plan.totals.characters} characters, ${plan.totals.scenes} scenes, ${plan.totals.seconds}s`, { plan });

  emit('assets', 0, 'Building assets');
  const assets = await buildAssets({
    force: forceAssets,
    offline,
    onProgress: (p) => emit('assets', p.progress ?? 0, `Assets — ${p.label ?? p.stage}`),
  });

  emit('render', 0, 'Rendering');
  const render = await renderVideo({
    onProgress: ({ stage, progress, message }) => {
      const within = stage === 'render' ? progress : progress * 0.08;
      emit('render', within, message ?? 'Rendering');
    },
  });

  emit('verify', 0, 'Verifying');
  const verification = await verifyOutput({ file: render.output });
  emit('verify', 1, 'Verified');

  return { plan, assets, render, verification };
}

export { loadPlan, planExists, savePlan };
