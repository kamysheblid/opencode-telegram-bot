import { Context, InlineKeyboard } from "grammy";
import {
  fetchCurrentModel,
  getFavoriteModels,
  getModelSelectionLists,
} from "../../app/services/model-selection-service.js";
import { fetchAllConfiguredItems } from "../../app/services/model-listing-service.js";
import type {
  FavoriteModel,
  ModelInfo,
  ModelSelectionLists,
} from "../../app/types/model.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { appendInlineMenuCancelButton, replyWithInlineMenu } from "./inline-menu.js";

export const MODEL_SEARCH_CALLBACK = "model:search";
export const MODEL_SEARCH_AGAIN_CALLBACK = "model:search:again";
export const MODEL_SEARCH_CANCEL_CALLBACK = "model:search:cancel";

/** Callback for selecting Favorites mode in the model picker. */
export const MODEL_MODE_FAVORITES_CALLBACK = "model:mode:fav";
/** Callback for selecting All Models mode in the model picker. */
export const MODEL_MODE_ALL_CALLBACK = "model:mode:all";

// ── Picker pagination helpers ──────────────────────────────────────────

/** Number of models to show per picker page. */
export const MODEL_PICKER_PAGE_SIZE = 10;

/** Callback prefix for picker page navigation. */
export const MODEL_PICKER_PAGE_PREFIX = "model:page:";

export interface ModelPickerPaginationRange {
  /** Normalized 0-based page index (clamped to valid range). */
  page: number;
  /** Total number of pages (at least 1). */
  totalPages: number;
  /** Start index (inclusive) into the full model list for this page. */
  startIndex: number;
  /** End index (exclusive) into the full model list for this page. */
  endIndex: number;
}

/**
 * Build a picker page navigation callback string.
 * Example: `buildModelPickerPageCallback(2)` → `"model:page:2"`
 */
export function buildModelPickerPageCallback(page: number): string {
  return `${MODEL_PICKER_PAGE_PREFIX}${page}`;
}

/**
 * Parse a picker page navigation callback.
 * Returns the 0-based page number, or `null` if the data is not a valid
 * picker page callback (wrong prefix, non-integer, or negative).
 */
export function parseModelPickerPageCallback(data: string): number | null {
  if (!data.startsWith(MODEL_PICKER_PAGE_PREFIX)) {
    return null;
  }

  const raw = data.slice(MODEL_PICKER_PAGE_PREFIX.length);
  const page = Number(raw);

  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

/**
 * Calculate the pagination range for a model picker page.
 * Out-of-range pages are clamped to the nearest valid page (0 or last).
 *
 * @param totalItems - Total number of models to paginate.
 * @param page       - Requested 0-based page number.
 * @param pageSize   - Models per page (defaults to `MODEL_PICKER_PAGE_SIZE`).
 */
export function calculateModelPickerRange(
  totalItems: number,
  page: number,
  pageSize: number = MODEL_PICKER_PAGE_SIZE,
): ModelPickerPaginationRange {
  const safeSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safeSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = safePage * safeSize;
  const endIndex = Math.min(startIndex + safeSize, totalItems);

  return { page: safePage, totalPages, startIndex, endIndex };
}

// ── Menu text & keyboard builders ─────────────────────────────────────

export function getAllModelsFromLists(lists: ModelSelectionLists): FavoriteModel[] {
  const favoriteKeys = new Set<string>();
  for (const m of lists.favorites) {
    favoriteKeys.add(`${m.providerID}:${m.modelID}`);
  }

  const allModels = [...lists.favorites];
  for (const m of lists.recent) {
    if (!favoriteKeys.has(`${m.providerID}:${m.modelID}`)) {
      allModels.push(m);
    }
  }

  return allModels;
}

function isFavorite(model: FavoriteModel, favorites: readonly FavoriteModel[]): boolean {
  return favorites.some((f) => f.providerID === model.providerID && f.modelID === model.modelID);
}

export function buildModelSelectionMenuText(
  modelLists: ModelSelectionLists,
  page?: number,
  totalPages?: number,
): string {
  const lines = [t("model.menu.select"), t("model.menu.favorites_title")];

  if (modelLists.favorites.length === 0) {
    lines.push(t("model.menu.favorites_empty"));
  }

  lines.push(t("model.menu.recent_title"));

  if (modelLists.recent.length === 0) {
    lines.push(t("model.menu.recent_empty"));
  }

  if (page !== undefined && totalPages !== undefined && totalPages > 1) {
    lines.push("");
    lines.push(t("model.picker.page_indicator", { current: page + 1, total: totalPages }));
  }

  return lines.join("\n");
}

/**
 * Build inline keyboard for a specific page of the model picker.
 * First page always includes Search.
 * Navigation row includes Previous / Next buttons as appropriate.
 *
 * @param currentModel - Currently selected model (marked with ✅).
 * @param modelLists   - Favorite and recent model lists.
 * @param page         - 0-based page number (default 0).
 */
export async function buildModelSelectionMenu(
  currentModel?: ModelInfo,
  modelLists?: ModelSelectionLists,
  page: number = 0,
): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const lists = modelLists ?? (await getModelSelectionLists());
  const favorites = lists.favorites;

  const allModels = getAllModelsFromLists(lists);

  // Search button — always present as first row
  keyboard.text(t("model.search.button"), MODEL_SEARCH_CALLBACK).row();

  if (allModels.length === 0) {
    logger.warn("[ModelHandler] No model choices found in favorites/recent");
    return keyboard;
  }

  const range = calculateModelPickerRange(allModels.length, page);
  const pageModels = allModels.slice(range.startIndex, range.endIndex);

  const addButton = (model: FavoriteModel): void => {
    const isActive =
      currentModel &&
      model.providerID === currentModel.providerID &&
      model.modelID === currentModel.modelID;

    const prefix = isFavorite(model, favorites) ? "⭐" : "🕘";
    const label = `${prefix} ${model.providerID}/${model.modelID}`;
    const labelWithCheck = isActive ? `✅ ${label}` : label;

    keyboard.text(labelWithCheck, `model:${model.providerID}:${model.modelID}`).row();
  };

  for (const model of pageModels) {
    addButton(model);
  }

  if (range.totalPages > 1) {
    if (range.page > 0) {
      keyboard.text(
        t("model.picker.button.prev_page"),
        buildModelPickerPageCallback(range.page - 1),
      );
    }

    if (range.page < range.totalPages - 1) {
      keyboard.text(
        t("model.picker.button.next_page"),
        buildModelPickerPageCallback(range.page + 1),
      );
    }

    keyboard.row();
  }

  return keyboard;
}

