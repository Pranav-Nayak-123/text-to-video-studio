import React from 'react';
import { useCurrentFrame } from 'remotion';
import { Beat, characterById, colors, fonts } from '../plan';
import { Avatar, AssistantMark, hexA, useReveal } from './primitives';

/**
 * Message components for the interface presentation.
 *
 * Each takes a plan beat and the frame it entered on. Nothing here is aware of
 * any particular story: a beat is a person speaking, a system responding, or a
 * caption, and that is all these components need to know.
 */

const BUBBLE_TEXT = 27;

interface MsgProps {
  beat: Beat;
  enterFrame: number;
  t: number;
}

/** Shared entrance motion for every message. */
const Enter: React.FC<{ enterFrame: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  enterFrame, children, style,
}) => {
  const p = useReveal(enterFrame, 9);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 22}px)`, ...style }}>{children}</div>;
};

/* ------------------------------------------------------------ user message -- */

export const UserMessage: React.FC<MsgProps> = ({ beat, enterFrame }) => {
  const speaker = characterById(beat.speakerId);
  const accent = speaker?.accent ?? colors.accent;

  return (
    <Enter enterFrame={enterFrame} style={{ display: 'flex', justifyContent: 'flex-end', gap: 14 }}>
      <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }}>
        {speaker ? (
          <span
            style={{
              fontFamily: fonts.ui, fontSize: 14, fontWeight: 750,
              letterSpacing: '0.1em', textTransform: 'uppercase', color: accent,
            }}
          >
            {speaker.displayName}
          </span>
        ) : null}
        <div
          style={{
            background: `linear-gradient(148deg, ${accent}, ${hexA(accent, 0.72)})`,
            border: `1px solid ${hexA(accent, 0.5)}`,
            borderRadius: '18px 18px 6px 18px',
            padding: '17px 22px',
            boxShadow: `0 12px 30px ${hexA(accent, 0.28)}`,
            fontFamily: fonts.ui,
            fontSize: BUBBLE_TEXT,
            lineHeight: 1.48,
            color: '#FFFFFF',
            fontWeight: 500,
          }}
        >
          {beat.text}
        </div>
      </div>
      <Avatar initials={speaker?.initials ?? '··'} accent={accent} size={44} />
    </Enter>
  );
};

/* ---------------------------------------------------------- system message -- */

export const SystemMessage: React.FC<MsgProps> = ({ beat, enterFrame }) => {
  const speaker = characterById(beat.speakerId);
  return (
    <Enter enterFrame={enterFrame} style={{ display: 'flex', gap: 14 }}>
      <AssistantMark size={44} />
      <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span
          style={{
            fontFamily: fonts.ui, fontSize: 14, fontWeight: 750,
            letterSpacing: '0.1em', textTransform: 'uppercase', color: colors.accentSoft,
          }}
        >
          {speaker?.displayName ?? 'System'}
        </span>
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.stroke}`,
            borderRadius: '18px 18px 18px 6px',
            padding: '17px 22px',
            fontFamily: fonts.mono,
            fontSize: BUBBLE_TEXT - 2,
            lineHeight: 1.5,
            color: colors.textPrimary,
            boxShadow: '0 10px 26px rgba(0,0,0,0.28)',
          }}
        >
          {beat.text}
        </div>
      </div>
    </Enter>
  );
};

/* --------------------------------------------------------------- narration -- */

/** Narration and action beats, shown as a divider inside the transcript. */
export const NarrationCard: React.FC<MsgProps> = ({ beat, enterFrame }) => {
  const isAction = beat.kind === 'action';
  return (
    <Enter enterFrame={enterFrame}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '14px 20px', borderRadius: 14,
          background: 'rgba(255,255,255,0.028)',
          border: `1px solid ${colors.strokeSoft}`,
        }}
      >
        <div
          style={{
            width: 3, alignSelf: 'stretch', borderRadius: 2,
            background: isAction ? colors.textMuted : colors.accent, opacity: 0.7,
          }}
        />
        <div
          style={{
            fontFamily: fonts.ui, fontSize: 22, lineHeight: 1.44,
            color: colors.textSecondary,
            fontStyle: isAction ? 'italic' : 'normal',
          }}
        >
          {beat.text}
        </div>
      </div>
    </Enter>
  );
};

/* -------------------------------------------------------- typing indicator -- */

export const TypingIndicator: React.FC<{ enterFrame: number }> = ({ enterFrame }) => {
  const frame = useCurrentFrame();
  const p = useReveal(enterFrame, 6);
  return (
    <div style={{ display: 'flex', gap: 14, opacity: p }}>
      <AssistantMark size={44} />
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.stroke}`,
          borderRadius: '18px 18px 18px 6px',
          padding: '21px 24px',
          display: 'flex', gap: 9, alignItems: 'center',
        }}
      >
        {[0, 1, 2].map((i) => {
          const phase = ((frame - enterFrame) / 5 - i * 0.55) % 3;
          const lift = Math.max(0, Math.sin(phase * Math.PI));
          return (
            <div
              key={i}
              style={{
                width: 11, height: 11, borderRadius: '50%',
                background: colors.accentSoft,
                opacity: 0.4 + lift * 0.6,
                transform: `translateY(${-lift * 5}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- checkmark -- */

/** An SVG tick that draws itself. Used by the progress rail and finale states. */
export const CheckMark: React.FC<{
  size?: number; color?: string; progress: number; strokeWidth?: number;
}> = ({ size = 24, color = colors.success, progress, strokeWidth = 2.6 }) => {
  const length = 32;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M4.5 12.6 L9.8 17.9 L19.5 6.6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - progress)}
      />
    </svg>
  );
};
