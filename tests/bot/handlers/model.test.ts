import { beforeEach, describe, expect, it, vi } from "vitest";
import { InlineKeyboard } from "grammy";

const mocked = vi.hoisted(() => ({
  getModelSelectionListsMock: vi.fn(),
  searchModelsMock: vi.fn(),
  interactionManagerGetSnapshotMock: vi.fn(),
  interactionManagerStartMock: vi.fn(),
  interactionManagerTransitionMock: vi.fn(),
  interactionManagerClearMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  appendInlineMenuCancelButtonMock: vi.fn((keyboard: unknown) => keyboard),
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getModelSelectionLists: mocked.getModelSelectionListsMock,
  searchModels: mocked.searchModelsMock,
  selectModel: vi.fn(),
  fetchCurrentModel: vi.fn(),
}));

vi.mock("../../../src/app/managers/interaction-manager.js", () => ({
  interactionManager: {
    getSnapshot: mocked.interactionManagerGetSnapshotMock,
    start: mocked.interactionManagerStartMock,
    transition: mocked.interactionManagerTransitionMock,
    clear: mocked.interactionManagerClearMock,
  },
}));

vi.mock("../../../src/bot/menus/inline-menu.js", () => ({
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  appendInlineMenuCancelButton: mocked.appendInlineMenuCancelButtonMock,
  clearActiveInlineMenu: vi.fn(),
  replyWithInlineMenu: vi.fn(),
}));

import {
  buildModelSelectionMenu,
  MODEL_PICKER_PAGE_SIZE,
} from "../../../src/bot/menus/model-selection-menu.js";

import {
  handleModelSelect,
  handleModelSearchCallback,
  handleModelSearchTextInput,
  handleModelSearchResults,
} from "../../../src/bot/callbacks/model-selection-callback-handler.js";

function mockContext(overrides: Record<string, unknown> = {}) {
  return {
    callbackQuery: undefined,
    message: undefined,
    chat: { id: 123 },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 999 }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as import("grammy").Context;
}

