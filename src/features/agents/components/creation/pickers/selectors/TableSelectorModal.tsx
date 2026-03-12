import { X, Table2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useTableIntrospection } from '@/hooks/database/useTableIntrospection';
import { TableSelector } from '@/features/shared/components/forms/TableSelector';
import type { BuilderComponent } from '../../steps/builder/types';

// -- Table Selector Modal -----------------------------------------------------

export function TableSelectorModal({
  component,
  onSetWatchedTables,
  onClose,
}: {
  component: BuilderComponent;
  onSetWatchedTables: (componentId: string, tables: string[]) => void;
  onClose: () => void;
}) {
  const { tables, loading, error, fetchTables } = useTableIntrospection({
    credentialId: component.credentialId!,
    serviceType: component.connectorName,
    autoFetch: true,
  });

  const meta = getConnectorMeta(component.connectorName);
  const count = component.watchedTables?.length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15 }}
        className="bg-background border border-primary/20 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-amber-500/15 to-orange-500/10 border border-amber-500/20">
              <Table2 className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">
                Select Tables
              </h3>
              <p className="text-sm text-muted-foreground/65">
                {meta.label} -- choose tables to watch
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-muted-foreground/60 hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Table Selector */}
        <div className="p-4">
          <TableSelector
            tables={tables}
            selectedTables={component.watchedTables ?? []}
            onSelectionChange={(t) => onSetWatchedTables(component.id, t)}
            loading={loading}
            error={error}
            onRefresh={() => fetchTables(true)}
            maxHeight="360px"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-primary/10">
          <p className="text-sm text-muted-foreground/50">
            {count > 0
              ? `${count} table${count !== 1 ? 's' : ''} selected`
              : 'No tables selected -- agent watches all'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm font-medium rounded-xl text-muted-foreground/70 hover:text-foreground/80 hover:bg-secondary/40 transition-colors"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm font-semibold rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
