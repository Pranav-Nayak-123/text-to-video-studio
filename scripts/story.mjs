#!/usr/bin/env node
/**
 * Command-line entry point for the text-to-video pipeline.
 *
 *   npm run story -- stories/coffee-shop.txt --duration 30
 *   npm run story -- stories/bcm-request-automation.txt --style corporate --render
 *   echo "A doctor sees a patient." | npm run story -- --render
 *
 * Without --render it stops after producing the plan, so you can inspect what
 * the analyser understood before committing to a render.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../engine/io/paths.mjs';
import { log, reportError } from '../engine/io/log.mjs';
import { planStory, buildAssets, STYLES } from '../engine/pipeline.mjs';
import { renderVideo } from '../engine/render/render.mjs';
import { verifyOutput } from '../engine/render/verify.mjs';

function parseArgs(argv) {
  const options = {
    file: null, duration: null, style: null, title: null,
    render: false, force: false, offline: false, aspect: '16:9', voice: 'balanced', music: true,
  };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--duration': case '-d': options.duration = Number(next()); break;
      case '--style': case '-s': options.style = next(); break;
      case '--title': case '-t': options.title = next(); break;
      case '--aspect': options.aspect = next(); break;
      case '--voice': options.voice = next(); break;
      case '--render': case '-r': options.render = true; break;
      case '--force': options.force = true; break;
      case '--offline': options.offline = true; break;
      case '--no-music': options.music = false; break;
      case '--help': case '-h': options.help = true; break;
      default: if (!arg.startsWith('-')) rest.push(arg);
    }
  }
  options.file = rest[0] ?? null;
  return options;
}

const ASPECTS = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
};

function usage() {
  console.log(`
Usage: npm run story -- <story-file> [options]

  -d, --duration <seconds>   target runtime (default: derived from the story)
  -s, --style <id>           ${Object.keys(STYLES).join(' | ')}
  -t, --title <text>         title shown on screen
      --aspect <ratio>       ${Object.keys(ASPECTS).join(' | ')} (default 16:9)
      --voice <balanced|male|female>
      --no-music             mute the background bed
  -r, --render               build assets and render the video
      --force                rebuild cached assets
      --offline              skip every network provider
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { usage(); return; }

  let text;
  if (options.file) {
    const file = path.resolve(options.file);
    if (!fs.existsSync(file)) {
      log.error(`No story file at ${file}`);
      log.info(`Available samples: ${fs.readdirSync(path.join(PATHS.root, 'stories')).join(', ')}`);
      process.exit(1);
    }
    text = fs.readFileSync(file, 'utf8');
  } else if (!process.stdin.isTTY) {
    text = await new Promise((resolve) => {
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { buffer += c; });
      process.stdin.on('end', () => resolve(buffer));
    });
  } else {
    usage();
    process.exit(1);
  }

  const resolution = ASPECTS[options.aspect] ?? ASPECTS['16:9'];

  log.banner('Analysing the story');
  const plan = await planStory(text, {
    targetSeconds: options.duration,
    styleId: options.style,
    title: options.title,
    resolution,
    voiceStyle: options.voice,
    music: options.music,
    useLlm: !options.offline,
  });

  log.ok(`${plan.totals.characters} characters, ${plan.totals.scenes} scenes, ${plan.totals.spokenLines} spoken lines`);
  log.info(`style: ${plan.style.label} (${plan.presentation}) · analyser: ${plan.meta.analyser}`);
  log.info(`runtime: ${plan.totals.seconds}s${plan.meta.targetSeconds ? ` (requested ${plan.meta.targetSeconds}s${plan.meta.targetMet === false ? ' — the story needs longer' : ''})` : ''}`);
  log.blank();

  for (const character of plan.characters) {
    log.info(`${character.name.padEnd(20)} ${String(character.gender).padEnd(7)} ${character.voice.voiceId.replace('en-US-', '').padEnd(20)} scenes ${character.sceneIndexes.map((i) => i + 1).join(',')}`);
  }
  log.blank();

  for (const scene of plan.scenes) {
    log.step(`Scene ${scene.number} · ${scene.durationSeconds}s · ${scene.location.name}`);
    for (const beat of scene.beats) {
      const who = beat.speakerId ? `${beat.speakerId}: ` : '';
      log.info(`${String(beat.appearAt).padStart(6)}s ${beat.kind.padEnd(9)} ${who}${beat.text.slice(0, 70)}`);
    }
  }

  if (!options.render) {
    log.blank();
    log.info('Plan written to config/render-plan.json. Re-run with --render to build the video.');
    return;
  }

  log.banner('Building assets');
  await buildAssets({ force: options.force, offline: options.offline });

  log.banner('Rendering');
  let last = -1;
  const result = await renderVideo({
    onProgress: ({ stage, progress, message }) => {
      const pct = Math.round(progress * 100);
      if (pct !== last || stage !== 'render') {
        last = pct;
        process.stdout.write(`\r  ${stage.padEnd(8)} ${String(pct).padStart(3)}%  ${message ?? ''}`.padEnd(78));
      }
    },
  });
  process.stdout.write('\n');
  log.ok(`${path.relative(PATHS.root, result.output)} — ${result.seconds.toFixed(2)}s, ${(result.bytes / 1e6).toFixed(2)} MB`);

  log.banner('Verifying');
  const { checks, failed } = await verifyOutput({ file: result.output });
  for (const c of checks) log[c.pass ? 'ok' : 'error'](`${c.name.padEnd(48)} ${c.detail ?? ''}`);
  log.blank();
  if (failed.length) { log.error(`${failed.length} of ${checks.length} checks failed`); process.exit(1); }
  log.ok(`all ${checks.length} checks passed`);
}

main().catch((err) => { reportError(err); process.exit(1); });
