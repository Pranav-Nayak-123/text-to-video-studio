import React from 'react';
import { Composition } from 'remotion';
import { StoryVideo } from './Video';
import { plan, totalFrames } from './plan';
import './fonts';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Story"
    component={StoryVideo}
    durationInFrames={totalFrames()}
    fps={plan.meta.fps}
    width={plan.meta.width}
    height={plan.meta.height}
  />
);
