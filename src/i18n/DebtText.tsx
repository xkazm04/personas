import { useTranslation, getActiveTranslations } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

type DebtBundle = Translations extends { debt: infer Debt } ? Debt : Record<string, string>;
export type DebtTextKey = Extract<keyof DebtBundle, string>;

function readDebtValue(bundle: Translations, key: string): string {
  const debt = (bundle as unknown as { debt?: Record<string, string> }).debt;
  return debt?.[key] ?? key;
}

export function debtText(key: DebtTextKey): string {
  return readDebtValue(getActiveTranslations(), key);
}

export function DebtText({ k }: { k: DebtTextKey }) {
  const { t } = useTranslation();
  return <>{readDebtValue(t, k)}</>;
}
