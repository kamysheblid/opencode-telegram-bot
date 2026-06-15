import { beforeEach, describe, expect, it, vi } from "vitest";

const { providersMock, getModelSelectionListsMock, loggerErrorMock } = vi.hoisted(() => ({
  providersMock: vi.fn(),
  getModelSelectionListsMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: {
      providers: providersMock,
    },
  },
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getModelSelectionLists: getModelSelectionListsMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import {
  getSupportedModes,
  buildAllConfiguredItems,
  buildFavoritesRecentItems,
  paginateItems,
  fetchAllConfiguredItems,
  fetchFavoritesRecentItems,
} from "../../../src/app/services/model-listing-service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProvidersResponse(modelsByProvider: Record<string, string[]>) {
  return {
    data: {
      providers: Object.entries(modelsByProvider).map(([providerID, modelIDs]) => ({
        id: providerID,
        models: Object.fromEntries(modelIDs.map((modelID) => [modelID, { id: modelID }])),
      })),
    },
    error: null,
  };
}

function makeItems(count: number, prefix = "m"): Array<{ providerID: string; modelID: string }> {
  return Array.from({ length: count }, (_, i) => ({
    providerID: "p",
    modelID: `${prefix}${i}`,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("app/services/model-listing-service", () => {
  beforeEach(() => {
    providersMock.mockReset();
    getModelSelectionListsMock.mockReset();
    loggerErrorMock.mockReset();
  });

  // ---- getSupportedModes ---------------------------------------------------

  describe("getSupportedModes", () => {
    it("returns all and favoritesRecent", () => {
      expect(getSupportedModes()).toEqual(["all", "favoritesRecent"]);
    });

    it("does not include connected mode", () => {
      expect(getSupportedModes()).not.toContain("connected");
    });
  });

  // ---- buildAllConfiguredItems ---------------------------------------------

  describe("buildAllConfiguredItems", () => {
    it("returns one item per provider model", () => {
      const response = createProvidersResponse({
        openai: ["gpt-4o", "gpt-3.5"],
        anthropic: ["claude-sonnet"],
      });

      const items = buildAllConfiguredItems(response);
      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({ providerID: "openai", modelID: "gpt-4o", name: undefined });
      expect(items[1]).toEqual({ providerID: "openai", modelID: "gpt-3.5", name: undefined });
      expect(items[2]).toEqual({ providerID: "anthropic", modelID: "claude-sonnet", name: undefined });
    });

    it("returns empty array for empty providers", () => {
      const items = buildAllConfiguredItems({ data: { providers: [] }, error: null });
      expect(items).toHaveLength(0);
    });

    it("returns empty array when data is undefined", () => {
      const items = buildAllConfiguredItems({ data: undefined, error: new Error("fail") });
      expect(items).toHaveLength(0);
    });
  });

  // ---- buildFavoritesRecentItems -------------------------------------------

  describe("buildFavoritesRecentItems", () => {
    it("deduplicates favorites before recent", () => {
      const favorites = [{ providerID: "openai", modelID: "gpt-4o" }];
      const recent = [
        { providerID: "openai", modelID: "gpt-4o" }, // duplicate
        { providerID: "anthropic", modelID: "claude-sonnet" },
      ];

      const items = buildFavoritesRecentItems(favorites, recent);
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(items[1]).toEqual({ providerID: "anthropic", modelID: "claude-sonnet" });
    });

    it("places favorites before recent", () => {
      const favorites = [{ providerID: "anthropic", modelID: "claude-sonnet" }];
      const recent = [{ providerID: "openai", modelID: "gpt-4o" }];

      const items = buildFavoritesRecentItems(favorites, recent);
      expect(items).toHaveLength(2);
      expect(items[0].providerID).toBe("anthropic");
      expect(items[1].providerID).toBe("openai");
    });

    it("handles empty arrays", () => {
      expect(buildFavoritesRecentItems([], [])).toHaveLength(0);
    });

    it("handles duplicate within favorites", () => {
      const favorites = [
        { providerID: "openai", modelID: "gpt-4o" },
        { providerID: "openai", modelID: "gpt-4o" },
      ];

      const items = buildFavoritesRecentItems(favorites, []);
      expect(items).toHaveLength(1);
    });
  });

  // ---- paginateItems -------------------------------------------------------

  describe("paginateItems", () => {
    it("paginates with default page size 10", () => {
      const items = makeItems(12);
      const page = paginateItems(items, 0);

      expect(page.items).toHaveLength(10);
      expect(page.totalPages).toBe(2);
      expect(page.page).toBe(0);
      expect(page.totalItems).toBe(12);
    });

    it("returns remaining items on last page", () => {
      const items = makeItems(12);
      const page = paginateItems(items, 1);

      expect(page.items).toHaveLength(2);
      expect(page.page).toBe(1);
      expect(page.items[0].modelID).toBe("m10");
      expect(page.items[1].modelID).toBe("m11");
    });

    it("normalizes negative page to 0", () => {
      const items = makeItems(5);
      const page = paginateItems(items, -1);

      expect(page.page).toBe(0);
      expect(page.items).toHaveLength(5);
    });

    it("normalizes out-of-range page to last valid page", () => {
      const items = makeItems(5);
      const page = paginateItems(items, 100);

      expect(page.page).toBe(0);
      expect(page.items).toHaveLength(5);
    });

    it("handles empty items", () => {
      const page = paginateItems([], 0);

      expect(page.items).toHaveLength(0);
      expect(page.totalPages).toBe(1);
      expect(page.totalItems).toBe(0);
    });

    it("handles custom page size", () => {
      const items = makeItems(25);
      const page = paginateItems(items, 0, 20);

      expect(page.items).toHaveLength(20);
      expect(page.totalPages).toBe(2);
    });

    it("handles single item", () => {
      const items = makeItems(1);
      const page = paginateItems(items, 0);

      expect(page.items).toHaveLength(1);
      expect(page.totalPages).toBe(1);
    });
  });

  // ---- fetchAllConfiguredItems ---------------------------------------------

  describe("fetchAllConfiguredItems", () => {
    it("returns items from provider catalog", async () => {
      providersMock.mockResolvedValue(
        createProvidersResponse({
          openai: ["gpt-4o"],
          anthropic: ["claude-sonnet"],
        }),
      );

      const items = await fetchAllConfiguredItems();
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ providerID: "openai", modelID: "gpt-4o", name: undefined });
    });

    it("returns empty array on provider error", async () => {
      providersMock.mockResolvedValue({ data: null, error: new Error("upstream down") });

      const items = await fetchAllConfiguredItems();
      expect(items).toHaveLength(0);
    });

    it("returns empty array on exception", async () => {
      providersMock.mockRejectedValue(new Error("connection refused"));

      const items = await fetchAllConfiguredItems();
      expect(items).toHaveLength(0);
      expect(loggerErrorMock).toHaveBeenCalled();
    });
  });

  // ---- fetchFavoritesRecentItems -------------------------------------------

  describe("fetchFavoritesRecentItems", () => {
    it("returns deduplicated favorites and recent items", async () => {
      getModelSelectionListsMock.mockResolvedValue({
        favorites: [{ providerID: "openai", modelID: "gpt-4o" }],
        recent: [
          { providerID: "openai", modelID: "gpt-4o" },
          { providerID: "anthropic", modelID: "claude-sonnet" },
        ],
      });

      const items = await fetchFavoritesRecentItems();
      expect(items).toHaveLength(2);
      expect(items[0].providerID).toBe("openai");
      expect(items[1].providerID).toBe("anthropic");
    });

    it("returns empty array on exception", async () => {
      getModelSelectionListsMock.mockRejectedValue(new Error("file read error"));

      const items = await fetchFavoritesRecentItems();
      expect(items).toHaveLength(0);
      expect(loggerErrorMock).toHaveBeenCalled();
    });
  });

  // ---- Integration: All configured pagination ------------------------------
  // Scenario from QA: 12 models across 2 providers, page 0 -> 10 items / page 1 -> 2 items

  describe("all configured pagination (QA scenario)", () => {
    it("paginates 12 provider models into 2 pages of 10 and 2", async () => {
      providersMock.mockResolvedValue(
        createProvidersResponse({
          p1: Array.from({ length: 6 }, (_, i) => `m${i}`),
          p2: Array.from({ length: 6 }, (_, i) => `m${i + 6}`),
        }),
      );

      const allItems = buildAllConfiguredItems(await providersMock());
      expect(allItems).toHaveLength(12);

      const page0 = paginateItems(allItems, 0);
      expect(page0.items).toHaveLength(10);
      expect(page0.totalPages).toBe(2);
      expect(page0.page).toBe(0);

      const page1 = paginateItems(allItems, 1);
      expect(page1.items).toHaveLength(2);
      expect(page1.page).toBe(1);
    });
  });

  // ---- Integration: Favorites+recent deduplication -------------------------
  // Scenario from QA: same model in favorites and recent appears once

  describe("favorites+recent deduplication (QA scenario)", () => {
    it("deduplicates model appearing in both favorites and recent", () => {
      const favorites = [{ providerID: "openai", modelID: "gpt-test" }];
      const recent = [{ providerID: "openai", modelID: "gpt-test" }];

      const items = buildFavoritesRecentItems(favorites, recent);
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ providerID: "openai", modelID: "gpt-test" });
    });
  });
});
