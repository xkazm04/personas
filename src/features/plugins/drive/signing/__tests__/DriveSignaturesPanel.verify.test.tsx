// "Verify now" on a signature history row re-hashes the file the record was
// signed under. Records store the ABSOLUTE path (`sign_document` receives
// root + relative), and the row used to hand it to `verifyDriveFile`, which
// prefixes the managed root again: the backend got `<root>/<root>/a.txt` and
// every row-level verify failed.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { preloadSectionsAsync } from "@/i18n/useTranslation";
import { mockedTauriInvoke, resetInvokeMocks } from "@/test/tauriMock";

import { DriveSignaturesPanel } from "../DriveSignaturesPanel";
import { useSigning } from "../useSigning";

(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

const ROOT = "C:\\Users\\me\\Drive";
const SIGNED_ABS = "C:\\Users\\me\\Drive\\docs\\a.txt";

const signature = {
  id: "sig-1",
  file_name: "a.txt",
  file_path: SIGNED_ABS,
  file_hash: "abc",
  signature_b64: "sig",
  signer_peer_id: "peer",
  signer_public_key_b64: "pk",
  signer_display_name: "Me",
  metadata: null,
  signed_at: "2026-10-01T10:00:00Z",
  created_at: "2026-10-01T10:00:00Z",
};

function Harness() {
  const signing = useSigning();
  return <DriveSignaturesPanel signing={signing} onClose={() => {}} />;
}

describe("DriveSignaturesPanel row verify", () => {
  beforeAll(async () => {
    await preloadSectionsAsync("en", ["plugins"]);
  });

  let verifiedPaths: string[];
  beforeEach(() => {
    resetInvokeMocks();
    verifiedPaths = [];
    mockedTauriInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      switch (cmd) {
        case "drive_get_root":
          return ROOT;
        case "generate_signing_key":
          return { peer_id: "peer", display_name: "Me", status: "ok" };
        case "list_document_signatures":
          return [signature];
        case "export_signature_sidecar":
          return "{}";
        case "verify_document": {
          const input = (args as { input: { file_path: string } }).input;
          verifiedPaths.push(input.file_path);
          return { valid: true, file_hash_match: true, signature_valid: true };
        }
        default:
          return undefined;
      }
    });
  });

  it("verifies the file at the absolute path it was signed under", async () => {
    render(<Harness />);
    const verify = await screen.findByRole("button", { name: /verify/i });
    fireEvent.click(verify);
    await waitFor(() => expect(verifiedPaths).toHaveLength(1));
    expect(verifiedPaths[0]).toBe(SIGNED_ABS);
  });
});
