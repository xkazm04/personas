export type OAuthTokenLifetimeSummary = {
  credentialId: string;
  serviceType: string;
  totalRefreshes: number;
  fallbackCount: number;
  failureCount: number;
  avgPredictedLifetimeSecs: number | null;
  avgActualLifetimeSecs: number | null;
  avgDriftSecs: number | null;
  latestPredictedLifetimeSecs: number | null;
  latestActualLifetimeSecs: number | null;
  lifetimeTrendingShorter: boolean;
  recentPredictedLifetimes: number[];
};
