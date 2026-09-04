import { useEffect, useState } from 'react';
import { PenLine } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { ManifestSection } from './manifestDocument';

interface ManifestLawSectionProps {
  section: ManifestSection;
  onSave: (section: string, content: string) => Promise<void>;
}

/** A slug safe for a testid, derived from the heading (`Operation defaults`
 *  -> `operation-defaults`) so a test can name the section it means. */
export function headingSlug(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * One LAW section of the manifest — the operator's own word, and the only
 * half of the document a human writes directly. Reads as the document until
 * it is being edited; the save replaces this section's body wholesale through
 * `update_persona_manifest_law` and leaves every other line untouched.
 */
export function ManifestLawSection({ section, onSave }: ManifestLawSectionProps) {
  const { t } = useTranslation();
  const m = t.agents.manifest;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.body);
  const slug = headingSlug(section.heading);

  // A refresh after someone else's write must not silently overwrite an edit
  // in flight, so the draft re-seeds only while the editor is closed.
  useEffect(() => {
    if (!editing) setDraft(section.body);
  }, [section.body, editing]);

  const save = async () => {
    try {
      await onSave(section.heading, draft);
      setEditing(false);
    } catch (err) {
      toastCatch('manifest:saveLaw', m.save_failed)(err);
    }
  };

  return (
    <section className="space-y-2" data-testid={`manifest-section-${slug}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="typo-section-title text-foreground">{section.heading}</h3>
        {!editing && (
          <Button
            size="sm"
            variant="ghost"
            icon={<PenLine className="w-3 h-3" />}
            onClick={() => setEditing(true)}
            data-testid={`manifest-edit-${slug}`}
          >
            {t.common.edit}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(24, Math.max(6, draft.split('\n').length + 2))}
            placeholder={m.law_placeholder}
            aria-label={section.heading}
            className={`${INPUT_FIELD} typo-code resize-y`}
            data-testid={`manifest-editor-${slug}`}
          />
          <p className="typo-caption text-foreground/85">{m.law_no_headings}</p>
          <div className="flex items-center gap-2">
            <AsyncButton
              size="sm"
              variant="primary"
              onClick={save}
              data-testid={`manifest-save-${slug}`}
            >
              {t.common.save}
            </AsyncButton>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(section.body);
                setEditing(false);
              }}
              data-testid={`manifest-cancel-${slug}`}
            >
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : section.body ? (
        <MarkdownRenderer content={section.body} />
      ) : (
        <p className="typo-caption text-foreground/85">{m.law_empty}</p>
      )}
    </section>
  );
}
