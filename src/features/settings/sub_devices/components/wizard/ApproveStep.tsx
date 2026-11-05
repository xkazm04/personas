/**
 * Approve (another PC asked): the operator TYPES the code that PC shows.
 *
 * This step never renders the request's `fingerprint`: typing it is the whole
 * check, and a code shown here could just be read back. Its digit COUNT is the
 * one thing taken from it, so the form knows when a code is complete without
 * a client copy of the backend's format.
 *
 * Pair arms after a short beat ("Read the request first"), so a request that
 * pops up mid-typing elsewhere cannot be approved by a stray Enter.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { FormField } from '@/features/shared/components/forms/FormField';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevicePairingRequest } from '@/api/network/devices';

/** How long Pair stays disarmed after a request appears. */
export const APPROVE_ARM_MS = 1500;

const digitsOf = (raw: string) => raw.replace(/\D/g, '');

interface ApproveStepProps {
  request: DevicePairingRequest;
  busy: boolean;
  /** Tries left after the last wrong code, or null when none was wrong yet. */
  attemptsLeft: number | null;
  onSubmit: (code: string) => void;
  onDecline: () => void;
}

export function ApproveStep({ request, busy, attemptsLeft, onSubmit, onDecline }: ApproveStepProps) {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const device = request.displayName;
  const expected = digitsOf(request.fingerprint).length;
  const [code, setCode] = useState('');
  const [armed, setArmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setArmed(false);
    setCode('');
    const timer = setTimeout(() => setArmed(true), APPROVE_ARM_MS);
    // The modal focuses its first control on the next frame; take focus after it.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => inputRef.current?.focus()));
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [request.peerId]);

  // A wrong code clears the field, so the next try starts clean.
  useEffect(() => {
    if (attemptsLeft !== null) setCode('');
  }, [attemptsLeft]);

  const digits = digitsOf(code);
  const canSubmit = armed && !busy && digits.length === expected;
  const error =
    attemptsLeft === null
      ? undefined
      : attemptsLeft === 1
        ? st.wizard_approve_mismatch_one
        : tx(st.wizard_approve_mismatch, { count: attemptsLeft });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit(digits);
  };

  return (
    <form
      data-testid="incoming-pairings"
      onSubmit={submit}
      className="space-y-4"
      noValidate
    >
      <div data-testid={`incoming-pairing-${request.peerId}`} className="space-y-1">
        <h3 className="typo-heading text-foreground">{tx(st.wizard_approve_title, { device })}</h3>
        <p className="typo-body text-foreground">{tx(st.wizard_approve_body, { device })}</p>
      </div>

      <FormField
        label={tx(st.wizard_approve_input_label, { device })}
        hint={st.wizard_approve_input_hint}
        error={error}
        validateOn="change"
        forceValidation
      >
        {(inputProps) => (
          <input
            {...inputProps}
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={expected + 4}
            className={`${INPUT_FIELD} font-mono typo-heading text-center`}
            data-testid="pairing-code-input"
          />
        )}
      </FormField>

      <p className="typo-caption text-foreground">{st.wizard_approve_next}</p>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          data-testid={`incoming-decline-${request.peerId}`}
          onClick={onDecline}
        >
          {st.incoming_decline}
        </Button>
        <Button
          type="submit"
          loading={busy}
          disabled={!canSubmit}
          data-testid={`incoming-confirm-${request.peerId}`}
        >
          {armed ? st.wizard_approve_pair : st.wizard_approve_arming}
        </Button>
      </div>
    </form>
  );
}
