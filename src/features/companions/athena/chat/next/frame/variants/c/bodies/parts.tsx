/**
 * Small pieces the three card-native bodies share: key caps, the choice
 * button (the shared `Button`, so an in-flight verb gets the real spinner),
 * error / warning lines, the answer / note field, the deferral links.
 *
 * TODO(prototype, 2026-09-24): consolidate the Athena chat switcher.
 */

import type { CSSProperties, ReactNode } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { HOVER_GLOW, mix } from '../cardArt';
import type { CardChoice, CardField, CardModel } from './model';

export function KeyCap({ children, color, size = 'md' }: { children: ReactNode; color: string; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'w-10 h-10 typo-data-lg' : 'w-6 h-6 typo-data';
  return (
    <span
      className={`inline-grid place-items-center shrink-0 rounded-interactive border text-foreground ${box}`}
      style={{ borderColor: mix(color, 60), background: mix(color, 18, 'var(--background)') }}
      aria-hidden
    >
      {children}
    </span>
  );
}

/** A choice as the shared Button: real spinner while its verb is in flight. */
export function ChoiceButton({
  choice,
  className,
  style,
  children,
  block = false,
  size = 'lg',
}: {
  choice: CardChoice;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  block?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const btn = (
    <Button
      variant="ghost"
      size={size}
      block={block}
      loading={choice.busy}
      onClick={choice.run}
      data-testid={choice.testId}
      data-card-choice=""
      className={`ease-linear hover:brightness-125 focus-visible:brightness-125 ${className ?? ''}`}
      style={style}
    >
      {children}
    </Button>
  );
  return choice.hint ? (
    <Tooltip content={choice.hint} placement="top" triggerClassName={block ? 'flex w-full' : 'inline-flex'}>
      {btn}
    </Tooltip>
  ) : (
    btn
  );
}

/** Stroke colour of a choice by tone. */
export function toneColor(choice: CardChoice, kindColor: string): string {
  if (choice.tone === 'danger') return 'var(--status-error)';
  if (choice.tone === 'neutral') return 'var(--foreground)';
  return kindColor;
}

export function Problems({ model }: { model: CardModel }) {
  return (
    <>
      {model.error && (
        <p role="alert" className="rounded-input border border-status-error/30 bg-status-error/10 px-3 py-2 typo-body text-status-error">
          {model.error}
        </p>
      )}
      {model.warning && (
        <p role="alert" className="rounded-input border border-status-warning/30 bg-status-warning/10 px-3 py-2 typo-body text-foreground">
          {model.warning}
        </p>
      )}
    </>
  );
}

export function FieldInput({ field, className = '' }: { field: CardField; className?: string }) {
  const common = `w-full rounded-input border border-foreground/15 bg-background/70 px-3 py-2 typo-body text-foreground focus-ring disabled:is-disabled ${className}`;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="typo-label uppercase tracking-wider text-foreground/85">{field.label}</span>
      {field.multiline ? (
        <textarea
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends a typed answer, Shift+Enter breaks the line.
            if (e.key === 'Enter' && !e.shiftKey && field.submit?.enabled) {
              e.preventDefault();
              void field.submit.run();
            }
          }}
          placeholder={field.placeholder}
          rows={3}
          disabled={field.disabled}
          className={`${common} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={field.disabled}
          className={common}
        />
      )}
    </label>
  );
}

export function FieldSubmit({ field }: { field: CardField }) {
  if (!field.submit) return null;
  return (
    <Button
      variant="primary"
      size="md"
      loading={field.submit.busy}
      disabled={!field.submit.enabled}
      onClick={field.submit.run}
    >
      {field.submit.label}
    </Button>
  );
}

/** Machine detail (params JSON) behind a native disclosure. */
export function DetailsReveal({ details }: { details: NonNullable<CardModel['details']> }) {
  return (
    <details className="group">
      <summary className={`cursor-pointer select-none typo-body text-foreground/85 rounded-interactive focus-ring ${HOVER_GLOW}`}>{details.label}</summary>
      <pre className="mt-2 max-h-48 overflow-auto scrollbar-thin rounded-input bg-secondary/40 px-3 py-2 typo-data font-mono text-foreground whitespace-pre-wrap break-words">
        {details.code}
      </pre>
    </details>
  );
}
