import { useState, useEffect } from 'react';
import { getTemplatePerformance } from '@/api/templates/templateFeedback';
import type { TemplatePerformance } from '@/lib/bindings/TemplatePerformance';

interface UseTemplatePerformanceResult {
  performance: TemplatePerformance | null;
  loading: boolean;
  error: string | null;
}

export function useTemplatePerformance(reviewId: string | null): UseTemplatePerformanceResult {
  const [performance, setPerformance] = useState<TemplatePerformance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reviewId) {
      setPerformance(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getTemplatePerformance(reviewId)
      .then((data) => {
        if (!cancelled) {
          setPerformance(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPerformance(null);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [reviewId]);

  return { performance, loading, error };
}
