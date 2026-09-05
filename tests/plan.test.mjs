import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyseStory } from '../engine/analysis/heuristic.mjs';
import { compilePlan, pronounceable, formatRate } from '../engine/plan/compile.mjs';
import { validatePlan, buildTimeline, totalSeconds, allDialogue } from '../engine/plan/store.mjs';
import { assignIdentities, initialsFor, VOICE_POOLS } from '../engine/cast/identity.mjs';
import { STYLES } from '../engine/analysis/lexicon.mjs';

const COFFEE = 'A customer enters a coffee shop. He asks the cashier for a cappuccino. The cashier takes the order and the barista prepares the drink. The customer receives the coffee and leaves.';
const CLASSROOM = 'A teacher enters a classroom and greets two students. She asks them about their science project. One student explains the experiment while the other demonstrates it. The teacher congratulates them.';
const DIALOGUE = 'Sarah walks into the office. She says, "We need to leave now." John replies, "Give me one minute." They head to the street together.';

const planFor = (text, options = {}) => compilePlan(analyseStory(text, options), options);

describe('plan structure', () => {
  test('produces a valid plan for any story', () => {
    for (const story of [COFFEE, CLASSROOM, DIALOGUE]) {
      assert.equal(validatePlan(planFor(story)), true);
    }
  });

  test('a transition sits between every pair of scenes', () => {
    for (const story of [COFFEE, CLASSROOM, DIALOGUE]) {
      const plan = planFor(story);
      assert.equal(plan.transitions.length, plan.scenes.length - 1);
    }
  });

  test('the timeline is contiguous and correctly ordered', () => {
    const plan = planFor(COFFEE);
    const timeline = buildTimeline(plan);
    let cursor = 0;
    for (const segment of timeline) {
      assert.ok(Math.abs(segment.startSeconds - cursor) < 1e-9,
        `${segment.id} starts at ${segment.startSeconds}s, expected ${cursor}s`);
      cursor += segment.durationSeconds;
    }
    assert.ok(Math.abs(cursor - totalSeconds(plan)) < 1e-9);
  });

  test('every beat falls inside its scene', () => {
    for (const story of [COFFEE, CLASSROOM, DIALOGUE]) {
      for (const scene of planFor(story).scenes) {
        for (const beat of scene.beats) {
          assert.ok(beat.appearAt >= 0 && beat.appearAt < scene.durationSeconds,
            `${beat.id} at ${beat.appearAt}s in a ${scene.durationSeconds}s scene`);
        }
      }
    }
  });

  test('beats never overlap inside a scene', () => {
    for (const scene of planFor(CLASSROOM).scenes) {
      const sorted = [...scene.beats].sort((a, b) => a.appearAt - b.appearAt);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i].appearAt >= sorted[i - 1].appearAt + sorted[i - 1].duration - 0.01,
          `${sorted[i].id} starts before ${sorted[i - 1].id} finishes`);
      }
    }
  });

  test('scene count follows the story rather than a constant', () => {
    assert.equal(planFor('A doctor sees a patient. The patient rests.').scenes.length, 2);
    assert.equal(planFor(COFFEE).scenes.length, 4);
  });
});

describe('duration fitting', () => {
  test('meets a target that the story can carry', () => {
    for (const target of [15, 30, 45]) {
      const plan = planFor(COFFEE, { targetSeconds: target });
      assert.ok(Math.abs(plan.totals.seconds - target) <= Math.max(2.5, target * 0.12),
        `asked for ${target}s, planned ${plan.totals.seconds}s`);
      assert.equal(plan.meta.targetMet, true);
    }
  });

  test('a shorter target speeds the speech up', () => {
    const slow = planFor(COFFEE, { targetSeconds: 45 });
    const fast = planFor(COFFEE, { targetSeconds: 15 });
    assert.ok(fast.meta.speechRate > slow.meta.speechRate,
      `${fast.meta.speechRate}% should exceed ${slow.meta.speechRate}%`);
  });

  test('says so honestly when a target cannot be reached', () => {
    const long = Array.from({ length: 14 }, (_, i) =>
      `Scene: Room ${i + 1}\n\nThe manager reviews the report and speaks with the analyst about the quarterly figures.`).join('\n\n');
    const plan = planFor(long, { targetSeconds: 10 });
    assert.equal(plan.meta.targetMet, false);
    assert.ok(plan.totals.seconds > 10);
  });

  test('derives a duration when none is requested', () => {
    const plan = planFor(COFFEE);
    assert.equal(plan.meta.targetSeconds, null);
    assert.ok(plan.totals.seconds > 5 && plan.totals.seconds < 120);
  });

  test('frames and seconds agree', () => {
    const plan = planFor(CLASSROOM);
    assert.equal(plan.totals.frames, Math.round(plan.totals.seconds * plan.meta.fps));
  });
});

