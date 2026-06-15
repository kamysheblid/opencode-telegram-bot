import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleModelsCommandCallback } from "../../../src/bot/callbacks/models-command-callback-handler.js";
import { MODELS_LIST_CALLBACK_PREFIX } from "../../../src/bot/commands/models-command.js";

const mocked = vi.hoisted(() => ({
  fetchAllConfiguredItemsMock: vi.fn(),
  fetchFavoritesRecentItemsMock: vi.fn(),
  paginateItemsMock: vi.fn((items: unknown[], page: number, pageSize: number) => {
    const start = page * pageSize;
    const end = start + pageSize;
    return {
      items: items.slice(start, end),
      page,
      totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
      totalItems: items.length,
    };
  }),
}));

vi.mock("../../../src/app/services/model-listing-service.js", () => ({
  fetchAllConfiguredItems: mocked.fetchAllConfiguredItemsMock,
  fetchFavoritesRecentItems: mocked.fetchFavoritesRecentItemsMock,
  paginateItems: mocked.paginateItemsMock,
  DEFAULT_LISTING_PAGE_SIZE: 10,
}));

function createContext(overrides: Record<string, unknown> = {}): Context {
  return {
    callbackQuery: undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Context;
}

describe("bot/callbacks/models-command-callback-handler", () => {
  beforeEach(() => {
    mocked.fetchAllConfiguredItemsMock.mockReset();
    mocked.fetchFavoritesRecentItemsMock.mockReset();
  });

  it("returns false when no callback data", async () => {
    const ctx = createContext({ callbackQuery: undefined });
    const result = await handleModelsCommandCallback(ctx);
    expect(result).toBe(false);
  });

  it("returns false when callback data does not match models:list: prefix", async () => {
    const ctx = createContext({
      callbackQuery: { data: "model:openai:gpt-4o" },
    });

    const result = await handleModelsCommandCallback(ctx);
    expect(result).toBe(false);
  });

  it("handles mode:all and renders model list", async () => {
    mocked.fetchAllConfiguredItemsMock.mockResolvedValue([
      { providerID: "openai", modelID: "gpt-4o" },
      { providerID: "openai", modelID: "gpt-4-turbo" },
    ]);

    const ctx = createContext({
      callbackQuery: { data: `${MODELS_LIST_CALLBACK_PREFIX}:mode:all` },
    });

    const result = await handleModelsCommandCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.fetchAllConfiguredItemsMock).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("handles mode:favoritesRecent and renders model list", async () => {
    mocked.fetchFavoritesRecentItemsMock.mockResolvedValue([
      { providerID: "openai", modelID: "gpt-4o" },
    ]);

    const ctx = createContext({
      callbackQuery: { data: `${MODELS_LIST_CALLBACK_PREFIX}:mode:favoritesRecent` },
    });

    const result = await handleModelsCommandCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.fetchFavoritesRecentItemsMock).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("answers with unknown_mode for unsupported mode", async () => {
    const ctx = createContext({
      callbackQuery: { data: `${MODELS_LIST_CALLBACK_PREFIX}:mode:connected` },
    });

    const result = await handleModelsCommandCallback(ctx);

    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("handles page navigation in all mode", async () => {
    mocked.fetchAllConfiguredItemsMock.mockResolvedValue([
      { providerID: "openai", modelID: "gpt-4o" },
      { providerID: "openai", modelID: "gpt-4-turbo" },
    ]);

    const ctx = createContext({
      callbackQuery: { data: `${MODELS_LIST_CALLBACK_PREFIX}:page:all:0` },
    });

    const result = await handleModelsCommandCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.fetchAllConfiguredItemsMock).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("handles page navigation beyond first page", async () => {
    // Mock 15 items to span multiple pages (page size is 10 in the mock)
    const manyItems = Array.from({ length: 15 }, (_, i) => ({
      providerID: "openai",
      modelID: `gpt-${i}`,
    }));
    mocked.fetchAllConfiguredItemsMock.mockResolvedValue(manyItems);

    const ctx = createContext({
      callbackQuery: { data: `${MODELS_LIST_CALLBACK_PREFIX}:page:all:1` },
    });

    const result = await handleModelsCommandCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.fetchAllConfiguredItemsMock).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("handles page navigation in favoritesRecent mode", async () => {
    mocked.fetchFavoritesRecentItemsMock.mockResolvedValue([
      { providerID: "openai", modelID: "gpt-4o" },
    ]);

    const ctx = createContext({
      callbackQuery: { data: `${MODELS_LIST_CALLBACK_PREFIX}:page:favoritesRecent:0` },
    });

    const result = await handleModelsCommandCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.fetchFavoritesRecentItemsMock).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("answers with error for invalid page number", async () => {
    const ctx = createContext({
      callbackQuery: { data: `${MODELS_LIST_CALLBACK_PREFIX}:page:all:invalid` },
    });

    const result = await handleModelsCommandCallback(ctx);

    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("answers with fetch_error on service failure", async () => {
    mocked.fetchAllConfiguredItemsMock.mockRejectedValue(new Error("API unavailable"));

    const ctx = createContext({
      callbackQuery: { data: `${MODELS_LIST_CALLBACK_PREFIX}:mode:all` },
    });

    const result = await handleModelsCommandCallback(ctx);

    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("does not process model: prefix callbacks from existing picker", async () => {
    const ctx = createContext({
      callbackQuery: { data: "model:openai:gpt-4o" },
    });

    const result = await handleModelsCommandCallback(ctx);
    expect(result).toBe(false);
  });

  it("does not process model:search: prefix callbacks", async () => {
    const ctx = createContext({
      callbackQuery: { data: "model:search" },
    });

    const result = await handleModelsCommandCallback(ctx);
    expect(result).toBe(false);
  });

  it("handles editMessageText failure during page navigation", async () => {
    mocked.fetchAllConfiguredItemsMock.mockResolvedValue([
      { providerID: "openai", modelID: "gpt-4o" },
    ]);

    const ctx = createContext({
      callbackQuery: { data: `${MODELS_LIST_CALLBACK_PREFIX}:page:all:0` },
      editMessageText: vi.fn().mockRejectedValue(new Error("Bad Request")),
    });

    const result = await handleModelsCommandCallback(ctx);

    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });
});
