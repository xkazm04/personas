/**
 * CredentialRecipe -- TypeScript binding matching the Rust model.
 * Auto-generated shape; manually maintained for immediate use.
 */
export interface CredentialRecipe {
  id: string;
  connector_name: string;
  connector_label: string;
  category: string;
  color: string;
  oauth_type: string | null;
  fields_json: string;
  healthcheck_json: string | null;
  setup_instructions: string | null;
  summary: string | null;
  docs_url: string | null;
  source: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}