describe('character identity', () => {
  test('is stable across recompiles', () => {
    const a = planFor(CLASSROOM).characters;
    const b = planFor(CLASSROOM).characters;
    assert.deepEqual(a.map((c) => [c.id, c.accent, c.voice.voiceId]),
      b.map((c) => [c.id, c.accent, c.voice.voiceId]));
  });

  test('the same character keeps one identity in every scene it appears in', () => {
    const plan = planFor(COFFEE);
    const customer = plan.characters.find((c) => c.name === 'Customer');
    assert.ok(customer.sceneIndexes.length > 1, 'the customer should appear in several scenes');
    // Identity lives on the character, not on the scene, so it cannot vary.
    assert.equal(typeof customer.accent, 'string');
    assert.equal(typeof customer.voice.voiceId, 'string');
    assert.ok(customer.appearance.skin && customer.appearance.hair && customer.appearance.garment);
  });

  test('gives different characters different voices', () => {
    const plan = planFor(COFFEE);
    const voices = plan.characters.map((c) => c.voice.voiceId);
    assert.equal(new Set(voices).size, voices.length);
  });

  test('matches voice gender to character gender', () => {
    const plan = planFor(COFFEE);
    for (const character of plan.characters.filter((c) => c.kind === 'person')) {
      const pool = character.gender === 'female' ? VOICE_POOLS.female : VOICE_POOLS.male;
      assert.ok(pool.some((v) => v.voiceId === character.voice.voiceId),
        `${character.name} is ${character.gender} but uses ${character.voice.voiceId}`);
    }
  });

  test('resolves an unstated gender rather than leaving a character voiceless', () => {
    const plan = planFor('A cashier counts the till. A barista cleans the machine.');
    for (const character of plan.characters) {
      assert.ok(['male', 'female'].includes(character.gender));
      assert.ok(character.voice.voiceId);
    }
  });

  test('builds sensible initials', () => {
    assert.equal(initialsFor('Sarah'), 'SA');
    assert.equal(initialsFor('Request Manager'), 'RM');
    assert.equal(initialsFor('COE Operator 1'), 'O1');
  });

  test('gives the narrator its own voice', () => {
    const plan = planFor(COFFEE);
    const spoken = plan.characters.map((c) => c.voice.voiceId);
    assert.ok(!spoken.includes(plan.narrator.voice.voiceId),
      'the narrator shares a voice with a character');
  });
});

describe('styles and presentation', () => {
  test('every style declares a presentation the renderer implements', () => {
    for (const style of Object.values(STYLES)) {
      assert.ok(['narrative', 'interface'].includes(style.presentation));
      assert.ok(style.colors.bgDeep && style.colors.accent && style.colors.textPrimary);
    }
  });

  test('an explicit style is honoured', () => {
    assert.equal(planFor(COFFEE, { styleId: 'corporate' }).presentation, 'interface');
    assert.equal(planFor(COFFEE, { styleId: 'minimal' }).presentation, 'narrative');
  });

  test('a style is inferred when none is given', () => {
    assert.ok(STYLES[planFor(COFFEE).meta.styleId]);
  });

  test('resolution follows the requested aspect', () => {
    const portrait = planFor(COFFEE, { resolution: [1080, 1920] });
    assert.equal(portrait.meta.width, 1080);
    assert.equal(portrait.meta.height, 1920);
  });
});

