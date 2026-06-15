import { Context, InlineKeyboard } from "grammy";
import {
  fetchCurrentModel,
  getModelSelectionLists,
} from "../../app/services/model-selection-service.js";
import type {
  FavoriteModel,
  ModelInfo,
  ModelSelectionLists,
} from "../../app/types/model.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

export const MODEL_SEARCH_CALLBACK = "model:search";
export const MODEL_SEARCH_AGAIN_CALLBACK = "model:search:again";
export const MODEL_SEARCH_CANCEL_CALLBACK = "model:search:cancel";

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

function isFavorite(
  model: FavoriteModel,
  favorites: readonly FavoriteModel[],
): boolean {
  return favorites.some(
    (f) => f.providerID === model.providerID && f.modelID === model.modelID,
  );
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
      keyboard.text(t("model.picker.button.prev_page"), buildModelPickerPageCallback(range.page - 1));
    }

    if (range.page < range.totalPages - 1) {
      keyboard.text(t("model.picker.button.next_page"), buildModelPickerPageCallback(range.page + 1));
    }

    keyboard.row();
  }

  return keyboard;
}

/**
 * Show model selection menu
 */
export async function showModelSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentModel = fetchCurrentModel();
    const modelLists = await getModelSelectionLists();
    const allModels = getAllModelsFromLists(modelLists);
    const range = calculateModelPickerRange(allModels.length, 0);
    const keyboard = await buildModelSelectionMenu(currentModel, modelLists, 0);

    const text = buildModelSelectionMenuText(modelLists, range.page, range.totalPages);

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error("[ModelHandler] Error showing model menu:", err);
    await ctx.reply(t("model.menu.error"));
  }
}
