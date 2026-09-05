/**
 * Deterministic story analyser.
 *
 * Turns arbitrary English prose or light screenplay formatting into a
 * structured StoryPlan: characters, locations, scenes, and per-scene beats
 * (dialogue, narration, action).
 *
 * It knows nothing about any particular story. Every decision comes from
 * general English cues in engine/analysis/lexicon.mjs: role nouns, speech
 * verbs, location prepositions and discourse markers.
 *
 * This runs with no network and no API key, so it is the pipeline's guaranteed
 * path. engine/analysis/llm.mjs supersedes it when a model is reachable.
 *
 * Pipeline inside this file:
 *   1. segment into sentences, separating narration from quoted speech
 *   2. find the confident proper names used anywhere in the story
 *   3. find character mentions in each sentence (role phrases, names, systems)
 *   4. resolve pronouns to a referent and take gender from them
 *   5. group sentences into scenes
 *   6. turn each sentence into beats, attributing every line to a speaker
 */
import {
  ROLE_NOUNS, SYSTEM_NOUNS, SPEECH_VERBS, TYPED_VERBS, SYSTEM_VERBS,
  ARRIVAL_VERBS, SCENE_MARKERS, COMPLETION_WORDS, PRONOUN_GENDER, GENDER_WORDS,
  LOCATION_PREPOSITIONS,
} from './lexicon.mjs';
import {
  splitParagraphs, splitSentences, isSceneHeading, headingTitle,
  extractQuotes, withoutQuotes, words, stripDeterminer, titleCase,
  slugify, findLocation, classifyLocation,
} from './text.mjs';

/**
 * Capitalised words that routinely start an English sentence. Without this the
 * analyser invents characters called "He", "They" or "Then".
 */
const SENTENCE_STARTERS = new Set([
  'he', 'she', 'it', 'they', 'we', 'you', 'i', 'his', 'her', 'hers', 'their', 'theirs',
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'there', 'then', 'thus',
  'and', 'but', 'or', 'so', 'as', 'at', 'in', 'on', 'to', 'for', 'with', 'without',
  'after', 'before', 'during', 'while', 'when', 'where', 'why', 'how', 'if', 'once',
  'later', 'meanwhile', 'finally', 'next', 'now', 'soon', 'afterwards', 'afterward',
  'both', 'one', 'two', 'three', 'several', 'many', 'some', 'each', 'every', 'all',
  'inside', 'outside', 'together', 'eventually', 'suddenly', 'immediately',
  'first', 'second', 'third', 'last', 'another', 'other', 'no', 'not', 'yes',
]);

/** Adjectives worth keeping as part of a character's description. */
const DESCRIPTIVE = /^(young|old|elderly|senior|junior|new|tall|short|smiling|tired|friendly|professional|nervous|calm|busy|experienced|male|female|kind|angry|happy|worried)$/;

/** Words that qualify which member of a numbered group is meant. */
const ORDINALS = new Map(Object.entries({
  first: 0, one: 0, second: 1, other: 1, third: 2, another: 1,
}));

const COUNT_WORDS = new Map(Object.entries({
  two: 2, three: 3, four: 4, both: 2, several: 3, a: 1, an: 1, one: 1,
}));

/* ------------------------------------------------------------ segmentation -- */

/**
 * Break the story into sentence records that carry their paragraph, their
 * narrative frame (quotes removed) and the quoted spans.
 */
function segment(text) {
  const records = [];
  const paragraphs = splitParagraphs(text);

  paragraphs.forEach((paragraph, paraIndex) => {
    const lines = paragraph.split('\n').map((l) => l.trim()).filter(Boolean);
    let heading = null;
    if (lines.length && isSceneHeading(lines[0])) {
      heading = headingTitle(lines[0]) || null;
      lines.shift();
    }

    const body = lines.join(' ');
    const sentences = splitSentences(body);
    sentences.forEach((sentence, i) => {
      records.push({
        text: sentence,
        frame: withoutQuotes(sentence),
        quotes: extractQuotes(sentence),
        paraIndex,
        heading: i === 0 ? heading : null,
        paragraphStart: i === 0,
      });
    });

    // A heading with no body still opens a scene.
    if (!sentences.length && heading) {
      records.push({ text: '', frame: '', quotes: [], paraIndex, heading, paragraphStart: true });
    }
  });

  return records;
}

