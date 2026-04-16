import { useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ResearchLabFormModal } from '../_shared/ResearchLabFormModal';
import { TextField, TextAreaField, SelectField } from '../_shared/FormField';
import { SOURCE_TYPES, sourceTypeLabel, type SourceType } from '../_shared/tokens';

interface Props {
  projectId: string;
  onClose: () => void;
}

export default function AddSourceForm({ projectId, onClose }: Props) {
  const { t } = useTranslation();
  const createSource = useSystemStore((s) => s.createResearchSource);

  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('web');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [abstractText, setAbstractText] = useState('');
  const [url, setUrl] = useState('');
  const [doi, setDoi] = useState('');
  const [saving, setSaving] = useState(false);

  const typeOptions = SOURCE_TYPES.map((st) => ({ value: st, label: sourceTypeLabel(t, st) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createSource({
        projectId,
        sourceType,
        title: title.trim(),
        authors: authors.trim() || undefined,
        year: year ? parseInt(year, 10) : undefined,
        abstractText: abstractText.trim() || undefined,
        url: url.trim() || undefined,
        doi: doi.trim() || undefined,
      });
      onClose();
    } catch (err) {
      toastCatch("AddSourceForm:create")(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResearchLabFormModal
      title={t.research_lab.search_sources}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={t.common.save}
      submitDisabled={!title.trim()}
      saving={saving}
    >
      <TextField
        label={t.research_lab.source_title}
        value={title}
        onChange={setTitle}
        placeholder={t.research_lab.source_title_placeholder}
        autoFocus
      />

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label={t.research_lab.source_type}
          value={sourceType}
          onChange={setSourceType}
          options={typeOptions}
        />
        <TextField
          label={t.research_lab.source_year}
          value={year}
          onChange={setYear}
          placeholder={t.research_lab.source_year_placeholder}
          type="number"
        />
      </div>

      <TextField
        label={t.research_lab.source_authors}
        value={authors}
        onChange={setAuthors}
        placeholder={t.research_lab.source_authors_placeholder}
      />

      <TextField
        label={t.research_lab.source_url}
        value={url}
        onChange={setUrl}
        placeholder={t.research_lab.source_url_placeholder}
        type="url"
      />

      <TextField
        label={t.research_lab.source_doi}
        value={doi}
        onChange={setDoi}
        placeholder={t.research_lab.source_doi_placeholder}
      />

      <TextAreaField
        label={t.research_lab.source_abstract}
        value={abstractText}
        onChange={setAbstractText}
        placeholder={t.research_lab.source_abstract_placeholder}
        rows={4}
      />
    </ResearchLabFormModal>
  );
}
