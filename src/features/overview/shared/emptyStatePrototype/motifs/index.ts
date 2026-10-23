import type { FC } from 'react';
import type { MotionMotif, MotifProps } from '../types';
import { ActivityMotif } from './ActivityMotif';

export const MOTIF_COMPONENTS: Record<MotionMotif, FC<MotifProps>> = {
  activity: ActivityMotif,
};
