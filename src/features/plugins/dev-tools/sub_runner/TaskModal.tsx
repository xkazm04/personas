import { useState } from 'react';
import { Plus, X, Link2, Zap, Layers, Building2 } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';

type DepthColor = 'emerald' | 'amber' | 'violet';

// Static class bundles so Tailwind's JIT can detect every class at build time.
// `ring-${color}-500/40` style template strings are invisible to the JIT and
// silently produce no styles, so the depth-selector highlight stayed blank.
const DEPTH_COLOR_CLASSES: Record<DepthColor, { selectedRing: string; selectedIcon: string }> = {
  emerald: { selectedRing: 'ring-2 ring-emerald-500/40 border-emerald-500/40', selectedIcon: 'text-emerald-400' },
  amber:   { selectedRing: 'ring-2 ring-amber-500/40 border-amber-500/40',     selectedIcon: 'text-amber-400'   },
  violet:  { selectedRing: 'ring-2 ring-violet-500/40 border-violet-500/40',   selectedIcon: 'text-violet-400'  },
};

/**
 * Depth options carry i18n *keys*, not English labels — the old
 * `label: 'Quick'` / `description: '…'` literals rendered untranslated in
 * every non-English locale.
 */
const DEPTH_OPTIONS = [
  { value: 'quick',      labelKey: 'depth_quick_label',      descriptionKey: 'depth_quick_description',      icon: Zap,       color: 'emerald' },
  { value: 'campaign',   labelKey: 'depth_campaign_label',   descriptionKey: 'depth_campaign_description',   icon: Layers,    color: 'amber'   },
  { value: 'deep_build', labelKey: 'depth_deep_build_label', descriptionKey: 'depth_deep_build_description', icon: Building2, color: 'violet'  },
] as const satisfies readonly {
  value: string;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Zap;
  color: DepthColor;
}[];

export interface TaskDraft {
  title: string;
  description: string;
  goalId?: string;
  depth?: string;
}

export function TaskModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: TaskDraft) => void;
}) {
  const { t } = useTranslation();
  const dr = t.plugins.dev_runner;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goalId, setGoalId] = useState('');
  const [depth, setDepth] = useState<string>('quick');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description: description.trim(), goalId: goalId.trim() || undefined, depth });
    setTitle('');
    setDescription('');
    setGoalId('');
    setDepth('quick');
    onClose();
  };

  const selectedDescriptionKey = DEPTH_OPTIONS.find((o) => o.value === depth)?.descriptionKey;

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="dev-tools-new-task-title"
      size="sm"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-6 shadow-elevation-4"
    >
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 id="dev-tools-new-task-title" className="typo-section-title">{dr.new_task}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} title={t.common.close}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="typo-caption font-medium text-foreground mb-1.5 block">{dr.task_title_label}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={dr.task_title_placeholder}
              className="w-full px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30"
            />
          </div>
          <div>
            <label className="typo-caption font-medium text-foreground mb-1.5 block">{t.common.description}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={dr.task_details_placeholder}
              rows={3}
              className="w-full px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30 resize-none"
            />
          </div>

          {/* Task depth selector */}
          <div>
            <label className="typo-caption font-medium text-foreground mb-1.5 block">{dr.task_depth}</label>
            <div className="grid grid-cols-3 gap-2">
              {DEPTH_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const selected = depth === opt.value;
                const tw = DEPTH_COLOR_CLASSES[opt.color];
                const ring = selected ? tw.selectedRing : 'border-primary/10 hover:border-primary/20';
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDepth(opt.value)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-modal border bg-secondary/30 transition-all ${ring}`}
                  >
                    <Icon className={`w-4 h-4 ${selected ? tw.selectedIcon : 'text-foreground'}`} />
                    <span className="typo-caption font-medium text-foreground">{dr[opt.labelKey]}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-foreground mt-1.5">
              {selectedDescriptionKey ? dr[selectedDescriptionKey] : null}
            </p>
          </div>

          <div>
            <label className="typo-caption font-medium text-foreground mb-1.5 block">
              {dr.goal_link} <span className="text-foreground">{dr.optional}</span>
            </label>
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
              <input
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                placeholder={dr.goal_link_placeholder}
                className="w-full pl-9 pr-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="ghost" size="sm" onClick={onClose}>{t.common.cancel}</Button>
          <Button
            variant="accent"
            accentColor="amber"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            disabled={!title.trim()}
            onClick={handleSubmit}
          >
            {dr.create_task}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
