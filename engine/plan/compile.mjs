/**
 * Compiles an analysed StoryPlan into a RenderPlan: the frame-accurate
 * document the Remotion composition, the asset generators and the verifier all
 * read from.
 *
 * Responsibilities:
 *  - give every character a render identity and a voice
 *  - estimate how long every beat needs, and fit the whole piece to a target
 *    runtime by adjusting speech rate and pacing rather than truncating content
 *  - lay beats out on an absolute timeline inside each scene
 *  - choose a transition between each pair of scenes from their context
 *  - emit the audio cue sheet
 *
 * Nothing in this file knows about any particular story.
 */
import { assignIdentities, narratorIdentity } from '../cast/identity.mjs';
import { STYLES, inferStyle } from '../analysis/lexicon.mjs';
import { speechSeconds, readSeconds, slugify } from '../analysis/text.mjs';

/** Pacing constants, in seconds. */
const PACE = {
  sceneLeadIn: 0.45,
  sceneTailOut: 0.65,
  beatGap: 0.28,
  typingLead: 0.15,
  minBeat: 0.85,
  transitionSame: 0.8,
  transitionMove: 1.05,
  minSpeechRate: -10,
  maxSpeechRate: 60,
  minGapScale: 0.5,
  maxGapScale: 1.7,
};

const DEFAULT_FPS = 30;

/**
 * @param {object} story a StoryPlan from the analyser
 * @param {object} [options]
 * @param {number|null} [options.targetSeconds] desired runtime
 * @param {string} [options.styleId]
 * @param {string} [options.title]
 * @param {number} [options.fps]
 * @param {[number, number]} [options.resolution]
 * @param {string} [options.voiceStyle]
 * @param {boolean} [options.music]
 * @returns {object} RenderPlan
 */