describe('speech preparation', () => {
  test('respells codes that mix letters and digits', () => {
    assert.equal(pronounceable('system QL9'), 'system Q L 9');
    assert.match(pronounceable('number is BCM002345'), /B C M 0 0 2 3 4 5/);
  });

  test('leaves plain words and small numbers alone', () => {
    assert.equal(pronounceable('the new client number is 205'), 'the new client number is 205');
    assert.equal(pronounceable('He asks the cashier'), 'He asks the cashier');
  });

  test('the spoken form keeps every letter and digit of the written line', () => {
    const DIGITS = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
    const normalise = (t) => t.toLowerCase()
      .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => DIGITS[w])
      .replace(/[^a-z0-9]/g, '');
    for (const line of ['build a client in system QL9 with scenario ZDOC', 'request BCM002345 is queued']) {
      assert.equal(normalise(pronounceable(line)), normalise(line));
    }
  });

  test('formats a speech rate the synthesiser accepts', () => {
    assert.equal(formatRate(18), '+18%');
    assert.equal(formatRate(-10), '-10%');
    assert.equal(formatRate(0), '+0%');
  });

  test('every spoken beat produces exactly one dialogue line', () => {
    const plan = planFor(CLASSROOM);
    for (const scene of plan.scenes) {
      const spokenBeats = scene.beats.filter((b) => ['narration', 'dialogue', 'system'].includes(b.kind));
      assert.equal(scene.dialogue.length, spokenBeats.length);
    }
  });

  test('dialogue lines start when their beat does', () => {
    const plan = planFor(DIALOGUE);
    for (const line of allDialogue(plan)) {
      const beat = line.scene.beats.find((b) => `${b.id}-vo` === line.id);
      assert.ok(beat, `no beat for ${line.id}`);
      assert.equal(line.startAt, beat.appearAt);
    }
  });
});

describe('transitions', () => {
  test('a change of location announces the new place', () => {
    const plan = planFor(DIALOGUE);
    const move = plan.transitions.find((t) => t.type === 'location');
    assert.ok(move, 'no location transition for a story that changes place');
    assert.ok(move.caption.length > 0);
  });

  test('staying in one place uses a quiet fade', () => {
    const plan = planFor(COFFEE);
    assert.ok(plan.transitions.some((t) => t.type === 'fade'));
  });

  test('transitions are short pauses', () => {
    for (const story of [COFFEE, CLASSROOM, DIALOGUE]) {
      for (const t of planFor(story).transitions) {
        assert.ok(t.durationSeconds >= 0.4 && t.durationSeconds <= 2,
          `${t.id} lasts ${t.durationSeconds}s`);
      }
    }
  });
});

describe('validation', () => {
  /** Validation reports what is wrong in the error's remediation hint. */
  const rejects = (plan, pattern) => {
    let thrown = null;
    try { validatePlan(plan); } catch (err) { thrown = err; }
    assert.ok(thrown, 'the invalid plan was accepted');
    assert.match(`${thrown.message}
${thrown.hint ?? ''}`, pattern);
  };

  test('rejects a plan with no scenes', () => {
    rejects({
      meta: { fps: 30, width: 1920, height: 1080 },
      presentation: 'narrative', characters: [], scenes: [], transitions: [],
    }, /at least one scene/);
  });

  test('rejects a beat that references an unknown speaker', () => {
    const plan = planFor(COFFEE);
    plan.scenes[0].beats[0].speakerId = 'nobody';
    rejects(plan, /unknown speaker/);
  });

  test('rejects a beat past the end of its scene', () => {
    const plan = planFor(COFFEE);
    plan.scenes[0].beats[0].appearAt = plan.scenes[0].durationSeconds + 5;
    rejects(plan, /past the end/);
  });

  test('accepts every plan the compiler produces', () => {
    for (const story of [COFFEE, CLASSROOM, DIALOGUE]) {
      assert.equal(validatePlan(planFor(story)), true);
    }
  });
});
