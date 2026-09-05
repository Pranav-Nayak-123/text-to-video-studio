/**
 * Job runner behind the web application.
 *
 * One generation at a time, with every stage reporting progress that the
 * browser consumes over Server-Sent Events. Stage failures are captured with
 * their remediation hint rather than crashing the server.
 */
import { planStory, buildAssets } from '../engine/pipeline.mjs';
import { renderVideo, DEFAULT_OUTPUT } from '../engine/render/render.mjs';
import { verifyOutput } from '../engine/render/verify.mjs';
import { log } from '../engine/io/log.mjs';

/** Weight of each stage in the overall progress bar. */
const STAGE_WEIGHTS = { analyse: 0.05, assets: 0.28, render: 0.6, verify: 0.07 };
const ORDER = Object.keys(STAGE_WEIGHTS);

export class GenerationJob {
  constructor() {
    /** @type {'idle'|'running'|'done'|'failed'} */
    this.status = 'idle';
    this.events = [];
    this.listeners = new Set();
    this.result = null;
    this.plan = null;
    this.error = null;
    this.startedAt = null;
    this.finishedAt = null;
  }

  get running() { return this.status === 'running'; }

  subscribe(fn) {
    this.listeners.add(fn);
    // Replay history so a browser that connects mid-run sees the whole story.
    for (const e of this.events) fn(e);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    const payload = { ...event, at: Date.now() };
    this.events.push(payload);
    for (const fn of this.listeners) {
      try { fn(payload); } catch { /* a dead client must not break the run */ }
    }
  }

  reset() {
    this.events = [];
    this.result = null;
    this.error = null;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.status = 'running';
  }

  /** Overall progress, given the fraction complete within one stage. */
  static overall(stage, within) {
    const index = ORDER.indexOf(stage);
    return ORDER.reduce((acc, key, i) => {
      if (i < index) return acc + STAGE_WEIGHTS[key];
      if (i === index) return acc + STAGE_WEIGHTS[key] * Math.max(0, Math.min(1, within));
      return acc;
    }, 0);
  }

