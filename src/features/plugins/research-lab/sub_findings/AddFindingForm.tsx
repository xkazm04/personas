import { useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ResearchLabFormModal } from '../_shared/ResearchLabFormModal';
import { TextField, TextAreaField } from '../_shared/FormField';

interface Props {
  projectId: string;
  onClose: () => void;
}

export default function AddFindingForm({ projectId, onClose }: Props) {
  const { t } = useTranslation();
  const createFinding = useSystemStore((s) => s.createResearchFinding);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createFinding({
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
      });
      onClose();
    } catch (err) {
      toastCatch("AddFindingForm:create")(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResearchLabFormModal
      title={t.research_lab.create_finding}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={t.common.save}
      submitDisabled={!title.trim()}
      saving={saving}
    >
      <TextField
        label={t.research_lab.finding_title}
        value={title}
        onChange={setTitle}
        placeholder={t.research_lab.finding_title_placeholder}
        autoFocus
      />
      <TextAreaField
        label={t.research_lab.finding_description}
        value={description}
        onChange={setDescription}
        placeholder={t.research_lab.finding_description_placeholder}
        rows={4}
      />
      <TextField
        label={t.research_lab.finding_category}
        value={category}
        onChange={setCategory}
        placeholder={t.research_lab.finding_category_placeholder}
      />
    </ResearchLabFormModal>
  );
}
