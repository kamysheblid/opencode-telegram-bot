import { Context, InlineKeyboard } from "grammy";
import { MODELS_LIST_CALLBACK_PREFIX } from "../commands/models-command.js";
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
import { interactionManager } from "../../app/managers/interaction-manager.js";

/**
 * Callback suffix for pagination within a mode listing.
 */
const MODELS_PAGE_SUFFIX = "page";

/** Callback suffix for search action. */
const MODELS_SEARCH_ACTION = "search";

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
    keyboard
      .text(
        `${item.providerID}/${item.modelID}`,
        `${MODELS_LIST_CALLBACK_PREFIX}:select:${mode}:${index}`,
      )
      .row();
  }

  // Search / Clear filter row — always present
  if (mode === MODELS_SEARCH_ACTION) {
    keyboard
      .text(
        t("models.search.clear_filter"),
        `${MODELS_LIST_CALLBACK_PREFIX}:${MODELS_SEARCH_ACTION}:clear`,
      )
      .row();
  } else {
    keyboard
      .text(
        t("models.search.button"),
        `${MODELS_LIST_CALLBACK_PREFIX}:${MODELS_SEARCH_ACTION}:${mode}`,
      )
      .row();
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
    const action = parts[2]; // "mode", "page", "select", or "search"

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

      const header =
        mode === "all" ? t("models.mode.all_header") : t("models.mode.favorites_recent_header");
      const pageInfo =
        page.totalPages > 1
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

    // ── Search ──────────────────────────────────────────────
    if (action === MODELS_SEARCH_ACTION) {
      const subAction = parts[3];

      // Clear filter — return to full unfiltered listing at page 0
      if (subAction === "clear") {
        // Read the original mode from interaction metadata before clearing
        const meta = interactionManager.getSnapshot();
        const originalMode = meta?.metadata?.listingMode as string | undefined;
        interactionManager.clear("models_search_cleared");

        if (originalMode && (originalMode === "all" || originalMode === "favoritesRecent")) {
          // Re-render the original mode listing at page 0
          let items: Array<{ providerID: string; modelID: string }>;
          if (originalMode === "all") {
            items = await fetchAllConfiguredItems();
          } else {
            items = await fetchFavoritesRecentItems();
          }
          const page = paginateItems(items, 0, DEFAULT_LISTING_PAGE_SIZE);
          const header =
            originalMode === "all"
              ? t("models.mode.all_header")
              : t("models.mode.favorites_recent_header");
          const pageInfo =
            page.totalPages > 1
              ? `\n\n${t("model.picker.page_indicator", { current: 1, total: page.totalPages })}`
              : "";
          const keyboard = buildModelsListKeyboard(
            page.items,
            page.page,
            page.totalPages,
            originalMode,
          );
          await ctx
            .editMessageText(`${header}${pageInfo}`, { reply_markup: keyboard })
            .catch(() => {});
        } else {
          await ctx.editMessageText(t("models.select_mode")).catch(() => {});
        }

        await ctx.answerCallbackQuery({ text: t("models.search.clear_filter") }).catch(() => {});
        return true;
      }

      // Start search — subAction is the listing mode ("all" or "favoritesRecent")
      const listingMode = subAction;
      if (listingMode !== "all" && listingMode !== "favoritesRecent") {
        await ctx.answerCallbackQuery({ text: t("models.unknown_mode") }).catch(() => {});
        return true;
      }

      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.deleteMessage().catch(() => {});

      interactionManager.start({
        kind: "custom",
        expectedInput: "text",
        metadata: {
          flow: "models-search",
          stage: "input",
          listingMode,
        },
      });

      await ctx.reply(t("models.search.prompt"));
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
      let searchQuery: string | undefined;
      let displayMode = mode;

      if (mode === MODELS_SEARCH_ACTION) {
        // In search results mode — get original mode + query from interaction metadata
        const meta = interactionManager.getSnapshot();
        const originalMode = meta?.metadata?.listingMode as string | undefined;
        searchQuery = meta?.metadata?.query as string | undefined;

        if (!originalMode || !searchQuery) {
          await ctx.answerCallbackQuery({ text: t("models.search.error") }).catch(() => {});
          return true;
        }

        if (originalMode === "all") {
          items = await fetchAllConfiguredItems();
        } else if (originalMode === "favoritesRecent") {
          items = await fetchFavoritesRecentItems();
        } else {
          await ctx.answerCallbackQuery({ text: t("models.unknown_mode") }).catch(() => {});
          return true;
        }

        // Filter by query
        const normalizedQuery = searchQuery.toLowerCase();
        items = items.filter((item) => {
          const key = `${item.providerID}/${item.modelID}`.toLowerCase();
          return key.includes(normalizedQuery);
        });

        displayMode = originalMode;
      } else {
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

      const header =
        displayMode === "all"
          ? t("models.mode.all_header")
          : t("models.mode.favorites_recent_header");
      const effectiveMode = mode === MODELS_SEARCH_ACTION ? MODELS_SEARCH_ACTION : mode;
      const pageInfo =
        page.totalPages > 1
          ? `\n\n${t("model.picker.page_indicator", { current: page.page + 1, total: page.totalPages })}`
          : "";

      // Add search context to header
      const fullHeader = searchQuery
        ? `${t("models.search.results_header", { query: searchQuery })}\n\n${header}`
        : header;

      let keyboard: InlineKeyboard;
      try {
        keyboard = buildModelsListKeyboard(page.items, page.page, page.totalPages, effectiveMode);
      } catch (keyboardErr) {
        logger.error("[ModelsCallback] Failed to build keyboard for page navigation:", keyboardErr);
        await ctx.answerCallbackQuery({ text: t("models.fetch_error") }).catch(() => {});
        return true;
      }

      try {
        await ctx.editMessageText(`${fullHeader}${pageInfo}`, { reply_markup: keyboard });
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

      if (mode === MODELS_SEARCH_ACTION) {
        // In search mode — read original mode + query from interaction metadata
        const meta = interactionManager.getSnapshot();
        const originalMode = meta?.metadata?.listingMode as string | undefined;
        const searchQuery = meta?.metadata?.query as string | undefined;

        if (!originalMode || !searchQuery) {
          await ctx.answerCallbackQuery({ text: t("models.search.error") }).catch(() => {});
          return true;
        }

        if (originalMode === "all") {
          items = await fetchAllConfiguredItems();
        } else if (originalMode === "favoritesRecent") {
          items = await fetchFavoritesRecentItems();
        } else {
          await ctx.answerCallbackQuery({ text: t("models.unknown_mode") }).catch(() => {});
          return true;
        }

        // Filter by query
        const normalizedQuery = searchQuery.toLowerCase();
        items = items.filter((item) => {
          const key = `${item.providerID}/${item.modelID}`.toLowerCase();
          return key.includes(normalizedQuery);
        });
      } else {
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

        if (mode === MODELS_SEARCH_ACTION) {
          interactionManager.clear("models_search_selected");
        }

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

// ---------------------------------------------------------------------------
// Search text input handler (called from message router)
// ---------------------------------------------------------------------------

/**
 * Handle text input for models search from the /models command listing.
 * Activated when interaction manager has an active "models-search" flow
 * in the "input" stage.
 */
export async function handleModelsCommandSearchTextInput(ctx: Context): Promise<boolean> {
  const meta = interactionManager.getSnapshot();
  if (!meta || meta.metadata?.flow !== "models-search") {
    return false;
  }

  if (meta.metadata?.stage !== "input") {
    return false;
  }

  const text = ctx.message?.text;
  if (!text) {
    return false;
  }

  const listingMode = meta.metadata?.listingMode as string | undefined;
  if (!listingMode || (listingMode !== "all" && listingMode !== "favoritesRecent")) {
    await ctx.reply(t("models.fetch_error"));
    interactionManager.clear("models_search_invalid_mode");
    return true;
  }

  logger.debug(`[ModelsCallback] Models search query: "${text}" (mode: ${listingMode})`);

  try {
    // Fetch all items for the listing mode
    let allItems: Array<{ providerID: string; modelID: string }>;
    if (listingMode === "all") {
      allItems = await fetchAllConfiguredItems();
    } else {
      allItems = await fetchFavoritesRecentItems();
    }

    // Filter by query (case-insensitive substring match on "providerID/modelID")
    const normalizedQuery = text.trim().toLowerCase();
    if (!normalizedQuery) {
      await ctx.reply(t("models.search.prompt"));
      return true;
    }

    const filteredItems = allItems.filter((item) => {
      const key = `${item.providerID}/${item.modelID}`.toLowerCase();
      return key.includes(normalizedQuery);
    });

    // Paginate filtered results
    const page = paginateItems(filteredItems, 0, DEFAULT_LISTING_PAGE_SIZE);

    if (page.items.length === 0) {
      // Show "no results" with a way to search again
      const keyboard = new InlineKeyboard();
      keyboard.text(
        t("models.search.clear_filter"),
        `${MODELS_LIST_CALLBACK_PREFIX}:${MODELS_SEARCH_ACTION}:clear`,
      );
      await ctx.reply(t("models.search.no_results", { query: text }), { reply_markup: keyboard });

      interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "models-search",
          stage: "results",
          listingMode,
          query: normalizedQuery,
        },
      });
      return true;
    }

    // Build response text and keyboard
    const header =
      listingMode === "all"
        ? t("models.mode.all_header")
        : t("models.mode.favorites_recent_header");
    const searchHeader = t("models.search.results_header", { query: text });
    const pageInfo =
      page.totalPages > 1
        ? `\n\n${t("model.picker.page_indicator", { current: 1, total: page.totalPages })}`
        : "";
    const fullText = `${searchHeader}\n\n${header}${pageInfo}`;

    const keyboard = buildModelsListKeyboard(
      page.items,
      page.page,
      page.totalPages,
      MODELS_SEARCH_ACTION,
    );

    await ctx.reply(fullText, { reply_markup: keyboard });

    // Transition to results stage — only callback input expected now
    interactionManager.transition({
      expectedInput: "callback",
      metadata: {
        flow: "models-search",
        stage: "results",
        listingMode,
        query: normalizedQuery,
      },
    });

    return true;
  } catch (err) {
    logger.error("[ModelsCallback] Models search error:", err);
    await ctx.reply(t("models.search.error"));
    interactionManager.clear("models_search_error");
    return true;
  }
}
