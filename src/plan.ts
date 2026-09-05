import planJson from '../config/render-plan.json';
import plateManifest from '../public/plates/plate-manifest.json';

/**
 * The render plan, produced by engine/plan/compile.mjs. Every value the
 * composition draws comes from here - there is no story knowledge in src/.
 */
export const plan = planJson as unknown as RenderPlan;

export const colors = plan.brand.colors;

export const fonts = {
  ui: `Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif`,
  mono: `"JetBrains Mono", "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace`,
};

/* ------------------------------------------------------------------ types -- */

export interface RenderPlan {
  meta: {
    id: string; title: string; subtitle: string; version: string; generatedAt: string;
    analyser: string; fps: number; width: number; height: number; styleId: string;
    targetSeconds: number | null; speechRate: number; gapScale: number; naturalSeconds: number;
  };
  brand: {
    appName: string; appSubtitle: string; assistantName: string;
    colors: Record<string, string>;
    fonts: { ui: string; mono: string };
  };
  presentation: 'narrative' | 'interface';
  style: { id: string; label: string; description: string };
  characters: Character[];
  narrator: Character;
  locations: { id: string; name: string; kind: string }[];
  scenes: Scene[];
  transitions: Transition[];
  audio: {
    music: { file: string; volume: number; fadeInSeconds: number; fadeOutSeconds: number };
    sfx: Record<string, { file: string; volume: number }>;
    dialogueVolume: number;
  };
  totals: {
    seconds: number; frames: number; scenes: number; transitions: number;
    characters: number; spokenLines: number;
  };
  source: string;
}

export interface Character {
  id: string; key: string; name: string; displayName: string; role: string;
  kind: 'person' | 'system' | 'narrator';
  gender: string; initials: string; accent: string;
  sceneIndexes: number[]; descriptors: string[];
  appearance: { summary: string; [k: string]: unknown };
  voice: { provider: string; voiceId: string; rate?: string; pitch?: string };
}

export type BeatKind = 'narration' | 'dialogue' | 'system' | 'action';

export interface Beat {
  id: string;
  kind: BeatKind;
  text: string;
  speakerId: string | null;
  appearAt: number;
  duration: number;
  typeDuration?: number;
  commitAt?: number;
}

export interface Scene {
  id: string; index: number; number: number; title: string; label: string;
  durationSeconds: number;
  location: { id: string; name: string; kind: string };
  characterIds: string[];
  focusId: string | null;
  isFinale: boolean;
  camera: { type: 'pushIn' | 'none'; from?: number; to?: number; panX?: number; panY?: number };
  beats: Beat[];
  dialogue: { id: string; characterId: string; text: string; file: string; startAt: number; enabled?: boolean }[];
  sfx: { cue: string; at: number }[];
  summary: string;
}

export interface Transition {
  id: string; afterScene: string; fromIndex: number; toIndex: number;
  durationSeconds: number; type: 'fade' | 'location' | 'resolve';
  caption: string; sfx: string;
}

/* -------------------------------------------------------------- utilities -- */

export const characterById = (id: string | null): Character | null => {
  if (!id) return null;
  if (plan.narrator?.id === id) return plan.narrator;
  return plan.characters.find((c) => c.id === id) ?? null;
};

export const totalFrames = (): number => {
  const seconds =
    plan.scenes.reduce((a, s) => a + s.durationSeconds, 0) +
    plan.transitions.reduce((a, t) => a + t.durationSeconds, 0);
  return Math.max(1, Math.round(seconds * plan.meta.fps));
};

export interface Segment {
  kind: 'scene' | 'transition';
  id: string;
  startFrame: number;
  durationInFrames: number;
  scene?: Scene;
  transition?: Transition;
}

/** Scenes and transitions flattened into one ordered timeline. */
export const buildSegments = (): Segment[] => {
  const fps = plan.meta.fps;
  const segments: Segment[] = [];
  let cursor = 0;

  for (const scene of plan.scenes) {
    segments.push({
      kind: 'scene',
      id: scene.id,
      startFrame: Math.round(cursor * fps),
      durationInFrames: Math.round(scene.durationSeconds * fps),
      scene,
    });
    cursor += scene.durationSeconds;

    const transition = plan.transitions.find((t) => t.afterScene === scene.id);
    if (transition) {
      segments.push({
        kind: 'transition',
        id: transition.id,
        startFrame: Math.round(cursor * fps),
        durationInFrames: Math.round(transition.durationSeconds * fps),
        transition,
      });
      cursor += transition.durationSeconds;
    }
  }
  return segments;
};

/** The plate file for a scene, preferring a photoreal render when one exists. */
export const plateFor = (sceneId: string): string => {
  const entry = (plateManifest as { scenes: { id: string; plate: string }[] }).scenes
    .find((s) => s.id === sceneId);
  return entry?.plate ?? `plates/${sceneId}.svg`;
};
