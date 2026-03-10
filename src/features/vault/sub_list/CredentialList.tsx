import { motion } from 'framer-motion';
import { CredentialCard } from '@/features/vault/sub_card/CredentialCard';
import { CredentialPlaygroundModal } from '@/features/vault/sub_playground/CredentialPlaygroundModal';
import { SchemaManagerModal } from '@/features/vault/sub_databases/SchemaManagerModal';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { type CredentialListProps, capitalize } from './credentialListTypes';
import { useCredentialListFilters } from './useCredentialListFilters';
import { CredentialFilterBar } from './CredentialFilterBar';
import { EmptyStateView } from './EmptyStateView';

export function CredentialList({ credentials, connectorDefinitions, searchTerm, onDelete, onQuickStart, onGoToCatalog, onGoToAddNew, onWorkspaceConnect }: CredentialListProps) {
  const {
    setSelectedId,
    selectedTags,
    selectedCredential, selectedConnector, selectedIsDatabase,
    healthFilter, setHealthFilter,
    sortKey, setSortKey,
    openDropdown, setOpenDropdown,
    allTags, hasFilters,
    toggleTag, clearFilters,
    filteredCredentials, grouped,
    showFilterBar,
  } = useCredentialListFilters(credentials, connectorDefinitions, searchTerm);

  return (
    <motion.div
      key="list"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-2"
    >
      {/* Filter bar */}
      {showFilterBar && (
        <CredentialFilterBar
          allTags={allTags}
          selectedTags={selectedTags}
          toggleTag={toggleTag}
          healthFilter={healthFilter}
          setHealthFilter={setHealthFilter}
          sortKey={sortKey}
          setSortKey={setSortKey}
          openDropdown={openDropdown}
          setOpenDropdown={setOpenDropdown}
          hasFilters={hasFilters}
          clearFilters={clearFilters}
        />
      )}

      {grouped.map(({ category, items }, gi) => (
        <div key={category || gi}>
          {category && (
            <p className={`text-sm font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 ${gi > 0 ? 'mt-4' : ''}`}>
              {capitalize(category)}
            </p>
          )}
          <div className="grid gap-2" style={{ gridTemplateColumns: IS_MOBILE ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {items.map(({ credential, connector }) => (
              <CredentialCard
                key={credential.id}
                credential={credential}
                connector={connector}
                onSelect={() => setSelectedId(credential.id)}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      ))}

      {filteredCredentials.length === 0 && credentials.length > 0 && (
        <div className="text-center py-10 text-muted-foreground/80 text-sm">
          {hasFilters ? 'No credentials match your filters' : 'No credentials match your search'}
        </div>
      )}

      {credentials.length === 0 && (
        <EmptyStateView
          connectorDefinitions={connectorDefinitions}
          onQuickStart={onQuickStart}
          onGoToCatalog={onGoToCatalog}
          onGoToAddNew={onGoToAddNew}
          onWorkspaceConnect={onWorkspaceConnect}
        />
      )}

      {/* Credential detail modal */}
      {selectedCredential && selectedIsDatabase && (
        <SchemaManagerModal
          credential={selectedCredential}
          connector={selectedConnector}
          onClose={() => setSelectedId(null)}
        />
      )}
      {selectedCredential && !selectedIsDatabase && (
        <CredentialPlaygroundModal
          credential={selectedCredential}
          connector={selectedConnector}
          onClose={() => setSelectedId(null)}
          onDelete={onDelete}
        />
      )}
    </motion.div>
  );
}
