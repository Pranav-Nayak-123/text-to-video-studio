#!/usr/bin/env node
/**
 * Generates every non-voice audio asset for the video: the corporate music bed,
 * UI sounds and the success chime.
 *
 * Everything is synthesised from first principles, so the pipeline needs no
 * audio downloads, has no licensing questions and is byte-reproducible.
 */
import path from 'node:path';
import { PATHS, ensureDir } from '../io/paths.mjs';
import { loadPlan, totalSeconds, planExists } from '../plan/store.mjs';
import { log, reportError, PipelineError } from '../io/log.mjs';
import {
  SAMPLE_RATE, silence, addTone, addNoise, addReverb, normalize,
  applyFades, softClip, writeWav, note, rng,
} from './synth.mjs';

/* ------------------------------------------------------------------ music -- */

/**
 * A restrained corporate ambience: a slow four-chord pad, a soft sub bass and a
 * sparse pulse. Deliberately low-contrast so it never competes with dialogue.
 */
function buildMusicBed(seconds) {
  const buf = silence(seconds + 1);

  // I - vi - IV - V in D major, voiced high and open so it sits above the voices.
  const progression = [
    ['D3', 'A3', 'F#4', 'A4'],
    ['B2', 'F#3', 'D4', 'F#4'],
    ['G2', 'D3', 'B3', 'D4'],
    ['A2', 'E3', 'C#4', 'E4'],
  ];

  const barSeconds = 4.0;
  const bars = Math.ceil(seconds / barSeconds);

  for (let bar = 0; bar < bars; bar++) {
    const chord = progression[bar % progression.length];
    const start = bar * barSeconds;
    chord.forEach((n, i) => {
      const f = note(n);
      // Two slightly detuned layers per note give the pad gentle movement.
      addTone(buf, {
        freq: f,
        startSeconds: start,
        duration: barSeconds + 1.2,
        gain: 0.052 / (1 + i * 0.28),
        wave: 'soft',
        detune: 0.0009 * (i % 2 === 0 ? 1 : -1),
        vibrato: 0.0012,
        vibratoRate: 0.22 + i * 0.05,
        envelope: { a: 1.1, d: 0.9, s: 0.72, r: 1.6 },
      });
      addTone(buf, {
        freq: f,
        startSeconds: start,
        duration: barSeconds + 1.2,
        gain: 0.03 / (1 + i * 0.3),
        wave: 'sine',
        detune: -0.0014,
        envelope: { a: 1.4, d: 0.8, s: 0.6, r: 1.7 },
      });
    });

    // Sub bass, one octave below the chord root.
    addTone(buf, {
      freq: note(chord[0]) / 2,
      startSeconds: start,
      duration: barSeconds + 0.5,
      gain: 0.075,
      wave: 'sine',
      envelope: { a: 0.7, d: 0.6, s: 0.65, r: 1.0 },
    });

    // Sparse high pulse on the half bar - a subtle sense of forward motion.
    for (const beat of [0, 2]) {
      addTone(buf, {
        freq: note(chord[3]) * 2,
        startSeconds: start + beat,
        duration: 0.9,
        gain: 0.019,
        wave: 'sine',
        envelope: { a: 0.02, d: 0.35, s: 0.12, r: 0.4 },
      });
    }
  }

  let out = addReverb(buf, { delaySeconds: 0.17, feedback: 0.36, mix: 0.3, taps: 4 });
  out = out.slice(0, Math.round(seconds * SAMPLE_RATE));
  normalize(out, 0.72);
  softClip(out, 1.1);
  applyFades(out, 1.4, 2.2);
  return out;
}

/* -------------------------------------------------------------------- sfx -- */

/** Two-tone enterprise notification: a clean rising perfect fourth. */
function buildNotification() {
  const buf = silence(1.1);
  addTone(buf, { freq: note('D5'), startSeconds: 0, duration: 0.4, gain: 0.42, wave: 'sine', envelope: { a: 0.004, d: 0.12, s: 0.3, r: 0.24 } });
  addTone(buf, { freq: note('G5'), startSeconds: 0.1, duration: 0.55, gain: 0.36, wave: 'sine', envelope: { a: 0.004, d: 0.16, s: 0.28, r: 0.34 } });
  addTone(buf, { freq: note('D6'), startSeconds: 0.1, duration: 0.5, gain: 0.1, wave: 'sine', envelope: { a: 0.004, d: 0.1, s: 0.14, r: 0.34 } });
  const out = addReverb(buf, { delaySeconds: 0.075, feedback: 0.26, mix: 0.24, taps: 3 });
  normalize(out, 0.78);
  applyFades(out, 0.002, 0.14);
  return out;
}

