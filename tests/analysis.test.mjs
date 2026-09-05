import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyseStory } from '../engine/analysis/heuristic.mjs';
import { splitSentences, findLocation, extractQuotes, titleCase } from '../engine/analysis/text.mjs';

/**
 * The analyser is the product. These tests use completely unrelated stories on
 * purpose: nothing here may depend on any particular domain.
 */

const COFFEE = 'A customer enters a coffee shop. He asks the cashier for a cappuccino. The cashier takes the order and the barista prepares the drink. The customer receives the coffee and leaves.';
const CLASSROOM = 'A teacher enters a classroom and greets two students. She asks them about their science project. One student explains the experiment while the other demonstrates it. The teacher congratulates them.';
const HOSPITAL = 'A doctor walks into a hospital room and speaks to a patient. The patient explains that he has been feeling tired. The doctor examines him and recommends that he rest.';
const QUOTED = 'Sarah walks into the office. She says, "We need to leave now." John replies, "Give me one minute." They head to the street together.';

const names = (plan) => plan.characters.map((c) => c.name).sort();
const beatsOf = (plan) => plan.scenes.flatMap((s) => s.beats);

describe('sentence segmentation', () => {
  test('splits plain prose', () => {
    assert.equal(splitSentences('One. Two. Three.').length, 3);
  });

  test('keeps a quotation together', () => {
    const out = splitSentences('He said, "Wait. Stop." Then he left.');
    assert.equal(out.length, 2);
    assert.match(out[0], /Wait\. Stop\./);
  });

  test('ends a sentence whose full stop is inside its closing quote', () => {
    const out = splitSentences('She says, "We need to leave now." John replies, "Give me one minute."');
    assert.equal(out.length, 2);
  });

  test('extracts quoted spans', () => {
    const quotes = extractQuotes('A says, "one" and B says, "two"');
    assert.deepEqual(quotes.map((q) => q.text), ['one', 'two']);
  });

  test('does not treat an apostrophe as a quote', () => {
    assert.equal(extractQuotes("It's the cashier's order").length, 0);
  });
});

describe('location detection', () => {
  test('finds a location introduced by a preposition', () => {
    assert.deepEqual(findLocation('A doctor walks into a hospital room.'),
      { name: 'Hospital Room', kind: 'medical' });
  });

  test('finds a location with no preposition at all', () => {
    assert.deepEqual(findLocation('A customer enters a coffee shop.'),
      { name: 'Coffee Shop', kind: 'cafe' });
  });

  test('does not invent a location from a departure', () => {
    const found = findLocation('The customer receives the coffee and leaves.');
    assert.notEqual(found?.name, 'Coffee');
  });

  test('returns nothing for a sentence with no place in it', () => {
    assert.equal(findLocation('He thought about it for a moment.'), null);
  });
});

describe('character extraction', () => {
  test('finds role characters without proper names', () => {
    assert.deepEqual(names(analyseStory(COFFEE)), ['Barista', 'Cashier', 'Customer']);
  });

  test('finds proper names', () => {
    assert.deepEqual(names(analyseStory(QUOTED)), ['John', 'Sarah']);
  });

  test('never invents a character from a sentence-initial pronoun', () => {
    const found = names(analyseStory(QUOTED));
    for (const bogus of ['He', 'She', 'They', 'We', 'Then', 'Give']) {
      assert.ok(!found.includes(bogus), `invented a character called "${bogus}"`);
    }
  });

  test('never takes a character from inside dialogue', () => {
    const plan = analyseStory('Ben walks in. He says, "Marcus took the ledger to Denver."');
    assert.ok(!names(plan).includes('Marcus'), 'a name inside a quote became a character');
    assert.ok(!names(plan).includes('Denver'), 'a place inside a quote became a character');
  });

  test('merges determiners so a character is not duplicated', () => {
    const plan = analyseStory('A customer waits. The customer orders a drink. The customer leaves.');
    assert.equal(plan.characters.length, 1);
    assert.equal(plan.characters[0].name, 'Customer');
  });

  test('keeps a multi-word title intact', () => {
    const plan = analyseStory('The Request Manager reviews the queue. The Request Manager assigns the work.');
    assert.deepEqual(names(plan), ['Request Manager']);
  });

  test('merges a short alias into the longer name', () => {
    const plan = analyseStory('The COE Operator 1 opens the console. The operator reviews the queue.');
    assert.equal(plan.characters.length, 1, `expected one character, got ${names(plan).join(', ')}`);
    assert.equal(plan.characters[0].name, 'COE Operator 1');
  });

  test('expands a counted group into numbered characters', () => {
    const plan = analyseStory(CLASSROOM);
    assert.ok(names(plan).includes('Student 1'));
    assert.ok(names(plan).includes('Student 2'));
  });

  test('recognises a non-human participant as a system', () => {
    const plan = analyseStory('The user opens the assistant. The assistant replies: "Done."');
    const system = plan.characters.find((c) => c.kind === 'system');
    assert.ok(system, `no system character in ${names(plan).join(', ')}`);
  });
});

