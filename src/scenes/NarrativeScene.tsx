import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Beat, Scene, characterById, colors, fonts, plan, plateFor } from '../plan';
import { Avatar, Label, hexA, useReveal, useSpringIn } from '../components/primitives';
import { ProgressRail, StoryIdentity } from '../components/Stage';

/**
 * The default presentation: a scene plate with the cast standing in it, the
 * location named, dialogue delivered as speech cards attributed to a character,
 * and narration as a lower third.
 *
 * Everything is driven by the plan, so this component works for any story.
 */
export const NarrativeScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;

  const cast = scene.characterIds.map(characterById).filter(Boolean) as NonNullable<ReturnType<typeof characterById>>[];

  // The beat currently on screen, and the narration/action caption under it.
  const active = [...scene.beats].reverse().find((b) => t >= b.appearAt) ?? null;
  const speech = [...scene.beats].reverse().find(
    (b) => (b.kind === 'dialogue' || b.kind === 'system') && t >= b.appearAt && t < b.appearAt + b.duration + 0.6,
  ) ?? null;
  const caption = [...scene.beats].reverse().find(
    (b) => (b.kind === 'narration' || b.kind === 'action') && t >= b.appearAt && t < b.appearAt + b.duration + 0.4,
  ) ?? null;

  const edgeFade = Math.min(
    interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    interpolate(frame, [durationInFrames - 7, durationInFrames - 1], [1, 0.6], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    }),
  );

  return (
    <AbsoluteFill style={{ opacity: edgeFade, background: colors.bgDeep }}>
      <ScenePlate scene={scene} progress={progress} />

      <StoryIdentity scene={scene} />
      <LocationCard scene={scene} />
      <CastStrip cast={cast} speakingId={speech?.speakerId ?? scene.focusId} />

      {caption ? <Caption key={caption.id} beat={caption} /> : null}
      {speech ? <SpeechCard key={speech.id} beat={speech} t={t} /> : null}

      <ProgressRail activeIndex={scene.index} />
      {active && scene.isFinale ? <FinaleGlow scene={scene} t={t} /> : null}
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------------------- plate -- */

const ScenePlate: React.FC<{ scene: Scene; progress: number }> = ({ scene, progress }) => {
  const camera = scene.camera ?? { type: 'none' };
  const zoom = camera.type === 'pushIn'
    ? interpolate(progress, [0, 1], [camera.from ?? 1, camera.to ?? 1.06])
    : 1;
  const panX = interpolate(progress, [0, 1], [0, camera.panX ?? 0]);
  const panY = interpolate(progress, [0, 1], [0, camera.panY ?? 0]);

  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: colors.bgDeep }}>
      <AbsoluteFill
        style={{ transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`, transformOrigin: '48% 44%' }}
      >
        <Img
          src={staticFile(plateFor(scene.id))}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 42%' }}
        />
      </AbsoluteFill>

      {/* Grade: darken the lower third where the speech card sits. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(to bottom,
            ${hexA(colors.bgDeep, 0.5)} 0%,
            ${hexA(colors.bgDeep, 0.12)} 26%,
            ${hexA(colors.bgDeep, 0.24)} 52%,
            ${hexA(colors.bgDeep, 0.86)} 84%,
            ${hexA(colors.bgDeep, 0.95)} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------- speech card -- */

const SpeechCard: React.FC<{ beat: Beat; t: number }> = ({ beat, t }) => {
  const { fps } = useVideoConfig();
  const speaker = characterById(beat.speakerId);
  const enterFrame = Math.round(beat.appearAt * fps);
  const p = useReveal(enterFrame, 9);
  const accent = speaker?.accent ?? colors.accent;
  const isSystem = beat.kind === 'system';

  // A typed line is revealed character by character.
  const shown = beat.typeDuration
    ? beat.text.slice(0, Math.round(beat.text.length * clamp01((t - beat.appearAt) / beat.typeDuration)))
    : beat.text;

  return (
    <div
      style={{
        position: 'absolute', left: 150, right: 150, bottom: 168,
        opacity: p, transform: `translateY(${(1 - p) * 22}px)`,
        display: 'flex', gap: 22, alignItems: 'flex-start',
        padding: '28px 36px',
        borderRadius: 22,
        background: `linear-gradient(140deg, ${hexA(accent, 0.16)}, ${hexA(colors.bgPanel, 0.93)} 55%)`,
        border: `1px solid ${hexA(accent, 0.42)}`,
        borderLeft: `5px solid ${accent}`,
        boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
        backdropFilter: 'blur(14px)',
      }}
    >
      {speaker ? (
        <Avatar initials={speaker.initials} accent={accent} size={62} />
      ) : null}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span
            style={{
              fontFamily: fonts.ui, fontSize: 21, fontWeight: 750,
              letterSpacing: '0.06em', textTransform: 'uppercase', color: accent,
            }}
          >
            {speaker?.displayName ?? 'Voice'}
          </span>
          {isSystem ? (
            <span
              style={{
                fontFamily: fonts.ui, fontSize: 12, fontWeight: 800, letterSpacing: '0.16em',
                textTransform: 'uppercase', color: colors.textSecondary,
                border: `1px solid ${hexA(colors.textSecondary, 0.4)}`,
                borderRadius: 999, padding: '3px 10px',
              }}
            >
              System
            </span>
          ) : null}
        </div>

        <div
          style={{
            fontFamily: isSystem ? fonts.mono : fonts.ui,
            fontSize: isSystem ? 33 : 37,
            lineHeight: 1.34,
            fontWeight: isSystem ? 500 : 550,
            color: colors.textPrimary,
            letterSpacing: '-0.01em',
          }}
        >
          {isSystem ? shown : `“${shown}”`}
        </div>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- caption -- */

/** Narration and action beats, set as a lower third. */
const Caption: React.FC<{ beat: Beat }> = ({ beat }) => {
  const { fps } = useVideoConfig();
  const p = useReveal(Math.round(beat.appearAt * fps), 11);
  const isAction = beat.kind === 'action';

  return (
    <div
      style={{
        position: 'absolute', left: 150, right: 150, bottom: 168,
        opacity: p, transform: `translateY(${(1 - p) * 16}px)`,
        display: 'flex', gap: 18, alignItems: 'center',
        padding: '26px 34px',
        borderRadius: 20,
        background: hexA(colors.bgPanel, 0.82),
        border: `1px solid ${colors.stroke}`,
        boxShadow: '0 26px 70px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        style={{
          width: 4, alignSelf: 'stretch', borderRadius: 2,
          background: isAction ? colors.textMuted : colors.accent, opacity: 0.8,
        }}
      />
      <div
        style={{
          fontFamily: fonts.ui,
          fontSize: isAction ? 30 : 34,
          lineHeight: 1.36,
          fontWeight: isAction ? 450 : 500,
          fontStyle: isAction ? 'italic' : 'normal',
          color: isAction ? colors.textSecondary : colors.textPrimary,
        }}
      >
        {beat.text}
      </div>
    </div>
  );
};

/* ------------------------------------------------------- location and cast -- */

const LocationCard: React.FC<{ scene: Scene }> = ({ scene }) => {
  const p = useReveal(4, 14);
  return (
    <div
      style={{
        position: 'absolute', left: 80, top: 250,
        opacity: p, transform: `translateX(${(1 - p) * -18}px)`,
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '16px 24px', borderRadius: 16,
        background: hexA(colors.bgPanel, 0.7),
        border: `1px solid ${colors.stroke}`,
        backdropFilter: 'blur(10px)',
      }}
    >
      <Label size={12}>{`Scene ${scene.number}`}</Label>
      <div style={{ fontFamily: fonts.ui, fontSize: 27, fontWeight: 700, color: colors.textPrimary }}>
        {scene.location.name}
      </div>
    </div>
  );
};

/** Who is in this scene, with the current speaker lit. */
const CastStrip: React.FC<{
  cast: NonNullable<ReturnType<typeof characterById>>[];
  speakingId: string | null;
}> = ({ cast, speakingId }) => {
  const p = useReveal(8, 16);
  if (!cast.length) return null;

  return (
    <div
      style={{
        position: 'absolute', right: 80, top: 96,
        display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end',
        opacity: p, transform: `translateX(${(1 - p) * 18}px)`,
      }}
    >
      <Label size={11}>In this scene</Label>
      {cast.slice(0, 4).map((character) => {
        const lit = character.id === speakingId;
        return (
          <div
            key={character.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 14px 9px 10px', borderRadius: 999,
              background: lit ? hexA(character.accent, 0.16) : hexA(colors.bgPanel, 0.62),
              border: `1px solid ${lit ? hexA(character.accent, 0.55) : colors.strokeSoft}`,
              boxShadow: lit ? `0 0 26px ${hexA(character.accent, 0.28)}` : 'none',
              backdropFilter: 'blur(8px)',
            }}
          >
            <Avatar initials={character.initials} accent={character.accent} size={36} dim={!lit} />
            <span
              style={{
                fontFamily: fonts.ui, fontSize: 19,
                fontWeight: lit ? 700 : 500,
                color: lit ? colors.textPrimary : colors.textSecondary,
                whiteSpace: 'nowrap',
              }}
            >
              {character.displayName}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/* ----------------------------------------------------------------- finale -- */

/** A closing glow on the last scene, so the story visibly resolves. */
const FinaleGlow: React.FC<{ scene: Scene; t: number }> = ({ scene, t }) => {
  const { fps } = useVideoConfig();
  const at = Math.max(0.2, scene.durationSeconds - 2.2);
  const s = useSpringIn(Math.round(at * fps), 16);
  if (t < at) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at 50% 46%, ${hexA(colors.success, 0.14 * s)}, transparent 70%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Exported so the interface presentation can reuse the plate treatment. */
export { ScenePlate };
