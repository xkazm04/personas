export const QUICK_SERVICE_HINTS = [
  'OpenAI API key',
  'GitHub personal access token',
  'Slack bot token',
  'Stripe secret key',
  'Notion integration token',
  'Datadog API key',
];

export function extractFirstUrl(text?: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : null;
}

// ── Healthcheck message translation ─────────────────────────────

export interface TranslatedHealthcheck {
  friendly: string;
  suggestion: string;
  raw: string;
}

/** Extract HTTP status code from raw healthcheck message. */
function extractHttpStatus(raw: string): number | null {
  const match = raw.match(/HTTP (\d{3})/);
  const code = match?.[1];
  return code ? parseInt(code, 10) : null;
}

/** Translate raw backend healthcheck messages into user-friendly guidance. */
export function translateHealthcheckMessage(raw: string): TranslatedHealthcheck {
  const status = extractHttpStatus(raw);

  // Connection / network errors
  if (raw.includes('request failed:')) {
    if (raw.includes('timed out') || raw.includes('timeout')) {
      return {
        friendly: 'Could not reach the service — the request timed out.',
        suggestion: 'Check that the URL is correct and the service is online. Your firewall or proxy may be blocking the connection.',
        raw,
      };
    }
    if (raw.includes('dns') || raw.includes('resolve')) {
      return {
        friendly: 'Could not reach the service — the hostname could not be resolved.',
        suggestion: 'Double-check the service URL for typos. Make sure you have an active internet connection.',
        raw,
      };
    }
    if (raw.includes('connection refused')) {
      return {
        friendly: 'Connection refused by the service.',
        suggestion: 'The service may be down or the URL/port may be incorrect. Verify the endpoint address.',
        raw,
      };
    }
    return {
      friendly: 'Could not reach the service — check the URL.',
      suggestion: 'Verify your internet connection and that the service endpoint is correct.',
      raw,
    };
  }

  // HTTP status codes
  if (status) {
    switch (status) {
      case 401:
        return {
          friendly: 'Your credentials appear to be invalid or expired.',
          suggestion: 'Double-check the API key or token — make sure you copied the full value without extra spaces.',
          raw,
        };
      case 403:
        return {
          friendly: 'Your credentials lack the required permissions.',
          suggestion: 'The key is valid but does not have access to this endpoint. Check your API key\'s scopes or role assignments.',
          raw,
        };
      case 404:
        return {
          friendly: 'The healthcheck endpoint was not found.',
          suggestion: 'This usually means the generated test URL is wrong — not a problem with your credentials. Try saving anyway if you trust the key.',
          raw,
        };
      case 429:
        return {
          friendly: 'Too many requests — the service is rate-limiting you.',
          suggestion: 'Wait a moment and try again. This doesn\'t necessarily mean your credentials are wrong.',
          raw,
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          friendly: 'The service returned a server error.',
          suggestion: 'This is likely a temporary issue on the provider\'s side. Try again in a few minutes.',
          raw,
        };
      default:
        if (status >= 400 && status < 500) {
          return {
            friendly: `The service rejected the request (HTTP ${status}).`,
            suggestion: 'Verify your credentials and ensure the API key has the correct permissions.',
            raw,
          };
        }
    }
  }

  // Skip message
  if (raw.includes('skipped automatic healthcheck')) {
    return {
      friendly: 'Automatic testing was skipped for this service.',
      suggestion: 'You can save the credential and test it manually by running your agent.',
      raw,
    };
  }

  // Local validation message
  if (raw.includes('Run Test Connection')) {
    return {
      friendly: raw,
      suggestion: '',
      raw,
    };
  }

  // Fallback
  return {
    friendly: raw,
    suggestion: '',
    raw,
  };
}
