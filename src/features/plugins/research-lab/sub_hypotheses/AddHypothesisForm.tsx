import { useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ResearchLabFormModal } from '../_shared/ResearchLabFormModal';
import { TextAreaField } from '../_shared/FormField';

interface Props {
  projectId: string;
  onClose: () => void;
}

export default function AddHypothesisForm({ projectId, onClose }: Props) {
  const { t } = useTranslation();
  const createHypothesis = useSystemStore((s) => s.createResearchHypothesis);

  const [statement, setStatement] = useState('');
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statement.trim()) return;
    setSaving(true);
    try {
      await createHypothesis({
        projectId,
        statement: statement.trim(),
        rationale: rationale.trim() || undefined,
      });
      onClose();
    } catch (err) {
      toastCatch("AddHypothesisForm:create")(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResearchLabFormModal
      title={t.research_lab.add_hypothesis}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={t.common.save}
      submitDisabled={!statement.trim()}
      saving={saving}
    >
      <TextAreaField
        label={t.research_lab.hypothesis_statement}
        value={statement}
        onChange={setStatement}
        placeholder={t.research_lab.hypothesis_statement_placeholder}
        rows={3}
      />
      <TextAreaField
        label={t.research_lab.hypothesis_rationale}
        value={rationale}
        onChange={setRationale}
        placeholder={t.research_lab.hypothesis_rationale_placeholder}
        rows={3}
      />
    </ResearchLabFormModal>
  );
}
