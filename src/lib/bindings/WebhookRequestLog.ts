export interface WebhookRequestLog {
  id: string;
  triggerId: string;
  method: string;
  headers: string | null;
  body: string | null;
  statusCode: number;
  responseBody: string | null;
  eventId: string | null;
  errorMessage: string | null;
  receivedAt: string;
}