/** Soft "message sent" blip. */
function buildMessage() {
  const buf = silence(0.42);
  addTone(buf, { freq: note('A5'), startSeconds: 0, duration: 0.16, gain: 0.3, wave: 'sine', envelope: { a: 0.003, d: 0.06, s: 0.2, r: 0.09 } });
  addTone(buf, { freq: note('E6'), startSeconds: 0.02, duration: 0.14, gain: 0.12, wave: 'sine', envelope: { a: 0.003, d: 0.05, s: 0.14, r: 0.08 } });
  addNoise(buf, { startSeconds: 0, duration: 0.05, gain: 0.06, seed: 21, lowpass: 7000, highpass: 1200 });
  const out = addReverb(buf, { delaySeconds: 0.05, feedback: 0.2, mix: 0.16, taps: 2 });
  normalize(out, 0.7);
  applyFades(out, 0.002, 0.09);
  return out;
}

/** A short loop of mechanical keyboard clicks, irregular enough to feel human. */
function buildTyping() {
  const seconds = 2.2;
  const buf = silence(seconds);
  const rand = rng(1337);
  let t = 0.01;
  while (t < seconds - 0.08) {
    addNoise(buf, {
      startSeconds: t,
      duration: 0.032,
      gain: 0.24 + rand() * 0.14,
      seed: Math.floor(rand() * 100000) + 1,
      lowpass: 4200 + rand() * 2600,
      highpass: 700 + rand() * 500,
      envelope: { a: 0.0008, d: 0.008, s: 0.08, r: 0.02 },
    });
    addTone(buf, {
      freq: 1500 + rand() * 900,
      startSeconds: t,
      duration: 0.022,
      gain: 0.05,
      wave: 'sine',
      envelope: { a: 0.0008, d: 0.006, s: 0.05, r: 0.014 },
    });
    t += 0.062 + rand() * 0.055;
  }
  normalize(buf, 0.5);
  applyFades(buf, 0.008, 0.09);
  return buf;
}

/** Low, calm pulsing tone that reads as "the system is working". */
function buildProcessing() {
  const seconds = 2.0;
  const buf = silence(seconds);
  for (let i = 0; i * 0.5 < seconds - 0.4; i++) {
    const t = i * 0.5;
    addTone(buf, { freq: note('D4'), startSeconds: t, duration: 0.42, gain: 0.16, wave: 'sine', envelope: { a: 0.05, d: 0.14, s: 0.35, r: 0.22 } });
    addTone(buf, { freq: note('A4'), startSeconds: t, duration: 0.42, gain: 0.07, wave: 'sine', envelope: { a: 0.06, d: 0.14, s: 0.28, r: 0.22 } });
  }
  addTone(buf, { freq: note('D3'), startSeconds: 0, duration: seconds, gain: 0.06, wave: 'sine', envelope: { a: 0.2, d: 0.3, s: 0.7, r: 0.5 } });
  const out = addReverb(buf, { delaySeconds: 0.09, feedback: 0.24, mix: 0.2, taps: 3 });
  normalize(out, 0.6);
  applyFades(out, 0.05, 0.2);
  return out;
}

