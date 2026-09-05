/**
 * Re-times the plan against the audio that was actually synthesised.
 *
 * The compiler estimates how long each line will take before any speech
 * exists. Estimates are good but never exact - identifier-heavy lines
 * ("BCM002345", "QL9") in particular are read more slowly than a word count
 * suggests. Once the voices exist, this pass replaces every estimate with the
 * measured duration and re-lays the timeline, so no line is ever cut off by its
 * own scene ending.
 *
 * This is what makes the audio and the picture exactly aligned rather than
 * approximately aligned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS } from '../io/paths.mjs';
import { log } from '../io/log.mjs';
import { loadPlan, savePlan } from './store.mjs';

/** Measured length of an audio file, in seconds. */
function probeDuration(file) {
  const r = spawnSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const value = parseFloat(String(r.stdout).trim());
  return Number.isFinite(value) ? value : null;
}

const PACE = { gap: 0.28, leadIn: 0.45, tailOut: 0.65, minBeat: 0.85, pad: 0.18 };

/**
 * @param {object} [options]
 * @param {object} [options.plan] plan to retime (defaults to the saved plan)
 * @param {boolean} [options.save] write the result back to disk
 * @returns {{plan: object, adjusted: number, before: number, after: number}}
 */
export function retimePlan({ plan = null, save = true } = {}) {
  const target = plan ?? loadPlan();
  const gap = PACE.gap * (target.meta.gapScale ?? 1);
  const leadIn = PACE.leadIn * (target.meta.gapScale ?? 1);
  const tailOut = PACE.tailOut * (target.meta.gapScale ?? 1);

  const before = target.scenes.reduce((a, s) => a + s.durationSeconds, 0) +
    target.transitions.reduce((a, t) => a + t.durationSeconds, 0);

  let adjusted = 0;

  for (const scene of target.scenes) {
    const measured = new Map();
    for (const line of scene.dialogue ?? []) {
      if (line.enabled === false) continue;
      const file = path.join(PATHS.audio, line.file);
      if (!fs.existsSync(file)) continue;
      const seconds = probeDuration(file);
      if (seconds) measured.set(line.id, seconds);
    }
    if (!measured.size) continue;

    // Beats and dialogue lines are matched by id: a line's id is its beat id
    // plus "-vo", which is how the compiler emits them.
    const lineForBeat = new Map(
      (scene.dialogue ?? []).map((line) => [line.id.replace(/-vo$/, ''), line]),
    );

    let cursor = leadIn;
    for (const beat of scene.beats) {
      const line = lineForBeat.get(beat.id);
      const seconds = line ? measured.get(line.id) : null;

      if (seconds) {
        const needed = Math.max(PACE.minBeat, seconds + PACE.pad);
        if (Math.abs(needed - beat.duration) > 0.05) adjusted += 1;
        beat.duration = round(needed);
      }

      beat.appearAt = round(cursor);
      if (beat.typeDuration !== undefined) {
        beat.typeDuration = round(Math.max(0.6, beat.duration * 0.8));
        beat.commitAt = round(beat.appearAt + beat.duration);
      }
      if (line) line.startAt = beat.appearAt;

      cursor = beat.appearAt + beat.duration + gap;
    }

    const floor = scene.isFinale ? 4.2 : 2;
    scene.durationSeconds = round(Math.max(floor, cursor - gap + tailOut));

    // Cues are placed relative to their beat, so re-derive them too.
    scene.sfx = rebuildCues(scene);
  }

  // Measured speech is often shorter than estimated. Re-apply the requested
  // runtime so retiming never quietly ends the film early: any slack becomes
  // hold time at the end of each scene, in proportion to its length.
  let after = target.scenes.reduce((a, s) => a + s.durationSeconds, 0) +
    target.transitions.reduce((a, t) => a + t.durationSeconds, 0);

  if (target.meta.targetSeconds) {
    const sceneTotal = target.scenes.reduce((a, s) => a + s.durationSeconds, 0);
    const budget = target.meta.targetSeconds - target.transitions.reduce((a, t) => a + t.durationSeconds, 0);
    const shortfall = budget - sceneTotal;
    if (shortfall > 0.3 && sceneTotal > 0) {
      for (const scene of target.scenes) {
        scene.durationSeconds = round(scene.durationSeconds + shortfall * (scene.durationSeconds / sceneTotal));
      }
      after = target.scenes.reduce((a, s) => a + s.durationSeconds, 0) +
        target.transitions.reduce((a, t) => a + t.durationSeconds, 0);
    }
  }

  target.totals.seconds = round(after);
  target.totals.frames = Math.round(after * target.meta.fps);
  if (target.meta.targetSeconds) {
    target.meta.targetMet =
      Math.abs(after - target.meta.targetSeconds) <= Math.max(2.5, target.meta.targetSeconds * 0.12);
  }

  if (save) savePlan(target);
  return { plan: target, adjusted, before: round(before), after: round(after) };
}

/** Rebuild a scene's audio cue sheet from its (now exact) beat times. */
function rebuildCues(scene) {
  const cues = [];
  for (const beat of scene.beats) {
    if (beat.typeDuration !== undefined) {
      cues.push({ cue: 'typing', at: beat.appearAt });
      cues.push({ cue: 'message', at: round(beat.commitAt ?? beat.appearAt + beat.duration) });
    } else if (beat.kind === 'system') {
      cues.push({ cue: 'notification', at: beat.appearAt });
    } else if (beat.kind === 'dialogue') {
      cues.push({ cue: 'message', at: beat.appearAt });
    }
  }
  if (scene.isFinale) {
    cues.push({ cue: 'success', at: round(Math.max(0.2, scene.durationSeconds - 2.2)) });
  }
  return cues;
}

const round = (n) => Math.round(n * 100) / 100;

if (process.argv[1]?.endsWith('retime.mjs')) {
  const result = retimePlan();
  log.ok(`retimed ${result.adjusted} beat(s): ${result.before}s → ${result.after}s`);
}
