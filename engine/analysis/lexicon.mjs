/**
 * Language knowledge used by the heuristic story analyser.
 *
 * Everything here is domain-neutral vocabulary: role nouns, speech verbs,
 * location words and discourse markers. No story-specific terms belong in this
 * file - a word earns its place only if it helps parse English generally.
 */

/** Verbs that introduce speech. "X said/asked/replied ..." */
export const SPEECH_VERBS = new Set([
  'says', 'said', 'asks', 'asked', 'replies', 'replied', 'answers', 'answered',
  'responds', 'responded', 'tells', 'told', 'adds', 'added', 'explains', 'explained',
  'shouts', 'shouted', 'whispers', 'whispered', 'announces', 'announced',
  'states', 'stated', 'declares', 'declared', 'mentions', 'mentioned',
  'continues', 'continued', 'begins', 'began', 'confirms', 'confirmed',
  'greets', 'greeted', 'congratulates', 'congratulated', 'notes', 'noted',
  'types', 'typed', 'enters', 'entered', 'writes', 'wrote', 'sends', 'sent',
  'requests', 'requested', 'instructs', 'instructed', 'orders', 'ordered',
  'reports', 'reported', 'displays', 'displayed', 'shows', 'showed',
  'notifies', 'notified', 'informs', 'informed', 'prompts', 'prompted',
]);

/** Speech verbs that mean the line was typed into an interface, not spoken aloud. */
export const TYPED_VERBS = new Set([
  'types', 'typed', 'enters', 'entered', 'writes', 'wrote', 'sends', 'sent', 'submits', 'submitted',
]);

/** Speech verbs that mean a system emitted the line rather than a person speaking. */
export const SYSTEM_VERBS = new Set([
  'displays', 'displayed', 'shows', 'showed', 'notifies', 'notified',
  'reports', 'reported', 'confirms', 'confirmed', 'responds', 'responded',
]);

/**
 * Common role nouns. A noun phrase built on one of these is treated as a
 * character even without a proper name ("the cashier", "a doctor").
 * `gender: null` means unknown until the text says otherwise.
 */
export const ROLE_NOUNS = new Map(Object.entries({
  // service & retail
  customer: { gender: null }, client: { gender: null }, cashier: { gender: null },
  barista: { gender: null }, waiter: { gender: 'male' }, waitress: { gender: 'female' },
  server: { gender: null }, chef: { gender: null }, cook: { gender: null },
  bartender: { gender: null }, receptionist: { gender: null }, clerk: { gender: null },
  shopkeeper: { gender: null }, guest: { gender: null }, visitor: { gender: null },
  // medical
  doctor: { gender: null }, nurse: { gender: null }, patient: { gender: null },
  surgeon: { gender: null }, dentist: { gender: null }, therapist: { gender: null },
  paramedic: { gender: null }, pharmacist: { gender: null },
  // education
  teacher: { gender: null }, student: { gender: null }, professor: { gender: null },
  pupil: { gender: null }, lecturer: { gender: null }, principal: { gender: null },
  instructor: { gender: null }, tutor: { gender: null }, examiner: { gender: null },
  // business & technology
  manager: { gender: null }, operator: { gender: null }, engineer: { gender: null },
  developer: { gender: null }, analyst: { gender: null }, consultant: { gender: null },
  director: { gender: null }, executive: { gender: null }, supervisor: { gender: null },
  administrator: { gender: null }, technician: { gender: null }, designer: { gender: null },
  accountant: { gender: null }, lawyer: { gender: null }, agent: { gender: null },
  assistant: { gender: null }, secretary: { gender: null }, colleague: { gender: null },
  employee: { gender: null }, worker: { gender: null }, specialist: { gender: null },
  requester: { gender: null }, approver: { gender: null }, reviewer: { gender: null },
  // civic & other
  officer: { gender: null }, policeman: { gender: 'male' }, policewoman: { gender: 'female' },
  firefighter: { gender: null }, driver: { gender: null }, pilot: { gender: null },
  journalist: { gender: null }, reporter: { gender: null }, photographer: { gender: null },
  scientist: { gender: null }, researcher: { gender: null }, librarian: { gender: null },
  athlete: { gender: null }, coach: { gender: null }, referee: { gender: null },
  artist: { gender: null }, musician: { gender: null },
  // sport
  goalkeeper: { gender: null }, goalie: { gender: null }, player: { gender: null },
  striker: { gender: null }, defender: { gender: null }, captain: { gender: null },
  teammate: { gender: null }, opponent: { gender: null }, umpire: { gender: null },
  spectator: { gender: null }, fan: { gender: null }, runner: { gender: null },
  swimmer: { gender: null }, cyclist: { gender: null }, keeper: { gender: null },
  // family & general people
  man: { gender: 'male' }, woman: { gender: 'female' }, boy: { gender: 'male' },
  girl: { gender: 'female' }, gentleman: { gender: 'male' }, lady: { gender: 'female' },
  father: { gender: 'male' }, mother: { gender: 'female' }, son: { gender: 'male' },
  daughter: { gender: 'female' }, brother: { gender: 'male' }, sister: { gender: 'female' },
  husband: { gender: 'male' }, wife: { gender: 'female' }, friend: { gender: null },
  neighbour: { gender: null }, neighbor: { gender: null }, stranger: { gender: null },
  person: { gender: null }, child: { gender: null }, teenager: { gender: null },
}));

