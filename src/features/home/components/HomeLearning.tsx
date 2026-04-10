import { useState } from 'react';
import {
  GraduationCap, RotateCcw, Play, Check, Compass, Activity, Radio,
  Sparkles, FlaskConical, Link, Zap, Shield, Eye, Palette, Brain,
  X, Wrench, BarChart3,
} from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { TOUR_REGISTRY } from '@/stores/slices/system/tourSlice';
import { BaseModal } from '@/lib/ui/BaseModal';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';

// -- Tour icons & colors -----------------------------------------------

const TOUR_ICONS: Record<string, typeof Compass> = { Compass, Activity, Radio };

const FALLBACK = { bg: 'bg-violet-500/5', border: 'border-violet-500/15', text: 'text-violet-400', btnBg: 'bg-violet-500/10', btnBorder: 'border-violet-500/25', btnText: 'text-violet-300' };
const COLORS: Record<string, typeof FALLBACK> = {
  violet: FALLBACK,
  blue: { bg: 'bg-blue-500/5', border: 'border-blue-500/15', text: 'text-blue-400', btnBg: 'bg-blue-500/10', btnBorder: 'border-blue-500/25', btnText: 'text-blue-300' },
  teal: { bg: 'bg-teal-500/5', border: 'border-teal-500/15', text: 'text-teal-400', btnBg: 'bg-teal-500/10', btnBorder: 'border-teal-500/25', btnText: 'text-teal-300' },
};
function getColors(k: string) { return COLORS[k] ?? FALLBACK; }

// -- Tricks data --------------------------------------------------------

interface TrickStep {
  text: string;
  bold?: string;
}

interface Trick {
  id: string;
  title: string;
  tagline: string;
  icon: typeof Sparkles;
  color: string;
  category: 'agent-craft' | 'observability' | 'platform';
  screenshot: string;
  steps: TrickStep[];
  proTip?: string;
}

