import { beforeEach, describe, expect, it } from "vitest";
import { replyDeliveryRegistry } from "../../../src/app/managers/reply-delivery-registry.js";
import type { ReplyTargetInfo } from "../../../src/app/managers/reply-delivery-registry.js";

describe("app/managers/reply-delivery-registry", () => {
  beforeEach(() => {
    replyDeliveryRegistry.__resetForTests();
  });

  const baseTarget = (overrides?: Partial<ReplyTargetInfo>): ReplyTargetInfo => ({
    stableSessionId: "stable-1",
    targetSessionId: "session-abc",
    targetDirectory: "/home/user/repo",
    projectWorktree: "/home/user/repo",
    projectName: "my-project",
    chatId: 12345,
    deliveryMode: "stream",
    startedAt: 1000,
    ...overrides,
  });

  it("registers and looks up a reply target", () => {
    replyDeliveryRegistry.register(baseTarget());

    const result = replyDeliveryRegistry.lookup("stable-1");

    expect(result).not.toBeNull();
    expect(result!.stableSessionId).toBe("stable-1");
    expect(result!.targetSessionId).toBe("session-abc");
    expect(result!.chatId).toBe(12345);
    expect(result!.deliveryMode).toBe("stream");
    expect(result!.startedAt).toBe(1000);
  });

  it("returns null when looking up an unknown stable session", () => {
    expect(replyDeliveryRegistry.lookup("nonexistent")).toBeNull();
  });

  it("unregister removes a specific target", () => {
    replyDeliveryRegistry.register(baseTarget());
    replyDeliveryRegistry.register(
      baseTarget({ stableSessionId: "stable-2", targetSessionId: "session-xyz" }),
    );

    replyDeliveryRegistry.unregister("stable-1");

    expect(replyDeliveryRegistry.lookup("stable-1")).toBeNull();
    expect(replyDeliveryRegistry.lookup("stable-2")).not.toBeNull();
    expect(replyDeliveryRegistry.getCount()).toBe(1);
  });

  it("unregister on unknown id is a no-op", () => {
    replyDeliveryRegistry.register(baseTarget());

    replyDeliveryRegistry.unregister("nonexistent");

    expect(replyDeliveryRegistry.getCount()).toBe(1);
  });

  it("cleanup removes a specific target with reason", () => {
    replyDeliveryRegistry.register(baseTarget());

    replyDeliveryRegistry.cleanup("stable-1", "test_cleanup");

    expect(replyDeliveryRegistry.lookup("stable-1")).toBeNull();
    expect(replyDeliveryRegistry.getCount()).toBe(0);
  });

  it("cleanup on unknown id is a no-op", () => {
    replyDeliveryRegistry.register(baseTarget());

    replyDeliveryRegistry.cleanup("nonexistent", "test_reason");

    expect(replyDeliveryRegistry.getCount()).toBe(1);
  });

  it("tracks multiple targets independently", () => {
    replyDeliveryRegistry.register(baseTarget());
    replyDeliveryRegistry.register(
      baseTarget({ stableSessionId: "stable-2", targetSessionId: "session-xyz", chatId: 67890 }),
    );
    replyDeliveryRegistry.register(
      baseTarget({ stableSessionId: "stable-3", targetSessionId: "session-def", deliveryMode: "batch" }),
    );

    expect(replyDeliveryRegistry.getCount()).toBe(3);
    expect(replyDeliveryRegistry.lookup("stable-1")).not.toBeNull();
    expect(replyDeliveryRegistry.lookup("stable-2")).not.toBeNull();
    expect(replyDeliveryRegistry.lookup("stable-3")).not.toBeNull();
  });

  it("getAll returns all registered targets", () => {
    replyDeliveryRegistry.register(baseTarget());
    replyDeliveryRegistry.register(
      baseTarget({ stableSessionId: "stable-2", targetSessionId: "session-xyz" }),
    );

    const all = replyDeliveryRegistry.getAll();

    expect(all).toHaveLength(2);
    expect(all.map((t) => t.stableSessionId).sort()).toEqual(["stable-1", "stable-2"]);
  });

  it("clearAll removes all targets", () => {
    replyDeliveryRegistry.register(baseTarget());
    replyDeliveryRegistry.register(
      baseTarget({ stableSessionId: "stable-2", targetSessionId: "session-xyz" }),
    );
    replyDeliveryRegistry.register(
      baseTarget({ stableSessionId: "stable-3", targetSessionId: "session-def" }),
    );

    replyDeliveryRegistry.clearAll("test_clear");

    expect(replyDeliveryRegistry.getCount()).toBe(0);
    expect(replyDeliveryRegistry.getAll()).toEqual([]);
  });

  it("clearAll on empty registry is a no-op", () => {
    expect(replyDeliveryRegistry.getCount()).toBe(0);
    replyDeliveryRegistry.clearAll("test_clear_empty");
    expect(replyDeliveryRegistry.getCount()).toBe(0);
  });

  it("__resetForTests clears state", () => {
    replyDeliveryRegistry.register(baseTarget());
    expect(replyDeliveryRegistry.getCount()).toBe(1);
    expect(replyDeliveryRegistry.lookup("stable-1")).not.toBeNull();

    replyDeliveryRegistry.__resetForTests();

    expect(replyDeliveryRegistry.getCount()).toBe(0);
    expect(replyDeliveryRegistry.lookup("stable-1")).toBeNull();
  });

  it("ignores registration with missing stableSessionId", () => {
    replyDeliveryRegistry.register(baseTarget({ stableSessionId: "" }));

    expect(replyDeliveryRegistry.getCount()).toBe(0);
  });

  it("ignores registration with missing targetSessionId", () => {
    replyDeliveryRegistry.register(baseTarget({ targetSessionId: "" }));

    expect(replyDeliveryRegistry.getCount()).toBe(0);
  });

  it("ignores registration with missing targetDirectory", () => {
    replyDeliveryRegistry.register(baseTarget({ targetDirectory: "" }));

    expect(replyDeliveryRegistry.getCount()).toBe(0);
  });

  it("getAll returns copies, not references", () => {
    replyDeliveryRegistry.register(baseTarget());

    const all = replyDeliveryRegistry.getAll();
    all[0]!.chatId = 99999;

    const fresh = replyDeliveryRegistry.lookup("stable-1");
    expect(fresh!.chatId).toBe(12345);
  });
});
