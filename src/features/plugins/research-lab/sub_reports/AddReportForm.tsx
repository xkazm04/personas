import { useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ResearchLabFormModal } from '../_shared/ResearchLabFormModal';
import { TextField, SelectField } from '../_shared/FormField';

interface Props {
  projectId: string;
  onClose: () => void;
}

type ReportType = 'literature_review' | 'experiment_report' | 'full_paper' | 'executive_summary';
type ReportFormat = 'markdown' | 'pdf' | 'html';

export default function AddReportForm({ projectId, onClose }: Props) {
  const { t } = useTranslation();
  const createReport = useSystemStore((s) => s.createResearchReport);

  const [title, setTitle] = useState('');
  const [reportType, setReportType] = useState<ReportType>('literature_review');
  const [format, setFormat] = useState<ReportFormat>('markdown');
  const [saving, setSaving] = useState(false);

  const typeOptions: ReadonlyArray<{ value: ReportType; label: string }> = [
    { value: 'literature_review', label: t.research_lab.literature_review },
    { value: 'experiment_report', label: t.research_lab.experiment_report },
    { value: 'full_paper', label: t.research_lab.full_paper },
    { value: 'executive_summary', label: t.research_lab.executive_summary },
  ];

  const formatOptions: ReadonlyArray<{ value: ReportFormat; label: string }> = [
    { value: 'markdown', label: 'Markdown' },
    { value: 'pdf', label: 'PDF' },
    { value: 'html', label: 'HTML' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createReport({
        projectId,
        title: title.trim(),
        reportType,
        format,
      });
      onClose();
    } catch (err) {
      toastCatch("AddReportForm:create")(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResearchLabFormModal
      title={t.research_lab.create_report}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={t.common.save}
      submitDisabled={!title.trim()}
      saving={saving}
    >
      <TextField
        label={t.research_lab.report_title}
        value={title}
        onChange={setTitle}
        placeholder={t.research_lab.report_title_placeholder}
        autoFocus
      />
      <SelectField
        label={t.research_lab.report_type}
        value={reportType}
        onChange={setReportType}
        options={typeOptions}
      />
      <SelectField
        label={t.research_lab.report_format}
        value={format}
        onChange={setFormat}
        options={formatOptions}
      />
    </ResearchLabFormModal>
  );
}
