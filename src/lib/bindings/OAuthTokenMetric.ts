export type OAuthTokenMetric = {
  id: string;
  credentialId: string;
  serviceType: string;
  predictedLifetimeSecs: number | null;
  actualLifetimeSecs: number | null;
  driftSecs: number | null;
  usedFallback: boolean;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
};
