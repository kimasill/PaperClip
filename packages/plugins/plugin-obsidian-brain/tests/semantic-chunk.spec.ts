import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../src/semantic-search.js";

describe("chunkMarkdown", () => {
  it("splits oversized paragraphs", () => {
    const long = "x".repeat(2000);
    const chunks = chunkMarkdown(long, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 400)).toBe(true);
  });

  it("merges short paragraphs up to maxChars", () => {
    const text = "a\n\nb\n\nc";
    const chunks = chunkMarkdown(text, 100);
    expect(chunks.length).toBe(1);
  });
});
