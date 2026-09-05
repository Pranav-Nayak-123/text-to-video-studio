#!/usr/bin/env node
/**
 * Environment preflight.
 *
 * Reports what the pipeline found and, for anything missing, what it will fall
 * back to. Nothing here is fatal except a missing ffmpeg: every optional
 * provider has a working local substitute.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS, ensureAllDirs } from '../engine/io/paths.mjs';
import { log, reportError } from '../engine/io/log.mjs';
import { planExists, loadPlan } from '../engine/plan/store.mjs';
import { analyseStory } from '../engine/analysis/heuristic.mjs';

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
const firstLine = (s) => String(s ?? '').split('\n')[0].trim();

function check(label, fn) {
  try {
    const r = fn();
    log[r.ok ? 'ok' : 'warn'](`${label.padEnd(22)} ${r.detail}`);
    return r;
  } catch (err) {
    log.error(`${label.padEnd(22)} ${err.message}`);
    return { ok: false, detail: err.message };
  }
}

async function main() {
  log.banner('Environment check');
  ensureAllDirs();

  const results = {};

  results.node = check('Node.js', () => ({ ok: true, detail: process.version }));

  results.ffmpeg = check('ffmpeg', () => {
    const r = run('ffmpeg', ['-version']);
    return r.status === 0
      ? { ok: true, detail: firstLine(r.stdout).replace('ffmpeg version ', '') }
      : { ok: false, detail: 'NOT FOUND — required. Install from https://ffmpeg.org/download.html' };
  });

  results.ffprobe = check('ffprobe', () => {
    const r = run('ffprobe', ['-version']);
    return r.status === 0
      ? { ok: true, detail: firstLine(r.stdout).replace('ffprobe version ', '') }
      : { ok: false, detail: 'NOT FOUND — verification and retiming will not run' };
  });

  results.python = check('Python', () => {
    const bin = process.env.PYTHON_BIN || 'python';
    const r = run(bin, ['--version']);
    return r.status === 0
      ? { ok: true, detail: firstLine(r.stdout || r.stderr) }
      : { ok: false, detail: 'not found — neural voices unavailable, Windows SAPI will be used' };
  });

  results.edgeTts = check('edge-tts', () => {
    const bin = process.env.PYTHON_BIN || 'python';
    const r = run(bin, ['-c', 'import edge_tts, sys; sys.stdout.write(getattr(edge_tts, "__version__", "installed"))']);
    return r.status === 0
      ? { ok: true, detail: `neural voices available (${firstLine(r.stdout)})` }
      : { ok: false, detail: 'not installed — falling back to Windows SAPI (pip install edge-tts)' };
  });

  results.sapi = check('Offline voices', () => {
    if (process.platform !== 'win32') return { ok: false, detail: 'Windows SAPI not applicable on this platform' };
    const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices().Count']);
    const count = Number(firstLine(r.stdout));
    return count > 0
      ? { ok: true, detail: `${count} Windows SAPI voice(s) available as a fallback` }
      : { ok: false, detail: 'none found' };
  });

  results.llm = check('Story model', () => (
    process.env.OPENAI_API_KEY
      ? { ok: true, detail: 'API key set — model-backed analysis will be attempted' }
      : { ok: false, detail: 'no OPENAI_API_KEY — using the built-in analyser (works offline)' }
  ));

  results.images = check('Image provider', () => (
    process.env.OPENAI_API_KEY
      ? { ok: true, detail: 'API key set — photoreal plates will be attempted' }
      : { ok: false, detail: 'no OPENAI_API_KEY — using the built-in vector plates' }
  ));

  results.analyser = check('Built-in analyser', () => {
    const plan = analyseStory('A doctor walks into a hospital room and speaks to a patient.');
    return {
      ok: plan.characters.length === 2 && plan.scenes.length >= 1,
      detail: `working — found ${plan.characters.map((c) => c.name).join(', ')}`,
    };
  });

  /* -------------------------------------------------------------- stories -- */

  log.blank();
  log.step('Sample stories');
  try {
    for (const file of fs.readdirSync(path.join(PATHS.root, 'stories')).filter((f) => f.endsWith('.txt'))) {
      const words = fs.readFileSync(path.join(PATHS.root, 'stories', file), 'utf8').split(/\s+/).filter(Boolean).length;
      log.info(`${file.padEnd(32)} ${words} words`);
    }
  } catch {
    log.warn('no stories directory found');
  }

  /* ----------------------------------------------------------- current plan -- */

  log.blank();
  log.step('Current plan');
  if (planExists()) {
    try {
      const plan = loadPlan();
      log.ok(`${plan.meta.title} — ${plan.totals.characters} characters, ${plan.totals.scenes} scenes, ${plan.totals.seconds}s`);
      const platesDir = path.join(PATHS.public, 'plates');
      const platesOk = plan.scenes.every((s) =>
        fs.existsSync(path.join(platesDir, `${s.id}.svg`)) || fs.existsSync(path.join(platesDir, `${s.id}.png`)));
      const voicesOk = plan.scenes.every((s) => (s.dialogue ?? [])
        .every((d) => d.enabled === false || fs.existsSync(path.join(PATHS.audio, d.file))));
      log[platesOk ? 'ok' : 'warn'](`${'scene plates'.padEnd(22)} ${platesOk ? 'ready' : 'missing — run npm run assets'}`);
      log[voicesOk ? 'ok' : 'warn'](`${'character voices'.padEnd(22)} ${voicesOk ? 'ready' : 'missing — run npm run assets'}`);
    } catch (err) {
      log.warn(`a plan exists but could not be read: ${err.message}`);
    }
  } else {
    log.info('none yet — submit a story in the web app, or run npm run story -- <file>');
  }

  const output = path.join(PATHS.output, 'story.mp4');
  log[fs.existsSync(output) ? 'ok' : 'info'](
    `${'rendered video'.padEnd(22)} ${fs.existsSync(output) ? `${(fs.statSync(output).size / 1e6).toFixed(2)} MB` : 'not rendered yet'}`);

  /* ------------------------------------------------------------- verdict -- */

  log.blank();
  if (!results.ffmpeg.ok) {
    log.error('ffmpeg is required. Install it, reopen your terminal, and run this again.');
    process.exit(1);
  }

  log.banner('Next step');
  log.info('npm start                                     open the studio and paste a story');
  log.info('npm run story -- stories/coffee-shop.txt -r   or generate from the command line');
}

main().catch((err) => { reportError(err); process.exit(1); });
