/**
 * The six-digit code (`NNN-NNN`) both devices derive independently. The whole
 * security value of the ceremony is a human comparing these two strings, so it
 * is rendered large, monospaced and wide-tracked — never truncated, never
 * shrunk to fit.
 */
interface FingerprintCodeProps {
  fingerprint: string;
  'data-testid'?: string;
}

export function FingerprintCode({ fingerprint, 'data-testid': testId }: FingerprintCodeProps) {
  return (
    <span
      data-testid={testId ?? 'pairing-fingerprint'}
      className="typo-heading-lg font-mono tracking-[0.35em] text-foreground select-all"
    >
      {fingerprint}
    </span>
  );
}
