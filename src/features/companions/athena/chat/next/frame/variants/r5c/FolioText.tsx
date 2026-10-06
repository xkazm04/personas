/**
 * Folio · a question set as text. The question is the page's heading (its
 * first sentence; the rest is italic context), the choices are numbered
 * paragraphs you press or type (1-9), and Athena's recommendation is a NOTE IN
 * THE OUTER MARGIN joined by a bracket to the paragraph she picked, which
 * takes a highlighter stroke. Until you ask (0), the margin holds the
 * invitation instead. Enter takes her pick. All verbs are the CardModel's.
 */

import { useEffect, type ReactNode } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { useAnnounce } from '@/features/shared/components/feedback/AriaLiveProvider';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { WorkItem } from '../../../useWorkforce';
import type { CardModel } from '../c/bodies/model';
import { FOLIO_COPY as C } from './copy';
import { Key, OwlMark } from './parts';
import { useChoiceKeys } from './useChoiceKeys';

/** The first sentence leads; a long prompt's remainder becomes context. */
function splitPrompt(raw: string): { lead: string; rest: string } {
  const text = raw.trim();
  if (text.length <= 140) return { lead: text, rest: '' };
  const end = text.search(/[.?!](?=\s)/);
  if (end < 0 || end > 180) return { lead: text, rest: '' };
  return { lead: text.slice(0, end + 1), rest: text.slice(end + 1).trim() };
}

/** `**bold**` and `` `code` `` as marks, never as literal characters. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="typo-code">{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    });
}

/** The page's running head: its footnote mark, who asks, the project. */
export function Eyebrow({ mark, text, project }: { mark: string; text: string; project: string | null }) {
  return (
    <p className="r5c-page-eyebrow">
      <span className="typo-section-title r5c-page-mark" aria-hidden>
        {mark}
      </span>
      <span className="r5c-sc typo-label r5c-asker">{text}</span>
      {project && <span className="r5c-sc typo-label r5c-page-project">{project}</span>}
    </p>
  );
}

function HerNote({ text, label }: { text: string; label: string }) {
  return (
    <aside className="r5c-note" data-testid="companion-r5c-her-note">
      <span className="r5c-note-brace" aria-hidden />
      <span className="r5c-sc typo-label text-primary">{label}</span>
      <span className="typo-body italic text-foreground">{text}</span>
    </aside>
  );
}

export function FolioText({ model, item, mark }: { model: CardModel; item: WorkItem; mark: string }) {
  useChoiceKeys(model);
  const announce = useAnnounce();
  const rec = model.recommendation;
  const noted = !!(rec?.revealed && rec.text);
  const pickAt = model.choices.findIndex((c) => c.recommended);
  const { lead, rest } = splitPrompt(model.question);
  const spoken = noted ? (rec?.text ?? '') : (rec?.composing ?? '');
  useEffect(() => {
    if (spoken) announce(spoken);
  }, [spoken, announce]);

  // The question's own margin: her note when it joins no paragraph, the pen
  // while she writes it, else the invitation to ask (0).
  let margin: ReactNode = null;
  if (noted && pickAt < 0) margin = <HerNote text={rec!.text!} label={rec!.label} />;
  else if (!noted && rec?.composing) {
    margin = (
      <aside className="r5c-note">
        <span className="typo-body italic">{C.composing}…</span>
      </aside>
    );
  } else if (rec && !rec.revealed && rec.reveal) {
    margin = (
      <aside className="r5c-note">
        <Button variant="ghost" size="sm" className="r5c-ask" onClick={rec.reveal} aria-keyshortcuts="0" data-testid="companion-r5c-ask">
          <OwlMark size={18} />
          <span className="typo-body italic">{C.askForNote}</span>
          <Key>0</Key>
        </Button>
      </aside>
    );
  }

  return (
    <article className="r5c-text">
      <Eyebrow mark={mark} text={model.eyebrow} project={item.project} />
      <div className="r5c-text-row">
        <div className="min-w-0">
          <h2 className="typo-heading-lg text-foreground r5c-question">{inline(lead)}</h2>
          {rest && <p className="typo-body-lg italic text-foreground r5c-context">{inline(rest)}</p>}
          {model.context && <p className="typo-body italic text-foreground r5c-context">{inline(model.context)}</p>}
        </div>
        {margin}
      </div>

      {model.choices.length > 0 && (
        <ol className="r5c-paras">
          {model.choices.map((c, i) => (
            <li key={c.key} className={`r5c-text-row r5c-para${c.recommended && noted ? ' picked' : ''}${c.tone === 'danger' ? ' danger' : ''}`}>
              <Button
                variant="ghost"
                size="md"
                className="r5c-para-btn"
                loading={c.busy}
                disabled={model.busy}
                onClick={c.run}
                data-card-choice=""
                data-testid={c.testId}
                aria-keyshortcuts={String(i + 1)}
              >
                <span className="typo-data r5c-para-n">{i + 1}.</span>
                <span className="r5c-para-text">
                  <span className="typo-body-lg text-foreground r5c-para-verb">{inline(c.label)}</span>
                  {c.hint && <span className="typo-body italic r5c-para-hint">{c.hint}</span>}
                </span>
              </Button>
              {c.recommended && noted && <HerNote text={rec!.text!} label={rec!.label} />}
            </li>
          ))}
        </ol>
      )}

      {model.field && (
        <label className="r5c-field">
          <span className="r5c-sc typo-label">{model.field.label}</span>
          <textarea
            className={`${INPUT_FIELD} typo-body`}
            rows={model.field.multiline ? 3 : 1}
            value={model.field.value}
            placeholder={model.field.placeholder}
            disabled={model.field.disabled}
            onChange={(e) => model.field!.onChange(e.target.value)}
          />
          {model.field.submit && (
            <Button variant="primary" size="sm" loading={model.field.submit.busy} disabled={!model.field.submit.enabled} onClick={model.field.submit.run}>
              {model.field.submit.label}
            </Button>
          )}
        </label>
      )}

      {rec?.failed && <p className="typo-body text-status-warning">{rec.failed}</p>}
      {model.error && <p className="typo-body text-status-error" role="alert">{model.error}</p>}
      {model.warning && <p className="typo-body text-status-warning" role="alert">{model.warning}</p>}

      {(model.deferrals.length > 0 || model.details) && (
        <div className="r5c-text-foot">
          {model.deferrals.map((d) => (
            <Button key={d.key} variant="link" size="sm" onClick={d.run}>
              <span className="typo-caption">{d.label}</span>
            </Button>
          ))}
          {model.details && (
            <details className="r5c-details">
              <summary className="typo-caption">{model.details.label}</summary>
              <pre className="typo-code">{model.details.code}</pre>
            </details>
          )}
        </div>
      )}
    </article>
  );
}
