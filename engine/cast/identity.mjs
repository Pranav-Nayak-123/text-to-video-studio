/**
 * Turns analysed characters into render identities.
 *
 * The guarantee this module provides is **consistency**: a character's colour,
 * initials, voice and every visual attribute are derived deterministically from
 * their key, so the same person looks and sounds identical in scene 1 and in
 * scene 7, across re-runs, and no matter how many other characters exist.
 */
import { slugify } from '../analysis/text.mjs';

/**
 * Voice pools. Order matters: characters take voices in appearance order, so
 * the first male character in any story gets the first male voice.
 */
export const VOICE_POOLS = {
  male: [
    { voiceId: 'en-US-GuyNeural', pitch: '-2Hz', sapiVoice: 'Microsoft David Desktop' },
    { voiceId: 'en-US-ChristopherNeural', pitch: '-4Hz', sapiVoice: 'Microsoft David Desktop' },
    { voiceId: 'en-US-EricNeural', pitch: '+0Hz', sapiVoice: 'Microsoft David Desktop' },
    { voiceId: 'en-US-RogerNeural', pitch: '-3Hz', sapiVoice: 'Microsoft David Desktop' },
    { voiceId: 'en-GB-RyanNeural', pitch: '+0Hz', sapiVoice: 'Microsoft David Desktop' },
  ],
  female: [
    { voiceId: 'en-US-AriaNeural', pitch: '+0Hz', sapiVoice: 'Microsoft Zira Desktop' },
    { voiceId: 'en-US-JennyNeural', pitch: '+2Hz', sapiVoice: 'Microsoft Zira Desktop' },
    { voiceId: 'en-US-MichelleNeural', pitch: '+0Hz', sapiVoice: 'Microsoft Zira Desktop' },
    { voiceId: 'en-GB-SoniaNeural', pitch: '+0Hz', sapiVoice: 'Microsoft Zira Desktop' },
    { voiceId: 'en-US-AnaNeural', pitch: '+4Hz', sapiVoice: 'Microsoft Zira Desktop' },
  ],
  system: [
    { voiceId: 'en-US-BrianNeural', pitch: '+0Hz', sapiVoice: 'Microsoft David Desktop' },
  ],
  narrator: [
    { voiceId: 'en-US-AndrewNeural', pitch: '-1Hz', sapiVoice: 'Microsoft David Desktop' },
  ],
};

/** Accent colours, chosen to stay distinct from each other on a dark ground. */
const ACCENTS = [
  '#3E8BFF', '#31D8D8', '#25C08B', '#F0A72B', '#C879F2',
  '#F2626B', '#8FBEFF', '#7FD463', '#FF9F5A', '#5AC8FA',
];

/** Visual attribute pools. Index is derived from the character key. */
const SKIN_TONES = ['#E5BE9A', '#D2A077', '#C08A5E', '#A26F45', '#7D5233', '#F0D2B4'];
const HAIR_COLOURS = ['#2E2119', '#12100F', '#4A3524', '#6B4A2A', '#8C6239', '#3A3A3E'];
const GARMENTS = [
  { base: '#24466F', dark: '#14273F', light: '#3E72B4' }, // navy
  { base: '#3B4762', dark: '#212938', light: '#606F92' }, // charcoal
  { base: '#1E5250', dark: '#10312F', light: '#33807C' }, // teal
  { base: '#5A3B62', dark: '#33203A', light: '#81588C' }, // plum
  { base: '#6B3B34', dark: '#3E211D', light: '#9C5A4E' }, // rust
  { base: '#3D5233', dark: '#22301C', light: '#5E7C4F' }, // olive
  { base: '#4A4E57', dark: '#2A2D33', light: '#6E747F' }, // slate
];

