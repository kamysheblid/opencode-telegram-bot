import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatTelegramError,
  getTelegramRetryAfterMs,
  isTelegramRetryableError,
  withTelegramRateLimitRetry,
  withTelegramRetry,
} from "../../src/utils/telegram-rate-limit-retry.js";

describe("utils/telegram-rate-limit-retry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("extracts retry delay from Telegram error parameters", () => {
    const retryAfterMs = getTelegramRetryAfterMs({
      error_code: 429,
      parameters: {
        retry_after: 3,
      },
    });

    expect(retryAfterMs).toBe(3000);
  });

  it("retries failed operations with Telegram retry_after", async () => {
    vi.useFakeTimers();

    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("429: Too Many Requests: retry after 1"))
      .mockResolvedValueOnce("ok");

    const promise = withTelegramRateLimitRetry(operation, { maxRetries: 2 });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries transient network errors with exponential backoff", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }))
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
      .mockResolvedValueOnce("ok");

    const promise = withTelegramRetry(operation, {
      maxRetries: 3,
      fallbackDelayMs: 1000,
      jitterRatio: 0,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("retries Telegram server errors", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const operation = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: "Service Unavailable" })
      .mockResolvedValueOnce("ok");

    const promise = withTelegramRetry(operation, {
      maxRetries: 1,
      fallbackDelayMs: 1000,
      jitterRatio: 0,
    });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable client errors", async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error("400: Bad Request"));

    await expect(withTelegramRetry(operation, { maxRetries: 2 })).rejects.toThrow(
      "400: Bad Request",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("identifies transient network errors", () => {
    expect(isTelegramRetryableError(Object.assign(new Error("fetch failed"), { code: "EAI_AGAIN" }))).toBe(
      true,
    );
    expect(isTelegramRetryableError(new Error("Bad Request"))).toBe(false);
  });

  it("formats Telegram error details for logs", () => {
    const error = {
      status: 400,
      description: "BUTTON_LABEL_INVALID",
      message: "Network request for 'sendMessage' failed!",
    };

    expect(formatTelegramError(error)).toBe(
      "Network request for 'sendMessage' failed! | Telegram: BUTTON_LABEL_INVALID | status=400",
    );
  });
});
