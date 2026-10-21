import { toastCatch } from '@/lib/silentCatch';

/**
 * Report a failed "Dispatch Fleet" spawn: ONE error toast carrying the
 * localized message. `toastCatch` always toasts, so pairing it with a separate
 * `addToast` showed two errors per failure; its `customMessage` argument is the
 * way to keep the friendly copy while still logging the raw error to Sentry.
 */
export function reportDispatchFailure(err: unknown, message: string): void {
  toastCatch('mastermind dispatch fleet', message)(err);
}
