// reloginActs — the strip's re-login acts, as the seam the real backend and the
// simulation both fill. `AccountRows` and the settings dialog talk to THIS, never
// to a hook or an IPC wrapper, so the simulated strip walks every flow offline.

import type { LoginProfileView } from '@/lib/bindings/LoginProfileView';

/** A vault login the Proton mailbox profile can be bound to. */
export interface VaultLogin {
  id: string;
  name: string;
}

export interface ReloginActs {
  /** The browser profiles the plans can be linked to. */
  profiles: LoginProfileView[];
  relogin: (accountId: string) => Promise<void>;
  /** Open the profile in a visible window, to sign in by hand. */
  openSignIn: (profileKey: string) => Promise<void>;
  saveProfile: (key: string, label: string, vaultCredentialId: string | null) => Promise<void>;
  setProfile: (
    accountId: string, profileKey: string | null, codeInboxProfileKey: string | null, unattended: boolean,
  ) => Promise<void>;
  listVaultLogins: () => Promise<VaultLogin[]>;
}
