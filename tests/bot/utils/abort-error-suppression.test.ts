import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetUserAbortErrorSuppressionForTests,
  markUserAbortRequested,
  shouldSuppressUserAbortSessionError,
} from "../../../src/bot/utils/abort-error-suppression.js";

describe("bot/utils/abort-error-suppression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T10:00:00Z"));
    __resetUserAbortErrorSuppressionForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetUserAbortErrorSuppressionForTests();
  });

  it("suppresses one Aborted error after a user abort request", () => {
    markUserAbortRequested("session-1");

    expect(shouldSuppressUserAbortSessionError("session-1", " Aborted ")).toBe(true);
    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(false);
  });

  it("does not suppress unrelated errors after a user abort request", () => {
    markUserAbortRequested("session-1");

    expect(shouldSuppressUserAbortSessionError("session-1", "Model not found")).toBe(false);
    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(true);
  });

  it("does not suppress stale abort errors", () => {
    markUserAbortRequested("session-1");
    vi.advanceTimersByTime(30_001);

    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(false);
  });
});
