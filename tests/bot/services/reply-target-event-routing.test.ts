import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config.js", () => ({
  config: {
    telegram: { token: "test-token", allowedUserId: 777, proxyUrl: "" },
    opencode: {
      apiUrl: "http://localhost:4096",
      username: "opencode",
      password: "",
      model: { provider: "openai", modelId: "gpt-5" },
    },
    server: { logLevel: "info" },
    bot: {
      responseStreamingMode: "edit",
      responseStreamThrottleMs: 500,
      messageFormatMode: "markdown",
      hideThinkingMessages: false,
      hideToolCallMessages: false,
      hideToolFileMessages: false,
      trackBackgroundSessions: false,
      locale: "en",
      sessionsListLimit: 10,
      projectsListLimit: 10,
      hideSubagentMessages: false,
      responseStreamTextLimit: 3800,
    },
    files: { maxFileSizeKb: 100 },
    stt: { apiUrl: "", apiKey: "", model: "", language: "" },
    tts: { apiUrl: "", apiKey: "", model: "", voice: "" },
    open: { browserRoots: "" },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { createEventSubscriptionService } from "../../../src/bot/services/event-subscription-service.js";
import { replyDeliveryRegistry } from "../../../src/app/managers/reply-delivery-registry.js";

interface MockEvent {
  type: string;
  properties: Record<string, unknown>;
}

function makeEvent(type: string, properties: Record<string, unknown>): MockEvent {
  return { type, properties };
}

describe("reply-target-event-routing", () => {
  let service: {
    setTelegramContext: (bot: unknown, chatId: number | null) => void;
    deliverToReplyTarget: (target: unknown, event: MockEvent) => Promise<void>;
  };
  let mockApi: { sendMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    replyDeliveryRegistry.__resetForTests();

    mockApi = { sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }) };
    const mockBot = { api: mockApi };

    const instance = createEventSubscriptionService();
    instance.setTelegramContext(mockBot as never, 12345);
    service = instance as never;
  });

  describe("deliverToReplyTarget", () => {
    const registerTarget = (overrides?: Record<string, unknown>) => {
      replyDeliveryRegistry.register({
        stableSessionId: "target-ses-1",
        targetSessionId: "target-ses-1",
        targetDirectory: "/test/project",
        projectWorktree: "/test/project",
        projectName: "test-project",
        chatId: 99999,
        deliveryMode: "stream",
        startedAt: Date.now(),
        ...overrides,
      } as never);
    };

    const expectedHeader =
      "📁 Project: /test/project | test-project\n💬 Session: target-ses-1 | target-ses-1\n";

    it("delivers accumulated text to reply target chat on assistant completion", async () => {
      registerTarget();

      const target = replyDeliveryRegistry.lookup("target-ses-1");

      // Send text part via message.part.updated
      await service.deliverToReplyTarget(target, makeEvent("message.part.updated", {
        part: {
          sessionID: "target-ses-1",
          messageID: "msg-1",
          type: "text",
          text: "Hello, this is the response text.",
        },
      }));

      // Send completion signal
      await service.deliverToReplyTarget(target, makeEvent("message.updated", {
        info: {
          sessionID: "target-ses-1",
          id: "msg-1",
          role: "assistant",
          time: { completed: Date.now() },
        },
      }));

      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        99999,
        expectedHeader + "Hello, this is the response text.",
      );
    });

    it("accumulates text from multiple message.part.updated events", async () => {
      registerTarget();

      const target = replyDeliveryRegistry.lookup("target-ses-1");

      // Send first text part
      await service.deliverToReplyTarget(target, makeEvent("message.part.updated", {
        part: {
          sessionID: "target-ses-1",
          messageID: "msg-1",
          type: "text",
          text: "Hello",
        },
      }));

      // Send second text part
      await service.deliverToReplyTarget(target, makeEvent("message.part.updated", {
        part: {
          sessionID: "target-ses-1",
          messageID: "msg-1",
          type: "text",
          text: ", World!",
        },
      }));

      // Send completion
      await service.deliverToReplyTarget(target, makeEvent("message.updated", {
        info: {
          sessionID: "target-ses-1",
          id: "msg-1",
          role: "assistant",
          time: { completed: Date.now() },
        },
      }));

      expect(mockApi.sendMessage).toHaveBeenCalledWith(99999, expectedHeader + "Hello, World!");
    });

    it("accumulates text from message.part.delta events", async () => {
      registerTarget();

      const target = replyDeliveryRegistry.lookup("target-ses-1");

      // Send delta text
      await service.deliverToReplyTarget(target, makeEvent("message.part.delta", {
        sessionID: "target-ses-1",
        messageID: "msg-1",
        delta: "Hello via delta!",
      }));

      // Send completion
      await service.deliverToReplyTarget(target, makeEvent("message.updated", {
        info: {
          sessionID: "target-ses-1",
          id: "msg-1",
          role: "assistant",
          time: { completed: Date.now() },
        },
      }));

      expect(mockApi.sendMessage).toHaveBeenCalledWith(99999, expectedHeader + "Hello via delta!");
    });

    it("includes parseable context header in delivered reply target message", async () => {
      registerTarget();
      const target = replyDeliveryRegistry.lookup("target-ses-1");

      await service.deliverToReplyTarget(target, makeEvent("message.part.updated", {
        part: {
          sessionID: "target-ses-1",
          messageID: "msg-1",
          type: "text",
          text: "Some response text.",
        },
      }));

      await service.deliverToReplyTarget(target, makeEvent("message.updated", {
        info: {
          sessionID: "target-ses-1",
          id: "msg-1",
          role: "assistant",
          time: { completed: Date.now() },
        },
      }));

      const sentText = mockApi.sendMessage.mock.calls[0][1] as string;
      expect(sentText).toMatch(/^📁 Project: /);
      expect(sentText).toMatch(/💬 Session: target-ses-1/);
    });

    it("does not send message when no text was accumulated before completion", async () => {
      registerTarget();

      const target = replyDeliveryRegistry.lookup("target-ses-1");

      // Send completion without any prior text parts
      await service.deliverToReplyTarget(target, makeEvent("message.updated", {
        info: {
          sessionID: "target-ses-1",
          id: "msg-1",
          role: "assistant",
          time: { completed: Date.now() },
        },
      }));

      expect(mockApi.sendMessage).not.toHaveBeenCalled();
    });

    it("does not send message for non-assistant role on message.updated", async () => {
      registerTarget();

      const target = replyDeliveryRegistry.lookup("target-ses-1");

      // User role should be ignored
      await service.deliverToReplyTarget(target, makeEvent("message.updated", {
        info: {
          sessionID: "target-ses-1",
          id: "msg-2",
          role: "user",
          time: { created: Date.now() },
        },
      }));

      expect(mockApi.sendMessage).not.toHaveBeenCalled();
    });

    it("session.idle cleans up the registry entry", async () => {
      registerTarget();
      expect(replyDeliveryRegistry.lookup("target-ses-1")).not.toBeNull();

      const target = replyDeliveryRegistry.lookup("target-ses-1");

      await service.deliverToReplyTarget(target, makeEvent("session.idle", {
        sessionID: "target-ses-1",
      }));

      expect(replyDeliveryRegistry.lookup("target-ses-1")).toBeNull();
    });

    it("session.error cleans up the registry entry", async () => {
      registerTarget();
      expect(replyDeliveryRegistry.lookup("target-ses-1")).not.toBeNull();

      const target = replyDeliveryRegistry.lookup("target-ses-1");

      await service.deliverToReplyTarget(target, makeEvent("session.error", {
        sessionID: "target-ses-1",
      }));

      expect(replyDeliveryRegistry.lookup("target-ses-1")).toBeNull();
    });

    it("does nothing when botInstance is null", async () => {
      // Create a new service WITHOUT setting Telegram context
      const rawService = createEventSubscriptionService() as never;
      registerTarget();

      const target = replyDeliveryRegistry.lookup("target-ses-1");

      // Should not throw despite botInstance being null
      await rawService.deliverToReplyTarget(target, makeEvent("message.updated", {
        info: {
          sessionID: "target-ses-1",
          id: "msg-1",
          role: "assistant",
          time: { completed: Date.now() },
        },
      }));

      expect(mockApi.sendMessage).not.toHaveBeenCalled();
    });

    it("cleans up text map when session.idle fires", async () => {
      registerTarget();
      const target = replyDeliveryRegistry.lookup("target-ses-1");

      // Accumulate some text first
      await service.deliverToReplyTarget(target, makeEvent("message.part.updated", {
        part: {
          sessionID: "target-ses-1",
          messageID: "msg-1",
          type: "text",
          text: "Some response",
        },
      }));

      // Idle cleans up
      await service.deliverToReplyTarget(target, makeEvent("session.idle", {
        sessionID: "target-ses-1",
      }));

      // Now the text should be gone — a completion event after idle
      // should find no accumulated text
      await service.deliverToReplyTarget(target, makeEvent("message.updated", {
        info: {
          sessionID: "target-ses-1",
          id: "msg-1",
          role: "assistant",
          time: { completed: Date.now() },
        },
      }));

      // After idle cleanup, the registry entry is gone, but even if
      // `deliverToReplyTarget` were called, the text map was cleaned
      expect(mockApi.sendMessage).not.toHaveBeenCalled();
    });

    it("ignores message.part.updated with non-text type", async () => {
      registerTarget();
      const target = replyDeliveryRegistry.lookup("target-ses-1");

      // Reasoning part should not accumulate text
      await service.deliverToReplyTarget(target, makeEvent("message.part.updated", {
        part: {
          sessionID: "target-ses-1",
          messageID: "msg-1",
          type: "reasoning",
          text: "thinking...",
        },
      }));

      // Completion should not find accumulated text
      await service.deliverToReplyTarget(target, makeEvent("message.updated", {
        info: {
          sessionID: "target-ses-1",
          id: "msg-1",
          role: "assistant",
          time: { completed: Date.now() },
        },
      }));

      expect(mockApi.sendMessage).not.toHaveBeenCalled();
    });

    it("ignores events not in the message.updated/part.updated/part.delta/idle/error family", async () => {
      registerTarget();
      const target = replyDeliveryRegistry.lookup("target-ses-1");

      // Default case does nothing
      await service.deliverToReplyTarget(target, makeEvent("server.heartbeat", {}));
      await service.deliverToReplyTarget(target, makeEvent("session.diff", {}));

      expect(mockApi.sendMessage).not.toHaveBeenCalled();
      expect(replyDeliveryRegistry.lookup("target-ses-1")).not.toBeNull();
    });
  });
});
