import { Context, InlineKeyboard } from "grammy";
import {
  MODELS_LIST_CALLBACK_PREFIX,
} from "../commands/models-command.js";
import {
  fetchAllConfiguredItems,
  fetchFavoritesRecentItems,
  paginateItems,
} from "../../app/services/model-listing-service.js";
import { selectModel } from "../../app/services/model-selection-service.js";
import { formatModelForDisplay } from "../../app/types/model.js";
import { DEFAULT_LISTING_PAGE_SIZE } from "../../app/types/model-listing.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

/**
 * Callback suffix for pagination within a mode listing.
 */
const MODELS_PAGE_SUFFIX = "page";

/**
 * Build an inline keyboard for a paginated model listing page.
 */
function buildModelsListKeyboard(
  items: Array<{ providerID: string; modelID: string }>,
  page: number,
  totalPages: number,
  mode: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const [index, item] of items.entries()) {
    keyboard.text(
      `${item.providerID}/${item.modelID}`,
      `${MODELS_LIST_CALLBACK_PREFIX}:select:${mode}:${index}`,
    ).row();
  }

  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text(
        t("model.picker.button.prev_page"),
        `${MODELS_LIST_CALLBACK_PREFIX}:${MODELS_PAGE_SUFFIX}:${mode}:${page - 1}`,
      );
    }

    if (page < totalPages - 1) {
      keyboard.text(
        t("model.picker.button.next_page"),
        `${MODELS_LIST_CALLBACK_PREFIX}:${MODELS_PAGE_SUFFIX}:${mode}:${page + 1}`,
      );
    }

    keyboard.row();
  }

  return keyboard;
}

/**
 * Handle /models inline callbacks (mode selection and page navigation).
 *
 * Returns `true` if the callback was handled, `false` if it should fall through.
 */
