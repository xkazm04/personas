// Manual authoring of a workspace knowledge item. Lands as `proposed` with
// human provenance (create_knowledge). The harvest engine (Arc 2) fills the
// library automatically; this is the by-hand path for the review queue.
import { useState } from 'react';

import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { createWorkspaceKnowledge, type KnowledgeKind } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import { toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

const KIND_VALUES: KnowledgeKind[] = ['pattern', 'pitfall', 'decision', 'howto', 'fact'];

export function CreatePracticeModal({
  workspaceId,
  memberProjects,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  memberProjects: DevProject[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const kindLabel: Record<KnowledgeKind, string> = {
    pattern: w.kind_pattern,
    pitfall: w.kind_pitfall,
    decision: w.kind_decision,
    howto: w.kind_howto,
    fact: w.kind_fact,
  };

  const [kind, setKind] = useState<KnowledgeKind>('pattern');
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('');
  const [topic, setTopic] = useState('');
  const [detail, setDetail] = useState('');
  const [origin, setOrigin] = useState('');

  const canSave = title.trim().length > 0 && statement.trim().length > 0;

  const submit = async () => {
    if (!canSave) return;
    try {
      await createWorkspaceKnowledge({
        workspaceId,
        kind,
        title: title.trim(),
        statement: statement.trim(),
        detailMd: detail.trim() || undefined,
        topic: topic.trim() || undefined,
        originProjectId: origin || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      toastCatch('workspaces:createPractice')(err);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="create-practice" size="md" staggerChildren={false}>
      <div className="flex flex-col gap-4 p-5">
        <h2 id="create-practice" className="typo-title text-foreground">
          {w.add_practice_title}
        </h2>

        <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
          <label className="typo-label text-muted-foreground pt-2">{w.form_kind}</label>
          <ThemedSelect
            filterable
            hideSearch
            options={KIND_VALUES.map((k) => ({ value: k, label: kindLabel[k] }))}
            value={kind}
            onValueChange={(v) => setKind(v as KnowledgeKind)}
          />

          <label className="typo-label text-muted-foreground pt-2">{w.form_title}</label>
          <input
            className={INPUT_FIELD}
            placeholder={w.form_title_ph}
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />

          <label className="typo-label text-muted-foreground pt-2">{w.form_statement}</label>
          <textarea
            className={`${INPUT_FIELD} min-h-20 resize-y`}
            placeholder={w.form_statement_ph}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />

          <label className="typo-label text-muted-foreground pt-2">{w.form_topic}</label>
          <div>
            <input
              className={INPUT_FIELD}
              placeholder={w.form_topic_ph}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <p className="typo-caption text-muted-foreground mt-1">{w.form_topic_help}</p>
          </div>

          <label className="typo-label text-muted-foreground pt-2">{w.form_origin}</label>
          <ThemedSelect
            filterable
            options={[
              { value: '', label: w.form_origin_none },
              ...memberProjects.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={origin}
            onValueChange={setOrigin}
            placeholder={w.form_origin_none}
          />

          <label className="typo-label text-muted-foreground pt-2">{w.form_detail}</label>
          <textarea
            className={`${INPUT_FIELD} min-h-24 resize-y font-mono text-xs`}
            placeholder={w.form_detail_ph}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <AsyncButton onClick={submit} disabled={!canSave}>
            {w.save_practice}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
