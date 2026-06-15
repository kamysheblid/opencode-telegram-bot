interface RetryAttemptInfo {
  attempt: number;
  retryAfterMs: number;
  error: unknown;
}

export interface TelegramRetryOptions {
  maxRetries?: number;
  fallbackDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  onRetry?: (info: RetryAttemptInfo) => void;
}

function getErrorMessage(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  }

  if (typeof error === "object" && error !== null) {
    const description = Reflect.get(error, "description");
    if (typeof description === "string") {
      parts.push(description);
    }

    const message = Reflect.get(error, "message");
    if (typeof message === "string") {
      parts.push(message);
    }
  }

  if (typeof error === "string") {
    parts.push(error);
  }

  return parts.join("\n");
}

function getNumericStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  for (const key of ["status", "error_code", "statusCode"] as const) {
    const value = Reflect.get(error, key);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function getRetryAfterSecondsFromError(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const parameters = Reflect.get(error, "parameters");
    if (typeof parameters === "object" && parameters !== null) {
      const retryAfter = Reflect.get(parameters, "retry_after");
      if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
        return retryAfter;
      }
    }
  }

  const message = getErrorMessage(error);
  const retryMatch = message.match(/retry after\s+(\d+)/i);
  if (!retryMatch) {
    return null;
  }

  const parsedSeconds = Number.parseInt(retryMatch[1], 10);
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return null;
  }

  return parsedSeconds;
}

function isTelegramRateLimitError(error: unknown): boolean {
  const status = getNumericStatus(error);
  if (status === 429) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return /\b429\b/.test(message) || message.includes("too many requests");
}

function isTelegramServerError(error: unknown): boolean {
  const status = getNumericStatus(error);
  if (status !== null && status >= 500 && status <= 599) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return /\b(500|502|503|504)\b/.test(message);
}

const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "TimeoutError",
]);

const TRANSIENT_NETWORK_ERROR_MESSAGES = [
  "fetch failed",
  "socket hang up",
  "connection reset",
  "connection refused",
  "timed out",
  "timeout",
  "temporary failure",
  "name or service not known",
  "getaddrinfo",
  "proxy",
];

function hasErrorCode(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = Reflect.get(error, "code");
  return typeof code === "string" && TRANSIENT_NETWORK_ERROR_CODES.has(code);
}

function hasTransientNetworkMessage(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return TRANSIENT_NETWORK_ERROR_MESSAGES.some((fragment) => message.includes(fragment));
}

function isTransientNetworkError(error: unknown): boolean {
  const status = getNumericStatus(error);
  if (status !== null && status >= 400 && status < 500 && status !== 429) {
    return false;
  }

  return hasErrorCode(error) || hasTransientNetworkMessage(error);
}

export function isTelegramRetryableError(error: unknown): boolean {
  const status = getNumericStatus(error);
  if (status !== null && status >= 400 && status < 500 && status !== 429) {
    return false;
  }

  return (
    isTelegramRateLimitError(error) ||
    isTelegramServerError(error) ||
    isTransientNetworkError(error)
  );
}

export function getTelegramErrorDescription(error: unknown): string | null {
  if (typeof error === "object" && error !== null) {
    const description = Reflect.get(error, "description");
    if (typeof description === "string" && description.trim().length > 0) {
      return description;
    }
  }

  return null;
}

function getPrimaryMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string") {
      return message;
    }
  }

  if (typeof error === "string") {
    return error;
  }

  return String(error ?? "");
}

export function formatTelegramError(error: unknown): string {
  const description = getTelegramErrorDescription(error);
  const message = getPrimaryMessage(error);
  const status = getNumericStatus(error);
  const retryAfter = getRetryAfterSecondsFromError(error);

  const parts = [message];

  if (description) {
    parts.push(`Telegram: ${description}`);
  }

  if (status !== null) {
    parts.push(`status=${status}`);
  }

  if (retryAfter !== null) {
    parts.push(`retry_after=${retryAfter}s`);
  }

  return parts.join(" | ");
}

export function getTelegramRetryAfterMs(
  error: unknown,
  fallbackDelayMs: number = 1000,
): number | null {
  if (!isTelegramRateLimitError(error)) {
    return null;
  }

  const retryAfterSeconds = getRetryAfterSecondsFromError(error);
  if (retryAfterSeconds !== null) {
    return retryAfterSeconds * 1000;
  }

  return Math.max(1, Math.floor(fallbackDelayMs));
}

function getExponentialRetryDelayMs(
  attempt: number,
  fallbackDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
): number {
  const exponent = Math.max(0, attempt - 1);
  const baseDelay = fallbackDelayMs * 2 ** exponent;
  const cappedDelay = Math.min(baseDelay, maxDelayMs);
  const jitter = cappedDelay * jitterRatio * Math.random();

  return Math.max(1, Math.floor(cappedDelay + jitter));
}

function getRetryDelayMs(
  error: unknown,
  attempt: number,
  fallbackDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
): number | null {
  if (isTelegramRateLimitError(error)) {
    return getTelegramRetryAfterMs(error, fallbackDelayMs);
  }

  if (isTelegramServerError(error) || isTransientNetworkError(error)) {
    return getExponentialRetryDelayMs(attempt, fallbackDelayMs, maxDelayMs, jitterRatio);
  }

  return null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function withTelegramRetry<T>(
  operation: () => Promise<T>,
  options: TelegramRetryOptions = {},
): Promise<T> {
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 3));
  const fallbackDelayMs = options.fallbackDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const jitterRatio = Math.max(0, Math.min(0.5, options.jitterRatio ?? 0.2));

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const retryAfterMs = getRetryDelayMs(
        error,
        attempt + 1,
        fallbackDelayMs,
        maxDelayMs,
        jitterRatio,
      );
      if (retryAfterMs === null || attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
      options.onRetry?.({
        attempt,
        retryAfterMs,
        error,
      });
      await wait(retryAfterMs);
    }
  }
}

export async function withTelegramRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: TelegramRetryOptions = {},
): Promise<T> {
  return withTelegramRetry(operation, {
    ...options,
    maxRetries: options.maxRetries ?? 3,
    fallbackDelayMs: options.fallbackDelayMs ?? 1000,
    maxDelayMs: options.maxDelayMs ?? 60_000,
  });
}
