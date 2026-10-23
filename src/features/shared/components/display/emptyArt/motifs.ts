import type { ComponentType } from 'react';
import {
  AgentsMotif, VaultMotif, LaunchMotif, TemplatesMotif, BoltMotif, RunsMotif,
  ScheduleMotif, TeamMotif, ChatMotif,
} from './motifsWork';
import {
  ArchiveMotif, StreamMotif, LinkMotif, InboxMotif, SearchMotif, FolderMotif,
  ChartMotif, ShieldMotif, BellMotif, ReportMotif,
} from './motifsData';

/**
 * Which motif to pick:
 * agents (personas) · vault (credentials, keys) · launch (first run, nothing run yet)
 * templates (gallery, presets) · bolt (triggers) · runs (executions) · schedule (timers)
 * team (teams, members, devices) · chat (conversations, messages) · archive (dead letters,
 * history) · stream (events, live feeds) · link (webhooks, routes, connectors) · inbox
 * (queues cleared, approvals) · search (no matches) · folder (files, drives, projects)
 * chart (metrics, analytics) · shield (security, broker, policies) · bell (notifications,
 * alerts) · report (reports, documents, logs)
 */
export const EMPTY_ART_MOTIFS = {
  agents: AgentsMotif,
  vault: VaultMotif,
  launch: LaunchMotif,
  templates: TemplatesMotif,
  bolt: BoltMotif,
  runs: RunsMotif,
  schedule: ScheduleMotif,
  team: TeamMotif,
  chat: ChatMotif,
  archive: ArchiveMotif,
  stream: StreamMotif,
  link: LinkMotif,
  inbox: InboxMotif,
  search: SearchMotif,
  folder: FolderMotif,
  chart: ChartMotif,
  shield: ShieldMotif,
  bell: BellMotif,
  report: ReportMotif,
} satisfies Record<string, ComponentType>;

export type EmptyArtMotif = keyof typeof EMPTY_ART_MOTIFS;
export const EMPTY_ART_MOTIF_NAMES = Object.keys(EMPTY_ART_MOTIFS) as EmptyArtMotif[];
