import {
  Palette, Key, Sparkles, Activity, MessageSquare, Heart, FlaskConical,
  BarChart3, Radio, Link, Zap, Eye,
  Puzzle, Bot, User, Wrench, Layers,
  CalendarClock, CalendarRange, Clock,
  LayoutGrid, Wand2, BookOpen, Rocket,
  Network, ListChecks, Target,
  Download, FolderOpen, RefreshCw, Search, Cloud, MoonStar, Brain,
} from 'lucide-react';
import {
  getTourSurface,
  type TourSurface,
  type TourSurfaceKey,
} from '@/lib/design/tourSurfaces';
import type { TourId } from '@/stores/slices/system/tourSlice';

// -- Per-step icon map (all tours) ---------------------------------------

const ICON_MAP: Record<string, typeof Key> = {
  // Getting Started
  'appearance-setup': Palette,
  'credentials-intro': Key,
  'persona-creation': Sparkles,
  'first-execution': Rocket,
  // Execution & Observability
  'overview-dashboard': BarChart3,
  'execution-activity': Activity,
  'messages-tab': MessageSquare,
  'health-monitoring': Heart,
  'lab-arena': FlaskConical,
  // Orchestration & Events
  'events-intro': Zap,
  'trigger-types': Radio,
  'event-chaining': Link,
  'live-stream': Eye,
  // Plugins Explorer
  'plugins-browse': Puzzle,
  'plugin-companion': Bot,
  'plugin-twin': User,
  'plugin-dev-tools': Wrench,
  'plugin-others': Layers,
  // Schedules Mastery
  'schedules-page': CalendarClock,
  'schedules-views': CalendarRange,
  'schedules-attach': Clock,
  // Templates & Recipes
  'templates-page': LayoutGrid,
  'templates-adopt': Wand2,
  'recipes-tab': BookOpen,
  // Teams & Orchestration
  'team-canvas-intro': Network,
  'team-chaining': Link,
  'team-assignments': ListChecks,
  'team-memory-goals': Target,
  // Obsidian Brain
  'obsidian-install': Download,
  'obsidian-vault-connect': FolderOpen,
  'obsidian-sync-tab': RefreshCw,
  'obsidian-browse-tab': Eye,
  'obsidian-graph-tab': Search,
  'obsidian-cloud-tab': Cloud,
  'obsidian-revitalize-tab': MoonStar,
  'obsidian-memory-dimensions': Brain,
};

export function getStepIcon(stepId: string): typeof Key {
  return ICON_MAP[stepId] ?? Sparkles;
}

// -- Step / tour → surface key mapping ----------------------------------

/** Step-ID → surface key (StepProgress renders each step in its tour's color). */
const STEP_TO_SURFACE: Record<string, TourSurfaceKey> = {
  'appearance-setup': 'violet', 'credentials-intro': 'violet', 'persona-creation': 'violet', 'first-execution': 'violet',
  'overview-dashboard': 'blue', 'execution-activity': 'blue', 'messages-tab': 'blue', 'health-monitoring': 'blue', 'lab-arena': 'blue',
  'events-intro': 'teal', 'trigger-types': 'teal', 'event-chaining': 'teal', 'live-stream': 'teal',
  'plugins-browse': 'amber', 'plugin-companion': 'amber', 'plugin-twin': 'amber', 'plugin-dev-tools': 'amber', 'plugin-others': 'amber',
  'schedules-page': 'emerald', 'schedules-views': 'emerald', 'schedules-attach': 'emerald',
  'templates-page': 'indigo', 'templates-adopt': 'indigo', 'recipes-tab': 'indigo',
  'team-canvas-intro': 'emerald', 'team-chaining': 'emerald', 'team-assignments': 'emerald', 'team-memory-goals': 'emerald',
  'obsidian-install': 'violet', 'obsidian-vault-connect': 'violet', 'obsidian-sync-tab': 'violet', 'obsidian-browse-tab': 'violet',
  'obsidian-graph-tab': 'violet', 'obsidian-cloud-tab': 'violet', 'obsidian-revitalize-tab': 'violet', 'obsidian-memory-dimensions': 'violet',
};

/**
 * Resolve a tour surface from either a step id (StepProgress) or a tour color
 * key (GuidedTour / TourPanelBody). Falls back to the default violet surface.
 */
export function getStepColors(key: string): TourSurface {
  return getTourSurface(STEP_TO_SURFACE[key] ?? key);
}

// -- Recommended tour sequence ------------------------------------------

/**
 * The order tours are suggested in once one completes. The Starter
 * (`getting-started-simple`) variant funnels into the same post-getting-started
 * sequence. `getNextTourId` skips tours the user has already completed so the
 * "start the next tour" nudge never points back at finished work.
 */
const TOUR_SEQUENCE: TourId[] = [
  'getting-started',
  'execution-observability',
  'orchestration-events',
  'plugins-explorer',
  'obsidian-brain',
  'schedules-mastery',
  'templates-recipes',
  'teams-orchestration',
];

/** The user-selectable tours in recommended order (excludes the Starter tier variant). */
export function getTourSequence(): readonly TourId[] {
  return TOUR_SEQUENCE;
}

/** The next not-yet-completed tour to suggest after `currentId`, or null when none remain. */
export function getNextTourId(currentId: TourId, completed: Record<TourId, boolean>): TourId | null {
  const startIdx = currentId === 'getting-started-simple' ? 0 : TOUR_SEQUENCE.indexOf(currentId);
  for (let i = startIdx + 1; i < TOUR_SEQUENCE.length; i++) {
    const id = TOUR_SEQUENCE[i];
    if (id && !completed[id]) return id;
  }
  return null;
}
