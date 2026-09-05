import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors, fonts } from '../plan';

/**
 * Shared motion helpers. Every animation in the video goes through one of these
 * so timing and easing stay consistent across scenes.
 */

/** 0 -> 1 over `durationInFrames`, starting at `startFrame`, eased. */
export const useReveal = (startFrame: number, durationInFrames = 12) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [startFrame, startFrame + durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
};

/** A settled spring, for elements that should feel physical rather than faded. */
export const useSpringIn = (startFrame: number, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - startFrame, fps, config: { damping, mass: 0.7, stiffness: 120 } });
};

/** Standard entrance: fade up with a small vertical offset. */
export const Appear: React.FC<{
  at: number;
  duration?: number;
  offsetY?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ at, duration = 12, offsetY = 16, children, style }) => {
  const p = useReveal(at, duration);
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * offsetY}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Small uppercase label used above values and inside cards. */
export const Label: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({
  children, color = colors.textMuted, size = 13,
}) => (
  <div
    style={{
      fontFamily: fonts.ui,
      fontSize: size,
      fontWeight: 700,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color,
    }}
  >
    {children}
  </div>
);

/** Monospace data value - every business token in the video uses this. */
export const Value: React.FC<{
  children: React.ReactNode; size?: number; color?: string; weight?: number;
}> = ({ children, size = 27, color = colors.textPrimary, weight = 600 }) => (
  <span style={{ fontFamily: fonts.mono, fontSize: size, fontWeight: weight, color, letterSpacing: '0.01em' }}>
    {children}
  </span>
);

/**
 * Splits a string so the business-critical tokens (BCM002345, QL9, 205, ZDOC,
 * Operator 1, ...) render in monospace with an accent. The surrounding sentence
 * is never altered - only its presentation.
 */
export const Highlighted: React.FC<{
  text: string;
  highlights?: string[];
  accent?: string;
  size?: number;
  color?: string;
}> = ({ text, highlights = [], accent = colors.accentSoft, size = 27, color = colors.textPrimary }) => {
  if (!highlights.length) return <>{text}</>;

  const escaped = highlights
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'g'));

  return (
    <>
      {parts.map((part, i) =>
        highlights.includes(part) ? (
          <span
            key={i}
            style={{
              fontFamily: fonts.mono,
              fontWeight: 700,
              fontSize: size * 0.96,
              color: accent,
              background: 'rgba(62,139,255,0.14)',
              border: '1px solid rgba(143,190,255,0.28)',
              borderRadius: 7,
              padding: '2px 8px',
              margin: '0 1px',
              whiteSpace: 'nowrap',
            }}
          >
            {part}
          </span>
        ) : (
          <span key={i} style={{ color }}>{part}</span>
        ),
      )}
    </>
  );
};

/** Circular character avatar: initials on the character's accent colour. */
export const Avatar: React.FC<{
  initials: string; accent: string; size?: number; dim?: boolean;
}> = ({ initials, accent, size = 46, dim = false }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: dim
        ? 'rgba(255,255,255,0.05)'
        : `linear-gradient(150deg, ${accent}, ${shade(accent, -34)})`,
      border: `1.5px solid ${dim ? 'rgba(255,255,255,0.12)' : hexA(accent, 0.55)}`,
      boxShadow: dim ? 'none' : `0 6px 18px ${hexA(accent, 0.28)}`,
      fontFamily: fonts.ui,
      fontSize: size * 0.36,
      fontWeight: 800,
      letterSpacing: '0.02em',
      color: dim ? colors.textMuted : '#FFFFFF',
      flexShrink: 0,
    }}
  >
    {initials}
  </div>
);

/** The assistant's mark - a simple geometric glyph, not a face. */
export const AssistantMark: React.FC<{ size?: number }> = ({ size = 46 }) => (
  <div
    style={{
      width: size, height: size, borderRadius: 13, flexShrink: 0,
      background: `linear-gradient(150deg, ${colors.accent}, ${colors.accentDeep})`,
      border: `1.5px solid ${hexA(colors.accentSoft, 0.4)}`,
      boxShadow: `0 8px 22px ${hexA(colors.accent, 0.32)}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
  >
    <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none">
      <path d="M4 7.5A3.5 3.5 0 0 1 7.5 4h9A3.5 3.5 0 0 1 20 7.5v6a3.5 3.5 0 0 1-3.5 3.5H11l-4.6 3.3a.6.6 0 0 1-.95-.49V17H7.5A3.5 3.5 0 0 1 4 13.5Z"
        stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="9" cy="10.5" r="1.35" fill="#fff" />
      <circle cx="15" cy="10.5" r="1.35" fill="#fff" />
    </svg>
  </div>
);

/** Status pill (IN QUEUE / ASSIGNED / FREE / BUSY ...). */
export const Pill: React.FC<{
  children: React.ReactNode; tone?: 'accent' | 'success' | 'warning' | 'muted'; size?: number;
}> = ({ children, tone = 'accent', size = 13 }) => {
  const map = {
    accent: colors.accent,
    success: colors.success,
    warning: colors.warning,
    muted: colors.textMuted,
  } as const;
  const c = map[tone];
  return (
    <span
      style={{
        fontFamily: fonts.ui, fontSize: size, fontWeight: 800, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: c,
        background: hexA(c, 0.13), border: `1px solid ${hexA(c, 0.38)}`,
        borderRadius: 999, padding: '5px 13px', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
};

/* ------------------------------------------------------------ colour utils -- */

/** #RRGGBB + alpha -> rgba() string. */
export function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Lighten (positive) or darken (negative) a hex colour by `amount` (0-255). */
export function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
