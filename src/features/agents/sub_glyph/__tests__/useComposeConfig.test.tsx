/**
 * useComposeConfig - the session reset.
 *
 * `resetKey` is the build session identity; when it changes the composer must
 * start from scratch. Every pick is part of that contract, the messaging
 * channels included: a channel picked for one build must not ride into the
 * next one while every other pick clears.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/features/agents/shared/quickConfig/useHealthyConnectors", () => ({
  useHealthyConnectors: () => [],
}));

import { useComposeConfig } from "../useComposeConfig";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";

const SLACK: ChannelSpecV2 = {
  type: "slack",
  enabled: true,
  credential_id: "cred-slack",
  use_case_ids: "*",
  event_filter: null,
  config: null,
};

function setup(initialNotificationChannels?: ChannelSpecV2[]) {
  return renderHook(
    ({ resetKey }: { resetKey: string | null }) =>
      useComposeConfig({
        intentText: "",
        onIntentChange: () => {},
        onLaunch: () => {},
        initialNotificationChannels,
        resetKey,
      }),
    { initialProps: { resetKey: null as string | null } },
  );
}

type Result = { current: ReturnType<typeof useComposeConfig> };
/** Every item carries the same quick-setup controller. */
const quick = (r: Result) => r.current.items[0]!.quick!;
const channelTypes = (r: Result) => quick(r).config.notificationChannels.map((c) => c.type);

describe("useComposeConfig reset", () => {
  it("clears a picked channel when the session changes, like every other pick", () => {
    const { result, rerender } = setup();
    act(() => {
      quick(result).toggleChannel(SLACK);
      quick(result).toggleConnector("gmail");
    });
    expect(channelTypes(result)).toEqual(["built-in", "slack"]);

    rerender({ resetKey: "session-1" });

    expect(quick(result).config.selectedConnectors).toEqual([]);
    expect(channelTypes(result)).toEqual(["built-in"]);
  });

  it("resets channels back to the caller's initial channels, inbox pinned", () => {
    const { result, rerender } = setup([SLACK]);
    expect(channelTypes(result)).toEqual(["built-in", "slack"]);
    act(() => quick(result).toggleChannel(SLACK));
    expect(channelTypes(result)).toEqual(["built-in"]);

    rerender({ resetKey: "session-1" });

    expect(channelTypes(result)).toEqual(["built-in", "slack"]);
  });
});