const TRICKS: Trick[] = [
  {
    id: 'persona-matrix',
    title: 'How Agents Are Built: The 8-Dimension Blueprint',
    tagline: 'Understand the complete blueprint behind every AI agent',
    icon: Sparkles,
    color: 'text-violet-400',
    category: 'agent-craft',
    screenshot: '/guides/trick-persona-matrix.png',
    steps: [
      { text: 'Go to', bold: 'Agents > Create New' },
      { text: 'Every agent is defined across 8 independent dimensions:' },
      { text: 'Use Cases — what workflows it handles', bold: 'Identity' },
      { text: 'Connections — external apps and services it integrates with', bold: 'Capability' },
      { text: 'Triggers, Approvals, Messages, Memory, Error Handling, Events', bold: 'Behavior' },
      { text: 'Each dimension is configured independently during the setup process' },
    ],
    proTip: 'After the build completes, you can click any cell to manually edit its configuration before promoting.',
  },
  {
    id: 'arena-model-compare',
    title: 'Arena: Head-to-Head Model Comparison',
    tagline: 'Compare Haiku, Sonnet, and Opus on your actual use cases',
    icon: FlaskConical,
    color: 'text-amber-400',
    category: 'agent-craft',
    screenshot: '/guides/trick-arena-model-compare.png',
    steps: [
      { text: 'Select any agent and open the', bold: 'Lab tab' },
      { text: 'Switch to', bold: 'Arena mode' },
      { text: 'Toggle models to compare (Haiku vs Sonnet vs Opus)' },
      { text: 'Click Run — the arena tests each model on your agent\'s scenarios' },
      { text: 'Results show composite scores for Tool Accuracy, Output Quality, and Protocol Compliance' },
    ],
    proTip: 'Use Arena after prompt changes to verify you haven\'t regressed on cheaper models.',
  },
  {
    id: 'prompt-versioning',
    title: 'Prompt Version Rollback',
    tagline: 'Every edit versioned, diffable, and rollbackable',
    icon: RotateCcw,
    color: 'text-cyan-400',
    category: 'agent-craft',
    screenshot: '/guides/trick-prompt-versioning.png',
    steps: [
      { text: 'Select an agent → open', bold: 'Lab > Versions' },
      { text: 'Every prompt edit creates a numbered version automatically' },
      { text: 'Click any two versions to see a side-by-side diff' },
      { text: 'Tag versions as Production, Experimental, or Archived' },
      { text: 'Rollback instantly if a new version causes regressions' },
    ],
    proTip: 'Select two versions and click "Run A/B Test" to scientifically compare them before promoting.',
  },
  {
    id: 'health-heartbeats',
    title: 'Agent Health Heartbeats',
    tagline: 'Score 0-100 for every agent in your fleet',
    icon: Activity,
    color: 'text-rose-400',
    category: 'observability',
    screenshot: '/guides/trick-health-heartbeats.png',
    steps: [
      { text: 'Go to', bold: 'Overview > Health' },
      { text: 'Each agent card shows a heartbeat score with color-coded grades:' },
      { text: 'Green (80+) = Healthy, Amber (50-79) = Degraded, Red (<50) = Critical' },
      { text: 'Expand any card to see success rate, failure count, cost projection, and average latency' },
    ],
    proTip: 'Filter by grade (Degraded/Critical) to quickly find agents that need attention.',
  },
  {
    id: 'message-threads',
    title: 'Threaded Agent Messages',
    tagline: 'Follow multi-agent conversations in context',
    icon: Brain,
    color: 'text-blue-400',
    category: 'observability',
    screenshot: '/guides/trick-message-threads.png',
    steps: [
      { text: 'Go to', bold: 'Overview > Messages' },
      { text: 'Toggle between Flat (chronological) and Threaded view modes' },
      { text: 'In Threaded view, parent messages group their replies with indented nesting' },
      { text: 'Filter by priority (High/Normal/Low) or read status (Unread)' },
      { text: 'Click "Mark All Read" to clear the unread badge count' },
    ],
    proTip: 'High-priority messages appear with a red badge — useful for error notifications from agents.',
  },
  {
    id: 'live-event-stream',
    title: 'Real-Time Event Stream',
    tagline: 'Watch your agent ecosystem pulse live',
    icon: Zap,
    color: 'text-yellow-400',
    category: 'observability',
    screenshot: '/guides/trick-live-event-stream.png',
    steps: [
      { text: 'Go to', bold: 'Events > Live Stream' },
      { text: 'Events appear in real-time: execution_completed, webhook_received, schedule_fired' },
      { text: 'Each event shows its type, source, target agent, and processing status' },
      { text: 'Filter by event type or persona to focus on specific chains' },
    ],
    proTip: 'Use the Live Stream while testing chain triggers — you\'ll see the cascade in real-time.',
  },
  {
    id: 'event-chaining',
    title: 'Chain Agents with Event Listeners',
    tagline: 'Build multi-agent workflows with the event bus',
    icon: Link,
    color: 'text-purple-400',
    category: 'observability',
    screenshot: '/guides/trick-event-chaining.png',
    steps: [
      { text: 'Go to', bold: 'Events > Builder' },
      { text: 'The canvas shows event sources (left) connected to consuming agents (right)' },
      { text: 'Agent A completes → emits execution_completed → Agent B\'s event_listener trigger fires → Agent B auto-executes' },
      { text: 'Use source_filter to limit which agent\'s events trigger the chain (e.g., only "persona-a")' },
    ],
    proTip: 'Combine chain triggers with composite triggers for time-windowed, multi-condition orchestration.',
  },
  {
    id: 'credential-healthcheck',
    title: 'Bulk Credential Health Check',
    tagline: 'Automated daily monitoring for all your credentials',
    icon: Shield,
    color: 'text-emerald-400',
    category: 'platform',
    screenshot: '/guides/trick-credential-healthcheck.png',
    steps: [
      { text: 'Open', bold: 'Credentials' },
      { text: 'Look at the status dots next to each credential — green means healthy, amber needs attention, red is failing' },
      { text: 'Health checks run automatically once per day on first vault access' },
      { text: 'Click any failing credential to see the audit log and trigger AI remediation' },
    ],
    proTip: 'The remediation engine can auto-rotate expired API keys and refresh OAuth tokens without manual intervention.',
  },
  {
    id: 'auto-credential-discovery',
    title: 'AI Credential Auto-Discovery',
    tagline: 'Paste a URL, AI extracts credentials automatically',
    icon: Eye,
    color: 'text-teal-400',
    category: 'platform',
    screenshot: '/guides/trick-auto-credential-discovery.png',
    steps: [
      { text: 'Open', bold: 'Credentials > Add New' },
      { text: 'Choose', bold: 'API Autopilot' },
      { text: 'Paste any service URL or OpenAPI spec URL' },
      { text: 'The AI-powered browser automation navigates to the service, finds the auth page, and extracts credential fields' },
      { text: 'Review the extracted fields and confirm — no manual form filling needed' },
    ],
    proTip: 'Also try the AI Setup Wizard for guided setup, or Desktop Bridge for local apps like VS Code and Docker.',
  },
  {
    id: 'custom-theme',
    title: 'Build a Custom Theme',
    tagline: '8 color slots, gradients, and live preview',
    icon: Palette,
    color: 'text-pink-400',
    category: 'platform',
    screenshot: '/guides/trick-custom-theme.png',
    steps: [
      { text: 'Go to', bold: 'Settings > Appearance' },
      { text: 'Scroll to the Theming section and click the', bold: 'Custom tab' },
      { text: 'Pick a primary color — the entire app transforms instantly' },
      { text: 'Tweak Accent, Background, Foreground, Secondary, Border, Card, and Muted Text colors' },
      { text: 'Enable Background Gradient for a polished depth effect' },
    ],
    proTip: 'The mini preview panel updates in real-time, so you can see changes before applying.',
  },
];

