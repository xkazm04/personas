import { useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ResearchLabFormModal } from '../_shared/ResearchLabFormModal';
import { TextField, TextAreaField, SelectField } from '../_shared/FormField';

interface Props {
  projectId: string;
  onClose: () => void;
}

export default function AddExperimentForm({ projectId, onClose }: Props) {
  const { t } = useTranslation();
  const createExperiment = useSystemStore((s) => s.createResearchExperiment);
  const hypotheses = useSystemStore((s) => s.researchHypotheses);

  const projectHypotheses = hypotheses.filter((h) => h.projectId === projectId);

  const [name, setName] = useState('');
  const [methodology, setMethodology] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [hypothesisId, setHypothesisId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const hypothesisOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: t.research_lab.no_linked_hypothesis },
    ...projectHypotheses.map((h) => ({
      value: h.id,
      label: h.statement.length > 60 ? `${h.statement.slice(0, 60)}…` : h.statement,
    })),
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createExperiment({
        projectId,
        name: name.trim(),
        methodology: methodology.trim() || undefined,
        successCriteria: successCriteria.trim() || undefined,
        hypothesisId: hypothesisId || undefined,
      });
      onClose();
    } catch (err) {
      toastCatch("AddExperimentForm:create")(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResearchLabFormModal
      title={t.research_lab.create_experiment}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={t.common.save}
      submitDisabled={!name.trim()}
      saving={saving}
    >
      <TextField
        label={t.research_lab.experiment_name}
        value={name}
        onChange={setName}
        placeholder={t.research_lab.experiment_name_placeholder}
        autoFocus
      />

      {projectHypotheses.length > 0 && (
        <SelectField
          label={t.research_lab.linked_hypothesis}
          value={hypothesisId}
          onChange={setHypothesisId}
          options={hypothesisOptions}
        />
      )}

      <TextAreaField
        label={t.research_lab.methodology}
        value={methodology}
        onChange={setMethodology}
        placeholder={t.research_lab.methodology_placeholder}
        rows={3}
      />

      <TextAreaField
        label={t.research_lab.success_criteria}
        value={successCriteria}
        onChange={setSuccessCriteria}
        placeholder={t.research_lab.success_criteria_placeholder}
        rows={2}
      />
    </ResearchLabFormModal>
  );
}
