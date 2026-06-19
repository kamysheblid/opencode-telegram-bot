import { opencodeClient } from "../../opencode/client.js";
import { getModelSelectionLists } from "./model-selection-service.js";
import { logger } from "../../utils/logger.js";
import type { ModelListItem, ModelListingMode, ModelListingPage } from "../types/model-listing.js";
import { DEFAULT_LISTING_PAGE_SIZE } from "../types/model-listing.js";

const LISTING_CACHE_TTL_MS = 60_000;

interface ListingCacheEntry {
  expiresAt: number;
  items: ModelListItem[];
}

const listingCache = new Map<ModelListingMode, ListingCacheEntry>();

function getCachedItems(mode: ModelListingMode): ModelListItem[] | null {
  const entry = listingCache.get(mode);
  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    listingCache.delete(mode);
    return null;
  }

  return [...entry.items];
}

function setCachedItems(mode: ModelListingMode, items: ModelListItem[]): void {
  if (items.length === 0) {
    return;
  }

  listingCache.set(mode, {
    expiresAt: Date.now() + LISTING_CACHE_TTL_MS,
    items: [...items],
  });
}

export function clearModelListingCache(): void {
  listingCache.clear();
}

// ---------------------------------------------------------------------------
// Supported modes
// ---------------------------------------------------------------------------

/**
 * Return the list of supported listing modes.
 * Connected-only mode is omitted because the SDK/API does not expose a
 * verified "connected" provider filter. Add it here only when API support
 * is confirmed.
 */
export function getSupportedModes(): ModelListingMode[] {
  return ["all", "favoritesRecent"];
}

// ---------------------------------------------------------------------------
// Pagination helpers (pure)
// ---------------------------------------------------------------------------

export interface ListingPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Calculate a safe pagination range from a total item count, requested page,
 * and page size. Out-of-range pages are clamped to the nearest valid page.
 * Follows the same pattern as `calculateCommandsPaginationRange` in
 * `src/bot/menus/command-catalog-menu.ts`.
 */
export function calculateListingPagination(
  totalItems: number,
  page: number,
  pageSize: number = DEFAULT_LISTING_PAGE_SIZE,
): ListingPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalItems);

  return { page: normalizedPage, totalPages, startIndex, endIndex };
}

// ---------------------------------------------------------------------------
// Item builders (pure)
// ---------------------------------------------------------------------------

/**
 * Convert a raw provider catalog response into a flat list of ModelListItem.
 */
export function buildAllConfiguredItems(response: {
  data?: {
    providers: Array<{
      id: string;
      models: Record<string, { id: string; name?: string }>;
    }>;
  };
  error?: unknown;
}): ModelListItem[] {
  if (!response.data?.providers?.length) {
    return [];
  }

  const items: ModelListItem[] = [];

  for (const provider of response.data.providers) {
    if (!provider.models) {
      continue;
    }

    for (const [modelID, modelInfo] of Object.entries(provider.models)) {
      items.push({
        providerID: provider.id,
        modelID,
        name: modelInfo?.name,
      });
    }
  }

  return items;
}

/**
 * Build a deduplicated item list from favorites and recent model arrays.
 * Favorites appear first, followed by recent models that are not already in
 * favorites.
 */
export function buildFavoritesRecentItems(
  favorites: Array<{ providerID: string; modelID: string }>,
  recent: Array<{ providerID: string; modelID: string }>,
): ModelListItem[] {
  const seen = new Set<string>();
  const items: ModelListItem[] = [];

  for (const model of favorites) {
    const key = `${model.providerID}/${model.modelID}`;

    if (!seen.has(key)) {
      seen.add(key);
      items.push({ providerID: model.providerID, modelID: model.modelID });
    }
  }

  for (const model of recent) {
    const key = `${model.providerID}/${model.modelID}`;

    if (!seen.has(key)) {
      seen.add(key);
      items.push({ providerID: model.providerID, modelID: model.modelID });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Fetch helpers (async wrappers that call the API / OpenCode state)
// ---------------------------------------------------------------------------

/**
 * Fetch all configured models from the provider catalog.
 * Returns an empty array on failure.
 */
export async function fetchAllConfiguredItems(): Promise<ModelListItem[]> {
  const cachedItems = getCachedItems("all");
  if (cachedItems !== null) {
    return cachedItems;
  }

  try {
    const response = await opencodeClient.config.providers();
    const items = buildAllConfiguredItems(response);
    setCachedItems("all", items);
    return items;
  } catch (err) {
    logger.error("[ModelListingService] Failed to fetch provider catalog:", err);
    return [];
  }
}

/**
 * Fetch favorite and recent model items from the local OpenCode state.
 * Returns an empty array on failure.
 */
export async function fetchFavoritesRecentItems(): Promise<ModelListItem[]> {
  const cachedItems = getCachedItems("favoritesRecent");
  if (cachedItems !== null) {
    return cachedItems;
  }

  try {
    const lists = await getModelSelectionLists();
    const items = buildFavoritesRecentItems(lists.favorites, lists.recent);
    setCachedItems("favoritesRecent", items);
    return items;
  } catch (err) {
    logger.error("[ModelListingService] Failed to fetch favorites/recent items:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pagination wrapper
// ---------------------------------------------------------------------------

/**
 * Slice a full item array into a single page using the given page number and
 * page size. Uses the same safe-normalization logic as
 * `calculateListingPagination`.
 */
export function paginateItems(
  items: ModelListItem[],
  page: number,
  pageSize: number = DEFAULT_LISTING_PAGE_SIZE,
): ModelListingPage {
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateListingPagination(items.length, page, pageSize);

  return {
    items: items.slice(startIndex, endIndex),
    page: normalizedPage,
    totalPages,
    totalItems: items.length,
  };
}
