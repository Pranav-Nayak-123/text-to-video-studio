import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS } from '../engine/io/paths.mjs';
import { planExists, loadPlan, allDialogue } from '../engine/plan/store.mjs';
import { analyseStory } from '../engine/analysis/heuristic.mjs';
import { compilePlan } from '../engine/plan/compile.mjs';
import { note, writeWav, silence, addTone, SAMPLE_RATE } from '../engine/audio/synth.mjs';
import { buildScenePlate, buildPortraitPlate } from '../engine/world/scene-plate.mjs';
import { backdrop, BACKDROP_KINDS } from '../engine/world/backdrops.mjs';
import { figure } from '../engine/cast/figures.mjs';
import { STYLES } from '../engine/analysis/lexicon.mjs';

const STORY = 'A teacher enters a classroom and greets two students. She asks them about their science project. The teacher congratulates them.';
const plan = compilePlan(analyseStory(STORY), { targetSeconds: 30 });
const palette = STYLES.cinematic.colors;

const durationOf = (file) => {
  const r = spawnSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? parseFloat(r.stdout.trim()) : null;
};

describe('audio synthesis', () => {
  test('note names map to the right frequencies', () => {
    assert.ok(Math.abs(note('A4') - 440) < 0.001);
    assert.ok(Math.abs(note('C4') - 261.6256) < 0.01);
    assert.ok(Math.abs(note('F#4') - 369.9944) < 0.01);
  });

  test('rejects an unparseable note', () => {
    assert.throws(() => note('H4'), /Unknown note/);
  });

  test('writes a WAV that ffprobe agrees with', () => {
    const buf = silence(0.5);
    addTone(buf, { freq: 440, duration: 0.5, gain: 0.5 });
    const file = path.join(PATHS.temp, 'test-tone.wav');
    try {
      const result = writeWav(file, buf);
      assert.ok(Math.abs(result.seconds - 0.5) < 0.001);
      const probed = durationOf(file);
      assert.ok(probed !== null && Math.abs(probed - 0.5) < 0.02, `ffprobe reports ${probed}s`);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  test('synthesised audio is not silent', () => {
    const buf = silence(0.2);
    addTone(buf, { freq: 440, duration: 0.2, gain: 0.5 });
    assert.ok(buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) > 0.4);
  });

  test('runs at the render sample rate', () => {
    assert.equal(SAMPLE_RATE, 48000);
  });
});

describe('backdrops', () => {
  test('every location kind the analyser can produce has a backdrop', () => {
    for (const kind of BACKDROP_KINDS) {
      const set = backdrop(kind, palette, '#3E8BFF');
      assert.ok(set.background.length > 100, `${kind} has no background`);
      assert.ok(set.foreground.length > 20, `${kind} has no foreground`);
      assert.ok(set.groundY > 0 && set.groundY < 1024, `${kind} has an implausible ground line`);
    }
  });

  test('an unknown kind falls back rather than failing', () => {
    const set = backdrop('somewhere-unheard-of', palette, '#3E8BFF');
    assert.ok(set.background.length > 100);
  });

  test('backdrops contain no unresolved template values', () => {
    for (const kind of BACKDROP_KINDS) {
      const set = backdrop(kind, palette, '#3E8BFF');
      const markup = set.defs + set.background + set.foreground;
      assert.equal(markup.includes('undefined'), false, `${kind} contains "undefined"`);
      assert.equal(markup.includes('${'), false, `${kind} has an unresolved placeholder`);
    }
  });
});

describe('character figures and plates', () => {
  test('a figure renders from a character identity', () => {
    for (const character of plan.characters) {
      const svg = figure(character, { x: 400, feetY: 1100, scale: 1.3, facing: 1 });
      assert.ok(svg.includes('<g transform='), `${character.name} produced no figure`);
      assert.equal(svg.includes('undefined'), false, `${character.name} figure contains "undefined"`);
    }
  });

  test('the same character always renders identically', () => {
    const character = plan.characters[0];
    const options = { x: 400, feetY: 1100, scale: 1.3, facing: 1 };
    assert.equal(figure(character, options), figure(character, options));
  });

  test('different characters look different', () => {
    const options = { x: 400, feetY: 1100, scale: 1.3, facing: 1 };
    const drawings = plan.characters.map((c) => figure(c, options));
    assert.equal(new Set(drawings).size, drawings.length, 'two characters render identically');
  });

  test('a scene plate is a valid SVG at the plate size', () => {
    for (const scene of plan.scenes) {
      const cast = scene.characterIds.map((id) => plan.characters.find((c) => c.id === id)).filter(Boolean);
      const svg = buildScenePlate({ location: scene.location, characters: cast, palette, accent: '#3E8BFF' });
      assert.ok(svg.startsWith('<svg'), `${scene.id} did not produce an SVG`);
      assert.ok(svg.trimEnd().endsWith('</svg>'), `${scene.id} SVG is not closed`);
      assert.ok(svg.includes('width="1536"') && svg.includes('height="1024"'));
      assert.equal(svg.includes('undefined'), false, `${scene.id} contains "undefined"`);
    }
  });

  test('a scene with no cast still produces a plate', () => {
    const svg = buildScenePlate({
      location: { name: 'Nowhere', kind: 'generic' }, characters: [], palette, accent: '#3E8BFF',
    });
    assert.ok(svg.startsWith('<svg'));
  });

  test('a portrait renders for every character', () => {
    for (const character of plan.characters) {
      const svg = buildPortraitPlate({ character, palette, accent: character.accent });
      assert.ok(svg.startsWith('<svg') && svg.includes('512'));
    }
  });

  test('plates contain no malformed colours', () => {
    const cast = plan.characters;
    const svg = buildScenePlate({ location: { name: 'Room', kind: 'office' }, characters: cast, palette, accent: '#3E8BFF' });
    const bad = svg.match(/fill="#[0-9A-Fa-f]*[^0-9A-Fa-f"][^"]*"/);
    assert.equal(bad, null, `malformed colour: ${bad?.[0]}`);
  });
});

/**
 * These check the assets belonging to whatever plan is currently on disk.
 *
 * They are skipped until assets have actually been built for that plan. A
 * checkout ships a seed plan but no assets, so without this guard a fresh clone
 * would report failures for work it was never asked to do.
 */
function assetsBuiltFor(plan) {
  if (!plan) return false;
  const lines = plan.scenes.flatMap((s) => (s.dialogue ?? []).filter((d) => d.enabled !== false));
  if (!lines.length) return false;
  return lines.every((line) => fs.existsSync(path.join(PATHS.audio, line.file)));
}

const currentPlan = planExists() ? loadPlan() : null;
const hasAssets = assetsBuiltFor(currentPlan);

describe('generated assets for the current plan', {
  skip: hasAssets ? false : 'assets not built for the current plan — run "npm run assets"',
}, () => {
  const current = currentPlan;

  test('a plate exists for every scene', () => {
    for (const scene of current.scenes) {
      const svg = path.join(PATHS.public, 'plates', `${scene.id}.svg`);
      const png = path.join(PATHS.public, 'plates', `${scene.id}.png`);
      assert.ok(fs.existsSync(svg) || fs.existsSync(png), `no plate for ${scene.id}`);
    }
  });

  test('every UI sound the plan cues exists', () => {
    for (const scene of current.scenes) {
      for (const cue of scene.sfx ?? []) {
        const asset = current.audio.sfx[cue.cue];
        assert.ok(asset, `undefined cue "${cue.cue}" in ${scene.id}`);
        assert.ok(fs.existsSync(path.join(PATHS.audio, asset.file)), `${asset.file} is missing`);
      }
    }
  });

  test('the music bed covers the whole video', () => {
    const file = path.join(PATHS.audio, current.audio.music.file);
    assert.ok(fs.existsSync(file), 'music bed missing');
    const seconds = durationOf(file);
    assert.ok(seconds >= current.totals.seconds,
      `music is ${seconds}s but the video runs ${current.totals.seconds}s`);
  });

  test('sounds are mixed below the dialogue', () => {
    for (const [cue, asset] of Object.entries(current.audio.sfx)) {
      assert.ok(asset.volume < current.audio.dialogueVolume, `${cue} is not below dialogue`);
    }
    assert.ok(current.audio.music.volume <= 0.2, 'music would compete with speech');
  });

  test('every spoken line has audio that fits its scene', () => {
    for (const line of allDialogue(current)) {
      const file = path.join(PATHS.audio, line.file);
      assert.ok(fs.existsSync(file), `${line.file} is missing`);
      const seconds = durationOf(file);
      assert.ok(seconds > 0.3, `${line.id} is only ${seconds}s — synthesis probably failed`);
      const available = line.scene.durationSeconds - line.startAt;
      assert.ok(seconds <= available + 0.4,
        `${line.id} runs ${seconds.toFixed(2)}s but only ${available.toFixed(2)}s remain`);
    }
  });

  test('dialogue lines do not overlap', () => {
    for (const scene of current.scenes) {
      const lines = (scene.dialogue ?? [])
        .filter((d) => d.enabled !== false)
        .map((d) => ({ ...d, seconds: durationOf(path.join(PATHS.audio, d.file)) ?? 0 }))
        .sort((a, b) => a.startAt - b.startAt);
      for (let i = 1; i < lines.length; i++) {
        const previousEnd = lines[i - 1].startAt + lines[i - 1].seconds;
        assert.ok(lines[i].startAt >= previousEnd - 0.25,
          `${lines[i].id} starts at ${lines[i].startAt}s while ${lines[i - 1].id} runs to ${previousEnd.toFixed(2)}s`);
      }
    }
  });

  test('the self-hosted typefaces are present', () => {
    const manifest = path.join(PATHS.public, 'fonts', 'font-manifest.json');
    assert.ok(fs.existsSync(manifest), 'font manifest missing');
    for (const font of JSON.parse(fs.readFileSync(manifest, 'utf8')).fonts) {
      assert.ok(fs.existsSync(path.join(PATHS.public, 'fonts', font.file)), `${font.file} missing`);
    }
  });
});
