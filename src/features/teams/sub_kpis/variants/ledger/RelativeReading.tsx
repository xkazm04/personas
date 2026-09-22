// When this place was last read.
//
// A thin wrapper over the shared `RelativeTime` for one reason: in the books,
// "never" is not a missing value to fall back on, it is the most important
// entry on the line. A place that has never been read owes its whole claim.
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

export function RelativeReading({ at }: { at: number | null }) {
  const { t } = useTranslation();
  if (at == null) {
    return <span className="text-foreground">{t.kpis.overview.read_never}</span>;
  }
  return <RelativeTime timestamp={at} format="elapsed" />;
}
