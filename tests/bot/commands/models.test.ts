import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { modelsCommand, MODELS_LIST_CALLBACK_PREFIX } from "../../../src/bot/commands/models-command.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getSupportedModesMock: vi.fn(),
}));

vi.mock("../../../src/app/services/model-listing-service.js", () => ({
  getSupportedModes: mocked.getSupportedModesMock,
}));

function createContext(): Context {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/commands/models-command", () => {
  it("replies with mode selector when modes are available", async () => {
    mocked.getSupportedModesMock.mockReturnValue(["all", "favoritesRecent"]);

    const ctx = createContext();
    await modelsCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toBe(t("models.select_mode"));

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(options).toBeDefined();
    expect(options.reply_markup).toBeDefined();

    // Extract callback data from the inline keyboard
    const keyboard = options.reply_markup;
    const rows = (keyboard as unknown as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard;
    expect(rows.length).toBe(2);

    // First row: "All configured" button
    expect(rows[0][0].callback_data).toBe(`${MODELS_LIST_CALLBACK_PREFIX}:mode:all`);
    // Second row: "Favorites + Recent" button
    expect(rows[1][0].callback_data).toBe(`${MODELS_LIST_CALLBACK_PREFIX}:mode:favoritesRecent`);
  });

  it("uses models:list mode callback prefix, not existing model: prefix", async () => {
    mocked.getSupportedModesMock.mockReturnValue(["all", "favoritesRecent"]);

    const ctx = createContext();
    await modelsCommand(ctx);

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const keyboard = options.reply_markup;
    const rows = (keyboard as unknown as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard;

    for (const row of rows) {
      for (const button of row) {
        expect(button.callback_data).not.toMatch(/^model:/);
        expect(button.callback_data).toMatch(/^models:list:/);
      }
    }
  });

  it("replies with empty state when no modes are supported", async () => {
    mocked.getSupportedModesMock.mockReturnValue([]);

    const ctx = createContext();
    await modelsCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toBe(t("models.empty"));
  });

  it("replies with localized error on failure and logs internally", async () => {
    mocked.getSupportedModesMock.mockImplementation(() => {
      throw new Error("Catalog unavailable");
    });

    const ctx = createContext();
    await modelsCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toBe(t("models.fetch_error"));
  });

  it("does not change the active model", async () => {
    mocked.getSupportedModesMock.mockReturnValue(["all", "favoritesRecent"]);

    const ctx = createContext();
    await modelsCommand(ctx);

    // Verify no select/change model callbacks are used
    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const keyboard = options.reply_markup;
    const rows = (keyboard as unknown as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard;

    for (const row of rows) {
      for (const button of row) {
        expect(button.callback_data).not.toMatch(/^model:(select|change|set)/);
      }
    }
  });
});