describe("bot model selection", () => {
  beforeEach(() => {
    mocked.getModelSelectionListsMock.mockReset();
    mocked.searchModelsMock.mockReset();
    mocked.interactionManagerGetSnapshotMock.mockReset();
    mocked.interactionManagerStartMock.mockReset();
    mocked.interactionManagerTransitionMock.mockReset();
    mocked.interactionManagerClearMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.appendInlineMenuCancelButtonMock.mockReset();
  });

  describe("buildModelSelectionMenu", () => {
    it("includes search button as the first row", async () => {
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [{ providerID: "openai", modelID: "gpt-4o" }],
        recent: [{ providerID: "google", modelID: "gemini-pro" }],
      });

      const keyboard = await buildModelSelectionMenu();

      expect(keyboard).toBeInstanceOf(InlineKeyboard);
      const rows = keyboard.inline_keyboard;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0][0].text).toBe("🔍 Search");
      expect(rows[0][0].callback_data).toBe("model:search");
    });

    it("still returns keyboard with search button when no favorites or recent", async () => {
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [],
        recent: [],
      });

      const keyboard = await buildModelSelectionMenu();

      // Keyboard always has at least the search button row
      expect(keyboard.inline_keyboard.length).toBeGreaterThanOrEqual(1);
      expect(keyboard.inline_keyboard[0][0].text).toBe("🔍 Search");
      expect(keyboard.inline_keyboard[0][0].callback_data).toBe("model:search");
    });

    it("shows Next button on page 0 when there are multiple pages", async () => {
      const models = Array.from({ length: 15 }, (_, i) => ({
        providerID: "openai",
        modelID: `gpt-model-${i}`,
      }));
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: models,
        recent: [],
      });

      const keyboard = await buildModelSelectionMenu(undefined, undefined, 0);
      const rows = keyboard.inline_keyboard;

      // Row 0: Search
      expect(rows[0][0].callback_data).toBe("model:search");

      // Because keyboard.row() adds a trailing empty row, nav is at rows.length - 2
      const navRow = rows[rows.length - 2];
      const callbacks = navRow.map((b: { callback_data: string }) => b.callback_data);

      // Page 0 should have Next button with model:page:1 callback
      expect(callbacks.some((c: string) => c === "model:page:1")).toBe(true);
    });

    it("shows Previous button and no Next button on the last page", async () => {
      const models = Array.from({ length: 15 }, (_, i) => ({
        providerID: "openai",
        modelID: `gpt-model-${i}`,
      }));
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: models,
        recent: [],
      });

      // Page 1 (0-indexed) for 15 items with page size 10
      const keyboard = await buildModelSelectionMenu(undefined, undefined, 1);
      const rows = keyboard.inline_keyboard;

      // Row 0: Search
      expect(rows[0][0].callback_data).toBe("model:search");

      // Nav row is at rows.length - 2 (empty trailing row from keyboard.row())
      const navRow = rows[rows.length - 2];
      const callbacks = navRow.map((b: { callback_data: string }) => b.callback_data);

      // Page 1 (last) should have Previous (model:page:0) but no Next
      expect(callbacks.some((c: string) => c === "model:page:0")).toBe(true);
      expect(callbacks.some((c: string) => c === "model:page:2")).toBe(false);
    });

    it("marks current model with checkmark", async () => {
      const currentModel = { providerID: "openai", modelID: "gpt-current", variant: "default" };
      const models = [
        { providerID: "openai", modelID: "gpt-current" },
        { providerID: "openai", modelID: "gpt-other" },
      ];
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: models,
        recent: [],
      });

      const keyboard = await buildModelSelectionMenu(currentModel, undefined, 0);
      const rows = keyboard.inline_keyboard;

      // Find model button that contains the checkmark
      const modelButtons = rows.slice(1, -1).flat();
      const currentButton = modelButtons.find(
        (b: { callback_data: string }) => b.callback_data === "model:openai:gpt-current",
      );
      expect(currentButton).toBeDefined();
      expect(currentButton.text).toContain("✅");
    });
  });

  describe("handleModelSelect picker pagination", () => {
    it("edits picker page and appends cancel to callback edits", async () => {
      const models = Array.from({ length: 15 }, (_, i) => ({
        providerID: "openai",
        modelID: `gpt-model-${i}`,
      }));
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: models,
        recent: [],
      });
      mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);

      const ctx = mockContext({
        callbackQuery: {
          data: "model:page:1",
          message: { message_id: 123 },
        },
        editMessageText: vi.fn().mockResolvedValue(undefined),
      });

      const result = await handleModelSelect(ctx);

      expect(result).toBe(true);
      expect(mocked.ensureActiveInlineMenuMock).toHaveBeenCalledWith(expect.anything(), "model");
      expect(mocked.appendInlineMenuCancelButtonMock).toHaveBeenCalledWith(expect.anything(), "model");
      expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining("Page 2/2"), {
        reply_markup: expect.anything(),
      });
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe("handleModelSearchCallback", () => {
    it("returns false when callback data does not match", async () => {
      const ctx = mockContext({
        callbackQuery: { data: "model:openai:gpt-4o" },
      });

      const result = await handleModelSearchCallback(ctx);

      expect(result).toBe(false);
    });

    it("returns false when no callback data", async () => {
      const ctx = mockContext({ callbackQuery: undefined });

      const result = await handleModelSearchCallback(ctx);

      expect(result).toBe(false);
    });
  });

  describe("handleModelSearchTextInput", () => {
    it("returns false when no model-search interaction is active", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue(null);

      const ctx = mockContext({
        message: { text: "gpt" },
      });

      const result = await handleModelSearchTextInput(ctx);

      expect(result).toBe(false);
    });

    it("returns false when interaction is not model-search", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "other-flow", stage: "input" },
      });

      const ctx = mockContext({
        message: { text: "gpt" },
      });

      const result = await handleModelSearchTextInput(ctx);

      expect(result).toBe(false);
    });

    it("returns false when stage is not input", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "model-search", stage: "results" },
      });

      const ctx = mockContext({
        message: { text: "gpt" },
      });

      const result = await handleModelSearchTextInput(ctx);

      expect(result).toBe(false);
    });

    it("returns false when no message text", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "model-search", stage: "input" },
      });

      const ctx = mockContext({
        message: { text: undefined },
      });

      const result = await handleModelSearchTextInput(ctx);

      expect(result).toBe(false);
    });
  });

  describe("handleModelSearchResults", () => {
    it("returns false when no callback data", async () => {
      const ctx = mockContext({ callbackQuery: undefined });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(false);
    });

    it("returns false when no model-search interaction is active", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue(null);

      const ctx = mockContext({
        callbackQuery: { data: "model:search:cancel" },
      });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(false);
    });

    it("returns false when stage is not results", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "model-search", stage: "input" },
      });

      const ctx = mockContext({
        callbackQuery: { data: "model:search:cancel" },
      });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(false);
    });

    it("returns false when interaction is not model-search", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "other-flow", stage: "results" },
      });

      const ctx = mockContext({
        callbackQuery: { data: "model:search:cancel" },
      });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(false);
    });
  });
});