/**
 * Proper names used confidently somewhere in the story: capitalised, not a
 * common sentence starter, and either appearing mid-sentence or followed by a
 * lower-case verb. Only narrative frames are scanned, so words inside dialogue
 * never become characters.
 */
function confidentNames(records) {
  const scores = new Map();

  for (const record of records) {
    const raw = record.frame.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
    raw.forEach((word, i) => {
      if (!/^[A-Z][a-z]+$/.test(word)) return;
      const lower = word.toLowerCase();
      if (SENTENCE_STARTERS.has(lower)) return;
      if (ROLE_NOUNS.has(lower) || SYSTEM_NOUNS.has(lower)) return;

      // "Request" in "Request Manager" is part of a title, not a character.
      const next = raw[i + 1]?.toLowerCase();
      const nextSingular = next?.replace(/s$/, '');
      if (next && (ROLE_NOUNS.has(next) || ROLE_NOUNS.has(nextSingular) ||
                   SYSTEM_NOUNS.has(next) || SYSTEM_NOUNS.has(nextSingular))) return;

      // Mid-sentence capitalisation is strong evidence of a name.
      const midSentence = i > 0;
      // Sentence-initial is acceptable when a lower-case verb follows.
      const followedByVerb = i === 0 && raw[1] && /^[a-z]/.test(raw[1]);
      if (midSentence || followedByVerb) {
        scores.set(lower, (scores.get(lower) ?? 0) + (midSentence ? 2 : 1));
      }
    });
  }

  return new Set([...scores].filter(([, score]) => score >= 1).map(([name]) => name));
}

/* --------------------------------------------------------- mention finding -- */

/**
 * All character mentions inside one narrative frame, in reading order.
 * A mention carries the token offset so pronouns can be resolved by position.
 */
function findMentions(frame, names) {
  const mentions = [];
  const raw = [...frame.matchAll(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)];
  const lower = raw.map((m) => m[0].toLowerCase());

  const consumed = new Set();

  raw.forEach((match, i) => {
    if (consumed.has(i)) return;
    const word = lower[i];
    const singular = word.replace(/s$/, '');
    const isPlural = word !== singular && ROLE_NOUNS.has(singular);
    const roleWord = ROLE_NOUNS.has(word) ? word : isPlural ? singular : null;
    const systemWord = SYSTEM_NOUNS.has(word) ? word : SYSTEM_NOUNS.has(singular) ? singular : null;

    if (roleWord || systemWord) {
      const head = roleWord ?? systemWord;

      // Capitalised words immediately before the role form part of its title:
      // "COE Operator", "Request Manager". Determiners and pronouns do not.
      const prefix = [];
      for (let k = i - 1; k >= 0; k--) {
        const token = raw[k][0];
        if (!/^[A-Z]/.test(token)) break;
        if (SENTENCE_STARTERS.has(lower[k])) break;
        if (names.has(lower[k])) break; // a name is its own mention
        prefix.unshift(token);
        consumed.add(k);
        if (prefix.length >= 2) break;
      }

      // Descriptive adjectives and count/ordinal words just before the role.
      const descriptors = [];
      let count = null;
      let ordinal = null;
      for (let k = Math.max(0, i - 3); k < i; k++) {
        const w = lower[k];
        if (DESCRIPTIVE.test(w)) descriptors.push(w);
        if (GENDER_WORDS.has(w)) descriptors.push(w);
        if (COUNT_WORDS.has(w)) count = COUNT_WORDS.get(w);
        if (ORDINALS.has(w)) ordinal = ORDINALS.get(w);
        if (/^\d+$/.test(w)) count = Number(w);
      }

      // A trailing number distinguishes instances: "Operator 1".
      let suffix = null;
      const next = raw[i + 1]?.[0];
      if (next && /^\d+$/.test(next)) { suffix = next; consumed.add(i + 1); }

      const titleParts = [...prefix, titleCase(head), suffix].filter(Boolean);
      const name = titleCase(titleParts.join(' '));

      const explicitGender = descriptors.map((d) => GENDER_WORDS.get(d)).find(Boolean)
        ?? (roleWord ? ROLE_NOUNS.get(roleWord).gender : null);

      mentions.push({
        key: slugify(name),
        name,
        kind: systemWord ? 'system' : 'person',
        role: titleCase(head),
        gender: explicitGender ?? null,
        descriptors: descriptors.filter((d) => DESCRIPTIVE.test(d)),
        plural: isPlural,
        count: isPlural ? (count ?? 2) : null,
        ordinal,
        at: i,
      });
      consumed.add(i);
      return;
    }

    // A confident proper name.
    if (names.has(word) && /^[A-Z]/.test(match[0])) {
      mentions.push({
        key: slugify(word),
        name: titleCase(word),
        kind: 'person',
        role: null,
        gender: null,
        descriptors: [],
        plural: false,
        count: null,
        ordinal: null,
        at: i,
      });
      consumed.add(i);
    }
  });

  return mentions.sort((a, b) => a.at - b.at);
}