/** Non-human participants that speak as an interface rather than a person. */
export const SYSTEM_NOUNS = new Set([
  'chatbot', 'bot', 'assistant', 'system', 'application', 'app', 'software',
  'platform', 'portal', 'dashboard', 'interface', 'terminal', 'console',
  'computer', 'machine', 'device', 'screen', 'website', 'service', 'agent',
]);

/** Words that hint at the location of a scene. Keys map to a backdrop family. */
export const LOCATION_KINDS = new Map(Object.entries({
  office: 'office', workstation: 'office', desk: 'office', boardroom: 'office',
  meeting: 'office', cubicle: 'office', headquarters: 'office', workplace: 'office',
  'operations centre': 'office', 'operations center': 'office', 'control room': 'office',

  cafe: 'cafe', café: 'cafe', coffee: 'cafe', restaurant: 'cafe', diner: 'cafe',
  bar: 'cafe', kitchen: 'cafe', bakery: 'cafe', canteen: 'cafe', counter: 'cafe',

  hospital: 'medical', clinic: 'medical', ward: 'medical', surgery: 'medical',
  pharmacy: 'medical', infirmary: 'medical', 'examination room': 'medical',

  classroom: 'classroom', school: 'classroom', university: 'classroom',
  lecture: 'classroom', laboratory: 'classroom', lab: 'classroom',
  library: 'classroom', college: 'classroom', auditorium: 'classroom',

  shop: 'retail', store: 'retail', market: 'retail', supermarket: 'retail',
  showroom: 'retail', boutique: 'retail', warehouse: 'retail',

  home: 'home', house: 'home', apartment: 'home', flat: 'home',
  'living room': 'home', bedroom: 'home', lounge: 'home',

  street: 'outdoor', park: 'outdoor', garden: 'outdoor', beach: 'outdoor',
  road: 'outdoor', field: 'outdoor', outside: 'outdoor', city: 'outdoor',
  station: 'outdoor', airport: 'outdoor', platform: 'outdoor',
  pitch: 'outdoor', stadium: 'outdoor', court: 'outdoor', track: 'outdoor',
  playground: 'outdoor', yard: 'outdoor',
}));

/** Prepositions that introduce a location phrase. */
export const LOCATION_PREPOSITIONS = ['into the', 'into a', 'in the', 'in a', 'at the', 'at a', 'inside the', 'inside a', 'to the', 'to a'];

/**
 * Verbs that imply arriving somewhere, which establishes a scene's location.
 * Departure verbs are deliberately excluded: "receives the coffee and leaves"
 * must not invent a location called "Coffee".
 */
export const ARRIVAL_VERBS = new Set([
  'enters', 'entered', 'walks', 'walked', 'arrives', 'arrived', 'steps', 'stepped',
  'returns', 'returned', 'goes', 'went', 'moves', 'moved', 'heads', 'headed',
  'approaches', 'approached', 'visits', 'visited', 'reaches', 'reached',
]);

/** Verbs that imply leaving. They can end a scene but never name one. */
export const DEPARTURE_VERBS = new Set([
  'leaves', 'left', 'exits', 'exited', 'departs', 'departed',
]);

/** Discourse markers that signal a new beat or scene. */
export const SCENE_MARKERS = [
  'meanwhile', 'later', 'afterwards', 'afterward', 'then', 'next', 'finally',
  'eventually', 'soon after', 'the next day', 'that evening', 'that morning',
  'after that', 'at the same time', 'moments later', 'shortly after', 'in the end',
];

/** Words indicating a successful conclusion, used to mark a finale scene. */
export const COMPLETION_WORDS = [
  'complete', 'completed', 'completes', 'success', 'successful', 'successfully',
  'finished', 'finishes', 'done', 'confirmed', 'approved', 'resolved', 'delivered',
  'congratulates', 'congratulated', 'thanks', 'thanked', 'leaves happy',
  'celebrates', 'celebrated', 'celebrating', 'wins', 'won', 'cheers', 'cheered',
  'applauds', 'applauded', 'scores', 'scored',
];

/** Determiners and fillers stripped from the front of a noun phrase. */
export const DETERMINERS = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'its', 'this', 'that', 'one', 'two', 'three', 'some', 'another']);

