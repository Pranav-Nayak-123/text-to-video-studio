#!/usr/bin/env node
/**
 * Generates the character dialogue track for every spoken line in the story.
 *
 * Provider chain (first one that works wins, per line):
 *   1. edge-tts  - Microsoft neural voices, distinct male/female timbres.
 *   2. Windows SAPI (System.Speech) - fully offline fallback.
 *   3. Silent placeholder of the authored length - keeps the render valid so a
 *      voice track can be dropped in later without touching the pipeline.
 *
 * Every line is loudness-normalised so dialogue sits consistently above the
 * music bed, and each result is measured and checked against the time available
 * in its scene.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS, ensureDir } from '../io/paths.mjs';
import { loadPlan, allDialogue, characterById } from '../plan/store.mjs';
import { log, reportError, PipelineError } from '../io/log.mjs';
import { silence, writeWav } from './synth.mjs';

const PY = process.env.PYTHON_BIN || 'python';

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
}

/** Duration of a media file in seconds, via ffprobe. */
export function probeDuration(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  if (r.status !== 0) return null;
  const v = parseFloat(String(r.stdout).trim());
  return Number.isFinite(v) ? v : null;
}

function ffmpegAvailable() {
  return run('ffmpeg', ['-version']).status === 0;
}

/**
 * Convert any TTS output to the render format: 48kHz stereo WAV, loudness
 * normalised, with a touch of silence trimmed from the head so lines start
 * exactly on their cue.
 */
function toRenderWav(input, output) {
  const filters = [
    'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    'aresample=48000',
  ].join(',');
  const r = run('ffmpeg', [
    '-y', '-v', 'error', '-i', input,
    '-af', filters, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', output,
  ]);
  if (r.status !== 0) {
    throw new PipelineError(`ffmpeg could not convert "${path.basename(input)}" to WAV`, {
      stage: 'voice', hint: 'Confirm ffmpeg is on PATH and supports pcm_s16le.', cause: new Error(r.stderr?.trim()),
    });
  }
  return output;
}

/* --------------------------------------------------------------- providers -- */

function synthEdgeTts(line, character, tempMp3) {
  // `--rate`/`--pitch` values start with + or -, so they must be passed in the
  // `--flag=value` form or argparse treats "-4Hz" as an unknown option.
  const rate = line.rate ?? character.voice.rate ?? '+0%';
  const pitch = line.pitch ?? character.voice.pitch ?? '+0Hz';
  const r = run(PY, [
    '-m', 'edge_tts',
    '--voice', character.voice.voiceId,
    `--rate=${rate}`,
    `--pitch=${pitch}`,
    '--text', line.speakText ?? line.text,
    '--write-media', tempMp3,
  ], { timeout: 60000 });

  if (r.status !== 0 || !fs.existsSync(tempMp3) || fs.statSync(tempMp3).size < 512) {
    throw new Error(`edge-tts failed: ${(r.stderr || r.error?.message || 'no audio produced').trim().slice(0, 300)}`);
  }
  return tempMp3;
}

function synthSapi(line, character, tempWav) {
  const text = (line.speakText ?? line.text).replace(/'/g, "''");
  const voice = (character.voice.sapiVoice ?? '').replace(/'/g, "''");
  const rate = character.voice.sapiRate ?? 2;
  const ps = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    voice ? `try { $s.SelectVoice('${voice}') } catch { };` : '',
    `$s.Rate = ${rate};`,
    `$s.SetOutputToWaveFile('${tempWav.replace(/'/g, "''")}');`,
    `$s.Speak('${text}');`,
    '$s.Dispose();',
  ].join(' ');

  const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 60000 });
  if (r.status !== 0 || !fs.existsSync(tempWav) || fs.statSync(tempWav).size < 512) {
    throw new Error(`SAPI failed: ${(r.stderr || 'no audio produced').trim().slice(0, 300)}`);
  }
  return tempWav;
}

/* -------------------------------------------------------------------- main -- */

