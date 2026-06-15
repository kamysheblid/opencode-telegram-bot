import { describe, expect, it } from "vitest";
import {
  MODEL_PICKER_PAGE_SIZE,
  MODEL_PICKER_PAGE_PREFIX,
  buildModelPickerPageCallback,
  parseModelPickerPageCallback,
  calculateModelPickerRange,
} from "../../../src/bot/menus/model-selection-menu.js";

describe("buildModelPickerPageCallback", () => {
  it("builds callback string for page 0", () => {
    expect(buildModelPickerPageCallback(0)).toBe(`${MODEL_PICKER_PAGE_PREFIX}0`);
  });

  it("builds callback string for page 2", () => {
    expect(buildModelPickerPageCallback(2)).toBe(`${MODEL_PICKER_PAGE_PREFIX}2`);
  });
});

describe("parseModelPickerPageCallback", () => {
  it("parses valid page callback", () => {
    expect(parseModelPickerPageCallback("model:page:2")).toBe(2);
  });

  it("parses page 0 callback", () => {
    expect(parseModelPickerPageCallback("model:page:0")).toBe(0);
  });

  it("returns null for non-matching prefix", () => {
    expect(parseModelPickerPageCallback("model:search")).toBeNull();
  });

  it("returns null for non-integer suffix", () => {
    expect(parseModelPickerPageCallback("model:page:abc")).toBeNull();
  });

  it("returns null for negative page", () => {
    expect(parseModelPickerPageCallback("model:page:-1")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseModelPickerPageCallback("")).toBeNull();
  });

  it("returns null for unrelated callback", () => {
    expect(parseModelPickerPageCallback("model:openai:gpt-4o")).toBeNull();
  });
});

describe("calculateModelPickerRange", () => {
  it("returns first page range when total fits in one page", () => {
    const range = calculateModelPickerRange(5, 0, 10);
    expect(range.page).toBe(0);
    expect(range.totalPages).toBe(1);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(5);
  });

  it("calculates multi-page range for page 0", () => {
    const range = calculateModelPickerRange(25, 0, 10);
    expect(range.page).toBe(0);
    expect(range.totalPages).toBe(3);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(10);
  });

  it("calculates multi-page range for page 1", () => {
    const range = calculateModelPickerRange(25, 1, 10);
    expect(range.page).toBe(1);
    expect(range.totalPages).toBe(3);
    expect(range.startIndex).toBe(10);
    expect(range.endIndex).toBe(20);
  });

  it("calculates multi-page range for last page", () => {
    const range = calculateModelPickerRange(25, 2, 10);
    expect(range.page).toBe(2);
    expect(range.totalPages).toBe(3);
    expect(range.startIndex).toBe(20);
    expect(range.endIndex).toBe(25);
  });

  it("normalizes page beyond last page to last page", () => {
    const range = calculateModelPickerRange(25, 9, 10);
    expect(range.page).toBe(2);
    expect(range.totalPages).toBe(3);
    expect(range.startIndex).toBe(20);
    expect(range.endIndex).toBe(25);
  });

  it("normalizes negative page to 0", () => {
    const range = calculateModelPickerRange(15, -5, 10);
    expect(range.page).toBe(0);
    expect(range.totalPages).toBe(2);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(10);
  });

  it("handles zero items with one empty page", () => {
    const range = calculateModelPickerRange(0, 0, 10);
    expect(range.page).toBe(0);
    expect(range.totalPages).toBe(1);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(0);
  });

  it("uses default page size when pageSize is not provided", () => {
    const range = calculateModelPickerRange(MODEL_PICKER_PAGE_SIZE * 2 + 5, 0);
    expect(range.totalPages).toBe(3);
    expect(range.page).toBe(0);
    expect(range.endIndex).toBe(10);
  });

  it("handles page size of 1 correctly", () => {
    const range = calculateModelPickerRange(3, 0, 1);
    expect(range.page).toBe(0);
    expect(range.totalPages).toBe(3);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(1);
  });

  it("handles page size larger than total", () => {
    const range = calculateModelPickerRange(3, 0, 100);
    expect(range.page).toBe(0);
    expect(range.totalPages).toBe(1);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(3);
  });
});