/** Adjectives that commonly qualify a character and belong in their description. */
export const STOP_WORDS = new Set([
  'and', 'or', 'but', 'so', 'then', 'when', 'while', 'after', 'before', 'because',
  'if', 'as', 'that', 'which', 'who', 'whom', 'whose', 'with', 'without', 'for',
  'from', 'into', 'onto', 'about', 'over', 'under', 'again', 'very', 'just',
]);

/** Pronoun → gender, used to resolve the gender of a nearby character. */
export const PRONOUN_GENDER = new Map(Object.entries({
  he: 'male', him: 'male', his: 'male', himself: 'male',
  she: 'female', her: 'female', hers: 'female', herself: 'female',
}));

/** Explicit gender words appearing in a description. */
export const GENDER_WORDS = new Map(Object.entries({
  male: 'male', man: 'male', boy: 'male', gentleman: 'male', mr: 'male',
  female: 'female', woman: 'female', girl: 'female', lady: 'female',
  mrs: 'female', ms: 'female', miss: 'female',
}));

/** Visual style presets the user can choose between. */
export const STYLES = {
  corporate: {
    id: 'corporate',
    label: 'Corporate',
    description: 'Enterprise software demonstration: interface panel, data cards, progress rail.',
    presentation: 'interface',
    colors: {
      bgDeep: '#05080F', bgPanel: '#0C1526', bgPanelAlt: '#111E33',
      surface: '#16243C', surfaceAlt: '#1D2F4C', stroke: '#22375A', strokeSoft: '#1A2B47',
      textPrimary: '#EAF1FC', textSecondary: '#9FB3D1', textMuted: '#6B82A6',
      accent: '#3E8BFF', accentDeep: '#1F5FD6', accentSoft: '#8FBEFF',
      teal: '#31D8D8', success: '#25C08B', warning: '#F0A72B', userBubble: '#2563D9',
    },
  },
  cinematic: {
    id: 'cinematic',
    label: 'Cinematic',
    description: 'Warm, filmic storytelling with speech cards and location titles.',
    presentation: 'narrative',
    colors: {
      bgDeep: '#140F11', bgPanel: '#241A17', bgPanelAlt: '#2F221D',
      surface: '#382822', surfaceAlt: '#45322A', stroke: '#5C4438', strokeSoft: '#3E2D26',
      textPrimary: '#F7EFE8', textSecondary: '#CBB3A4', textMuted: '#967D6E',
      accent: '#E8925C', accentDeep: '#B9683A', accentSoft: '#F6BF95',
      teal: '#64B6A8', success: '#7FBF6A', warning: '#E0A93F', userBubble: '#B9683A',
    },
  },
  documentary: {
    id: 'documentary',
    label: 'Documentary',
    description: 'Neutral, factual presentation with strong captions and lower thirds.',
    presentation: 'narrative',
    colors: {
      bgDeep: '#07090C', bgPanel: '#101419', bgPanelAlt: '#161C23',
      surface: '#1B222B', surfaceAlt: '#232C37', stroke: '#33404E', strokeSoft: '#232C37',
      textPrimary: '#F0F3F7', textSecondary: '#AEBAC7', textMuted: '#7B8996',
      accent: '#D8B24C', accentDeep: '#A8862F', accentSoft: '#EFD храм', // placeholder replaced below
      teal: '#5FA8A0', success: '#6FB27A', warning: '#D8B24C', userBubble: '#A8862F',
    },
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    description: 'Restrained, typographic presentation on a near-black ground.',
    presentation: 'narrative',
    colors: {
      bgDeep: '#08090B', bgPanel: '#111316', bgPanelAlt: '#171A1E',
      surface: '#1C2025', surfaceAlt: '#24292F', stroke: '#333941', strokeSoft: '#24292F',
      textPrimary: '#F2F4F6', textSecondary: '#AEB6BF', textMuted: '#7C858F',
      accent: '#8AA0FF', accentDeep: '#5C74D8', accentSoft: '#BFCBFF',
      teal: '#7FC8C0', success: '#71C08B', warning: '#D9B463', userBubble: '#5C74D8',
    },
  },
};

// The documentary preset had a corrupted swatch; keep the palette valid.
STYLES.documentary.colors.accentSoft = '#EFD79A';

/** Choose a style from free text when the user has not picked one. */
export function inferStyle(text) {
  const t = text.toLowerCase();
  const businessHits = ['system', 'request', 'chatbot', 'assistant', 'client', 'integration',
    'workflow', 'ticket', 'queue', 'operator', 'enterprise', 'dashboard', 'application']
    .filter((w) => t.includes(w)).length;
  if (businessHits >= 3) return 'corporate';
  if (/\b(documentary|report|study|research|analysis)\b/.test(t)) return 'documentary';
  return 'cinematic';
}
