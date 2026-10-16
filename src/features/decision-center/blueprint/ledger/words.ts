// Words the ledger reads by a store value (a release status, a compare mode), resolved from the sheet's language.
import type { ReleaseStatus } from '@/lib/lensScan/wire';
import type { BpText } from '../controller/useBlueprintText';

export const releaseWord = (B: BpText, s: ReleaseStatus): string => B[`lg_rs_${s === 'pr-open' ? 'pr_open' : s}` as const];
