import type { FC } from 'react';
import type { EmptyStateMotif, MotifProps } from '../types';
import { ActivityMotif } from './ActivityMotif';
import { ApprovalMotif } from './ApprovalMotif';
import { MessagesMotif } from './MessagesMotif';
import { KnowledgeMotif } from './KnowledgeMotif';
import { MemoriesMotif } from './MemoriesMotif';
import { LeaderboardMotif } from './LeaderboardMotif';

export const MOTIF_COMPONENTS: Record<EmptyStateMotif, FC<MotifProps>> = {
  activity: ActivityMotif,
  approval: ApprovalMotif,
  messages: MessagesMotif,
  knowledge: KnowledgeMotif,
  memories: MemoriesMotif,
  leaderboard: LeaderboardMotif,
};