/**
 * Build the mode selection keyboard (Favorites vs All Models).
 */
function buildModeSelectionKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text("⭐ " + t("models.mode.favorites_recent"), MODEL_MODE_FAVORITES_CALLBACK).row();
  keyboard.text("📋 " + t("models.mode.all"), MODEL_MODE_ALL_CALLBACK).row();
  return keyboard;
}

/**
 * Show model selection mode menu (Favorites vs All Models).
 */
export async function showModelSelectionMenu(ctx: Context): Promise<void> {
  try {
    const keyboard = buildModeSelectionKeyboard();

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text: t("models.select_mode"),
      keyboard,
    });
  } catch (err) {
    logger.error("[ModelHandler] Error showing model mode menu:", err);
    await ctx.reply(t("model.menu.error"));
  }
}

/**
 * Fetch all catalog models as a ModelSelectionLists structure.
 * Favorites are placed in the favorites list (marked with ⭐),
 * non-favorite catalog models go into recent (marked with 🕘).
 */
async function fetchCatalogModelsAsSelectionLists(): Promise<ModelSelectionLists> {
  const favorites = await getFavoriteModels();
  const allItems = await fetchAllConfiguredItems();

  const favKeys = new Set<string>();
  for (const m of favorites) {
    favKeys.add(`${m.providerID}:${m.modelID}`);
  }

  const recent: FavoriteModel[] = [];
  for (const item of allItems) {
    if (!favKeys.has(`${item.providerID}:${item.modelID}`)) {
      recent.push({ providerID: item.providerID, modelID: item.modelID });
    }
  }

  return { favorites, recent };
}

/**
 * Show the model picker for a given mode.
 *
 * @param ctx    Telegram context from the callback query.
 * @param mode   "fav" for favorites+recent, "all" for full catalog.
 * @param page   0-based page number (default 0).
 */
export async function showModelPicker(
  ctx: Context,
  mode: "fav" | "all",
  page: number = 0,
): Promise<void> {
  try {
    const currentModel = fetchCurrentModel();
    const modelLists =
      mode === "all" ? await fetchCatalogModelsAsSelectionLists() : await getModelSelectionLists();

    const allModels = getAllModelsFromLists(modelLists);
    const range = calculateModelPickerRange(allModels.length, page);
    const keyboard = await buildModelSelectionMenu(currentModel, modelLists, range.page);

    appendInlineMenuCancelButton(keyboard, "model");

    const text = buildModelSelectionMenuText(modelLists, range.page, range.totalPages);

    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery().catch(() => {});
  } catch (err) {
    logger.error("[ModelHandler] Error showing model picker:", err);
    await ctx.answerCallbackQuery({ text: t("model.menu.error") }).catch(() => {});
  }
}

/**
 * Resolve the model picker data for a given mode and page.
 * Returns the model lists, full model array, and pagination range.
 */
export async function resolveModelPickerData(
  mode: "fav" | "all",
  page: number,
): Promise<{
  modelLists: ModelSelectionLists;
  allModels: FavoriteModel[];
  range: ModelPickerPaginationRange;
}> {
  const modelLists =
    mode === "all" ? await fetchCatalogModelsAsSelectionLists() : await getModelSelectionLists();
  const allModels = getAllModelsFromLists(modelLists);
  const range = calculateModelPickerRange(allModels.length, page);
  return { modelLists, allModels, range };
}
