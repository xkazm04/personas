import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { SectionCard, type SectionCardStatus } from '../SectionCard';
import { useSectionScrollSpy } from './useSectionScrollSpy';

export interface SettingsSection {
  /** Stable id — used as the scroll anchor + nav key. */
  id: string;
  /** Nav label + (when carded) the section card title. */
  label: string;
  /** Leading glyph shown in the nav rail and the card header. */
  icon?: ReactNode;
  /** Optional card subtitle. */
  subtitle?: string;
  /** Optional right-aligned header control (e.g. a status badge), forwarded to the SectionCard. */
  action?: ReactNode;
  /** The section body. */
  content: ReactNode;
  /** Optional status accent forwarded to the SectionCard. */
  status?: SectionCardStatus;
  /**
   * When `false`, render `content` directly (it brings its own card —
   * e.g. an existing self-carded panel). Defaults to `true`, which wraps
   * `content` in a shared SectionCard so sections look consistent.
   */
  card?: boolean;
}

interface SettingsScaffoldProps {
  sections: SettingsSection[];
  /** Accessible name for the quick-nav landmark. */
  navAriaLabel: string;
  className?: string;
  /** Tailwind max-width cap for the whole nav+content group (centered). Default `max-w-5xl`. */
  maxWidth?: string;
  /** Render the quick-nav rail. Default `true`; pass `false` for short surfaces
   *  whose few sections need no navigation (content then spans the full width). */
  showNav?: boolean;
}

/**
 * @catalog Two-column settings layout — a sticky quick-nav rail (scroll-spy + smooth-scroll + animated active pill) beside a stack of SectionCard sections. Use for any multi-section settings surface so panels share one nav + typography.
 *
 * Centralizes the settings-panel shape that AccountSettings / companion
 * SetupPanel were each laying out by hand. Pass a `sections` array; the rail
 * lists them, tracks the scroll position, and click-scrolls (markdown-style
 * quick nav). Sections render through the shared SectionCard for one
 * consistent type ramp / spacing / colour, or opt out with `card: false`
 * when the content is an already-carded panel.
 */
export function SettingsScaffold({
  sections,
  navAriaLabel,
  className,
  maxWidth = 'max-w-5xl',
  showNav = true,
}: SettingsScaffoldProps) {
  const ids = sections.map((s) => s.id);
  const { activeId, register, jumpTo } = useSectionScrollSpy(ids);
  const uid = useId();

  return (
    <div className={`flex flex-col md:flex-row gap-6 items-stretch md:items-start mx-auto ${maxWidth} ${className ?? ''}`.trim()}>
      {/* Below `md` the rail is display:none, which left a narrow window or the
          Android shell with no section index at all - just one long scroll.
          The jumplist is the same `jumpTo` / `activeId` contract in a control
          that fits, and it unmounts at `md` where the rail takes over, so the
          two never appear together. */}
      {showNav && (
        <div className="md:hidden sticky top-0 z-10 bg-background/90 backdrop-blur py-2" data-settings-jumplist="">
          <ThemedSelect
            aria-label={navAriaLabel}
            filterable
            hideSearch
            value={activeId}
            onValueChange={jumpTo}
            options={sections.map((s) => ({ value: s.id, label: s.label }))}
            wrapperClassName="w-full"
          />
        </div>
      )}

      {showNav && <nav
        aria-label={navAriaLabel}
        className="hidden md:block sticky top-1 self-start w-[30%] flex-shrink-0"
      >
        <ul className="space-y-0.5">
          {sections.map((s) => {
            const active = s.id === activeId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => jumpTo(s.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`relative w-full flex items-center gap-2 rounded-card px-2.5 py-1.5 text-left transition-colors ${
                    active ? 'text-primary' : 'text-foreground hover:bg-secondary/20'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={`settings-nav-${uid}`}
                      className="absolute inset-0 rounded-card bg-primary/10 border border-primary/15"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  {s.icon && <span className="relative z-10 flex-shrink-0 flex">{s.icon}</span>}
                  <span className="relative z-10 typo-caption font-medium">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>}

      <div className="flex-1 min-w-0 space-y-4">
        {sections.map((s) => (
          <section key={s.id} id={s.id} ref={register(s.id)} className="scroll-mt-4">
            {s.card === false ? (
              s.content
            ) : (
              <SectionCard
                title={s.label}
                subtitle={s.subtitle}
                icon={s.icon}
                action={s.action}
                status={s.status}
                titleClassName="text-primary"
              >
                {s.content}
              </SectionCard>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
