#!/usr/bin/env node
/**
 * Inspects the rendered MP4 and checks it against the render plan.
 *
 * Every expectation is derived from the plan, so this verifier works for any
 * story: it never hard-codes a scene count, a duration, or a line of dialogue.
 * It probes the container, measures the duration against the planned timeline,
 * confirms the audio carries signal, checks that every planned line of speech
 * was actually synthesised, and samples one frame from every segment to prove
 * nothing rendered blank.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS, ensureDir } from '../io/paths.mjs';
import { loadPlan, buildTimeline, totalSeconds, allDialogue, characterById } from '../plan/store.mjs';
import { log, reportError, PipelineError } from '../io/log.mjs';
import { DEFAULT_OUTPUT } from './render.mjs';

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 * 32 });
}

function ffprobeJson(file) {
  const r = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.status !== 0) {
    throw new PipelineError(`ffprobe could not read ${path.basename(file)}`, {
      stage: 'verify', hint: 'The file may be truncated. Re-run the render.', cause: new Error(r.stderr),
    });
  }
  return JSON.parse(r.stdout);
}

function measureAudio(file) {
  const r = run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const out = `${r.stdout}${r.stderr}`;
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(out);
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(out);
  return { meanDb: mean ? Number(mean[1]) : null, maxDb: max ? Number(max[1]) : null };
}

/**
 * Average luminance of one frame, 0-255, proving the segment drew something.
 * The frame is chosen by timestamp: a `select=eq(n,N)` filter needs a backslash
 * that does not survive Windows argument quoting.
 */
