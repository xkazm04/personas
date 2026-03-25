import { memo, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  User,
  FileText,
  Wrench,
  Zap,
  Link2,
  LayoutList,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { StreamingSection, SectionKind } from '@/api/templates/n8nTransform';

// -- Section icon + color mapping --

const SECTION_META: Record<
  SectionKind,
  { Icon: React.ComponentType<{ className?: string }>; color: string; bg: string }
> = {
  identity: { Icon: User, color: 'text-violet-400', bg: 'bg-violet-500/15' },
  prompt: { Icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/15' },
  tool: { Icon: Wrench, color: 'text-amber-400', bg: 'bg-amber-500/15' },
  trigger: { Icon: Zap, color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  connector: { Icon: Link2, color: 'text-cyan-400', bg: 'bg-cyan-500/15' },
  design_context: { Icon: LayoutList, color: 'text-rose-400', bg: 'bg-rose-500/15' },
};

// -- Status indicator --

function StatusIcon({ section }: { section: StreamingSection }) {
  const { valid, errors, warnings } = section.validation;

  if (!valid || errors.length > 0) {
    return (
      <div className="flex items-center gap-1" title={errors.join('; ')}>
        <XCircle className="w-3.5 h-3.5 text-red-400" />
      </div>
    );
  }
  if (warnings.length > 0) {
    return (
      <div className="flex items-center gap-1" title={warnings.join('; ')}>
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
      </div>
    );
  }
  return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
}

// -- Section detail (expandable info) --

function SectionDetail({ section }: { section: StreamingSection }) {
  const { errors, warnings } = section.validation;
  const allMessages = [
    ...errors.map((e) => ({ msg: e, type: 'error' as const })),
    ...warnings.map((w) => ({ msg: w, type: 'warning' as const })),
  ];

  if (allMessages.length === 0) return null;

  return (
    <div className="mt-1.5 space-y-0.5">
      {allMessages.map((m, i) => (
        <p
          key={i}
          className={`text-sm leading-tight ${
            m.type === 'error' ? 'text-red-400/80' : 'text-amber-400/70'
          }`}
        >
          {m.type === 'error' ? '\u2717 ' : '\u26A0 '}
          {m.msg}
        </p>
      ))}
    </div>
  );
}

// -- Single section row --

const SectionRow = memo(function SectionRow({
  section,
  isLatest,
}: {
  section: StreamingSection;
  isLatest: boolean;
}) {
  const meta = SECTION_META[section.kind];
  const { Icon, color, bg } = meta;

  return (
    <div
      className={`animate-fade-slide-in flex items-start gap-2.5 px-3 py-2 rounded-xl border transition-colors ${
        isLatest
          ? 'border-primary/15 bg-secondary/30'
          : 'border-transparent bg-transparent'
      }`}
    >
      {/* Icon */}
      <div
        className={`flex-shrink-0 w-6 h-6 rounded-lg ${bg} flex items-center justify-center mt-0.5`}
      >
        <Icon className={`w-3 h-3 ${color}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground/85 truncate font-medium">
            {section.label}
          </span>
          <StatusIcon section={section} />
        </div>
        <SectionDetail section={section} />
      </div>
    </div>
  );
}, (prev, next) => {
  if (prev.isLatest !== next.isLatest) return false;
  if (prev.section !== next.section) {
    return (
      prev.section.kind === next.section.kind
      && prev.section.index === next.section.index
      && prev.section.label === next.section.label
      && prev.section.validation.valid === next.section.validation.valid
      && prev.section.validation.errors.length === next.section.validation.errors.length
      && prev.section.validation.warnings.length === next.section.validation.warnings.length
    );
  }
  return true;
});

// -- Main component --

interface StreamingSectionsProps {
  sections: StreamingSection[];
  isStreaming: boolean;
}

export function StreamingSections({ sections, isStreaming }: StreamingSectionsProps) {
  const { validCount, warningCount, errorCount } = useMemo(() => {
    let valid = 0;
    let warning = 0;
    let error = 0;
    for (const s of sections) {
      if (s.validation.valid) {
        valid++;
        if (s.validation.warnings.length > 0) warning++;
      } else {
        error++;
      }
    }
    return { validCount: valid, warningCount: warning, errorCount: error };
  }, [sections]);

  if (sections.length === 0 && !isStreaming) return null;

  return (
    <div
      aria-live="polite"
      aria-busy={isStreaming}
      className="animate-fade-slide-in rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-primary/8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70">
            Streaming Sections
          </span>
        </div>
        {sections.length > 0 && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground/60">
            {validCount > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400/70" />
                {validCount}
              </span>
            )}
            {warningCount > 0 && (
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-400/70" />
                {warningCount}
              </span>
            )}
            {errorCount > 0 && (
              <span className="flex items-center gap-1">
                <XCircle className="w-3 h-3 text-red-400/70" />
                {errorCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Section list */}
      <div className="px-2 py-2 space-y-0.5">
        {sections.map((section, i) => (
            <SectionRow
              key={`${section.kind}-${section.index}`}
              section={section}
              isLatest={i === sections.length - 1 && isStreaming}
            />
          ))}

        {/* Loading indicator */}
        {isStreaming && (
          <div
            className="animate-fade-slide-in flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground/50"
          >
            <LoadingSpinner size="xs" />
            Awaiting next section...
          </div>
        )}
      </div>
    </div>
  );
}
