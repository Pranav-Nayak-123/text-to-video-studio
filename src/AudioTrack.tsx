import React from 'react';
import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from 'remotion';
import { buildSegments, plan, totalFrames } from './plan';

/**
 * The soundtrack, assembled from the same plan that drives the picture so audio
 * and visuals cannot drift apart.
 *
 *   - a continuous music bed, ducked well under everything else
 *   - UI sounds cued to the exact frame their visual event happens
 *   - character and narrator speech at each line's planned start time
 *
 * Every asset is generated locally, so nothing here needs the network.
 */
export const AudioTrack: React.FC = () => {
  const { fps } = useVideoConfig();
  const segments = buildSegments();
  const total = totalFrames();
  const { music, sfx, dialogueVolume } = plan.audio;

  const fadeIn = Math.max(1, Math.round(music.fadeInSeconds * fps));
  const fadeOut = Math.max(1, Math.round(music.fadeOutSeconds * fps));

  return (
    <>
      {music.volume > 0 ? (
        <Audio
          src={staticFile(`audio/${music.file}`)}
          volume={(f) =>
            interpolate(
              f,
              [0, fadeIn, Math.max(fadeIn + 1, total - fadeOut), total],
              [0, music.volume, music.volume, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            )
          }
        />
      ) : null}

      {segments.map((segment) => {
        if (segment.kind === 'transition') {
          const asset = sfx[segment.transition!.sfx];
          if (!asset) return null;
          return (
            <Sequence
              key={`${segment.id}-sfx`}
              from={segment.startFrame}
              durationInFrames={segment.durationInFrames + 12}
            >
              <Audio src={staticFile(`audio/${asset.file}`)} volume={asset.volume} />
            </Sequence>
          );
        }

        const scene = segment.scene!;
        return (
          <React.Fragment key={segment.id}>
            {(scene.sfx ?? []).map((cue, i) => {
              const asset = sfx[cue.cue];
              if (!asset) return null;
              return (
                <Sequence key={`${segment.id}-sfx-${i}`} from={segment.startFrame + Math.round(cue.at * fps)}>
                  <Audio src={staticFile(`audio/${asset.file}`)} volume={asset.volume} />
                </Sequence>
              );
            })}

            {(scene.dialogue ?? [])
              .filter((line) => line.enabled !== false)
              .map((line) => (
                <Sequence key={line.id} from={segment.startFrame + Math.round(line.startAt * fps)}>
                  <Audio src={staticFile(`audio/${line.file}`)} volume={dialogueVolume} />
                </Sequence>
              ))}
          </React.Fragment>
        );
      })}
    </>
  );
};
