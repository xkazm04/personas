import { ExternalLink } from 'lucide-react';
import { COPILOT_GITHUB_TOKEN_SETTING } from './CopilotPresets';
import { ProviderCredentialField } from './ProviderCredentialField';

export function CopilotTokenField() {
  return (
    <ProviderCredentialField
      label="GitHub Token"
      sublabel="(global, shared across all personas)"
      field1={{ settingKey: COPILOT_GITHUB_TOKEN_SETTING, placeholder: 'ghp_... or paste a GitHub token', type: 'password' }}
      saveLabel="Save Token"
      description={
        <>
          Generate a token at{' '}
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary/60 hover:text-primary inline-flex items-center gap-0.5"
          >
            github.com/settings/tokens <ExternalLink className="w-2.5 h-2.5" />
          </a>
          {' '}with Copilot access.
        </>
      }
    />
  );
}
