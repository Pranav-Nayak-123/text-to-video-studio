import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { Transition, characterById, colors, fonts, plan } from '../plan';
import { Avatar, Label, hexA } from '../components/primitives';
import { CheckMark } from '../components/ChatMessages';

/**
 * The pause between two scenes.
 *
 * The transition's type is chosen by the compiler from the scenes' context:
 * a `location` move announces where the story goes next, a `fade` is a quiet
 * beat inside one place, and `resolve` closes the story out. All three carry
 * the same progress rail, so the audience always knows how far through we are.
 */
export const TransitionSegment: React.FC<{ transition: Transition }> = ({ transition }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const from = plan.scenes[transition.fromIndex];
  const to = plan.scenes[transition.toIndex];

  const opacity = Math.min(
    interpolate(frame, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    interpolate(frame, [durationInFrames - 7, durationInFrames - 1], [1, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    }),
  );

  const travel = interpolate(frame, [3, durationInFrames - 6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  });

  const tint = to?.focusId
    ? characterById(to.focusId)?.accent ?? colors.accent
    : colors.accent;
  const isResolve = transition.type === 'resolve';

  return (
    <AbsoluteFill style={{ opacity, background: colors.bgDeep }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse 76% 66% at 50% 46%, ${colors.bgPanelAlt}, ${colors.bgDeep} 72%)` }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            `linear-gradient(${hexA(colors.accentSoft, 0.04)} 1px, transparent 1px),
             linear-gradient(90deg, ${hexA(colors.accentSoft, 0.04)} 1px, transparent 1px)`,
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(ellipse 58% 52% at 50% 48%, #000 18%, transparent 76%)',
          WebkitMaskImage: 'radial-gradient(ellipse 58% 52% at 50% 48%, #000 18%, transparent 76%)',
        }}
      />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 44 }}>
          {/* Where the story is going */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '14px 30px', borderRadius: 999,
              background: hexA(tint, 0.13),
              border: `1px solid ${hexA(tint, 0.45)}`,
              boxShadow: `0 0 42px ${hexA(tint, 0.2)}`,
            }}
          >
            <Label size={12} color={colors.accentSoft}>
              {isResolve ? 'Conclusion' : transition.type === 'location' ? 'Next location' : 'Next'}
            </Label>
            <span
              style={{
                fontFamily: fonts.ui, fontSize: 34, fontWeight: 750,
                color: colors.textPrimary, letterSpacing: '-0.01em',
              }}
            >
              {transition.caption}
            </span>
          </div>

          {/* Scene-to-scene rail */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, width: Math.min(1320, 260 * plan.scenes.length + 200) }}>
            {plan.scenes.map((scene, i) => {
              const isTarget = i === transition.toIndex;
              const lit = i <= transition.fromIndex || (isTarget && travel > 0.55);
              const focus = scene.focusId ? characterById(scene.focusId) : null;
              const stopTint = focus?.accent ?? colors.accent;

              return (
                <React.Fragment key={scene.id}>
                  <div
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                      flexShrink: 0, width: Math.max(120, 900 / plan.scenes.length),
                    }}
                  >
                    <div
                      style={{
                        width: 60, height: 60, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: lit ? hexA(stopTint, isTarget ? 0.26 : 0.14) : 'rgba(255,255,255,0.04)',
                        border: `2px solid ${lit ? hexA(stopTint, isTarget && travel > 0.55 ? 1 : 0.6) : 'rgba(255,255,255,0.12)'}`,
                        boxShadow: isTarget && travel > 0.55 ? `0 0 34px ${hexA(stopTint, 0.6)}` : 'none',
                        transform: `scale(${isTarget ? 1 + Math.max(0, travel - 0.72) * 0.45 : 1})`,
                      }}
                    >
                      {focus ? (
                        <Avatar initials={focus.initials} accent={stopTint} size={42} dim={!lit} />
                      ) : (
                        <CheckMark size={26} color={lit ? stopTint : colors.textMuted} progress={lit ? 1 : 0.001} strokeWidth={2.8} />
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: fonts.ui, fontSize: 16,
                        fontWeight: isTarget ? 750 : 500,
                        color: lit ? colors.textPrimary : colors.textMuted,
                        textAlign: 'center', maxWidth: 180,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {scene.title}
                    </div>
                  </div>

                  {i < plan.scenes.length - 1 ? (
                    <TravelLine
                      progress={i < transition.fromIndex ? 1 : i === transition.fromIndex ? travel : 0}
                      tint={stopTint}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </div>

          {from && to ? (
            <div
              style={{
                opacity: interpolate(frame, [5, 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                fontFamily: fonts.ui, fontSize: 24, fontWeight: 500,
                color: colors.textSecondary, letterSpacing: '0.02em',
              }}
            >
              {from.location.name}
              <span style={{ color: colors.textMuted, margin: '0 14px' }}>→</span>
              {to.location.name}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const TravelLine: React.FC<{ progress: number; tint: string }> = ({ progress, tint }) => {
  const p = Math.max(0, Math.min(1, progress));
  return (
    <div style={{ flex: 1, position: 'relative', height: 4, minWidth: 30 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }} />
      <div
        style={{
          position: 'absolute', top: 0, left: 0, height: '100%', width: `${p * 100}%`,
          background: `linear-gradient(90deg, ${hexA(tint, 0.5)}, ${tint})`,
          borderRadius: 3,
          boxShadow: p > 0.02 ? `0 0 16px ${hexA(tint, 0.5)}` : 'none',
        }}
      />
      {p > 0.01 && p < 0.99 ? (
        <div
          style={{
            position: 'absolute', top: -6, left: `calc(${p * 100}% - 8px)`,
            width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF',
            boxShadow: `0 0 22px ${tint}, 0 0 44px ${hexA(tint, 0.6)}`,
          }}
        />
      ) : null}
    </div>
  );
};