/** Rising three-note resolution for the successful completion moment. */
function buildSuccess() {
  const buf = silence(2.0);
  const seq = [
    { n: 'D5', t: 0.0 },
    { n: 'F#5', t: 0.115 },
    { n: 'A5', t: 0.23 },
    { n: 'D6', t: 0.36 },
  ];
  for (const { n, t } of seq) {
    addTone(buf, { freq: note(n), startSeconds: t, duration: 1.1, gain: 0.3, wave: 'sine', envelope: { a: 0.004, d: 0.2, s: 0.22, r: 0.8 } });
    addTone(buf, { freq: note(n) * 2, startSeconds: t, duration: 0.7, gain: 0.06, wave: 'sine', envelope: { a: 0.004, d: 0.14, s: 0.12, r: 0.5 } });
  }
  addTone(buf, { freq: note('D3'), startSeconds: 0.34, duration: 1.3, gain: 0.12, wave: 'soft', envelope: { a: 0.02, d: 0.3, s: 0.4, r: 0.9 } });
  const out = addReverb(buf, { delaySeconds: 0.13, feedback: 0.34, mix: 0.32, taps: 4 });
  normalize(out, 0.8);
  applyFades(out, 0.002, 0.35);
  return out;
}

/** Restrained scene-change whoosh with a soft tonal landing. */
function buildTransition() {
  const seconds = 1.15;
  const buf = silence(seconds);
  const rand = rng(909);
  // Sweeping filtered noise.
  for (let i = 0; i < 26; i++) {
    const t = (i / 26) * 0.62;
    addNoise(buf, {
      startSeconds: t,
      duration: 0.2,
      gain: 0.055 * Math.sin((Math.PI * i) / 26),
      seed: Math.floor(rand() * 90000) + 1,
      lowpass: 900 + i * 320,
      highpass: 260 + i * 40,
      envelope: { a: 0.03, d: 0.06, s: 0.5, r: 0.1 },
    });
  }
  addTone(buf, { freq: note('D4'), startSeconds: 0.5, duration: 0.6, gain: 0.14, wave: 'sine', envelope: { a: 0.03, d: 0.18, s: 0.2, r: 0.38 } });
  addTone(buf, { freq: note('A4'), startSeconds: 0.5, duration: 0.55, gain: 0.07, wave: 'sine', envelope: { a: 0.03, d: 0.16, s: 0.16, r: 0.34 } });
  const out = addReverb(buf, { delaySeconds: 0.11, feedback: 0.28, mix: 0.24, taps: 3 });
  normalize(out, 0.6);
  applyFades(out, 0.02, 0.22);
  return out;
}

/* ------------------------------------------------------------------- main -- */

export async function generateSfx({ onProgress } = {}) {
  // The sound set is fixed; only the music bed's length depends on the plan.
  // Without a plan yet, a generous default keeps the assets usable.
  const plan = planExists() ? loadPlan() : null;
  ensureDir(PATHS.audio);

  const musicSeconds = plan ? Math.ceil(totalSeconds(plan)) + 2 : 90;
  const jobs = [
    { name: 'music_bed.wav', build: () => buildMusicBed(musicSeconds), label: 'music bed' },
    { name: 'sfx_notification.wav', build: buildNotification, label: 'notification chime' },
    { name: 'sfx_message.wav', build: buildMessage, label: 'message blip' },
    { name: 'sfx_typing.wav', build: buildTyping, label: 'keyboard typing' },
    { name: 'sfx_processing.wav', build: buildProcessing, label: 'processing pulse' },
    { name: 'sfx_success.wav', build: buildSuccess, label: 'success chime' },
    { name: 'sfx_transition.wav', build: buildTransition, label: 'transition whoosh' },
  ];

  const results = [];
  for (const [i, job] of jobs.entries()) {
    const target = path.join(PATHS.audio, job.name);
    try {
      const buf = job.build();
      const res = writeWav(target, buf);
      results.push({ file: job.name, seconds: Number(res.seconds.toFixed(3)), bytes: res.bytes });
      log.ok(`${job.label.padEnd(22)} ${job.name} (${res.seconds.toFixed(2)}s)`);
    } catch (cause) {
      throw new PipelineError(`Failed to synthesise audio asset "${job.name}"`, {
        stage: 'sfx', hint: `Check write permissions for ${PATHS.audio}`, cause,
      });
    }
    onProgress?.({ index: i + 1, total: jobs.length, label: job.label });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('sfx.mjs')) {
  log.banner('Audio assets — music & SFX');
  generateSfx().then((r) => {
    log.blank();
    log.info(`${r.length} audio assets written to public/audio`);
  }).catch((err) => { reportError(err); process.exit(1); });
}
