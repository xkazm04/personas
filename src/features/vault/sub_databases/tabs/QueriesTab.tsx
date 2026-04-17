import { useState, useCallback } from 'react';
import { Wand2 } from 'lucide-react';
import { useVaultStore } from "@/stores/vaultStore";
import { useTranslation } from '@/i18n/useTranslation';
import { QuerySidebar } from './QuerySidebar';
import { QueryEditorPane } from './QueryEditorPane';

interface QueriesTabProps {
  credentialId: string;
  language: string;
  serviceType: string;
}

export function QueriesTab({ credentialId, language, serviceType }: QueriesTabProps) {
  const { t } = useTranslation();
  const queries = useVaultStore((s) => s.dbSavedQueries).filter((q) => q.credential_id === credentialId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');

  const selectedQuery = queries.find((q) => q.id === selectedId);

  const handleSelect = useCallback((id: string) => {
    if (!id) { setSelectedId(null); return; }
    const q = queries.find((q) => q.id === id);
    if (q) {
      setSelectedId(id);
      setEditorValue(q.query_text);
    }
  }, [queries]);

  return (
    <div className="flex h-full min-h-[500px]">
      <QuerySidebar
        credentialId={credentialId}
        language={language}
        selectedId={selectedId}
        onSelect={handleSelect}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {selectedQuery ? (
          <QueryEditorPane
            credentialId={credentialId}
            language={language}
            serviceType={serviceType}
            selectedId={selectedId}
            selectedTitle={selectedQuery.title}
            editorValue={editorValue}
            onEditorChange={setEditorValue}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-modal bg-secondary/20 border border-primary/10 flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-foreground" />
            </div>
            <p className="text-sm text-foreground">{t.vault.databases.select_or_create}</p>
          </div>
        )}
      </div>
    </div>
  );
}