/** A small, stable hash so every derived attribute is reproducible. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Two capital letters that identify a character in avatars and rails. */
export function initialsFor(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const numeric = parts[parts.length - 1];
  if (/^\d+$/.test(numeric)) {
    return (parts[parts.length - 2][0] + numeric[0]).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Assign identities to every analysed character.
 *
 * @param {object[]} characters analysed characters
 * @param {object} [options]
 * @param {string} [options.voiceStyle] 'balanced' | 'male' | 'female'
 * @returns {object[]} render-ready characters
 */
export function assignIdentities(characters, { voiceStyle = 'balanced' } = {}) {
  const taken = { male: 0, female: 0, system: 0, narrator: 0 };
  const usedAccents = new Set();

  return characters.map((character, index) => {
    const key = character.key;
    const seed = hash(key);

    // Resolve an unstated gender deterministically, alternating so a cast of
    // unspecified roles still gets distinguishable voices.
    let gender = character.gender;
    if (character.kind === 'system') gender = 'system';
    else if (!gender) {
      if (voiceStyle === 'male' || voiceStyle === 'female') gender = voiceStyle;
      else gender = index % 2 === 0 ? 'male' : 'female';
    }

    const poolName = character.kind === 'system' ? 'system'
      : character.kind === 'narrator' ? 'narrator'
        : gender === 'female' ? 'female' : 'male';
    const pool = VOICE_POOLS[poolName];
    const voice = pool[taken[poolName] % pool.length];
    taken[poolName] += 1;

    // Accents are taken in order but never repeat while options remain.
    let accent = ACCENTS[index % ACCENTS.length];
    if (usedAccents.has(accent)) {
      accent = ACCENTS.find((a) => !usedAccents.has(a)) ?? accent;
    }
    usedAccents.add(accent);

    const descriptors = character.descriptors ?? [];
    const isElder = descriptors.some((d) => /old|elderly|senior/.test(d));
    const isYoung = descriptors.some((d) => /young|junior|new/.test(d));

    return {
      id: key,
      key,
      name: character.name,
      displayName: character.name,
      role: character.role ?? 'Character',
      kind: character.kind,
      gender: character.kind === 'system' ? 'system' : gender,
      genderStated: !!character.gender,
      initials: character.kind === 'system' ? 'AI' : initialsFor(character.name),
      accent,
      sceneIndexes: character.sceneIndexes ?? [],
      descriptors,
      appearance: {
        summary: describeAppearance(character, gender, descriptors),
        skin: SKIN_TONES[seed % SKIN_TONES.length],
        hair: HAIR_COLOURS[(seed >> 3) % HAIR_COLOURS.length],
        garment: GARMENTS[(seed >> 6) % GARMENTS.length],
        hairStyle: gender === 'female' ? 'long' : (seed >> 9) % 4 === 0 ? 'long' : 'short',
        build: isElder ? 'slight' : isYoung ? 'slim' : 'regular',
        // A seeded prompt so an image provider can reproduce the same person.
        seedPrompt: describeAppearance(character, gender, descriptors),
      },
      voice: {
        provider: 'edge-tts',
        voiceId: voice.voiceId,
        rate: '+8%',
        pitch: voice.pitch,
        sapiVoice: voice.sapiVoice,
        sapiRate: 1,
      },
    };
  });
}

/** A one-line appearance description, used in the UI and for image prompts. */
function describeAppearance(character, gender, descriptors) {
  if (character.kind === 'system') {
    return `${character.name}, a software interface that responds to the people in the story.`;
  }
  const adjectives = descriptors.filter((d) => !/male|female/.test(d));
  const parts = [
    adjectives.length ? adjectives.join(', ') : null,
    gender === 'female' ? 'woman' : 'man',
    character.role && character.role !== 'Character' ? `working as ${article(character.role)}` : null,
  ].filter(Boolean);
  return capitalise(parts.join(' '));
}

const article = (word) => (/^[aeiou]/i.test(word) ? `an ${word.toLowerCase()}` : `a ${word.toLowerCase()}`);
const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The narrator is a character too, so narration gets a consistent voice. */
export function narratorIdentity(style) {
  return {
    id: 'narrator',
    key: 'narrator',
    name: 'Narrator',
    displayName: 'Narrator',
    role: 'Narration',
    kind: 'narrator',
    gender: 'narrator',
    initials: 'NA',
    accent: style?.colors?.textSecondary ?? '#9FB3D1',
    sceneIndexes: [],
    descriptors: [],
    appearance: { summary: 'Off-screen narration.' },
    voice: {
      provider: 'edge-tts',
      voiceId: VOICE_POOLS.narrator[0].voiceId,
      rate: '+10%',
      pitch: VOICE_POOLS.narrator[0].pitch,
      sapiVoice: VOICE_POOLS.narrator[0].sapiVoice,
      sapiRate: 1,
    },
  };
}

export { slugify };