describe('gender resolution', () => {
  test('takes gender from a sentence-initial pronoun referring to the previous subject', () => {
    const plan = analyseStory(COFFEE);
    assert.equal(plan.characters.find((c) => c.name === 'Customer').gender, 'male');
  });

  test('takes gender from a pronoun later in the same sentence', () => {
    const plan = analyseStory(HOSPITAL);
    assert.equal(plan.characters.find((c) => c.name === 'Patient').gender, 'male');
  });

  test('assigns the pronoun to the subject, not to the nearest noun', () => {
    const plan = analyseStory(CLASSROOM);
    assert.equal(plan.characters.find((c) => c.name === 'Teacher').gender, 'female');
  });

  test('leaves gender unstated when the story never says', () => {
    const plan = analyseStory('A cashier counts the till. A barista cleans the machine.');
    assert.equal(plan.characters.every((c) => c.gender === null), true);
  });
});

describe('scene detection', () => {
  test('the number of scenes comes from the story, not a constant', () => {
    assert.equal(analyseStory(HOSPITAL).scenes.length, 3);
    assert.equal(analyseStory(COFFEE).scenes.length, 4);
  });

  test('an explicit heading declares a scene and keeps its whole paragraph', () => {
    const plan = analyseStory(
      'Scene: The Kitchen\n\nA chef cooks. A waiter waits. The chef plates the dish.\n\n' +
      'Scene: The Dining Room\n\nThe waiter serves the guest.',
    );
    assert.equal(plan.scenes.length, 2);
    assert.equal(plan.scenes[0].title, 'The Kitchen');
    assert.equal(plan.scenes[1].title, 'The Dining Room');
  });

  test('a conversation in one place stays one scene', () => {
    const plan = analyseStory(QUOTED);
    const dialogueScenes = plan.scenes.filter((s) => s.beats.some((b) => b.kind === 'dialogue'));
    assert.equal(dialogueScenes.length, 1, 'the exchange was split across scenes');
    assert.equal(dialogueScenes[0].beats.filter((b) => b.kind === 'dialogue').length, 2);
  });

  test('every scene has someone in it', () => {
    for (const story of [COFFEE, CLASSROOM, HOSPITAL, QUOTED]) {
      const plan = analyseStory(story);
      for (const scene of plan.scenes) {
        assert.ok(scene.characterKeys.length > 0, `${scene.title} has an empty cast`);
      }
    }
  });

  test('a completion sentence marks the final scene as a finale', () => {
    const plan = analyseStory(CLASSROOM);
    assert.equal(plan.scenes[plan.scenes.length - 1].isFinale, true);
  });
});

describe('dialogue attribution', () => {
  test('attributes each quote to its own speaker', () => {
    const plan = analyseStory(QUOTED);
    const lines = beatsOf(plan).filter((b) => b.kind === 'dialogue');
    assert.equal(lines.length, 2);
    assert.equal(lines[0].speakerKey, 'sarah');
    assert.equal(lines[1].speakerKey, 'john');
  });

  test('attributes two quotes in one paragraph to different speakers', () => {
    const plan = analyseStory('The clerk types: "ready" The assistant replies: "confirmed"');
    const spoken = beatsOf(plan).filter((b) => b.kind === 'dialogue' || b.kind === 'system');
    assert.equal(spoken.length, 2);
    assert.notEqual(spoken[0].speakerKey, spoken[1].speakerKey);
  });

  test('marks a typed line as interface input', () => {
    const plan = analyseStory('The clerk types: "run the report"');
    const typed = beatsOf(plan).find((b) => b.input);
    assert.ok(typed, 'the typed line was not marked as input');
  });

  test('a system response is a system beat, not a person speaking', () => {
    const plan = analyseStory('The user asks: "status?" The assistant displays: "all clear"');
    const system = beatsOf(plan).filter((b) => b.kind === 'system');
    assert.equal(system.length, 1);
    assert.equal(system[0].text, 'all clear');
  });

  test('unquoted prose becomes narration', () => {
    const plan = analyseStory(COFFEE);
    assert.equal(beatsOf(plan).every((b) => b.kind === 'narration'), true);
  });

  test('never invents text that is not in the story', () => {
    for (const story of [COFFEE, CLASSROOM, HOSPITAL, QUOTED]) {
      const plan = analyseStory(story);
      const source = story.replace(/\s+/g, ' ').toLowerCase();
      for (const beat of beatsOf(plan)) {
        const needle = beat.text.replace(/\s+/g, ' ').toLowerCase()
          .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
        assert.ok(source.includes(needle), `invented text: "${beat.text}"`);
      }
    }
  });
});

describe('robustness', () => {
  test('rejects an empty story', () => {
    assert.throws(() => analyseStory('   '), /empty/i);
  });

  test('handles a single sentence', () => {
    const plan = analyseStory('A doctor examines a patient.');
    assert.equal(plan.scenes.length, 1);
    assert.equal(plan.characters.length, 2);
  });

  test('handles prose with no recognisable characters', () => {
    const plan = analyseStory('The rain fell all afternoon. The river rose steadily.');
    assert.ok(plan.scenes.length >= 1);
    assert.equal(beatsOf(plan).every((b) => b.kind === 'narration'), true);
  });

  test('is deterministic', () => {
    assert.deepEqual(analyseStory(CLASSROOM), analyseStory(CLASSROOM));
  });

  test('titleCase leaves an already-capitalised name alone', () => {
    assert.equal(titleCase('COE Operator 1'), 'COE Operator 1');
  });
});
