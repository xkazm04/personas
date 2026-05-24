import type { FC } from 'react';
import type { MotionMotif, MotifProps } from '../types';
import { ActivityMotif } from './ActivityMotif';
import { KnowledgeMotif } from './KnowledgeMotif';
import { MemoriesMotif } from './MemoriesMotif';

export const MOTIF_COMPONENTS: Record<MotionMotif, FC<MotifProps>> = {
  activity: ActivityMotif,
  knowledge: KnowledgeMotif,
  memories: MemoriesMotif,
};
