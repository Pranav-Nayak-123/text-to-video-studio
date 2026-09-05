import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { buildSegments, colors, plan } from './plan';
import { NarrativeScene } from './scenes/NarrativeScene';
import { InterfaceScene } from './scenes/InterfaceScene';
import { TransitionSegment } from './scenes/TransitionSegment';
import { AudioTrack } from './AudioTrack';

/**
 * The finished piece: every scene in the plan, separated by the transitions the
 * compiler chose. The presentation is selected by the plan's style.
 */
export const StoryVideo: React.FC = () => {
  const segments = buildSegments();
  const SceneComponent = plan.presentation === 'interface' ? InterfaceScene : NarrativeScene;

  return (
    <AbsoluteFill style={{ background: colors.bgDeep }}>
      {segments.map((segment) => (
        <Sequence
          key={segment.id}
          from={segment.startFrame}
          durationInFrames={segment.durationInFrames}
          name={segment.kind === 'scene' ? segment.scene!.title : segment.transition!.caption}
        >
          {segment.kind === 'scene' ? (
            <SceneComponent scene={segment.scene!} />
          ) : (
            <TransitionSegment transition={segment.transition!} />
          )}
        </Sequence>
      ))}

      <AudioTrack />
    </AbsoluteFill>
  );
};
