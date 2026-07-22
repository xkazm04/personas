/**
 * Vault domain store -- credentials, databases, automations, and rotation.
 */
import { create } from "zustand";
import { createCoreState, type VaultStore } from "./storeTypes";

import { createCredentialSlice } from "./slices/vault/credentialSlice";
import { createDatabaseSlice } from "./slices/vault/databaseSlice";
import { createAutomationSlice } from "./slices/vault/automationSlice";
import { createRotationSlice } from "./slices/vault/rotationSlice";
import { createCatalogPrefsSlice } from "./slices/vault/catalogPrefsSlice";

export const useVaultStore = create<VaultStore>()((...a) => ({
  ...createCoreState(),
  ...createCredentialSlice(...a),
  ...createDatabaseSlice(...a),
  ...createAutomationSlice(...a),
  ...createRotationSlice(...a),
  ...createCatalogPrefsSlice(...a),
}));