/** Pronoun occurrences with their token offsets. */
function findPronouns(frame) {
  const raw = [...frame.matchAll(/[A-Za-z][A-Za-z'’-]*/g)];
  return raw
    .map((m, i) => ({ word: m[0].toLowerCase(), at: i }))
    .filter((p) => PRONOUN_GENDER.has(p.word));
}

/* ---------------------------------------------------------------- registry -- */

/** Accumulates characters across the story and merges repeated mentions. */
class CharacterRegistry {
  constructor() {
    this.byKey = new Map();
    /** Numbered siblings created from "two students". */
    this.groups = new Map();
    /** Short-name key -> surviving key, filled in by mergeAliases(). */
    this.aliases = new Map();
  }

  /** Canonical key ignores determiners so "a customer" and "The customer" merge. */
  static canonical(name) {
    return slugify(stripDeterminer(String(name)).toLowerCase());
  }

  upsert(mention) {
    const key = CharacterRegistry.canonical(mention.name);
    let character = this.byKey.get(key);
    if (!character) {
      character = {
        key,
        name: mention.name,
        kind: mention.kind,
        role: mention.role,
        gender: mention.gender,
        descriptors: new Set(mention.descriptors),
        mentions: 0,
        sceneIndexes: new Set(),
      };
      this.byKey.set(key, character);
    }
    character.mentions += 1;
    character.gender ??= mention.gender;
    character.role ??= mention.role;
    for (const d of mention.descriptors) character.descriptors.add(d);
    // Prefer the longest observed form of the name ("Operator" -> "COE Operator 1").
    if (mention.name.length > character.name.length) character.name = mention.name;
    return character;
  }

  /**
   * Merge characters that are the same person under different lengths of name:
   * "the assistant" and "the BCM assistant", "Operator" and "COE Operator 1".
   * A short name is folded into a longer one when it is a whole-word prefix or
   * suffix of it. Numbered siblings ("Student 1" / "Student 2") never collide,
   * because neither contains the other.
   */
  mergeAliases() {
    const all = [...this.byKey.values()].sort((a, b) => b.name.length - a.name.length);
    const remap = new Map();

    for (const shorter of all) {
      if (remap.has(shorter.key)) continue;
      const target = all.find((longer) =>
        longer !== shorter &&
        !remap.has(longer.key) &&
        longer.kind === shorter.kind &&
        longer.name.length > shorter.name.length &&
        isAliasOf(shorter.name, longer.name));
      if (!target) continue;

      target.mentions += shorter.mentions;
      target.gender ??= shorter.gender;
      target.role ??= shorter.role;
      for (const d of shorter.descriptors) target.descriptors.add(d);
      for (const i of shorter.sceneIndexes) target.sceneIndexes.add(i);
      remap.set(shorter.key, target.key);
      this.aliases.set(shorter.key, target.key);
      this.byKey.delete(shorter.key);
    }
    return remap;
  }

  /** "two students" becomes Student 1 and Student 2 as separate characters. */
  upsertGroup(mention) {
    const base = titleCase(mention.role ?? mention.name);
    const size = Math.min(Math.max(mention.count ?? 2, 2), 3);
    const groupKey = slugify(base);
    if (this.groups.has(groupKey)) return this.groups.get(groupKey);

    const members = [];
    for (let i = 1; i <= size; i++) {
      const member = this.upsert({ ...mention, name: `${base} ${i}`, plural: false, count: null });
      members.push(member.key);
    }
    this.groups.set(groupKey, members);
    return members;
  }

  /** Resolve a singular mention that belongs to a numbered group. */
  resolveGroupMember(mention) {
    const groupKey = slugify(titleCase(mention.role ?? mention.name));
    const members = this.groups.get(groupKey);
    if (!members) return null;
    const index = Math.min(mention.ordinal ?? 0, members.length - 1);
    return this.byKey.get(members[index]);
  }

  /** Resolves through alias keys, so "assistant" still finds "BCM Assistant". */
  get(key) {
    return this.byKey.get(key) ?? this.byKey.get(this.aliases.get(key));
  }
  all() { return [...this.byKey.values()]; }
  keys() { return new Set(this.byKey.keys()); }
}

/**
 * Is `short` a whole-word prefix or suffix of `long`?
 * "Operator" is an alias of "COE Operator 1"; "Student 1" is not an alias of
 * "Student 2".
 */
function isAliasOf(short, long) {
  const a = short.toLowerCase().split(/\s+/);
  const b = long.toLowerCase().split(/\s+/);
  if (a.length >= b.length) return false;
  // A contiguous run anywhere in the longer name counts, so "Operator" folds
  // into "COE Operator 1". Equal-length names never match, which is what keeps
  // "Student 1" and "Student 2" apart.
  for (let i = 0; i + a.length <= b.length; i++) {
    if (a.every((w, k) => w === b[i + k])) return true;
  }
  return false;
}

/* --------------------------------------------------------- scene splitting -- */

function groupIntoScenes(records, maxScenes) {
  // Short stories read best as one scene per action; longer ones pack more in.
  const perScene = records.length <= 4 ? 1 : Math.max(1, Math.ceil(records.length / maxScenes));

  const groups = [];
  let current = null;
  const close = () => { if (current?.records.length) groups.push(current); current = null; };
  const isSpeech = (record) => record.quotes.length > 0;

  for (const record of records) {
    const lower = record.text.toLowerCase();
    const arrival = words(record.text).some((w) => ARRIVAL_VERBS.has(w));
    const marker = SCENE_MARKERS.some((m) => lower.startsWith(m) || lower.startsWith(`and ${m}`));

    // Only a sentence that actually moves someone somewhere establishes the
    // scene's location. Otherwise a passing mention ("receives the coffee")
    // would invent a second location for the same room.
    const declared = (arrival || hasLocationPreposition(lower)) ? findLocation(record.text) : null;

    // An exchange of dialogue in one place is a single scene, not one scene per
    // line, so a conversation does not shatter into fragments.
    const continuesConversation =
      current && isSpeech(record) && isSpeech(current.records[current.records.length - 1]);

    const explicitBreak = !!record.heading;
    // Once a heading has declared a scene, everything under it belongs to it.
    const inDeclaredScene = current?.declared === true;
    const softBreak = current && current.records.length > 0 && !continuesConversation && !inDeclaredScene && (
      marker ||
      (declared && current.location && declared.kind !== current.location.kind) ||
      current.records.length >= perScene
    );

    if (explicitBreak || softBreak) close();
    if (!current) current = { title: record.heading ?? null, records: [], location: null, declared: !!record.heading };
    current.records.push(record);
    if (declared && !current.location) current.location = declared;
  }
  close();

  // Never exceed the cap: merge the shortest neighbours until it fits.
  while (groups.length > maxScenes) {
    let smallest = 0;
    for (let i = 1; i < groups.length - 1; i++) {
      if (groups[i].records.length < groups[smallest].records.length) smallest = i;
    }
    const target = smallest === groups.length - 1 ? smallest - 1 : smallest + 1;
    const [merged] = groups.splice(Math.max(smallest, target), 1);
    const into = groups[Math.min(smallest, target)];
    into.records.push(...merged.records);
    into.location ??= merged.location;
  }

  return groups;
}

/** Does the sentence contain a phrase that positions someone somewhere? */
function hasLocationPreposition(lower) {
  return LOCATION_PREPOSITIONS.some((prep) => lower.includes(`${prep} `));
}

/* ------------------------------------------------------------------ speech -- */

/** Extract speech from a sentence, with the verb that framed it. */
function speechIn(record) {
  const { text, frame, quotes } = record;

  if (!quotes.length) {
    // Screenplay form: `NAME: dialogue`
    const colon = /^\s*([A-Z][A-Za-z0-9 '’.-]{1,40}?)\s*:\s*(.+)$/.exec(text);
    if (colon && !isSceneHeading(text)) {
      const speaker = colon[1].trim();
      if (!/^(scene|shot|int|ext|part|chapter|step|stage|note|location|time|title)$/i.test(speaker)) {
        return [{ speakerName: speaker, text: colon[2].trim(), mode: 'spoken' }];
      }
    }
    return [];
  }

  // Each quote is attributed from the narrative span that immediately precedes
  // it, not from the sentence as a whole. A paragraph like
  //   The Customer types: "..." The assistant replies: "..."
  // has two speakers, and reading one verb for the whole sentence would give
  // both lines to the same character.
  const chars = [...text];
  const lines = [];
  let cursor = 0;

  for (const quote of quotes) {
    const span = chars.slice(cursor, quote.start).join('').trim();
    const spanWords = words(span);
    const verb = [...spanWords].reverse().find((w) => SPEECH_VERBS.has(w)) ?? null;
    const mode = verb && TYPED_VERBS.has(verb) ? 'typed'
      : verb && SYSTEM_VERBS.has(verb) ? 'system'
        : 'spoken';

    lines.push({ speakerName: null, text: quote.text, mode, verb, span });
    cursor = quote.end + 1;
  }

  void frame;
  return lines;
}

/* ------------------------------------------------------------------ public -- */

/**
 * @param {string} text raw story from the user
 * @param {object} [options]
 * @param {number|null} [options.targetSeconds]
 * @param {number} [options.maxScenes]
 * @returns {object} StoryPlan
 */
export function analyseStory(text, { targetSeconds = null, maxScenes = 8 } = {}) {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('The story is empty.');

  const records = segment(source);
  if (!records.length) throw new Error('No sentences could be read from the story.');

  const names = confidentNames(records);
  const registry = new CharacterRegistry();

  /* -- pass 1: mentions, group expansion and pronoun-driven gender ---------- */

  let previousSubject = null;

  for (const record of records) {
    const mentions = findMentions(record.frame, names);
    record.mentions = [];

    for (const mention of mentions) {
      if (mention.plural) {
        const memberKeys = registry.upsertGroup(mention);
        // A plural mention puts the whole group on stage.
        for (const key of memberKeys) record.mentions.push({ ...mention, key, resolved: registry.get(key) });
        continue;
      }
      const groupMember = mention.ordinal !== null ? registry.resolveGroupMember(mention) : null;
      const character = groupMember ?? registry.upsert(mention);
      record.mentions.push({ ...mention, key: character.key, resolved: character });
    }

    // Pronoun resolution: a sentence-initial pronoun refers to the previous
    // sentence's subject; otherwise to the nearest mention before it.
    record.referents = [];
    for (const pronoun of findPronouns(record.frame)) {
      const gender = PRONOUN_GENDER.get(pronoun.word);
      const preceding = record.mentions
        .filter((m) => m.at < pronoun.at && m.resolved?.kind === 'person')
        .pop();
      const referent = preceding?.resolved ?? previousSubject;
      if (referent && referent.kind === 'person') {
        referent.gender ??= gender;
        record.referents.push(referent);
      }
    }

    // A gendered pronoun inside dialogue usually refers to whoever the passage
    // is about: "...is assigned to his name" tells us the operator is male.
    if (record.quotes.length) {
      const quoted = record.quotes.map((q) => q.text).join(' ');
      const gender = findPronouns(quoted).map((p) => PRONOUN_GENDER.get(p.word)).find(Boolean);
      const about = record.mentions.find((m) => m.resolved?.kind === 'person')?.resolved ?? previousSubject;
      if (gender && about && about.kind === 'person') about.gender ??= gender;
    }

    // A sentence that names nobody ("She asks them about the project") still
    // belongs to whoever the pronoun points at, so the scene keeps a cast and
    // the line keeps a speaker.
    const subject = record.mentions.find((m) => m.resolved?.kind === 'person')?.resolved
      ?? record.referents[0]
      ?? null;
    record.subject = subject;
    if (subject) previousSubject = subject;
  }

  // Fold alias mentions together before scenes are built, so a character is
  // one person everywhere they appear.
  const aliasRemap = registry.mergeAliases();
  if (aliasRemap.size) {
    for (const record of records) {
      for (const mention of record.mentions) {
        const target = aliasRemap.get(mention.key);
        if (target) {
          mention.key = target;
          mention.resolved = registry.get(target);
        }
      }
      record.referents = (record.referents ?? []).map((r) => registry.get(aliasRemap.get(r.key) ?? r.key) ?? r);
      if (record.subject) record.subject = registry.get(aliasRemap.get(record.subject.key) ?? record.subject.key) ?? record.subject;
    }
  }

  /* -- pass 2: scenes and beats -------------------------------------------- */

  const groups = groupIntoScenes(records, maxScenes);
  let lastLocation = null;
  let lastCast = [];

  // Words that only name a character carry no action on their own.
  const nameWords = new Set(
    registry.all().flatMap((c) => words(c.name)),
  );

  const scenes = groups.map((group, index) => {
    const location = group.location ?? lastLocation ?? inferLocation(group.records);
    lastLocation = location;

    const beats = [];
    const present = new Set();
    let sceneSubject = null;

    for (const record of group.records) {
      for (const mention of record.mentions) present.add(mention.key);
      // Pronoun referents count as present too.
      for (const referent of record.referents ?? []) present.add(referent.key);
      if (record.subject) sceneSubject = record.subject.key;

      const speech = speechIn(record);

      if (speech.length) {
        // The narrative before the first quote becomes an action caption, but
        // only when it says more than who is speaking. "The COE Operator 1" is
        // an attribution, not an action.
        const action = cleanAction(speech[0].span ?? '');
        if (action && meaningfulAction(action, nameWords)) beats.push({ kind: 'action', text: action });

        for (const line of speech) {
          const speakerKey = resolveSpeaker(line, record, registry, present, sceneSubject, names);
          if (speakerKey) present.add(speakerKey);
          const speaker = speakerKey ? registry.get(speakerKey) : null;
          const isSystem = line.mode === 'system' || speaker?.kind === 'system';
          beats.push({
            kind: isSystem ? 'system' : 'dialogue',
            speakerKey: speakerKey ?? null,
            text: line.text,
            input: line.mode === 'typed' && !isSystem,
          });
        }
      } else if (record.text) {
        beats.push({ kind: 'narration', text: record.text.trim() });
      }
    }

    const lower = group.records.map((r) => r.text).join(' ').toLowerCase();

    // A scene that names nobody ("They head to the street together") keeps the
    // previous scene's cast on screen rather than emptying the frame.
    if (!present.size && lastCast.length) for (const key of lastCast) present.add(key);
    lastCast = [...present];

    return {
      index,
      title: group.title || sceneTitle(group.records, location, index),
      location,
      characterKeys: [...present],
      subjectKey: group.records.find((r) => r.subject)?.subject?.key ?? null,
      beats: mergeNarration(beats),
      isFinale: index === groups.length - 1 && COMPLETION_WORDS.some((w) => lower.includes(w)),
      text: group.records.map((r) => r.text).join(' '),
    };
  });

  /* -- pass 3: finalise ---------------------------------------------------- */

  scenes.forEach((scene, i) => {
    for (const key of scene.characterKeys) registry.get(key)?.sceneIndexes.add(i);
  });

  // An interface only counts as a character if it actually responds. "opens the
  // console" mentions a console; it does not put one in the cast.
  const speakingSystems = new Set(
    scenes.flatMap((scene) => scene.beats)
      .filter((beat) => beat.kind === 'system' && beat.speakerKey)
      .map((beat) => beat.speakerKey),
  );
  for (const character of registry.all()) {
    if (character.kind === 'system' && !speakingSystems.has(character.key)) {
      character.sceneIndexes.clear();
    }
  }

  const characters = registry.all()
    .filter((c) => c.sceneIndexes.size > 0)
    .map((c) => ({
      key: c.key,
      name: c.name,
      kind: c.kind,
      gender: c.gender,
      role: c.role ?? (c.kind === 'system' ? 'System' : 'Character'),
      descriptors: [...c.descriptors],
      mentions: c.mentions,
      sceneIndexes: [...c.sceneIndexes].sort((a, b) => a - b),
    }));

  const liveKeys = new Set(characters.map((c) => c.key));

  return {
    source,
    analyser: 'heuristic',
    targetSeconds,
    characters,
    locations: uniqueLocations(scenes),
    scenes: scenes.map((scene) => ({
      ...scene,
      characterKeys: scene.characterKeys.filter((k) => liveKeys.has(k)),
      beats: scene.beats.map((b) => (
        b.speakerKey && !liveKeys.has(b.speakerKey) ? { ...b, speakerKey: null } : b
      )),
    })),
  };
}

/* ----------------------------------------------------------------- helpers -- */

/**
 * Who spoke this line? Explicit attribution wins; otherwise the sentence's own
 * subject, then the only person on stage.
 */
function resolveSpeaker(line, record, registry, present, sceneSubject, names) {
  // An unattributed line in a pronoun sentence belongs to that pronoun's
  // referent: `She says, "..."` is spoken by whoever "she" is.
  if (line.speakerName) {
    const key = CharacterRegistry.canonical(line.speakerName);
    if (registry.get(key)) return key;
    const lower = line.speakerName.toLowerCase();
    for (const character of registry.all()) {
      const name = character.name.toLowerCase();
      if (name.includes(lower) || lower.includes(name)) return character.key;
    }
    return null;
  }

  // Whoever is named in the span immediately before this quote is the speaker.
  // That is what keeps `A types: "..." B replies: "..."` correctly attributed.
  const spanMentions = line.span ? findMentions(line.span, names ?? new Set()) : [];
  const spanResolved = spanMentions
    .map((m) => registry.get(CharacterRegistry.canonical(m.name)) ?? registry.resolveGroupMember(m))
    .filter(Boolean);

  const spanPerson = spanResolved.find((c) => c.kind === 'person');
  const spanSystem = spanResolved.find((c) => c.kind === 'system');
  if (line.mode === 'system' && spanSystem) return spanSystem.key;
  if (spanPerson) return spanPerson.key;
  if (spanSystem) return spanSystem.key;

  // Otherwise fall back to the sentence's own subject.
  const systemMention = record.mentions.find((m) => m.resolved?.kind === 'system');
  if (line.mode === 'system' && systemMention) return systemMention.key;

  const person = record.mentions.find((m) => m.resolved?.kind === 'person');
  if (person) return person.key;

  if (record.subject) return record.subject.key;
  if (systemMention) return systemMention.key;

  const people = [...present].filter((k) => registry.get(k)?.kind === 'person');
  if (people.length === 1) return people[0];
  return sceneSubject ?? null;
}

/**
 * Does an action caption describe something happening, or is it just an
 * attribution like "The COE Operator 1"?
 */
function meaningfulAction(action, nameWords) {
  const residual = words(action).filter((w) =>
    !nameWords.has(w) && !SENTENCE_STARTERS.has(w) && !/^\d+$/.test(w));
  return residual.length >= 2;
}

function mergeNarration(beats) {
  const out = [];
  for (const beat of beats) {
    const prev = out[out.length - 1];
    if (beat.kind === 'narration' && prev?.kind === 'narration' &&
        words(prev.text).length + words(beat.text).length <= 34) {
      prev.text = `${prev.text} ${beat.text}`.replace(/\s+/g, ' ');
    } else {
      out.push({ ...beat });
    }
  }
  return out;
}

/** Turn "John says," into a usable action caption, or nothing if it is bare. */
function cleanAction(frame) {
  const cleaned = frame
    .replace(new RegExp(`\\b(${[...SPEECH_VERBS].join('|')})\\b\\s*[,:]?\\s*$`, 'i'), '')
    .replace(/[,:;]\s*$/, '')
    .replace(/\s+(and|but|then|so|as|while|that|who)\s*$/i, '')
    .trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : '';
}

/**
 * A short, readable scene title taken from its opening sentence. Determiners
 * and trailing conjunctions are dropped so the result reads as a beat name
 * ("Customer Enters Coffee Shop") rather than a truncated sentence.
 */
const TITLE_SKIP = new Set(['a', 'an', 'the', 'his', 'her', 'their', 'its', 'some']);
const TITLE_TRAIL = new Set(['and', 'or', 'but', 'then', 'while', 'that', 'to', 'for', 'with', 'of', 'in', 'on', 'at']);

function sceneTitle(records, location, index) {
  const first = records.find((r) => r.text)?.text ?? '';
  const opening = first.replace(/["“”'’]/g, '').split(/[,.;:]/)[0].trim();

  const kept = opening
    .split(/\s+/)
    .filter((w) => !TITLE_SKIP.has(w.toLowerCase()))
    .slice(0, 5);
  while (kept.length && TITLE_TRAIL.has(kept[kept.length - 1].toLowerCase())) kept.pop();

  if (kept.length) return titleCase(kept.join(' '));
  return location?.name ?? `Scene ${index + 1}`;
}

function inferLocation(records) {
  for (const record of records) {
    const found = findLocation(record.text);
    if (found) return found;
  }
  const joined = records.map((r) => r.text).join(' ');
  const kind = classifyLocation(joined);
  return kind ? { name: titleCase(kind), kind } : { name: 'Scene', kind: 'generic' };
}

function uniqueLocations(scenes) {
  const map = new Map();
  for (const scene of scenes) {
    const loc = scene.location ?? { name: 'Scene', kind: 'generic' };
    const id = slugify(loc.name, 'scene');
    if (!map.has(id)) map.set(id, { id, name: loc.name, kind: loc.kind });
  }
  return [...map.values()];
}
