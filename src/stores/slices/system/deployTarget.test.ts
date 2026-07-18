import { describe, it, expect, vi } from "vitest";

// Mock the active-translation accessor so we can flip the "active locale" at
// will and prove that deploy error messages are resolved at CALL time (not
// frozen at module import). Each call returns whatever `deploy_errors` bundle
// the mock is currently configured with.
let activeDeployErrors: Record<string, string> = {};
vi.mock("@/i18n/useTranslation", () => ({
  getActiveTranslations: () => ({ deploy_errors: activeDeployErrors }),
}));

import { translateCloudError, translateGitLabError } from "./deployTarget";

describe("deployTarget — locale-reactive error resolution", () => {
  it("resolves a shared error message from the ACTIVE bundle, following a locale switch", () => {
    // Locale A (e.g. English)
    activeDeployErrors = { not_reachable: "Could not reach the server." };
    const enMsg = translateCloudError("Cloud error: connection refused by host");
    expect(enMsg).toBe("Could not reach the server.");

    // Locale B (e.g. French) — same error, different active bundle
    activeDeployErrors = { not_reachable: "Serveur injoignable." };
    const frMsg = translateCloudError("Cloud error: connection refused by host");
    expect(frMsg).toBe("Serveur injoignable.");

    // The two locales must yield two different strings for the same raw error;
    // a frozen module-scope snapshot would return the first string both times.
    expect(enMsg).not.toBe(frMsg);
  });

  it("resolves a cloud-specific rule from the active bundle at call time", () => {
    activeDeployErrors = { oauth_expired: "OAuth expired (A)" };
    expect(translateCloudError("Cloud error: oauth token expired")).toBe("OAuth expired (A)");

    activeDeployErrors = { oauth_expired: "OAuth expired (B)" };
    expect(translateCloudError("Cloud error: oauth token expired")).toBe("OAuth expired (B)");
  });

  it("resolves a gitlab-specific rule from the active bundle at call time", () => {
    activeDeployErrors = { token_empty: "Enter your token (A)" };
    expect(translateGitLabError("GitLab error: token must not be empty")).toBe("Enter your token (A)");

    activeDeployErrors = { token_empty: "Enter your token (B)" };
    expect(translateGitLabError("GitLab error: token must not be empty")).toBe("Enter your token (B)");
  });

  it("falls back to the prefix-stripped raw error when no rule matches", () => {
    activeDeployErrors = {};
    expect(translateCloudError("Cloud error: something totally novel")).toBe("something totally novel");
  });
});