export async function generateVoice({ onProgress, force = false, includeDisabled = false } = {}) {
  const plan = loadPlan();
  ensureDir(PATHS.audio);
  ensureDir(PATHS.temp);

  if (!ffmpegAvailable()) {
    throw new PipelineError('ffmpeg is not available on PATH', {
      stage: 'voice',
      hint: 'Install ffmpeg (https://ffmpeg.org/download.html) and reopen your terminal.',
    });
  }

  const lines = allDialogue(plan, { includeDisabled });
  const manifest = { generatedAt: new Date().toISOString(), providerSummary: {}, lines: [] };
  const warnings = [];

  for (const [i, line] of lines.entries()) {
    const character = characterById(plan, line.characterId);
    const target = path.join(PATHS.audio, line.file);
    const tempMp3 = path.join(PATHS.temp, `${line.id}.mp3`);
    const tempWav = path.join(PATHS.temp, `${line.id}.sapi.wav`);

    if (!force && fs.existsSync(target)) {
      const seconds = probeDuration(target) ?? 0;
      manifest.lines.push({ id: line.id, file: line.file, characterId: character.id, seconds, provider: 'cached' });
      log.info(`${line.id.padEnd(16)} cached (${seconds.toFixed(2)}s)`);
      onProgress?.({ index: i + 1, total: lines.length, label: line.id });
      continue;
    }

    let provider = null;
    let lastError = null;

    for (const attempt of ['edge-tts', 'sapi']) {
      try {
        if (attempt === 'edge-tts') {
          toRenderWav(synthEdgeTts(line, character, tempMp3), target);
        } else {
          toRenderWav(synthSapi(line, character, tempWav), target);
        }
        provider = attempt;
        break;
      } catch (err) {
        lastError = err;
        log.warn(`${line.id}: ${attempt} unavailable — ${err.message.split('\n')[0]}`);
      }
    }

    if (!provider) {
      // Last resort: authored-length silence. The video still renders correctly
      // and a real voice track can be substituted by re-running this script.
      const estimated = estimateSpeechSeconds(line.speakText ?? line.text);
      writeWav(target, silence(estimated));
      provider = 'silent-placeholder';
      warnings.push(`${line.id}: no TTS provider available, wrote ${estimated.toFixed(1)}s of silence`);
    }

    const seconds = probeDuration(target) ?? 0;
    manifest.providerSummary[provider] = (manifest.providerSummary[provider] ?? 0) + 1;
    manifest.lines.push({
      id: line.id, file: line.file, characterId: character.id,
      voiceId: character.voice.voiceId, sceneId: line.sceneId,
      startAt: line.startAt, seconds, provider,
    });

    // Does the line fit in the room the scene gives it?
    const available = line.scene.durationSeconds - line.startAt;
    const fit = seconds <= available + 0.35;
    const flag = fit ? '' : `  ← overruns scene by ${(seconds - available).toFixed(2)}s`;
    if (!fit) warnings.push(`${line.id} runs ${seconds.toFixed(2)}s but only ${available.toFixed(2)}s remain in ${line.sceneId}`);
    log[fit ? 'ok' : 'warn'](
      `${line.id.padEnd(16)} ${character.voice.voiceId.padEnd(24)} ${seconds.toFixed(2)}s / ${available.toFixed(2)}s${flag}`,
    );

    for (const f of [tempMp3, tempWav]) if (fs.existsSync(f)) fs.unlinkSync(f);
    onProgress?.({ index: i + 1, total: lines.length, label: line.id });
  }

  manifest.warnings = warnings;
  fs.writeFileSync(path.join(PATHS.audio, 'voice-manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Rough spoken length, used only when every TTS provider is unavailable. */
export function estimateSpeechSeconds(text) {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1.2, (words / 175) * 60);
}

if (process.argv[1]?.endsWith('tts.mjs')) {
  log.banner('Character dialogue — neural TTS');
  generateVoice({
    force: process.argv.includes('--force'),
    includeDisabled: process.argv.includes('--all'),
  })
    .then((m) => {
      log.blank();
      log.info(`providers: ${Object.entries(m.providerSummary).map(([k, v]) => `${k}×${v}`).join(', ') || 'all cached'}`);
      if (m.warnings.length) m.warnings.forEach((w) => log.warn(w));
      else log.ok('every line fits inside its scene');
    })
    .catch((err) => { reportError(err); process.exit(1); });
}
