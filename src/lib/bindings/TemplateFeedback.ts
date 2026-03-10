export interface TemplateFeedback {
  id: string;
  review_id: string;
  persona_id: string;
  execution_id: string | null;
  rating: string;
  labels: string;
  comment: string | null;
  source: string;
  created_at: string;
}