export function compilePlan(story, {
  targetSeconds = null,
  styleId = null,
  title = null,
  fps = DEFAULT_FPS,
  resolution = [1920, 1080],
  voiceStyle = 'balanced',
  music = true,
} = {}) {
  const style = STYLES[styleId] ?? STYLES[inferStyle(story.source ?? '')] ?? STYLES.cinematic;

  const cast = assignIdentities(story.characters, { voiceStyle });
  const byKey = new Map(cast.map((c) => [c.key, c]));
  const narrator = narratorIdentity(style);

  /* ---------------------------------------------- 1. natural beat lengths -- */

  const sceneDrafts = story.scenes.map((scene, index) => {
    const beats = scene.beats.map((beat, i) => {
      const speaker = beat.speakerKey ? byKey.get(beat.speakerKey) : null;
      const spoken = beat.kind === 'dialogue' || beat.kind === 'system' || beat.kind === 'narration';
      return {
        id: `${scene.id ?? `s${index + 1}`}-b${i + 1}`,
        kind: beat.kind,
        text: beat.text,
        speakerId: speaker?.id ?? (beat.kind === 'narration' ? narrator.id : null),
        input: !!beat.input,
        spoken,
        // Estimate against what is actually spoken, not what is displayed:
        // "BCM002345" is read out as ten separate characters, so measuring the
        // display text would badly underestimate the line.
        naturalSeconds: spoken ? speechSeconds(pronounceable(beat.text)) : readSeconds(beat.text),
      };
    });
    return { source: scene, index, beats };
  });

  /* --------------------------------------------- 2. fit to target runtime -- */

  const totalSpeech = sceneDrafts.reduce((a, s) =>
    a + s.beats.filter((b) => b.spoken).reduce((x, b) => x + b.naturalSeconds, 0), 0);
  const totalRead = sceneDrafts.reduce((a, s) =>
    a + s.beats.filter((b) => !b.spoken).reduce((x, b) => x + b.naturalSeconds, 0), 0);
  const beatCount = sceneDrafts.reduce((a, s) => a + s.beats.length, 0);

  const transitionCount = Math.max(0, sceneDrafts.length - 1);
  const transitionKinds = chooseTransitions(story.scenes);
  const transitionTotal = transitionKinds.reduce((a, t) => a + t.durationSeconds, 0);

  const baseOverhead =
    sceneDrafts.length * (PACE.sceneLeadIn + PACE.sceneTailOut) +
    Math.max(0, beatCount - sceneDrafts.length) * PACE.beatGap;

  const natural = totalSpeech + totalRead + baseOverhead + transitionTotal;

  let speechRate = 8;   // percent, the comfortable default
  let gapScale = 1;

  if (targetSeconds && targetSeconds > 0) {
    const budget = targetSeconds - transitionTotal;
    // Solve for the speech rate that fits, holding pacing constant.
    const contentAtBase = totalSpeech + totalRead + baseOverhead;
    if (contentAtBase > 0) {
      const wanted = budget / contentAtBase;
      const ratePercent = (1 / Math.max(0.25, wanted) - 1) * 100;
      speechRate = clamp(Math.round(ratePercent + 8), PACE.minSpeechRate, PACE.maxSpeechRate);

      // Whatever the rate could not absorb, take from (or give to) the pacing.
      const speechAfter = (totalSpeech + totalRead) / (1 + speechRate / 100);
      const remaining = budget - speechAfter;
      gapScale = clamp(remaining / Math.max(0.001, baseOverhead), PACE.minGapScale, PACE.maxGapScale);
    }
  }

  const speechFactor = 1 / (1 + speechRate / 100);
  const leadIn = PACE.sceneLeadIn * gapScale;
  const tailOut = PACE.sceneTailOut * gapScale;
  const gap = PACE.beatGap * gapScale;

  /* --------------------------------------------------- 3. lay out the beats -- */

  const scenes = sceneDrafts.map((draft, index) => {
    const source = draft.source;
    const sceneId = source.id ?? `scene${index + 1}`;
    const present = (source.characterKeys ?? []).map((k) => byKey.get(k)).filter(Boolean);
    const location = source.location ?? { name: 'Scene', kind: 'generic' };

    let cursor = leadIn;
    const beats = [];
    const dialogue = [];
    const sfx = [];

    for (const beat of draft.beats) {
      const duration = Math.max(PACE.minBeat, beat.naturalSeconds * (beat.spoken ? speechFactor : Math.max(0.7, gapScale)));
      const appearAt = round(cursor);

      const entry = {
        id: beat.id,
        kind: beat.kind,
        text: beat.text,
        speakerId: beat.speakerId,
        appearAt,
        duration: round(duration),
      };

      // A typed line is composed in the interface before it is committed.
      if (beat.input) {
        entry.typeDuration = round(Math.max(0.6, duration * 0.8));
        entry.commitAt = round(appearAt + duration);
        sfx.push({ cue: 'typing', at: appearAt });
        sfx.push({ cue: 'message', at: round(appearAt + duration) });
      } else if (beat.kind === 'system') {
        sfx.push({ cue: 'notification', at: appearAt });
      } else if (beat.kind === 'dialogue') {
        sfx.push({ cue: 'message', at: appearAt });
      }

      beats.push(entry);

      if (beat.spoken && beat.text) {
        const speaker = beat.speakerId === narrator.id ? narrator : byKey.get(beat.speakerId);
        const speakText = pronounceable(beat.text);
        const rate = formatRate(speechRate);
        // The file name carries a hash of everything that determines the audio.
        // Beat ids repeat across stories ("scene1-b1"), so without this a new
        // story would silently reuse the previous story's voice files.
        const stamp = fingerprint(`${speakText}|${speaker?.voice.voiceId}|${rate}|${speaker?.voice.pitch}`);
        dialogue.push({
          id: `${beat.id}-vo`,
          enabled: true,
          characterId: speaker?.id ?? narrator.id,
          text: beat.text,
          speakText,
          file: `vo_${beat.id}_${stamp}.wav`,
          startAt: appearAt,
          rate,
        });
      }

      cursor = appearAt + duration + gap;
    }

    // The closing scene needs room to land, even when it is a single line.
    const floor = source.isFinale ? 4.2 : 2;
    const durationSeconds = round(Math.max(floor, cursor - gap + tailOut));

    // The scene's focus is whoever speaks the most in it.
    const speakerTally = new Map();
    for (const beat of beats) {
      if (beat.kind === 'dialogue' && beat.speakerId) {
        speakerTally.set(beat.speakerId, (speakerTally.get(beat.speakerId) ?? 0) + 1);
      }
    }
    const focusId = [...speakerTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      ?? (source.subjectKey && byKey.has(source.subjectKey) ? byKey.get(source.subjectKey).id : null)
      ?? present.find((c) => c.kind === 'person')?.id
      ?? null;

    if (source.isFinale) sfx.push({ cue: 'success', at: round(Math.max(0.2, durationSeconds - 2.2)) });

    return {
      id: sceneId,
      index,
      number: index + 1,
      title: source.title,
      label: `SCENE ${String(index + 1).padStart(2, '0')} — ${String(source.title).toUpperCase()}`,
      durationSeconds,
      location: { id: slugify(location.name, 'scene'), name: location.name, kind: location.kind },
      characterIds: present.map((c) => c.id),
      focusId,
      isFinale: !!source.isFinale,
      camera: cameraFor(index, present.length),
      beats,
      dialogue,
      sfx,
      summary: source.text,
    };
  });

  /* ---------------------------------------------------- 4. transitions etc -- */

  const transitions = transitionKinds.map((t, i) => ({
    id: `t${i + 1}`,
    afterScene: scenes[i].id,
    fromIndex: i,
    toIndex: i + 1,
    durationSeconds: t.durationSeconds,
    type: t.type,
    caption: t.caption,
    sfx: 'transition',
  }));

  // Rate and pacing alone cannot always reach the target: a very short story
  // asked for 60 seconds still has only so much to say. Any shortfall is added
  // as hold time at the end of each scene, proportional to its length, so the
  // film breathes instead of ending early.
  if (targetSeconds && targetSeconds > 0) {
    const sceneTotal = scenes.reduce((a, s) => a + s.durationSeconds, 0);
    const budget = targetSeconds - transitions.reduce((a, t) => a + t.durationSeconds, 0);
    const shortfall = budget - sceneTotal;
    if (shortfall > 0.3 && sceneTotal > 0) {
      for (const scene of scenes) {
        scene.durationSeconds = round(scene.durationSeconds + shortfall * (scene.durationSeconds / sceneTotal));
      }
    }
  }

  const totalSeconds = round(
    scenes.reduce((a, s) => a + s.durationSeconds, 0) +
    transitions.reduce((a, t) => a + t.durationSeconds, 0),
  );

  // Record honestly whether the requested runtime was reachable. A story with
  // more speech than the target allows is stretched as far as pacing and rate
  // can take it, and the plan says so rather than silently missing.
  const targetMet = targetSeconds
    ? Math.abs(totalSeconds - targetSeconds) <= Math.max(2.5, targetSeconds * 0.12)
    : null;

  const derivedTitle = title || story.scenes[0]?.title || 'Generated Story';

  return {
    meta: {
      id: slugify(derivedTitle, 'story'),
      title: derivedTitle,
      subtitle: subtitleFor(story, scenes),
      version: '2.0.0',
      generatedAt: new Date().toISOString(),
      analyser: story.analyser ?? 'heuristic',
      fps,
      width: resolution[0],
      height: resolution[1],
      styleId: style.id,
      targetSeconds,
      speechRate,
      targetMet,
      gapScale: round(gapScale),
      naturalSeconds: round(natural),
    },
    brand: {
      appName: derivedTitle,
      appSubtitle: subtitleFor(story, scenes),
      assistantName: cast.find((c) => c.kind === 'system')?.name ?? 'Assistant',
      colors: style.colors,
      fonts: { ui: 'Inter', mono: 'JetBrains Mono' },
    },
    presentation: style.presentation,
    style: { id: style.id, label: style.label, description: style.description },
    characters: cast,
    narrator,
    locations: story.locations,
    scenes,
    transitions,
    audio: {
      music: {
        file: 'music_bed.wav',
        volume: music ? 0.1 : 0,
        fadeInSeconds: 1.2,
        fadeOutSeconds: 2.2,
      },
      sfx: {
        notification: { file: 'sfx_notification.wav', volume: 0.26 },
        message: { file: 'sfx_message.wav', volume: 0.18 },
        typing: { file: 'sfx_typing.wav', volume: 0.12 },
        processing: { file: 'sfx_processing.wav', volume: 0.16 },
        success: { file: 'sfx_success.wav', volume: 0.3 },
        transition: { file: 'sfx_transition.wav', volume: 0.17 },
      },
      dialogueVolume: 1.0,
    },
    totals: {
      seconds: totalSeconds,
      frames: Math.round(totalSeconds * fps),
      scenes: scenes.length,
      transitions: transitions.length,
      characters: cast.length,
      spokenLines: scenes.reduce((a, s) => a + s.dialogue.length, 0),
    },
    source: story.source,
  };
}

/* ----------------------------------------------------------------- helpers -- */

/**
 * Pick a transition between each pair of scenes from their context: moving to a
 * new place gets a location transition, staying put gets a simple fade.
 */
function chooseTransitions(scenes) {
  const out = [];
  for (let i = 0; i < scenes.length - 1; i++) {
    const from = scenes[i];
    const to = scenes[i + 1];
    const movedRoom = (from.location?.name ?? '') !== (to.location?.name ?? '');
    const movedKind = (from.location?.kind ?? '') !== (to.location?.kind ?? '');

    if (movedKind || movedRoom) {
      out.push({
        type: 'location',
        durationSeconds: PACE.transitionMove,
        caption: to.location?.name ?? to.title,
      });
    } else if (to.isFinale) {
      out.push({ type: 'resolve', durationSeconds: PACE.transitionMove, caption: to.title });
    } else {
      out.push({ type: 'fade', durationSeconds: PACE.transitionSame, caption: to.title });
    }
  }
  return out;
}

/** Alternate gentle camera moves so consecutive scenes do not feel identical. */
function cameraFor(index, castSize) {
  const moves = [
    { type: 'pushIn', from: 1.0, to: 1.06, panX: -14, panY: -6 },
    { type: 'pushIn', from: 1.06, to: 1.0, panX: 12, panY: 5 },
    { type: 'pushIn', from: 1.02, to: 1.08, panX: 8, panY: -8 },
    { type: 'pushIn', from: 1.07, to: 1.01, panX: -10, panY: 6 },
  ];
  const move = moves[index % moves.length];
  // A crowded scene moves less so the group stays readable.
  return castSize >= 3 ? { ...move, to: move.from + (move.to - move.from) * 0.6 } : move;
}

function subtitleFor(story, scenes) {
  const places = [...new Set(scenes.map((s) => s.location.name))].slice(0, 2);
  const cast = story.characters.filter((c) => c.kind === 'person').length;
  const where = places.length ? places.join(' & ') : 'Generated story';
  return `${cast} character${cast === 1 ? '' : 's'} · ${scenes.length} scene${scenes.length === 1 ? '' : 's'} · ${where}`;
}

/**
 * Respell identifiers so a synthesiser pronounces them the way a person would
 * read them aloud: "QL9" as "Q L 9", "BCM002345" digit by digit. The displayed
 * text is never changed - only what the voice is given.
 */
export function pronounceable(text) {
  // Only codes that mix letters and digits are respelled. A plain acronym like
  // "BCM" is already read letter by letter by the synthesiser, and spelling it
  // out again would only slow the line down.
  return String(text).replace(/\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{2,}\b/g, (token) => {
    // Pure numbers under four digits read naturally already.
    if (/^\d{1,3}$/.test(token)) return token;
    return token
      .replace(/([A-Za-z])(?=\d)/g, '$1 ')
      .replace(/(\d)(?=[A-Za-z])/g, '$1 ')
      .split(/(\d+)/)
      .map((part) => {
        if (/^\d+$/.test(part)) return part.split('').join(' ');
        return part.split('').join(' ');
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  });
}

/** A short, stable hash used to key generated audio to its exact content. */
function fingerprint(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 7);
}

/** edge-tts expects a signed percentage: "+18%" or "-10%". */
export function formatRate(percent) {
  const value = Math.round(percent);
  return `${value >= 0 ? '+' : ''}${value}%`;
}

const round = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