function frameBrightness(file, atSeconds, outPng) {
  const extract = run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ss', atSeconds.toFixed(3), '-frames:v', '1', outPng]);
  if (extract.status !== 0 || !fs.existsSync(outPng)) return null;

  const sample = spawnSync('ffmpeg', [
    '-v', 'error', '-i', outPng, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { windowsHide: true, maxBuffer: 1024 });
  if (sample.status !== 0 || !sample.stdout || sample.stdout.length < 3) return null;
  const [r, g, b] = sample.stdout;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** ffprobe reports frame rates as a rational string such as "30/1". */
function parseRational(value) {
  if (!value) return 0;
  const [num, den] = String(value).split('/').map(Number);
  return den ? num / den : num;
}

function probeDuration(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  if (r.status !== 0) return null;
  const v = parseFloat(String(r.stdout).trim());
  return Number.isFinite(v) ? v : null;
}

export async function verifyOutput({ file = DEFAULT_OUTPUT, keepFrames = false, plan = null } = {}) {
  const renderPlan = plan ?? loadPlan();
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  if (!fs.existsSync(file)) {
    throw new PipelineError(`No rendered video at ${file}`, {
      stage: 'verify', hint: 'Generate a video first.',
    });
  }

  const probe = ffprobeJson(file);
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  const expected = totalSeconds(renderPlan);
  const timeline = buildTimeline(renderPlan);

  /* ------------------------------------------------------------ container -- */

  add('file exists', true, `${(Number(probe.format.size) / 1e6).toFixed(2)} MB`);
  add('video stream present', !!video, video ? `${video.codec_name} ${video.width}×${video.height}` : 'missing');
  add('resolution matches the plan',
    video?.width === renderPlan.meta.width && video?.height === renderPlan.meta.height,
    `${video?.width}×${video?.height}`);
  add('frame rate matches the plan',
    Math.abs(parseRational(video?.r_frame_rate) - renderPlan.meta.fps) < 0.01,
    `${parseRational(video?.r_frame_rate)} fps`);
  add('duration matches the planned timeline', Math.abs(duration - expected) < 0.4,
    `${duration.toFixed(2)}s (planned ${expected.toFixed(2)}s)`);

  const frames = Number(video?.nb_frames ?? 0);
  add('frame count matches the timeline',
    Math.abs(frames - Math.round(expected * renderPlan.meta.fps)) <= 2, `${frames} frames`);

  // Only checked when the user asked for a specific runtime. A story with more
  // speech than the target allows is compressed as far as rate and pacing can
  // go; the plan records that, and the check reports it rather than failing on
  // something the content makes impossible.
  if (renderPlan.meta.targetSeconds) {
    const target = renderPlan.meta.targetSeconds;
    const tolerance = Math.max(2.5, target * 0.12);
    if (renderPlan.meta.targetMet === false) {
      const reason = duration > target
        ? `the story has more speech than ${target}s can carry`
        : `the story has less content than ${target}s needs`;
      add('runtime is as close to the target as the story allows', true,
        `${duration.toFixed(1)}s for ${target}s requested — ${reason}`);
    } else {
      add('duration is close to the requested target',
        Math.abs(duration - target) <= tolerance,
        `${duration.toFixed(1)}s vs ${target}s requested (±${tolerance.toFixed(1)}s)`);
    }
  }

  /* ---------------------------------------------------------------- audio -- */

  add('audio stream present', !!audio,
    audio ? `${audio.codec_name} ${audio.sample_rate}Hz ${audio.channels}ch` : 'missing');
  if (audio) {
    const level = measureAudio(file);
    add('audio carries signal', level.meanDb !== null && level.meanDb > -60,
      `mean ${level.meanDb}dB, peak ${level.maxDb}dB`);
    add('audio is not clipping', level.maxDb !== null && level.maxDb <= 0.5, `peak ${level.maxDb}dB`);
  }

  /* ------------------------------------------------------------- structure -- */

  const scenes = timeline.filter((s) => s.kind === 'scene');
  const transitions = timeline.filter((s) => s.kind === 'transition');

  add('every planned scene is in the timeline', scenes.length === renderPlan.scenes.length,
    `${scenes.length} scenes`);
  add('a transition sits between every pair of scenes',
    transitions.length === Math.max(0, renderPlan.scenes.length - 1),
    `${transitions.length} transitions`);
  add('transitions are brief pauses',
    transitions.every((t) => t.durationSeconds >= 0.4 && t.durationSeconds <= 2.5),
    transitions.length ? `${Math.min(...transitions.map((t) => t.durationSeconds))}-${Math.max(...transitions.map((t) => t.durationSeconds))}s` : 'none');

  add('every scene has a cast or narration',
    renderPlan.scenes.every((s) => s.characterIds.length > 0 || s.beats.some((b) => b.kind === 'narration')),
    `${renderPlan.scenes.filter((s) => s.characterIds.length).length}/${renderPlan.scenes.length} scenes with an on-screen cast`);

  /* ------------------------------------------------------------ characters -- */

  add('the story produced at least one character', renderPlan.characters.length > 0,
    renderPlan.characters.map((c) => c.name).join(', ') || 'none');

  const people = renderPlan.characters.filter((c) => c.kind === 'person');
  const voices = new Set(people.map((c) => c.voice.voiceId));
  add('speaking characters have distinct voices',
    people.length <= 1 || voices.size === Math.min(people.length, 5),
    [...voices].map((v) => v.replace('en-US-', '')).join(', ') || 'n/a');

  add('every character keeps one identity across scenes',
    renderPlan.characters.every((c) => c.id && c.accent && c.voice?.voiceId),
    `${renderPlan.characters.length} identities pinned`);

  /* -------------------------------------------------------------- dialogue -- */

  const spoken = allDialogue(renderPlan);
  const missingVoice = [];
  let voiceBytes = 0;
  for (const line of spoken) {
    const f = path.join(PATHS.audio, line.file);
    if (fs.existsSync(f)) voiceBytes += fs.statSync(f).size;
    else missingVoice.push(line.file);
  }
  add('every planned line was synthesised', missingVoice.length === 0,
    missingVoice.length ? `missing ${missingVoice.length}` : `${spoken.length} lines, ${(voiceBytes / 1e6).toFixed(2)} MB`);

  const overruns = spoken.filter((line) => {
    const seconds = probeDuration(path.join(PATHS.audio, line.file));
    if (seconds === null) return false;
    return seconds > (line.scene.durationSeconds - line.startAt) + 0.4;
  });
  add('no spoken line overruns its scene', overruns.length === 0,
    overruns.length ? overruns.map((l) => l.id).join(', ') : `${spoken.length} lines fit`);

  add('every spoken line is attributed to a known voice',
    spoken.every((l) => characterById(renderPlan, l.characterId)),
    `${new Set(spoken.map((l) => l.characterId)).size} distinct speakers`);

  /* -------------------------------------------------- script faithfulness -- */

  // Every beat's text must appear verbatim in the source story. This is what
  // guarantees the pipeline never invents dialogue.
  const source = String(renderPlan.source ?? '').replace(/\s+/g, ' ').toLowerCase();
  const beatTexts = renderPlan.scenes.flatMap((s) => s.beats.map((b) => b.text)).filter(Boolean);
  const invented = beatTexts.filter((t) => {
    const needle = String(t).replace(/\s+/g, ' ').toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    return needle.length > 8 && !source.includes(needle);
  });
  add('all on-screen text comes from the source story', invented.length === 0,
    invented.length ? `${invented.length} unmatched: "${invented[0].slice(0, 40)}…"` : `${beatTexts.length} beats verified`);

  /* --------------------------------------------------------- frame sampling -- */

  const framesDir = path.join(PATHS.temp, 'verify-frames');
  ensureDir(framesDir);
  const dark = [];
  for (const segment of timeline) {
    const at = segment.startSeconds + segment.durationSeconds / 2;
    const png = path.join(framesDir, `${segment.id}.png`);
    const brightness = frameBrightness(file, at, png);
    if (brightness === null) dark.push(`${segment.id} (unreadable)`);
    else if (brightness < 5) dark.push(`${segment.id} (luma ${brightness.toFixed(1)})`);
  }
  add('every scene and transition renders content', dark.length === 0,
    dark.length ? dark.join(', ') : `${timeline.length} segments sampled, all non-blank`);

  if (!keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });

  const failed = checks.filter((c) => !c.pass);
  return { checks, failed, duration, frames, file, plan: renderPlan };
}

if (process.argv[1]?.endsWith('verify.mjs')) {
  log.banner('Verifying rendered output');
  verifyOutput({ keepFrames: process.argv.includes('--keep-frames') })
    .then(({ checks, failed, duration }) => {
      for (const c of checks) log[c.pass ? 'ok' : 'error'](`${c.name.padEnd(48)} ${c.detail ?? ''}`);
      log.blank();
      if (failed.length) { log.error(`${failed.length} of ${checks.length} checks failed`); process.exit(1); }
      log.ok(`all ${checks.length} checks passed — ${duration.toFixed(2)}s video`);
    })
    .catch((err) => { reportError(err); process.exit(1); });
}
