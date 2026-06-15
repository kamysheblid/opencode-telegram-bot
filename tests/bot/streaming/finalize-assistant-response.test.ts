import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAddContextHeader = vi.hoisted(() => vi.fn((text: string) => text));

vi.mock("../../../src/bot/messages/session-context-header.js", () => ({
  addContextHeader: mockAddContextHeader,
}));

import { finalizeAssistantResponse } from "../../../src/bot/streaming/finalize-assistant-response.js";

describe("bot/streaming/finalize-assistant-response", () => {
  it("completes the response stream and sends final text when streamer reports not streamed", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const keyboard = { keyboard: [[{ text: "A" }]] };

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload: vi.fn(() => ({
        parts: [
          {
            text: "final reply",
            fallbackText: "final reply",
            source: "plain" as const,
          },
        ],
      })),
      renderFinalParts: vi.fn(() => [
        {
          text: "part 1",
          entities: [{ type: "bold", offset: 0, length: 6 }],
          fallbackText: "part 1",
          source: "entities" as const,
        },
        {
          text: "part 2",
          fallbackText: "part 2",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => keyboard),
      sendRenderedPart,
    });

    expect(responseStreamer.complete).toHaveBeenCalledWith("s1", "m1", {
      parts: [
        {
          text: "final reply",
          fallbackText: "final reply",
          source: "plain",
        },
      ],
      sendOptions: { disable_notification: true, reply_markup: keyboard },
      editOptions: undefined,
    });
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(sendRenderedPart).toHaveBeenCalledTimes(2);
    expect(sendRenderedPart).toHaveBeenNthCalledWith(
      1,
      {
        text: "part 1",
        entities: [{ type: "bold", offset: 0, length: 6 }],
        fallbackText: "part 1",
        source: "entities",
      },
      { disable_notification: true, reply_markup: keyboard },
    );
    expect(sendRenderedPart).toHaveBeenNthCalledWith(
      2,
      {
        text: "part 2",
        fallbackText: "part 2",
        source: "plain",
      },
      { disable_notification: true, reply_markup: keyboard },
    );
  });

  it("finalizes streamed messages in place without re-sending", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: true, telegramMessageIds: [101] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const prepareStreamingPayload = vi.fn(() => ({
      parts: [
        {
          text: "reply",
          fallbackText: "reply",
          source: "plain" as const,
        },
      ],
    }));
    const keyboard = { keyboard: [[{ text: "ctx" }]] };

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload,
      renderFinalParts: vi.fn(() => [
        {
          text: "reply",
          fallbackText: "reply",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => keyboard),
      sendRenderedPart,
    });

    expect(responseStreamer.complete).toHaveBeenCalledWith("s1", "m1", {
      parts: [
        {
          text: "reply",
          fallbackText: "reply",
          source: "plain",
        },
      ],
      sendOptions: { disable_notification: true, reply_markup: keyboard },
      editOptions: undefined,
    });
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(sendRenderedPart).not.toHaveBeenCalled();
  });

  it("still sends rendered parts with keyboard when streamer reports not streamed", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const prepareStreamingPayload = vi.fn(() => ({
      parts: [
        {
          text: "reply",
          fallbackText: "reply",
          source: "plain" as const,
        },
      ],
    }));

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload,
      renderFinalParts: vi.fn(() => [
        {
          text: "reply",
          fallbackText: "reply",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => undefined),
      sendRenderedPart,
    });

    expect(sendRenderedPart).toHaveBeenCalledTimes(1);
    expect(sendRenderedPart).toHaveBeenCalledWith(
      {
        text: "reply",
        fallbackText: "reply",
        source: "plain",
      },
      { disable_notification: true },
    );
  });

  describe("context header prepending via addContextHeader", () => {
    const testHeader =
      "📁 Project: /test/proj | Test Project\n💬 Session: ses_abc | Test Session\n";

    beforeEach(() => {
      mockAddContextHeader.mockImplementation((text: string) => testHeader + text);
    });

    afterEach(() => {
      mockAddContextHeader.mockImplementation((text: string) => text);
    });

    it("prepends context header to messageText when session and project are available", async () => {
      const responseStreamer = {
        complete: vi.fn().mockResolvedValue({ streamed: true, telegramMessageIds: [101] }),
      };
      const prepareStreamingPayload = vi.fn(() => ({
        parts: [
          {
            text: "",
            fallbackText: "",
            source: "plain" as const,
          },
        ],
      }));
      const renderFinalParts = vi.fn(() => []);

      await finalizeAssistantResponse({
        sessionId: "ses_abc",
        messageId: "m1",
        messageText: "Assistant reply text.",
        responseStreamer,
        flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
        prepareStreamingPayload,
        renderFinalParts,
        getReplyKeyboard: vi.fn(() => undefined),
        sendRenderedPart: vi.fn().mockResolvedValue(undefined),
      });

      expect(mockAddContextHeader).toHaveBeenCalledWith("Assistant reply text.");
      expect(prepareStreamingPayload).toHaveBeenCalledWith(
        testHeader + "Assistant reply text.",
      );
    });

    it("does not prepend header when addContextHeader returns text unchanged (session missing)", async () => {
      mockAddContextHeader.mockImplementation((text: string) => text);

      const prepareStreamingPayload = vi.fn(() => ({
        parts: [
          {
            text: "",
            fallbackText: "",
            source: "plain" as const,
          },
        ],
      }));

      await finalizeAssistantResponse({
        sessionId: "s1",
        messageId: "m1",
        messageText: "no session",
        responseStreamer: {
          complete: vi.fn().mockResolvedValue({ streamed: true, telegramMessageIds: [101] }),
        },
        flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
        prepareStreamingPayload,
        renderFinalParts: vi.fn(() => []),
        getReplyKeyboard: vi.fn(() => undefined),
        sendRenderedPart: vi.fn().mockResolvedValue(undefined),
      });

      expect(prepareStreamingPayload).toHaveBeenCalledWith("no session");
    });

    it("does not double-header when text already has a header", async () => {
      mockAddContextHeader.mockImplementation((text: string) => text);

      const alreadyHeadered = testHeader + "Already headered content.";

      const prepareStreamingPayload = vi.fn(() => ({
        parts: [
          {
            text: "",
            fallbackText: "",
            source: "plain" as const,
          },
        ],
      }));

      await finalizeAssistantResponse({
        sessionId: "s1",
        messageId: "m1",
        messageText: alreadyHeadered,
        responseStreamer: {
          complete: vi.fn().mockResolvedValue({ streamed: true, telegramMessageIds: [101] }),
        },
        flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
        prepareStreamingPayload,
        renderFinalParts: vi.fn(() => []),
        getReplyKeyboard: vi.fn(() => undefined),
        sendRenderedPart: vi.fn().mockResolvedValue(undefined),
      });

      expect(mockAddContextHeader).toHaveBeenCalledWith(alreadyHeadered);
      expect(prepareStreamingPayload).toHaveBeenCalledWith(alreadyHeadered);
    });
  });
});
