/**
 * Reads and writes the active render plan.
 *
 * The plan is the contract between every stage: the asset generators, the
 * Remotion composition, the renderer and the verifier all read this one file,
 * so they cannot disagree about what is being made.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDir } from '../io/paths.mjs';
import { PipelineError } from '../io/log.mjs';

export const PLAN_FILE = path.join(PATHS.config, 'render-plan.json');

/** Persist a plan and return it. */
export function savePlan(plan, file = PLAN_FILE) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(plan, null, 2));
  return plan;
}

/** Load the active plan. */
export function loadPlan(file = PLAN_FILE) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (cause) {
    throw new PipelineError('No render plan has been generated yet', {
      stage: 'plan',
      hint: 'Submit a story in the web app, or run "npm run story -- <file>" to build a plan first.',
      cause,
    });
  }
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (cause) {
    throw new PipelineError('config/render-plan.json is not valid JSON', {
      stage: 'plan', hint: 'Regenerate it from the story.', cause,
    });
  }
  validatePlan(plan);
  return plan;
}

export function planExists(file = PLAN_FILE) {
  return fs.existsSync(file);
}

/**
 * Structural validation. Catching a malformed plan here produces a readable
 * message instead of a cryptic React failure inside the headless browser.
 */
export function validatePlan(plan) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(msg); };

  need(plan?.meta?.fps > 0, 'meta.fps must be positive');
  need(plan?.meta?.width > 0 && plan?.meta?.height > 0, 'meta.width/height must be positive');
  need(Array.isArray(plan?.characters), 'characters must be an array');
  need(Array.isArray(plan?.scenes) && plan.scenes.length > 0, 'the plan needs at least one scene');
  need(Array.isArray(plan?.transitions), 'transitions must be an array');
  need(['narrative', 'interface'].includes(plan?.presentation), 'presentation must be narrative|interface');

  const characterIds = new Set([...(plan?.characters ?? []).map((c) => c.id), plan?.narrator?.id]);

  for (const scene of plan?.scenes ?? []) {
    need(scene.id, 'every scene needs an id');
    need(scene.durationSeconds > 0, `scene ${scene.id} needs a positive duration`);
    need(Array.isArray(scene.beats), `scene ${scene.id} needs a beats array`);
    for (const beat of scene.beats ?? []) {
      need(typeof beat.appearAt === 'number', `beat ${beat.id} needs appearAt`);
      need(beat.appearAt < scene.durationSeconds + 0.01,
        `beat ${beat.id} starts at ${beat.appearAt}s, past the end of ${scene.id}`);
      if (beat.speakerId) {
        need(characterIds.has(beat.speakerId), `beat ${beat.id} references unknown speaker "${beat.speakerId}"`);
      }
    }
    for (const line of scene.dialogue ?? []) {
      need(characterIds.has(line.characterId), `dialogue ${line.id} references unknown character "${line.characterId}"`);
      need(line.file, `dialogue ${line.id} needs a file name`);
    }
  }

  for (const transition of plan?.transitions ?? []) {
    need((plan.scenes ?? []).some((s) => s.id === transition.afterScene),
      `transition ${transition.id} follows unknown scene "${transition.afterScene}"`);
  }

  if (problems.length) {
    throw new PipelineError(`The render plan is invalid (${problems.length} problem(s))`, {
      stage: 'plan',
      hint: problems.map((p) => `\n         - ${p}`).join(''),
    });
  }
  return true;
}

/** Total runtime in seconds. */
export function totalSeconds(plan) {
  return (
    plan.scenes.reduce((a, s) => a + s.durationSeconds, 0) +
    plan.transitions.reduce((a, t) => a + t.durationSeconds, 0)
  );
}

export function totalFrames(plan) {
  return Math.round(totalSeconds(plan) * plan.meta.fps);
}

/**
 * Flatten scenes and transitions into one ordered timeline with absolute
 * start times, in both seconds and frames.
 */
export function buildTimeline(plan) {
  const fps = plan.meta.fps;
  const segments = [];
  let cursor = 0;

  for (const scene of plan.scenes) {
    segments.push({
      kind: 'scene',
      id: scene.id,
      title: scene.title,
      startSeconds: cursor,
      durationSeconds: scene.durationSeconds,
      startFrame: Math.round(cursor * fps),
      durationInFrames: Math.round(scene.durationSeconds * fps),
      data: scene,
    });
    cursor += scene.durationSeconds;

    const transition = plan.transitions.find((t) => t.afterScene === scene.id);
    if (transition) {
      segments.push({
        kind: 'transition',
        id: transition.id,
        title: transition.caption,
        startSeconds: cursor,
        durationSeconds: transition.durationSeconds,
        startFrame: Math.round(cursor * fps),
        durationInFrames: Math.round(transition.durationSeconds * fps),
        data: transition,
      });
      cursor += transition.durationSeconds;
    }
  }
  return segments;
}

/** Every spoken line in the plan, with its scene attached. */
export function allDialogue(plan, { includeDisabled = false } = {}) {
  return plan.scenes.flatMap((scene) =>
    (scene.dialogue ?? [])
      .filter((line) => includeDisabled || line.enabled !== false)
      .map((line) => ({ ...line, sceneId: scene.id, scene })),
  );
}

/** Look up a character (or the narrator) by id. */
export function characterById(plan, id) {
  if (!id) return null;
  if (plan.narrator?.id === id) return plan.narrator;
  return plan.characters.find((c) => c.id === id) ?? null;
}
