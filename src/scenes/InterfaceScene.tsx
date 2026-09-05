import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Beat, Scene, characterById, colors, fonts, plan, plateFor } from '../plan';
import { Avatar, AssistantMark, Label, hexA, useReveal } from '../components/primitives';
import { NarrationCard, SystemMessage, TypingIndicator, UserMessage } from '../components/ChatMessages';
import { ProgressRail, StoryIdentity } from '../components/Stage';

/**
 * The interface presentation, selected by the "corporate" style.
 *
 * Dialogue is delivered through an application panel: a person's line is typed
 * into the composer and committed to the transcript, and a system participant
 * replies. It suits stories about software, support and workflows; the
 * narrative presentation suits everything else. Both read the same plan.
 */
export const InterfaceScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;

  const edgeFade = Math.min(
    interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    interpolate(frame, [durationInFrames - 7, durationInFrames - 1], [1, 0.6], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    }),
  );

  const focus = scene.focusId ? characterById(scene.focusId) : null;

  return (
    <AbsoluteFill style={{ opacity: edgeFade, background: colors.bgDeep }}>
      <Plate scene={scene} progress={progress} />

      <StoryIdentity scene={scene} />
      <FocusCard character={focus} scene={scene} />

      <ChatPanel scene={scene} t={t} />

      <ProgressRail activeIndex={scene.index} advance={progress * 0.85} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ plate -- */

const Plate: React.FC<{ scene: Scene; progress: number }> = ({ scene, progress }) => {
  const camera = scene.camera ?? { type: 'none' };
  const zoom = camera.type === 'pushIn'
    ? interpolate(progress, [0, 1], [camera.from ?? 1, camera.to ?? 1.06])
    : 1;
  const panX = interpolate(progress, [0, 1], [0, camera.panX ?? 0]);
  const panY = interpolate(progress, [0, 1], [0, camera.panY ?? 0]);

  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: colors.bgDeep }}>
      <AbsoluteFill
        style={{ transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`, transformOrigin: '34% 44%' }}
      >
        <Img
          src={staticFile(plateFor(scene.id))}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '28% 42%' }}
        />
      </AbsoluteFill>

      {/* Dense on the right, where the panel sits. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(100deg,
            ${hexA(colors.bgDeep, 0.2)} 0%, ${hexA(colors.bgDeep, 0.32)} 26%,
            ${hexA(colors.bgDeep, 0.78)} 46%, ${hexA(colors.bgDeep, 0.93)} 62%,
            ${hexA(colors.bgDeep, 0.96)} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Who is driving the interface in this scene. */
const FocusCard: React.FC<{ character: ReturnType<typeof characterById>; scene: Scene }> = ({ character, scene }) => {
  const p = useReveal(6, 16);
  if (!character) return null;
  return (
    <div
      style={{
        position: 'absolute', left: 80, top: 700,
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 24px 16px 18px', borderRadius: 18,
        background: hexA(colors.bgPanel, 0.74),
        border: `1px solid ${hexA(character.accent, 0.32)}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(10px)',
        opacity: p, transform: `translateX(${(1 - p) * -22}px)`,
      }}
    >
      <Avatar initials={character.initials} accent={character.accent} size={54} />
      <div>
        <div style={{ fontFamily: fonts.ui, fontSize: 26, fontWeight: 700, color: colors.textPrimary }}>
          {character.displayName}
        </div>
        <div style={{ fontFamily: fonts.ui, fontSize: 17, color: colors.textSecondary, marginTop: 3 }}>
          {character.role} · {scene.location.name}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------- chat panel -- */

const ChatPanel: React.FC<{ scene: Scene; t: number }> = ({ scene, t }) => {
  const { fps } = useVideoConfig();

  // A typed line lives in the composer between appearAt and commitAt, then
  // moves into the transcript.
  const composing = scene.beats.find(
    (b) => b.typeDuration !== undefined && t >= b.appearAt && t < (b.commitAt ?? b.appearAt),
  );

  const visible = scene.beats.filter((b) => {
    if (b.typeDuration !== undefined) return t >= (b.commitAt ?? b.appearAt);
    return t >= b.appearAt;
  });

  const composerText = composing
    ? composing.text.slice(0, Math.round(composing.text.length *
        clamp01((t - composing.appearAt) / (composing.typeDuration ?? 1))))
    : '';

  const composingSpeaker = composing ? characterById(composing.speakerId) : null;
  const firstBeatAt = scene.beats.length
    ? Math.min(...scene.beats.map((b) => b.commitAt ?? b.appearAt))
    : 0;

  return (
    <div
      style={{
        position: 'absolute', left: 896, top: 64, width: 944, height: 900,
        display: 'flex', flexDirection: 'column',
        borderRadius: 26,
        background: `linear-gradient(168deg, ${hexA(colors.bgPanel, 0.97)}, ${hexA(colors.bgDeep, 0.98)})`,
        border: `1px solid ${colors.stroke}`,
        boxShadow: '0 44px 110px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        overflow: 'hidden',
        backdropFilter: 'blur(12px)',
      }}
    >
      <Header scene={scene} />

      <div
        style={{
          flex: 1, position: 'relative',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 17,
          padding: '22px 26px', overflow: 'hidden',
        }}
      >
        <Watermark firstBeatAt={firstBeatAt} />
        {visible.map((beat) => (
          <Router
            key={beat.id}
            beat={beat}
            enterFrame={Math.round((beat.commitAt ?? beat.appearAt) * fps)}
            t={t}
          />
        ))}
      </div>

      <Composer text={composerText} active={!!composing} character={composingSpeaker} />
    </div>
  );
};

