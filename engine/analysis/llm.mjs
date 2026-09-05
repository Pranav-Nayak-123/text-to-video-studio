/**
 * Optional model-backed story analysis.
 *
 * When a language model is reachable it produces a richer reading of the story
 * than the rule-based analyser can: implied characters, better scene
 * boundaries, inferred appearance. The output is validated and normalised into
 * exactly the same StoryPlan shape, so nothing downstream can tell which
 * analyser ran.
 *
 * If the model is unreachable, returns an error and the caller falls back to
 * engine/analysis/heuristic.mjs. The pipeline never depends on this file.
 */
import { slugify, titleCase, classifyLocation } from './text.mjs';

const API_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.STORY_MODEL || 'gpt-4o-mini';

export function llmAvailable() {
  return !!process.env.OPENAI_API_KEY;
}

const SCHEMA_INSTRUCTIONS = `You convert a story into a structured video plan.
Return ONLY JSON matching this shape:

{
  "characters": [
    {"key": "kebab-case-id", "name": "Display Name", "kind": "person"|"system",
     "gender": "male"|"female"|null, "role": "short role", "descriptors": ["adjective"]}
  ],
  "scenes": [
    {"title": "Short Scene Title",
     "location": {"name": "Place Name", "kind": "office|cafe|medical|classroom|retail|home|outdoor|generic"},
     "characterKeys": ["kebab-case-id"],
     "isFinale": false,
     "beats": [
       {"kind": "narration"|"dialogue"|"system"|"action",
        "speakerKey": "kebab-case-id or null",
        "text": "exact words",
        "input": false}
     ]}
  ]
}

Rules:
- Use ONLY the story's own words for dialogue text. Never invent lines.
- "dialogue" is a person speaking; "system" is an interface or device responding;
  "narration" is the story describing events; "action" is a brief on-screen caption.
- Set "input": true when a character types a command into an interface rather
  than speaking it aloud.
- gender only when the story states or clearly implies it, otherwise null.
- Split into as many scenes as the story naturally has. Do not pad or merge.`;

/**
 * @param {string} text
 * @param {object} [options]
 * @returns {Promise<object>} a StoryPlan in the same shape as the heuristic analyser
 */
export async function analyseWithLlm(text, { targetSeconds = null, maxScenes = 8, signal } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SCHEMA_INSTRUCTIONS },
        { role: 'user', content: `Maximum ${maxScenes} scenes.\n\nSTORY:\n${text}` },
      ],
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    let detail = body.slice(0, 240);
    try { detail = JSON.parse(body)?.error?.message ?? detail; } catch { /* keep raw */ }
    throw new Error(`HTTP ${res.status} — ${detail}`);
  }

  const content = JSON.parse(body)?.choices?.[0]?.message?.content;
  if (!content) throw new Error('the model returned no content');

  return normalise(JSON.parse(content), text, targetSeconds);
}

/**
 * Coerce the model's output into the exact StoryPlan contract, dropping
 * anything malformed rather than trusting it.
 */
function normalise(raw, source, targetSeconds) {
  const characters = (raw.characters ?? [])
    .filter((c) => c && (c.name || c.key))
    .map((c) => ({
      key: slugify(c.key || c.name),
      name: titleCase(c.name || c.key),
      kind: c.kind === 'system' ? 'system' : 'person',
      gender: c.gender === 'male' || c.gender === 'female' ? c.gender : null,
      role: c.role ? titleCase(c.role) : null,
      descriptors: Array.isArray(c.descriptors) ? c.descriptors.filter((d) => typeof d === 'string') : [],
      mentions: 1,
      sceneIndexes: [],
    }));

  const known = new Set(characters.map((c) => c.key));

  const scenes = (raw.scenes ?? [])
    .filter((s) => s && Array.isArray(s.beats))
    .map((s, index) => {
      const locationName = s.location?.name ? titleCase(s.location.name) : 'Scene';
      const kind = s.location?.kind && classifyLocation(s.location.kind)
        ? classifyLocation(s.location.kind)
        : classifyLocation(locationName) ?? 'generic';

      const beats = s.beats
        .filter((b) => b && typeof b.text === 'string' && b.text.trim())
        .map((b) => {
          const speakerKey = b.speakerKey && known.has(slugify(b.speakerKey)) ? slugify(b.speakerKey) : null;
          const kindOk = ['narration', 'dialogue', 'system', 'action'].includes(b.kind);
          return {
            kind: kindOk ? b.kind : 'narration',
            speakerKey,
            text: b.text.trim(),
            input: !!b.input,
          };
        });

      const characterKeys = (Array.isArray(s.characterKeys) ? s.characterKeys : [])
        .map((k) => slugify(k))
        .filter((k) => known.has(k));

      // Anyone who speaks in the scene is in the scene.
      for (const beat of beats) {
        if (beat.speakerKey && !characterKeys.includes(beat.speakerKey)) characterKeys.push(beat.speakerKey);
      }

      return {
        index,
        id: `scene${index + 1}`,
        title: s.title ? titleCase(s.title) : locationName,
        location: { name: locationName, kind },
        characterKeys,
        subjectKey: characterKeys[0] ?? null,
        beats,
        isFinale: !!s.isFinale,
        text: beats.map((b) => b.text).join(' '),
      };
    })
    .filter((s) => s.beats.length);

  if (!scenes.length) throw new Error('the model produced no usable scenes');

  scenes.forEach((scene, i) => {
    for (const key of scene.characterKeys) {
      const character = characters.find((c) => c.key === key);
      if (character && !character.sceneIndexes.includes(i)) character.sceneIndexes.push(i);
    }
  });

  const locations = [];
  const seen = new Set();
  for (const scene of scenes) {
    const id = slugify(scene.location.name, 'scene');
    if (!seen.has(id)) { seen.add(id); locations.push({ id, ...scene.location }); }
  }

  return {
    source,
    analyser: 'llm',
    targetSeconds,
    characters: characters.filter((c) => c.sceneIndexes.length),
    locations,
    scenes,
  };
}
