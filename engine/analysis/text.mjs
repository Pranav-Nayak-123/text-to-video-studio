/**
 * Text utilities for the story analyser: segmentation, quote extraction and
 * noun-phrase handling. Deliberately dependency-free and language-neutral in
 * structure, tuned for English prose and simple screenplay formatting.
 */
import { DETERMINERS, LOCATION_KINDS, LOCATION_PREPOSITIONS } from './lexicon.mjs';

/** Straight and typographic quote pairs the analyser understands. */
const QUOTE_PAIRS = [['"', '"'], ['“', '”'], ['‘', '’'], ["'", "'"]];

/**
 * Split a story into paragraphs. A blank line is an explicit break; a line that
 * looks like a scene heading also starts a new paragraph.
 */
export function splitParagraphs(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** True when a line reads as an explicit scene heading. */
export function isSceneHeading(line) {
  const t = line.trim();
  return (
    /^#{1,3}\s+/.test(t) ||
    /^(scene|shot|part|chapter|step|stage)\b\s*\d*\s*[:.\-—]/i.test(t) ||
    /^(int|ext)[.\s]/i.test(t)
  );
}

/** Strip heading punctuation, returning the human-readable title. */
export function headingTitle(line) {
  return line
    .replace(/^#{1,3}\s+/, '')
    .replace(/^(scene|shot|part|chapter|step|stage)\b\s*\d*\s*[:.\-—]\s*/i, '')
    .replace(/^(int|ext)[.\s]+/i, '')
    .trim();
}

/**
 * Split a block of prose into sentences, keeping quoted speech intact so a
 * full stop inside dialogue does not break the sentence apart.
 */
export function splitSentences(text) {
  const out = [];
  let current = '';
  let quote = null;

  const chars = [...String(text).trim()];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    current += ch;

    if (quote) {
      if (ch === quote) {
        quote = null;
        // `She says, "We need to leave now."` puts the full stop inside the
        // quote, so the sentence has to end at the closing mark itself.
        const beforeClose = chars[i - 1];
        const next = chars[i + 1];
        if (/[.!?]/.test(beforeClose ?? '') && (next === undefined || /\s/.test(next))) {
          out.push(current.trim());
          current = '';
        }
      }
      continue;
    }
    const opening = QUOTE_PAIRS.find(([open]) => open === ch);
    // A straight apostrophe inside a word is not an opening quote.
    if (opening && !(ch === "'" && /\w$/.test(current.slice(0, -1)))) {
      quote = opening[1];
      continue;
    }

    if (/[.!?]/.test(ch)) {
      const next = chars[i + 1];
      const after = chars[i + 2];
      // Keep decimals and abbreviations together.
      if (ch === '.' && /\d/.test(next ?? '')) continue;
      if (next === undefined || /\s/.test(next)) {
        // Absorb a closing quote or bracket that follows the terminator.
        if (next && QUOTE_PAIRS.some(([, close]) => close === after)) continue;
        out.push(current.trim());
        current = '';
      }
    }
  }

  if (current.trim()) out.push(current.trim());
  return out.filter((s) => s.replace(/[^A-Za-z0-9]/g, '').length > 0);
}

/**
 * Extract quoted spans from a sentence.
 * @returns {{text: string, start: number, end: number}[]}
 */
export function extractQuotes(sentence) {
  const quotes = [];
  const chars = [...sentence];
  let i = 0;
  while (i < chars.length) {
    const pair = QUOTE_PAIRS.find(([open]) => open === chars[i]);
    if (pair && !(chars[i] === "'" && /\w/.test(chars[i - 1] ?? ''))) {
      const close = pair[1];
      let j = i + 1;
      while (j < chars.length && chars[j] !== close) j++;
      if (j < chars.length && j > i + 1) {
        const inner = chars.slice(i + 1, j).join('').trim();
        if (inner.length > 1) quotes.push({ text: inner, start: i, end: j });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return quotes;
}

/** Remove quoted spans, leaving the narrative frame around them. */
export function withoutQuotes(sentence) {
  const quotes = extractQuotes(sentence);
  if (!quotes.length) return sentence;
  const chars = [...sentence];
  let out = '';
  let cursor = 0;
  for (const q of quotes) {
    out += chars.slice(cursor, q.start).join('');
    cursor = q.end + 1;
  }
  out += chars.slice(cursor).join('');
  return out.replace(/\s+/g, ' ').trim();
}

/** Lower-case word tokens. */
export function words(text) {
  return String(text).toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? [];
}

/** Tokens preserving original case, used for proper-noun detection. */
export function tokens(text) {
  return String(text).match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? [];
}

/** Strip leading determiners from a noun phrase: "the tired patient" → "tired patient". */
export function stripDeterminer(phrase) {
  const parts = phrase.trim().split(/\s+/);
  while (parts.length > 1 && DETERMINERS.has(parts[0].toLowerCase())) parts.shift();
  return parts.join(' ');
}

/** Title Case for display names. */
export function titleCase(phrase) {
  return String(phrase)
    .split(/\s+/)
    .map((w) => (w.length <= 2 && /^(of|to|in|at|a|an|the)$/i.test(w)
      ? w.toLowerCase()
      : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .trim();
}

/** A stable, url-safe id derived from a name. */
export function slugify(name, fallback = 'item') {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/**
 * Find a location phrase in a sentence: "walks into the coffee shop" →
 * { name: "coffee shop", kind: "cafe" }.
 */
export function findLocation(sentence) {
  const lower = sentence.toLowerCase();

  for (const prep of LOCATION_PREPOSITIONS) {
    let from = 0;
    while (true) {
      const at = lower.indexOf(`${prep} `, from);
      if (at === -1) break;
      from = at + prep.length;

      const tail = sentence.slice(at + prep.length).trim();
      // Take up to four words, stopping at punctuation or a clause boundary.
      const phrase = tail
        .split(/[,.;:!?]/)[0]
        .split(/\s+/)
        .slice(0, 4)
        .join(' ')
        .replace(/\b(and|then|where|who|which|while|to|for|with)\b.*$/i, '')
        .trim();

      if (!phrase) continue;
      const kind = classifyLocation(phrase);
      if (kind) return { name: expandLocationName(phrase, matchedKeyword(phrase)), kind };
    }
  }

  // "enters a coffee shop" has no preposition at all.
  const arrival = /(?:enters?|entered|arrives?|arrived|visits?|visited|reaches?|reached)\s+(?:the|a|an)?\s*([\w\s]{2,32})/i.exec(sentence);
  if (arrival) {
    const phrase = arrival[1].split(/[,.;:!?]/)[0].trim();
    const kind = classifyLocation(phrase);
    if (kind) return { name: expandLocationName(phrase, matchedKeyword(phrase)), kind };
  }

  // Fall back to a location word elsewhere in the sentence, but only one that
  // names a place on its own. "coffee" only means a cafe inside "coffee shop",
  // so "receives the coffee and leaves" must not become a location.
  const kind = classifyLocation(lower);
  if (kind) {
    const keyword = matchedKeyword(lower);
    const name = expandLocationName(lower, keyword ?? kind);
    if (keyword && (STANDALONE_PLACES.has(keyword) || name.split(/\s+/).length > 1)) {
      return { name, kind };
    }
  }
  return null;
}

/**
 * Location keywords that name a place by themselves. The rest ("coffee",
 * "counter", "desk") only indicate a place as part of a compound.
 */
const STANDALONE_PLACES = new Set([
  'office', 'boardroom', 'cubicle', 'headquarters', 'workplace', 'workstation',
  'cafe', 'café', 'restaurant', 'diner', 'bakery', 'canteen', 'kitchen',
  'hospital', 'clinic', 'ward', 'pharmacy', 'infirmary',
  'classroom', 'school', 'university', 'laboratory', 'library', 'college', 'auditorium',
  'shop', 'store', 'market', 'supermarket', 'showroom', 'boutique', 'warehouse',
  'home', 'house', 'apartment', 'flat', 'bedroom', 'lounge',
  'street', 'park', 'garden', 'beach', 'road', 'airport', 'station',
  'pitch', 'stadium', 'playground', 'field',
]);

/** The longest location keyword present in a phrase. */
function matchedKeyword(phrase) {
  const lower = String(phrase).toLowerCase();
  const keys = [...LOCATION_KINDS.keys()].sort((a, b) => b.length - a.length);
  return keys.find((k) => new RegExp(`\\b${escapeRegExp(k)}\\b`).test(lower)) ?? null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Nouns that complete a place compound. "coffee" + "shop" -> "Coffee Shop",
 * while "street" + "together" stays just "Street".
 */
const PLACE_HEADS = new Set([
  'shop', 'store', 'room', 'hall', 'centre', 'center', 'office', 'building',
  'house', 'area', 'floor', 'lab', 'laboratory', 'court', 'field', 'station',
  'counter', 'desk', 'kitchen', 'ward', 'clinic', 'bar', 'studio', 'workshop',
  'terminal', 'lounge', 'garden', 'park', 'yard', 'hallway', 'corridor',
]);

/**
 * Expand a matched location keyword into its full name using the words around
 * it, so the scene is titled "Coffee Shop" rather than "Coffee".
 */
export function expandLocationName(phrase, keyword) {
  const parts = String(phrase).toLowerCase().split(/\s+/).filter(Boolean);
  const keyParts = keyword.split(/\s+/);
  const at = parts.findIndex((_, i) => parts.slice(i, i + keyParts.length).join(' ') === keyword);
  if (at === -1) return titleCase(keyword);

  let start = at;
  let end = at + keyParts.length;
  const next = parts[end];
  if (next && PLACE_HEADS.has(next)) end += 1;
  const prev = parts[start - 1];
  if (prev && !DETERMINERS.has(prev) && PLACE_HEADS.has(parts[end - 1]) && /^[a-z]+$/.test(prev)
      && !['the', 'and', 'to', 'into', 'at', 'in'].includes(prev)) {
    // Only pull in a preceding word when it qualifies a place head.
    start -= 1;
  }
  return titleCase(parts.slice(start, end).join(' '));
}

/** Map a phrase to a backdrop family, or null when nothing matches. */
export function classifyLocation(phrase) {
  const lower = String(phrase).toLowerCase();
  // Prefer the longest matching key so "coffee shop" beats "shop".
  const keys = [...LOCATION_KINDS.keys()].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      return LOCATION_KINDS.get(key);
    }
  }
  return null;
}

/** Estimated spoken length of a line, in seconds, at a given words-per-minute. */
export function speechSeconds(text, wpm = 165) {
  const count = words(text).length;
  if (!count) return 0;
  // Digits and capitalised identifiers are read out slowly; add for each.
  const identifiers = (String(text).match(/\b(?=\w*\d)\w+\b|\b[A-Z]{2,}\b/g) ?? []).length;
  return (count / wpm) * 60 + identifiers * 0.45 + 0.25;
}

/** Estimated time an audience needs to read a caption, in seconds. */
export function readSeconds(text, wpm = 240) {
  const count = words(text).length;
  return Math.max(0.9, (count / wpm) * 60 + 0.5);
}
