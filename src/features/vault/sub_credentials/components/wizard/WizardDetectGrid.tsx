import { motion } from 'framer-motion';
import { Sparkles, SearchX } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import type { AuthDetection } from '@/api/auth/authDetect';
import type { ConnectorDefinition } from '@/lib/types/types';
import { staggerContainer } from '@/features/templates/animationPresets';
import { WizardDetectConnectorRow } from './WizardDetectConnectorRow';
import { useTranslation } from '@/i18n/useTranslation';

interface WizardDetectGridProps {
  detected: ConnectorDefinition[];
  available: ConnectorDefinition[];
  alreadyAdded: ConnectorDefinition[];
  filteredCount: number;
  search: string;
  selected: Set<string>;
  detectionMap: Map<string, AuthDetection>;
  onToggle: (name: string) => void;
}

export function WizardDetectGrid({
  detected,
  available,
  alreadyAdded,
  filteredCount,
  search,
  selected,
  detectionMap,
  onToggle,
}: WizardDetectGridProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1 -mr-1">
      {/* Detected services */}
      {detected.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-emerald-400/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            Detected ({detected.length})
          </h3>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
          >
            {detected.map((c) => (
              <WizardDetectConnectorRow
                key={c.id}
                connector={c}
                isAdded={false}
                isSelected={selected.has(c.name)}
                detection={detectionMap.get(c.name)}
                onToggle={onToggle}
              />
            ))}
          </motion.div>
        </div>
      )}

      {/* Available services */}
      {available.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
            Available ({available.length})
          </h3>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
          >
            {available.map((c) => (
              <WizardDetectConnectorRow
                key={c.id}
                connector={c}
                isAdded={false}
                isSelected={selected.has(c.name)}
                detection={detectionMap.get(c.name)}
                onToggle={onToggle}
              />
            ))}
          </motion.div>
        </div>
      )}

      {/* Already added */}
      {alreadyAdded.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">
            Already added ({alreadyAdded.length})
          </h3>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {alreadyAdded.map((c) => (
              <WizardDetectConnectorRow
                key={c.id}
                connector={c}
                isAdded={true}
                isSelected={false}
                detection={undefined}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}

      {filteredCount === 0 && (
        <EmptyIllustration
          icon={SearchX}
          heading={`No services match "${search}"`}
          description={t.vault.wizard_detect.no_filter_match}
          className="py-10"
        />
      )}
    </div>
  );
}
