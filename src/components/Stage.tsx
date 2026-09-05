import React from 'react';
import { Scene, colors, fonts, plan } from '../plan';
import { hexA, useReveal } from './primitives';
import { CheckMark } from './ChatMessages';

/**
 * Frame furniture shared by both presentations: the story identity block and
 * the scene progress rail.
 *
 * The rail is generated from the plan's scene list, so a three-scene story
 * shows three stops and a seven-scene story shows seven. Nothing here assumes a
 * particular number of scenes or a particular workflow.
 */

/** Title block, top-left. Present in every scene. */
export const StoryIdentity: React.FC<{ scene: Scene }> = ({ scene }) => {
  const p = useReveal(0, 14);
  return (
    <div
      style={{
        position: 'absolute', left: 80, top: 78,
        opacity: p, transform: `translateY(${(1 - p) * 12}px)`,
        maxWidth: 900,
      }}
    >
      <div
        style={{
          fontFamily: fonts.ui, fontSize: 34, fontWeight: 750,
          color: colors.textPrimary, letterSpacing: '-0.02em', lineHeight: 1.1,
        }}
      >
        {plan.meta.title}
      </div>
      <div
        style={{
          fontFamily: fonts.ui, fontSize: 18, color: colors.textSecondary,
          marginTop: 6, letterSpacing: '0.01em',
        }}
      >
        {plan.meta.subtitle}
      </div>

      <div style={{ marginTop: 22, display: 'inline-flex', alignItems: 'center', gap: 11 }}>
        <div
          style={{
            padding: '8px 15px', borderRadius: 999,
            background: hexA(colors.accent, 0.12),
            border: `1px solid ${hexA(colors.accent, 0.34)}`,
            fontFamily: fonts.ui, fontSize: 14, fontWeight: 700,
            letterSpacing: '0.14em', color: colors.accentSoft,
            maxWidth: 760, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {scene.label}
        </div>
      </div>
    </div>
  );
};

/**
 * The scene progress rail. One stop per scene in the plan; the current scene is
 * lit and earlier scenes are ticked.
 */
export const ProgressRail: React.FC<{
  activeIndex: number;
  advance?: number;
  allComplete?: boolean;
  y?: number;
}> = ({ activeIndex, advance = 1, allComplete = false, y = 986 }) => {
  const scenes = plan.scenes;
  const p = useReveal(4, 16);

  // Many scenes get dots only; a handful get labels too.
  const compact = scenes.length > 6;

  return (
    <div
      style={{
        position: 'absolute', left: 80, top: y, width: 1760,
        display: 'flex', alignItems: 'center',
        opacity: p * 0.99,
      }}
    >
      {scenes.map((scene, i) => {
        const done = allComplete || i < activeIndex;
        const active = !allComplete && i === activeIndex;
        const reached = done || active;
        const focus = scene.focusId ? plan.characters.find((c) => c.id === scene.focusId) : null;
        const tint = allComplete ? colors.success : focus?.accent ?? colors.accent;

        return (
          <React.Fragment key={scene.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div
                style={{
                  width: 34, height: 34, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: reached ? hexA(tint, active ? 0.24 : 0.14) : 'rgba(255,255,255,0.045)',
                  border: `2px solid ${reached ? hexA(tint, active ? 0.95 : 0.55) : 'rgba(255,255,255,0.12)'}`,
                  boxShadow: active ? `0 0 20px ${hexA(tint, 0.5)}` : 'none',
                }}
              >
                {done ? (
                  <CheckMark size={17} color={tint} progress={1} strokeWidth={2.8} />
                ) : (
                  <div
                    style={{
                      width: 9, height: 9, borderRadius: '50%',
                      background: reached ? tint : 'rgba(255,255,255,0.22)',
                      boxShadow: active ? `0 0 12px ${tint}` : 'none',
                    }}
                  />
                )}
              </div>

              {!compact ? (
                <div
                  style={{
                    fontFamily: fonts.ui, fontSize: 17,
                    fontWeight: active ? 750 : 550,
                    color: reached ? colors.textPrimary : colors.textMuted,
                    whiteSpace: 'nowrap', maxWidth: 250,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {scene.title}
                </div>
              ) : null}
            </div>

            {i < scenes.length - 1 ? (
              <Connector
                fill={allComplete || i < activeIndex ? 1 : i === activeIndex ? advance : 0}
                tint={tint}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const Connector: React.FC<{ fill: number; tint: string }> = ({ fill, tint }) => {
  const value = Math.max(0, Math.min(1, fill));
  return (
    <div style={{ flex: 1, height: 3, margin: '0 16px', position: 'relative', minWidth: 22 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.09)', borderRadius: 3 }} />
      <div
        style={{
          position: 'absolute', top: 0, left: 0, height: '100%', width: `${value * 100}%`,
          background: `linear-gradient(90deg, ${hexA(tint, 0.7)}, ${tint})`,
          borderRadius: 3,
          boxShadow: value > 0.02 ? `0 0 10px ${hexA(tint, 0.45)}` : 'none',
        }}
      />
    </div>
  );
};