  /**
   * @param {string} text the user's story
   * @param {object} options duration, style, aspect, voice, music, forceAssets, offline
   */
  async run(text, options = {}) {
    if (this.running) throw new Error('A generation is already running');
    if (!String(text ?? '').trim()) throw new Error('The story is empty');
    this.reset();

    const {
      targetSeconds = null, styleId = null, title = null,
      resolution = [1920, 1080], voiceStyle = 'balanced', music = true,
      forceAssets = false, offline = false,
    } = options;

    try {
      this.emit({ type: 'start', message: 'Starting generation' });

      /* ----------------------------------------------------------- analyse -- */
      this.emit({ type: 'stage', stage: 'analyse', message: 'Analysing the story', overall: 0 });
      const plan = await planStory(text, {
        targetSeconds, styleId, title, resolution, voiceStyle, music,
        useLlm: !offline,
      });
      this.plan = plan;
      this.emit({
        type: 'plan',
        message: `${plan.totals.characters} characters · ${plan.totals.scenes} scenes · ${plan.totals.seconds}s`,
        plan: summarisePlan(plan),
        overall: STAGE_WEIGHTS.analyse,
      });
      this.emit({ type: 'stage-done', stage: 'analyse', message: 'Story analysed', overall: STAGE_WEIGHTS.analyse });

      /* ------------------------------------------------------------ assets -- */
      this.emit({ type: 'stage', stage: 'assets', message: 'Building assets', overall: STAGE_WEIGHTS.analyse });
      const assets = await buildAssets({
        force: forceAssets,
        offline,
        onProgress: (p) => this.emit({
          type: 'progress', stage: 'assets',
          message: `Assets — ${p.label ?? p.stage}`,
          overall: GenerationJob.overall('assets', p.progress ?? 0),
        }),
      });
      for (const w of assets.warnings ?? []) this.emit({ type: 'warning', message: w });
      this.emit({
        type: 'stage-done', stage: 'assets', message: 'Assets ready',
        overall: GenerationJob.overall('assets', 1),
      });

      /* ------------------------------------------------------------ render -- */
      this.emit({ type: 'stage', stage: 'render', message: 'Rendering video', overall: GenerationJob.overall('render', 0) });
      const render = await renderVideo({
        onProgress: ({ stage, progress, message }) => {
          const within = stage === 'render' ? progress : progress * 0.08;
          this.emit({
            type: 'progress', stage: 'render', message: message ?? 'Rendering',
            overall: GenerationJob.overall('render', within),
          });
        },
      });
      this.emit({
        type: 'stage-done', stage: 'render', message: `Rendered ${render.frames} frames`,
        overall: GenerationJob.overall('render', 1),
      });

      /* ------------------------------------------------------------ verify -- */
      this.emit({ type: 'stage', stage: 'verify', message: 'Verifying output', overall: GenerationJob.overall('verify', 0) });
      const verification = await verifyOutput({ file: render.output, plan });
      for (const c of verification.failed) {
        this.emit({ type: 'warning', message: `Check failed: ${c.name} — ${c.detail ?? ''}` });
      }
      this.emit({ type: 'stage-done', stage: 'verify', message: 'Verification complete', overall: 1 });

      this.result = {
        output: render.output,
        seconds: verification.duration,
        frames: verification.frames,
        bytes: render.bytes,
        checks: verification.checks,
        failedChecks: verification.failed.length,
        videoUrl: `/api/video?v=${Date.now()}`,
        plan: summarisePlan(plan),
      };
      this.status = 'done';
      this.finishedAt = Date.now();
      this.emit({ type: 'done', message: 'Video ready', result: this.result, overall: 1 });
      return this.result;
    } catch (err) {
      this.status = 'failed';
      this.finishedAt = Date.now();
      this.error = {
        message: err?.message ?? String(err),
        hint: err?.hint ?? null,
        stage: err?.stage ?? null,
        cause: err?.cause?.message ?? null,
      };
      this.emit({ type: 'error', message: this.error.message, error: this.error });
      log.error(`generation failed: ${this.error.message}`);
      throw err;
    }
  }
}

/** The parts of a plan the browser needs, without the whole document. */
export function summarisePlan(plan) {
  return {
    title: plan.meta.title,
    subtitle: plan.meta.subtitle,
    analyser: plan.meta.analyser,
    style: plan.style,
    presentation: plan.presentation,
    seconds: plan.totals.seconds,
    frames: plan.totals.frames,
    targetSeconds: plan.meta.targetSeconds,
    targetMet: plan.meta.targetMet,
    speechRate: plan.meta.speechRate,
    resolution: `${plan.meta.width}×${plan.meta.height}`,
    totals: plan.totals,
    characters: plan.characters.map((c) => ({
      id: c.id, name: c.name, role: c.role, kind: c.kind, gender: c.gender,
      initials: c.initials, accent: c.accent, voice: c.voice.voiceId,
      appearance: c.appearance.summary,
      scenes: c.sceneIndexes.map((i) => i + 1),
    })),
    narrator: { name: plan.narrator.name, voice: plan.narrator.voice.voiceId },
    locations: plan.locations,
    scenes: plan.scenes.map((s) => ({
      id: s.id, number: s.number, title: s.title,
      seconds: s.durationSeconds,
      location: s.location,
      characters: s.characterIds,
      isFinale: s.isFinale,
      beats: s.beats.map((b) => ({
        kind: b.kind, text: b.text, speakerId: b.speakerId, at: b.appearAt,
      })),
    })),
    transitions: plan.transitions.map((t) => ({
      id: t.id, type: t.type, caption: t.caption, seconds: t.durationSeconds,
    })),
  };
}

export { DEFAULT_OUTPUT };
