import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getSupportedModes } from "../../app/services/model-listing-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

/**
 * Callback prefix for /models command list operations.
 * Used for mode selection and future page navigation.
 */
export const MODELS_LIST_CALLBACK_PREFIX = "models:list";

/**
 * Handle the /models command.
 *
 * Reads the supported listing modes from the model listing service and
 * presents an inline keyboard for the user to choose a mode.
 *
 * This command is read-only — it does not change the active model.
 */
export async function modelsCommand(ctx: Context): Promise<void> {
  try {
    const modes = getSupportedModes();

    if (modes.length === 0) {
      await ctx.reply(t("models.empty"));
      return;
    }

    const keyboard = new InlineKeyboard();

    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];

      switch (mode) {
        case "all":
          keyboard.text(t("models.mode.all"), `${MODELS_LIST_CALLBACK_PREFIX}:mode:all`);
          break;
        case "favoritesRecent":
          keyboard.text(
            t("models.mode.favorites_recent"),
            `${MODELS_LIST_CALLBACK_PREFIX}:mode:favoritesRecent`,
          );
          break;
      }

      if (i < modes.length - 1) {
        keyboard.row();
      }
    }

    await ctx.reply(t("models.select_mode"), {
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error("[ModelsCommand] Failed to load model listing:", error);
    await ctx.reply(t("models.fetch_error"));
  }
}
