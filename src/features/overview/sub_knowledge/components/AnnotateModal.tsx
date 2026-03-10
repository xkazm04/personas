import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { upsertKnowledgeAnnotation } from '@/api/overview/intelligence/knowledge';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { SCOPE_TYPES } from '../libs/knowledgeHelpers';

interface AnnotateModalProps {
  personas: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: () => void;
}

export function AnnotateModal({ personas, onClose, onCreated }: AnnotateModalProps) {
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? '');
  const [scopeType, setScopeType] = useState('global');
  const [scopeId, setScopeId] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!text.trim() || !personaId) return;
    setSaving(true);
    try {
      await upsertKnowledgeAnnotation(
        personaId,
        scopeType,
        scopeType !== 'persona' && scopeType !== 'global' ? (scopeId || null) : null,
        text.trim(),
        'user',
      );
      onCreated();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-primary/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-foreground/90 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-cyan-400" /> Add Knowledge Annotation
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground/70 mb-1 block">Attribution Persona</label>
            <ThemedSelect value={personaId} onChange={(e) => setPersonaId(e.target.value)} className="w-full py-1.5">
              {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </ThemedSelect>
          </div>

          <div>
            <label className="text-xs text-muted-foreground/70 mb-1 block">Scope</label>
            <ThemedSelect value={scopeType} onChange={(e) => setScopeType(e.target.value)} className="w-full py-1.5">
              {Object.entries(SCOPE_TYPES).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}
            </ThemedSelect>
          </div>

          {(scopeType === 'tool' || scopeType === 'connector') && (
            <div>
              <label className="text-xs text-muted-foreground/70 mb-1 block">
                {scopeType === 'tool' ? 'Tool Name' : 'Connector / Service Type'}
              </label>
              <input
                type="text"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                placeholder={scopeType === 'tool' ? 'e.g. http_request' : 'e.g. google_workspace'}
                className="w-full px-3 py-1.5 rounded-xl bg-secondary/40 border border-primary/10 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground/70 mb-1 block">Annotation</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Stripe webhook verification requires the raw request body, not the parsed JSON"
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-secondary/40 border border-primary/10 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-xl text-sm text-muted-foreground/70 hover:text-foreground/90 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saving || !text.trim()}
            className="px-4 py-1.5 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-sm font-medium text-cyan-300 hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Annotation'}
          </button>
        </div>
      </div>
    </div>
  );
}
