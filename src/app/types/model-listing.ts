/**
 * Model listing types for the /models command and picker pagination.
 *
 * These types are shared between:
 * - Model listing service (source of truth for items)
 * - Command handler (mode selector rendering)
 * - Callback handler (page/mode callback parsing)
 */

export type ModelListingMode = "all" | "favoritesRecent";

export interface ModelListItem {
  providerID: string;
  modelID: string;
  name?: string;
}

export interface ModelListingPage {
  items: ModelListItem[];
  page: number;
  totalPages: number;
  totalItems: number;
}

/**
 * Default page size aligned with existing command/picker pagination patterns.
 * Commands and skills use COMMANDS_LIST_LIMIT which defaults to 10.
 */
export const DEFAULT_LISTING_PAGE_SIZE = 10;