const Header: React.FC<{ scene: Scene }> = ({ scene }) => (
  <div
    style={{
      display: 'flex', alignItems: 'center', gap: 15,
      padding: '20px 26px',
      borderBottom: `1px solid ${colors.strokeSoft}`,
      background: 'rgba(255,255,255,0.022)',
      flexShrink: 0,
    }}
  >
    <AssistantMark size={46} />
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: fonts.ui, fontSize: 24, fontWeight: 700, color: colors.textPrimary }}>
        {plan.brand.assistantName}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.success, boxShadow: `0 0 10px ${colors.success}` }} />
        <span style={{ fontFamily: fonts.ui, fontSize: 16, color: colors.textSecondary }}>
          Online · {scene.location.name}
        </span>
      </div>
    </div>
  </div>
);

const Composer: React.FC<{
  text: string; active: boolean; character: ReturnType<typeof characterById>;
}> = ({ text, active, character }) => {
  const frame = useCurrentFrame();
  const caretOn = Math.floor(frame / 8) % 2 === 0;
  const accent = character?.accent ?? colors.accent;

  return (
    <div
      style={{
        flexShrink: 0, padding: '18px 26px 22px',
        borderTop: `1px solid ${colors.strokeSoft}`,
        background: 'rgba(255,255,255,0.016)',
        display: 'flex', alignItems: 'center', gap: 14,
      }}
    >
      <Avatar initials={character?.initials ?? '··'} accent={accent} size={42} dim={!active} />
      <div
        style={{
          flex: 1, minHeight: 56,
          display: 'flex', alignItems: 'center',
          padding: '12px 18px', borderRadius: 14,
          background: active ? hexA(accent, 0.07) : 'rgba(255,255,255,0.03)',
          border: `1px solid ${active ? hexA(accent, 0.42) : colors.strokeSoft}`,
          boxShadow: active ? `0 0 0 3px ${hexA(accent, 0.08)}` : 'none',
          fontFamily: fonts.ui, fontSize: 23, lineHeight: 1.4,
          color: active ? colors.textPrimary : colors.textMuted,
        }}
      >
        <span>
          {active ? text : 'Waiting for input…'}
          {active && caretOn ? <span style={{ color: accent, fontWeight: 300 }}>|</span> : null}
        </span>
      </div>
      <div
        style={{
          width: 56, height: 56, borderRadius: 14, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: active ? `linear-gradient(150deg, ${accent}, ${hexA(accent, 0.7)})` : 'rgba(255,255,255,0.04)',
          border: `1px solid ${active ? hexA(accent, 0.5) : colors.strokeSoft}`,
        }}
      >
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none">
          <path d="M4 12 20 4l-7 8 7 8-16-8Z" stroke={active ? '#fff' : colors.textMuted} strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
};

/** Idle mark shown before the first message so the panel is never a blank slab. */
const Watermark: React.FC<{ firstBeatAt: number }> = ({ firstBeatAt }) => {
  const { fps } = useVideoConfig();
  const fade = useReveal(Math.round(Math.max(0, firstBeatAt - 0.35) * fps), 10);
  const opacity = 1 - fade;
  if (opacity <= 0.01) return null;

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 18, opacity, pointerEvents: 'none',
      }}
    >
      <div style={{ opacity: 0.5 }}><AssistantMark size={78} /></div>
      <div style={{ fontFamily: fonts.ui, fontSize: 24, fontWeight: 650, color: colors.textSecondary }}>
        {plan.brand.assistantName}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: 420, marginTop: 4 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.09)' }} />
        <Label size={12}>Session started</Label>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.09)' }} />
      </div>
    </div>
  );
};

const Router: React.FC<{ beat: Beat; enterFrame: number; t: number }> = (props) => {
  switch (props.beat.kind) {
    case 'dialogue': return <UserMessage {...props} />;
    case 'system': return <SystemMessage {...props} />;
    case 'narration':
    case 'action': return <NarrationCard {...props} />;
    default: return null;
  }
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export { TypingIndicator };
