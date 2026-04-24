import * as Sentry from '@sentry/react';
import { log } from '@/lib/log';
import { errMsg } from '@/stores/storeTypes';
import { useToastStore } from '@/stores/toastStore';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { Translations } from '@/i18n/en';

export type SavedViewOp = 'load' | 'save' | 'delete';

interface SavedViewContext {
  viewId?: string;
  viewName?: string;
}

const OP_FALLBACK: Record<SavedViewOp, string> = {
  load: 'Failed to load saved views',
  save: 'Failed to save view',
  delete: 'Failed to delete view',
};

export function reportSavedViewError(
  t: Translations,
  op: SavedViewOp,
  err: unknown,
  ctx: SavedViewContext = {},
): void {
  const cause = errMsg(err, OP_FALLBACK[op]);
  const breadcrumbData: Record<string, unknown> = { op, cause };
  if (ctx.viewId) breadcrumbData.viewId = ctx.viewId;
  if (ctx.viewName) breadcrumbData.viewName = ctx.viewName;

  log.error('SavedViews', `${op} failed`, breadcrumbData);

  Sentry.addBreadcrumb({
    category: 'saved_views',
    message: `saved_views.${op} failed`,
    level: 'error',
    data: breadcrumbData,
  });

  const { message } = resolveErrorTranslated(t, cause);
  const errors = t.overview.saved_views.errors;
  const userCopy =
    op === 'load' ? errors.load_failed_message
    : op === 'save' ? errors.save_failed_message
    : errors.delete_failed_message;
  useToastStore.getState().addToast(`${userCopy} ${message}`.trim(), 'error', 5000);
}