export async function handleModelsCommandCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;

  if (!data || !data.startsWith(`${MODELS_LIST_CALLBACK_PREFIX}:`)) {
    return false;
  }

  try {
    const parts = data.split(":");
    const action = parts[2]; // "mode" or "page"

    if (action === "mode") {
      const mode = parts[3];

      let items: Array<{ providerID: string; modelID: string }>;

      switch (mode) {
        case "all":
          items = await fetchAllConfiguredItems();
          break;
        case "favoritesRecent":
          items = await fetchFavoritesRecentItems();
          break;
        default:
          await ctx.answerCallbackQuery({ text: t("models.unknown_mode") }).catch(() => {});
          return true;
      }

      const page = paginateItems(items, 0, DEFAULT_LISTING_PAGE_SIZE);

      if (page.items.length === 0) {
        try {
          await ctx.editMessageText(t("models.empty"), { reply_markup: undefined });
        } catch (emptyErr) {
          logger.error("[ModelsCallback] Failed to edit message for empty page (mode):", emptyErr);
          await ctx.answerCallbackQuery({ text: t("models.fetch_error") }).catch(() => {});
          return true;
        }
        await ctx.answerCallbackQuery().catch(() => {});
        return true;
      }

      const header = mode === "all" ? t("models.mode.all_header") : t("models.mode.favorites_recent_header");
      const pageInfo = page.totalPages > 1
        ? `\n\n${t("model.picker.page_indicator", { current: 1, total: page.totalPages })}`
        : "";

      let keyboard: InlineKeyboard;
      try {
        keyboard = buildModelsListKeyboard(page.items, page.page, page.totalPages, mode);
      } catch (keyboardErr) {
        logger.error("[ModelsCallback] Failed to build keyboard for mode selection:", keyboardErr);
        await ctx.answerCallbackQuery({ text: t("models.fetch_error") }).catch(() => {});
        return true;
      }

      try {
        await ctx.editMessageText(`${header}${pageInfo}`, { reply_markup: keyboard });
      } catch (editErr) {
        logger.error("[ModelsCallback] Failed to edit message for mode selection:", editErr);
        await ctx.answerCallbackQuery({ text: t("models.fetch_error") }).catch(() => {});
        return true;
      }

      await ctx.answerCallbackQuery().catch(() => {});
      return true;
    }

    if (action === MODELS_PAGE_SUFFIX) {
      const mode = parts[3];
      const pageNum = parseInt(parts[4], 10);

      if (isNaN(pageNum) || pageNum < 0) {
        await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
        return true;
      }

      let items: Array<{ providerID: string; modelID: string }>;

      switch (mode) {
        case "all":
          items = await fetchAllConfiguredItems();
          break;
        case "favoritesRecent":
          items = await fetchFavoritesRecentItems();
          break;
        default:
          await ctx.answerCallbackQuery({ text: t("models.unknown_mode") }).catch(() => {});
          return true;
      }

      const page = paginateItems(items, pageNum, DEFAULT_LISTING_PAGE_SIZE);

      if (page.items.length === 0) {
        try {
          await ctx.editMessageText(t("models.empty"), { reply_markup: undefined });
        } catch (emptyErr) {
          logger.error("[ModelsCallback] Failed to edit message for empty page:", emptyErr);
          await ctx.answerCallbackQuery({ text: t("models.fetch_error") }).catch(() => {});
          return true;
        }
        await ctx.answerCallbackQuery().catch(() => {});
        return true;
      }

      const header = mode === "all" ? t("models.mode.all_header") : t("models.mode.favorites_recent_header");
      const pageInfo = page.totalPages > 1
        ? `\n\n${t("model.picker.page_indicator", { current: page.page + 1, total: page.totalPages })}`
        : "";

      let keyboard: InlineKeyboard;
      try {
        keyboard = buildModelsListKeyboard(page.items, page.page, page.totalPages, mode);
      } catch (keyboardErr) {
        logger.error("[ModelsCallback] Failed to build keyboard for page navigation:", keyboardErr);
        await ctx.answerCallbackQuery({ text: t("models.fetch_error") }).catch(() => {});
        return true;
      }

      try {
        await ctx.editMessageText(`${header}${pageInfo}`, { reply_markup: keyboard });
      } catch (editErr) {
        logger.error("[ModelsCallback] Failed to edit message for page navigation:", editErr);
        await ctx.answerCallbackQuery({ text: t("models.fetch_error") }).catch(() => {});
        return true;
      }

      await ctx.answerCallbackQuery().catch(() => {});
      return true;
    }

    if (action === "select") {
      const mode = parts[3];
      const index = parseInt(parts[4], 10);

      if (isNaN(index) || index < 0) {
        await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
        return true;
      }

      let items: Array<{ providerID: string; modelID: string }>;

      switch (mode) {
        case "all":
          items = await fetchAllConfiguredItems();
          break;
        case "favoritesRecent":
          items = await fetchFavoritesRecentItems();
          break;
        default:
          await ctx.answerCallbackQuery({ text: t("models.unknown_mode") }).catch(() => {});
          return true;
      }

      const page = paginateItems(items, 0, DEFAULT_LISTING_PAGE_SIZE);
      const item = page.items[index];

      if (!item) {
        await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
        return true;
      }

      try {
        const displayName = formatModelForDisplay(item.providerID, item.modelID);
        selectModel({ providerID: item.providerID, modelID: item.modelID, variant: "default" });

        await ctx.answerCallbackQuery({ text: t("model.changed_callback", { name: displayName }) });
        await ctx.editMessageText(t("model.changed_message", { name: displayName }));
        return true;
      } catch (err) {
        logger.error("[ModelsCallback] Error selecting model:", err);
        await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
        return true;
      }
    }

    return false;
  } catch (err) {
    logger.error("[ModelsCallback] Error handling callback:", err);
    await ctx.answerCallbackQuery({ text: t("models.fetch_error") }).catch(() => {});
    return true;
  }
}
