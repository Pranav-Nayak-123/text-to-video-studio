import fs from 'node:fs';

export const SAMPLE_RATE = 48000;

/** A mono float buffer of `seconds` length, all silence. */
export function silence(seconds) {
  return new Float32Array(Math.max(1, Math.round(seconds * SAMPLE_RATE)));
}

/** Deterministic PRNG so every generated asset is byte-reproducible. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Attack / decay / sustain / release envelope evaluated at time t (seconds). */
export function adsr(t, duration, { a = 0.01, d = 0.1, s = 0.7, r = 0.2 } = {}) {
  if (t < 0 || t > duration) return 0;
  const releaseStart = Math.max(a + d, duration - r);
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < releaseStart) return s;
  const rt = (t - releaseStart) / Math.max(1e-6, duration - releaseStart);
  return s * (1 - rt);
}

/** Equal-power raised-cosine window — used for clickless fades. */
export function fadeWindow(i, n, fadeSamples) {
  if (i < fadeSamples) return 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeSamples);
  if (i > n - fadeSamples) return 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / fadeSamples);
  return 1;
}

/**
 * Add a tone into `buf` starting at `startSeconds`.
 * `wave` may be sine | triangle | soft (sine + gentle odd harmonics).
 */
export function addTone(buf, {
  freq,
  startSeconds = 0,
  duration = 1,
  gain = 0.2,
  wave = 'sine',
  envelope,
  vibrato = 0,
  vibratoRate = 5,
  detune = 0,
}) {
  const start = Math.round(startSeconds * SAMPLE_RATE);
  const n = Math.round(duration * SAMPLE_RATE);
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= buf.length) continue;
    const t = i / SAMPLE_RATE;
    const f = freq * (1 + detune) * (1 + vibrato * Math.sin(2 * Math.PI * vibratoRate * t));
    const ph = 2 * Math.PI * f * t;
    let v;
    if (wave === 'triangle') {
      v = (2 / Math.PI) * Math.asin(Math.sin(ph));
    } else if (wave === 'soft') {
      v = Math.sin(ph) + 0.18 * Math.sin(3 * ph) + 0.06 * Math.sin(5 * ph);
      v /= 1.24;
    } else {
      v = Math.sin(ph);
    }
    const env = envelope ? adsr(t, duration, envelope) : 1;
    buf[idx] += v * gain * env;
  }
  return buf;
}

/** Add filtered noise (used for key clicks and whooshes). */
export function addNoise(buf, {
  startSeconds = 0,
  duration = 0.1,
  gain = 0.2,
  seed = 7,
  lowpass = 6000,
  highpass = 200,
  envelope = { a: 0.002, d: 0.03, s: 0.2, r: 0.06 },
}) {
  const start = Math.round(startSeconds * SAMPLE_RATE);
  const n = Math.round(duration * SAMPLE_RATE);
  const rand = rng(seed);
  // One-pole low-pass and high-pass coefficients.
  const lpA = Math.exp((-2 * Math.PI * lowpass) / SAMPLE_RATE);
  const hpA = Math.exp((-2 * Math.PI * highpass) / SAMPLE_RATE);
  let lpState = 0;
  let hpState = 0;
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= buf.length) continue;
    const white = rand() * 2 - 1;
    lpState = white * (1 - lpA) + lpState * lpA;
    hpState = lpState * (1 - hpA) + hpState * hpA;
    const v = lpState - hpState;
    buf[idx] += v * gain * adsr(i / SAMPLE_RATE, duration, envelope);
  }
  return buf;
}

/** Simple feedback-delay reverb tail — enough to make chimes sound spatial. */
export function addReverb(buf, { delaySeconds = 0.11, feedback = 0.32, mix = 0.28, taps = 4 } = {}) {
  const out = Float32Array.from(buf);
  for (let tap = 1; tap <= taps; tap++) {
    const offset = Math.round(delaySeconds * tap * SAMPLE_RATE);
    const amp = mix * Math.pow(feedback, tap - 1);
    for (let i = 0; i < buf.length - offset; i++) {
      out[i + offset] += buf[i] * amp;
    }
  }
  return out;
}

/** Peak-normalise to `peak` (linear), leaving headroom for the final mix. */
export function normalize(buf, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (max < 1e-9) return buf;
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** Apply a raised-cosine fade in/out so no asset starts or ends on a click. */
export function applyFades(buf, fadeInSeconds = 0.01, fadeOutSeconds = 0.05) {
  const fi = Math.max(1, Math.round(fadeInSeconds * SAMPLE_RATE));
  const fo = Math.max(1, Math.round(fadeOutSeconds * SAMPLE_RATE));
  for (let i = 0; i < Math.min(fi, buf.length); i++) {
    buf[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
  }
  for (let i = 0; i < Math.min(fo, buf.length); i++) {
    buf[buf.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
  }
  return buf;
}

/** Soft saturation — tames peaks without audible clipping. */
export function softClip(buf, drive = 1) {
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.tanh(buf[i] * drive) / Math.tanh(drive);
  }
  return buf;
}

/** Write a mono Float32Array as a 16-bit stereo PCM WAV file. */
export function writeWav(file, mono, { sampleRate = SAMPLE_RATE, channels = 2 } = {}) {
  const frames = mono.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let off = 44;
  for (let i = 0; i < frames; i++) {
    const clamped = Math.max(-1, Math.min(1, mono[i]));
    const v = Math.round(clamped * 32767);
    for (let ch = 0; ch < channels; ch++) {
      buffer.writeInt16LE(v, off);
      off += 2;
    }
  }
  fs.writeFileSync(file, buffer);
  return { file, seconds: frames / sampleRate, bytes: buffer.length };
}

/** Musical note name -> frequency (A4 = 440Hz). */
const NOTE_OFFSETS = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
export function note(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`Unknown note "${name}"`);
  const [, letter, accidental, octave] = m;
  let semitones = NOTE_OFFSETS[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  semitones += (Number(octave) - 4) * 12;
  return 440 * Math.pow(2, semitones / 12);
}
