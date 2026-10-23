import {
  Activity, Archive, BarChart3, Bell, BookHeart, BookOpen, Bot, Calendar, CalendarClock, CheckCircle2,
  Clock, Cloud, CloudCog, Database, FileSignature, FileText, FileX, Filter, Folder, FolderOpen, FolderX,
  GitBranch, Globe, History, Inbox, Key, KeyRound, Layers, LayoutTemplate, Library, Link, Link2, ListChecks,
  MessageSquare, MessagesSquare, Network, NotepadText, Play, Radar, Radio, Rocket, ScanSearch, ScrollText,
  Search, SearchX, Server, Shield, ShieldCheck, Sparkles, Star, Timer, Trophy, Upload, Users, Webhook, Zap,
  type LucideIcon,
} from 'lucide-react';
import type { EmptyArtMotif } from './motifs';

/**
 * The lucide icon an empty state already passes, read as the motif it means.
 * This is what lets every existing `icon=` empty state gain its illustration
 * without a per-site edit. Error and warning icons are deliberately absent: an
 * errored region keeps its plain badge (the golden path's cascade puts errors
 * before emptiness, and decoration there reads as cheerful about a failure).
 */
const ICON_MOTIF = new Map<LucideIcon, EmptyArtMotif>([
  [Bot, 'agents'],
  [Key, 'vault'], [KeyRound, 'vault'],
  [Rocket, 'launch'],
  [Layers, 'templates'], [LayoutTemplate, 'templates'], [Sparkles, 'templates'],
  [Zap, 'bolt'],
  [Play, 'runs'],
  [Clock, 'schedule'], [Calendar, 'schedule'], [CalendarClock, 'schedule'], [Timer, 'schedule'],
  [Users, 'team'],
  [MessageSquare, 'chat'], [MessagesSquare, 'chat'],
  [Archive, 'archive'], [History, 'archive'],
  [Activity, 'stream'], [Radio, 'stream'],
  [Link, 'link'], [Link2, 'link'], [Webhook, 'link'], [Network, 'link'], [GitBranch, 'link'], [Globe, 'link'],
  [Inbox, 'inbox'], [CheckCircle2, 'inbox'], [ListChecks, 'inbox'],
  [Search, 'search'], [SearchX, 'search'], [ScanSearch, 'search'], [Filter, 'search'], [Radar, 'search'],
  [Folder, 'folder'], [FolderOpen, 'folder'], [FolderX, 'folder'], [Upload, 'folder'],
  [Database, 'folder'], [Server, 'folder'], [Cloud, 'folder'], [CloudCog, 'folder'],
  [BarChart3, 'chart'], [Trophy, 'chart'], [Star, 'chart'],
  [Shield, 'shield'], [ShieldCheck, 'shield'],
  [Bell, 'bell'],
  [FileText, 'report'], [FileX, 'report'], [ScrollText, 'report'], [NotepadText, 'report'],
  [FileSignature, 'report'], [BookOpen, 'report'], [BookHeart, 'report'], [Library, 'report'],
]);

/** Any icon component (lucide or a caller's own); one that is not in the map has no motif. */
export function motifForIcon(icon: unknown): EmptyArtMotif | undefined {
  for (const [key, motif] of ICON_MOTIF) if (key === icon) return motif;
  return undefined;
}
