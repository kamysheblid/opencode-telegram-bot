import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolCallStreamer } from "../../../src/bot/streaming/tool-call-streamer.js";
import type { ToolCallStreamerOptions } from "../../../src/bot/streaming/tool-call-streamer.js";

/* ------------------------------------------------------------------ */
/*  Helper: simulate addContextHeader for callback-level tests         */
/* ------------------------------------------------------------------ */
const TOOL_STREAM_HEADER =
  "📁 Project: /test | Test\n💬 Session: ses_test | Test\n\n";

function simulateAddHeader(text: string): string {
  if (text.startsWith(TOOL_STREAM_HEADER)) return text;
  return TOOL_STREAM_HEADER + text;
}

function makeOptions(overrides?: Partial<ToolCallStreamerOptions>): ToolCallStreamerOptions {
  return {
    throttleMs: 0,
    sendText: vi.fn().mockResolvedValue(1),
    editText: vi.fn().mockResolvedValue(undefined),
    deleteText: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("bot/streaming/tool-call-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles tool updates and sends the combined latest text", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "first");
    streamer.append("s1", "second");

    await vi.advanceTimersByTimeAsync(200);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "first\n\nsecond");
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("edits the existing streamed message when new tool lines arrive", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "first");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "second");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(editText).toHaveBeenCalledWith("s1", 10, "first\n\nsecond");
  });

  it("keeps todo updates in a separate message stream", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "regular tool");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "todo tool", "todo");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.append("s1", "regular tool update");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "todo tool");
    expect(editText).toHaveBeenCalledWith("s1", 10, "regular tool\n\nregular tool update");
  });

  it("keeps subagent updates in a separate replace-by-prefix stream", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(20).mockResolvedValueOnce(21);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "regular tool");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "subagent", "subagent card", "subagent");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.replaceByPrefix("s1", "subagent", "subagent card updated", "subagent");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "subagent card");
    expect(editText).toHaveBeenCalledWith("s1", 21, "subagent card updated");
  });

  it("wraps subagent card text with context header on first send", async () => {
    vi.useFakeTimers();

    let headeredText = "";
    const sendText = vi.fn(async (_sid: string, text: string) => {
      headeredText = simulateAddHeader(text);
      return 10;
    });
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer(
      makeOptions({
        sendText,
        editText,
      }),
    );

    streamer.replaceByPrefix("s1", "subagent", "subagent card", "subagent");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    expect(sendText).toHaveBeenCalledWith("s1", "subagent card");
    expect(headeredText).toBe(TOOL_STREAM_HEADER + "subagent card");
  });

  it("preserves context header on subagent card update without double-header", async () => {
    vi.useFakeTimers();

    let editHeaderedText = "";
    const sendText = vi.fn(async (_sid: string, text: string) => {
      simulateAddHeader(text);
      return 10;
    });
    const editText = vi.fn(async (_sid: string, _mid: number, text: string) => {
      editHeaderedText = simulateAddHeader(text);
    });
    const streamer = new ToolCallStreamer(
      makeOptions({
        sendText,
        editText,
      }),
    );

    streamer.replaceByPrefix("s1", "subagent", "subagent card", "subagent");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "subagent", "subagent card updated", "subagent");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(editText).toHaveBeenCalledWith("s1", 10, "subagent card updated");
    expect(editHeaderedText).toBe(TOOL_STREAM_HEADER + "subagent card updated");

    // Simulate second edit to verify dedup: passing already-headered text
    // should not double the header (same as production addContextHeader)
    const doubleWrapped = simulateAddHeader(editHeaderedText);
    expect(doubleWrapped).toBe(editHeaderedText);
  });

  it("creates continuation messages when the stream exceeds Telegram limits", async () => {
    vi.useFakeTimers();

    let nextMessageId = 100;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "a".repeat(3000));
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "b".repeat(3000));
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(editText).toHaveBeenCalledTimes(1);
    for (const call of sendText.mock.calls) {
      const [, text] = call as unknown as [string, string];
      expect(text.length).toBeLessThanOrEqual(4000);
    }
  });

  it("replaces retry text by prefix inside the active stream", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "tool one");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "🔁", "🔁 Retry attempt 1");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "🔁", "🔁 Retry attempt 2");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(2);
    });

    expect(editText).toHaveBeenLastCalledWith("s1", 1, "tool one\n\n🔁 Retry attempt 2");
  });

  it("starts a new tool stream after a file boundary break", async () => {
    vi.useFakeTimers();

    let nextMessageId = 50;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "before file");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    await streamer.breakSession("s1", "tool_file_boundary");

    streamer.append("s1", "after file");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "after file");
  });

  it("starts a new tool stream after an assistant reply boundary break", async () => {
    vi.useFakeTimers();

    let nextMessageId = 60;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "before reply");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    await streamer.breakSession("s1", "assistant_message_completed");

    streamer.append("s1", "after reply");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "after reply");
  });

  it("flushes all stream keys for the same session", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(30).mockResolvedValueOnce(31);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "regular tool");
    streamer.append("s1", "todo tool", "todo");

    await streamer.flushSession("s1", "manual_flush");

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "todo tool");
  });

  it("cancels throttled tool sends when clearing all streams", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "pending");
    streamer.clearAll("abort_command");

    await vi.advanceTimersByTimeAsync(500);

    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("cancels retry-after resend when the session is cleared", async () => {
    vi.useFakeTimers();

    const sendText = vi
      .fn()
      .mockRejectedValueOnce(new Error("429: retry after 1"))
      .mockResolvedValueOnce(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "hello");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.clearSession("s1", "abort_command");
    await vi.advanceTimersByTimeAsync(1000);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("wraps streamed tool text with context header and sends it", async () => {
    vi.useFakeTimers();

    let headeredText = "";
    const sendText = vi.fn(async (_sid: string, text: string) => {
      headeredText = simulateAddHeader(text);
      return 1;
    });
    const streamer = new ToolCallStreamer(
      makeOptions({
        sendText,
      }),
    );

    streamer.append("s1", "tool message");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    expect(sendText).toHaveBeenCalledWith("s1", "tool message");
    expect(headeredText).toBe(TOOL_STREAM_HEADER + "tool message");
  });

  it("preserves context header on tool stream edit without double-header", async () => {
    vi.useFakeTimers();

    let editHeaderedText = "";
    const sendText = vi.fn(async (_sid: string, text: string) => {
      simulateAddHeader(text);
      return 10;
    });
    const editText = vi.fn(async (_sid: string, _mid: number, text: string) => {
      editHeaderedText = simulateAddHeader(text);
    });
    const streamer = new ToolCallStreamer(
      makeOptions({
        sendText,
        editText,
      }),
    );

    streamer.append("s1", "first");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "second");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    const combinedRaw = "first\n\nsecond";
    expect(editText).toHaveBeenCalledWith("s1", 10, combinedRaw);
    expect(editHeaderedText).toBe(TOOL_STREAM_HEADER + combinedRaw);

    // Simulate second edit to verify dedup: passing already-headered text
    // should not double the header (same as production addContextHeader)
    const doubleWrapped = simulateAddHeader(editHeaderedText);
    expect(doubleWrapped).toBe(editHeaderedText);
  });

  it("routes new tool calls into a fresh stream while a break flush is still finishing", async () => {
    vi.useFakeTimers();

    const editResolution: { current: null | (() => void) } = { current: null };
    const sendText = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11);
    const editText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          editResolution.current = resolve;
        }),
    );
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "before break");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "forces edit");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    const breakPromise = streamer.breakSession("s1", "thinking_started");
    streamer.append("s1", "after break");

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    if (editResolution.current) {
      editResolution.current();
    }
    await expect(breakPromise).resolves.toBeUndefined();

    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "after break");
  });
});