// -- Category definitions -----------------------------------------------

const CATEGORIES: { key: Trick['category']; label: string; icon: typeof Sparkles; color: string }[] = [
  { key: 'agent-craft', label: 'Agent Craft', icon: Sparkles, color: 'text-violet-400' },
  { key: 'observability', label: 'Observability & Events', icon: BarChart3, color: 'text-blue-400' },
  { key: 'platform', label: 'Platform & Setup', icon: Wrench, color: 'text-emerald-400' },
];

// -- Component ----------------------------------------------------------

export default function HomeLearning() {
  const tourCompletionMap = useSystemStore((s) => s.tourCompletionMap);
  const startTour = useSystemStore((s) => s.startTour);
  const [activeTrick, setActiveTrick] = useState<Trick | null>(null);

  return (
    <ContentBox>
      <ContentHeader
        icon={<GraduationCap className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title="Learning Center"
        subtitle="Guided tours and quick tricks to master Personas"
      />
      <ContentBody centered>
      {/* 2-column layout */}
      <div className="flex gap-6 w-full">
        {/* Left column: Guided Tours */}
        <div className="w-1/2 flex-shrink-0 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-primary/10">
            <Compass className="w-4 h-4 text-indigo-400" />
            <h3 className="typo-heading text-foreground/80">Guided Tours</h3>
            <span className="text-[11px] text-muted-foreground/40 ml-auto">
              {Object.values(tourCompletionMap).filter(Boolean).length}/{TOUR_REGISTRY.length} completed
            </span>
          </div>

          {TOUR_REGISTRY.map((tour) => {
            const isCompleted = tourCompletionMap[tour.id] ?? false;
            const Icon = TOUR_ICONS[tour.icon] ?? Compass;
            const colors = getColors(tour.color);

            return (
              <div
                key={tour.id}
                data-testid={`learning-tour-${tour.id}`}
                className={`rounded-xl border ${colors.border} ${colors.bg} p-5 space-y-3 transition-all hover:shadow-elevation-2`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${colors.text}`} />
                    </div>
                    <div>
                      <h4 className="typo-heading text-foreground/80">{tour.title}</h4>
                      <span className="text-[11px] text-muted-foreground/50">{tour.steps.length} steps</span>
                    </div>
                  </div>
                  {isCompleted && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                      <Check className="w-2.5 h-2.5" />
                      Done
                    </span>
                  )}
                </div>
                <p className="typo-body text-muted-foreground/60 leading-relaxed">{tour.description}</p>
                <button
                  onClick={() => startTour(tour.id)}
                  data-testid={`learning-start-${tour.id}`}
                  className={`flex items-center gap-2 px-4 py-2 typo-heading rounded-xl ${colors.btnBg} ${colors.btnText} border ${colors.btnBorder} hover:brightness-125 transition-all`}
                >
                  {isCompleted ? <><RotateCcw className="w-3.5 h-3.5" /> Restart</> : <><Play className="w-3.5 h-3.5" /> Start Tour</>}
                </button>
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div className="w-px bg-primary/10 self-stretch flex-shrink-0" />

        {/* Right column: Tricks & Tips */}
        <div className="w-1/2 min-w-0 space-y-5">
          <div className="flex items-center gap-2 pb-2 border-b border-primary/10">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="typo-heading text-foreground/80">Tricks & Tips</h3>
            <span className="text-[11px] text-muted-foreground/40 ml-auto">{TRICKS.length} guides</span>
          </div>

          {CATEGORIES.map((cat) => {
            const catTricks = TRICKS.filter((t) => t.category === cat.key);
            return (
              <div key={cat.key} className="space-y-2">
                {/* Category header */}
                <div className="flex items-center gap-2 pl-1">
                  <cat.icon className={`w-3.5 h-3.5 ${cat.color}`} />
                  <span className="text-[11px] font-semibold text-foreground/60 uppercase tracking-wider">{cat.label}</span>
                  <div className="flex-1 h-px bg-primary/5 ml-1" />
                </div>

                {/* Tricks in category */}
                {catTricks.map((trick) => (
                  <button
                    key={trick.id}
                    onClick={() => setActiveTrick(trick)}
                    data-testid={`trick-btn-${trick.id}`}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border border-primary/8 bg-secondary/5 hover:bg-secondary/15 hover:border-primary/12 transition-all group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-secondary/30 border border-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-secondary/50 transition-colors">
                      <trick.icon className={`w-3.5 h-3.5 ${trick.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-foreground/80 group-hover:text-foreground/90 transition-colors">{trick.title}</h4>
                      <p className="text-[11px] text-muted-foreground/50 truncate">{trick.tagline}</p>
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Trick detail modal */}
      {activeTrick && (
        <TrickModal trick={activeTrick} onClose={() => setActiveTrick(null)} />
      )}
      </ContentBody>
    </ContentBox>
  );
}

// -- Trick Modal --------------------------------------------------------

function TrickModal({ trick, onClose }: { trick: Trick; onClose: () => void }) {
  return (
    <BaseModal isOpen onClose={onClose} titleId={`trick-modal-${trick.id}`} maxWidthClass="max-w-3xl" portal>
      <div className="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-secondary/30 border border-primary/10 flex items-center justify-center">
              <trick.icon className={`w-4.5 h-4.5 ${trick.color}`} />
            </div>
            <div>
              <h3 className="typo-heading text-foreground/90">{trick.title}</h3>
              <p className="text-[11px] text-muted-foreground/50">{trick.tagline}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Screenshot */}
          <div className="rounded-xl overflow-hidden border border-primary/10 bg-black/20">
            <img
              src={trick.screenshot}
              alt={trick.title}
              className="w-full h-auto"
              data-testid={`trick-img-${trick.id}`}
            />
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-foreground/60 uppercase tracking-wider">How to use</span>
            <div className="space-y-2 pl-0.5">
              {trick.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-[11px] font-mono text-muted-foreground/30 mt-0.5 w-5 flex-shrink-0 text-right">{i + 1}.</span>
                  <p className="text-sm text-muted-foreground/70 leading-relaxed">
                    {step.bold ? (
                      <>{step.text} <span className="font-semibold text-foreground/80">{step.bold}</span></>
                    ) : step.text}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Pro tip */}
          {trick.proTip && (
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 px-4 py-3">
              <p className="text-sm text-amber-300/70 leading-relaxed">
                <span className="font-semibold text-amber-400">Pro tip: </span>{trick.proTip}
              </p>
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
