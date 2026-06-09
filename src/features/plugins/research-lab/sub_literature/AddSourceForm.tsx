import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, Check } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ResearchLabFormModal } from '../shared/ResearchLabFormModal';
import { TextField, TextAreaField, SelectField } from '../shared/FormField';
import { SOURCE_TYPES, sourceTypeLabel, type SourceType } from '../shared/tokens';
import { lookupCrossref, CrossrefLookupError } from './crossrefClient';

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

  // Crossref lookup — pre-fills the form from a DOI or free-text title. Citation
  // count carries no form field of its own, so we hold it (and the canonical
  // landing URL) in state until submit.
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [citationCount, setCitationCount] = useState<number | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => lookupAbortRef.current?.abort(), []);

  const typeOptions = SOURCE_TYPES.map((st) => ({ value: st, label: sourceTypeLabel(t, st) }));

  const describeLookupError = (err: unknown): string => {
    if (err instanceof CrossrefLookupError && err.kind === 'network') {
      return "Couldn't reach Crossref. Check your connection and try again.";
    }
    return 'The Crossref lookup failed. Try again.';
  };

  const runLookup = async () => {
    const q = lookupQuery.trim();
    if (!q) return;
    lookupAbortRef.current?.abort();
    const ctrl = new AbortController();
    lookupAbortRef.current = ctrl;
    setLookingUp(true);
    setLookupMsg(null);
    try {
      const result = await lookupCrossref({ query: q, signal: ctrl.signal });
      if (!result) {
        setLookupMsg({ kind: 'error', text: 'No Crossref match for that DOI or title.' });
        return;
      }
      // Pre-fill every field we have; leave existing user input intact only for
      // fields Crossref didn't return.
      if (result.title) setTitle(result.title);
      if (result.authors) setAuthors(result.authors);
      if (result.year != null) setYear(String(result.year));
      if (result.abstract) setAbstractText(result.abstract);
      if (result.doi) setDoi(result.doi);
      if (result.url) setUrl(result.url);
      setCitationCount(result.citationCount);
      // A Crossref-sourced paper is a journal/conference work, not a web page.
      setSourceType('manual');
      setLookupMsg({ kind: 'ok', text: 'Pre-filled from Crossref' });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setLookupMsg({ kind: 'error', text: describeLookupError(err) });
    } finally {
      setLookingUp(false);
    }
  };

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
        citationCount: citationCount ?? undefined,
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
      <div className="space-y-1.5">
        {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
        <label className="typo-caption text-foreground">Look up by DOI / title</label>
        <div className="flex items-stretch gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-card bg-secondary/50 border border-border/30 focus-within:border-primary/40">
            <Search className="w-4 h-4 text-foreground" />
            <input
              type="text"
              value={lookupQuery}
              onChange={(e) => setLookupQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runLookup();
                }
              }}
              // eslint-disable-next-line custom/no-hardcoded-jsx-text
              placeholder="10.xxxx/… or a paper title"
              className="flex-1 bg-transparent text-foreground typo-body outline-none placeholder:text-foreground/40"
            />
          </div>
          <button
            type="button"
            onClick={runLookup}
            disabled={lookingUp || !lookupQuery.trim()}
            className="px-4 py-2 rounded-card typo-body bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
            {lookingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Look up
          </button>
        </div>
        {lookupMsg && (
          <p
            className={`typo-caption flex items-center gap-1 ${
              lookupMsg.kind === 'ok' ? 'text-primary' : 'text-status-error'
            }`}
          >
            {lookupMsg.kind === 'ok' && <Check className="w-3 h-3" />}
            {lookupMsg.text}
            {lookupMsg.kind === 'ok' && citationCount != null ? ` · ${citationCount} citations` : ''}
          </p>
        )}
      </div>

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
