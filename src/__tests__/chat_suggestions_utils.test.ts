import { describe, it, expect } from "vitest";

import {
  CHAT_SUGGESTION_MESSAGE_SNIPPET,
  formatChatHistoryForSuggestions,
  sanitizeChatSuggestions,
} from "../ipc/handlers/chat_suggestions";

describe("formatChatHistoryForSuggestions", () => {
  it("returns empty string when no messages provided", () => {
    expect(formatChatHistoryForSuggestions([])).toBe("");
  });

  it("labels assistant and user messages", () => {
    const result = formatChatHistoryForSuggestions([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);

    expect(result).toBe("User: Hello\n\nAssistant: Hi there");
  });

  it("truncates overly long messages and appends ellipsis", () => {
    const longMessage = "x".repeat(CHAT_SUGGESTION_MESSAGE_SNIPPET + 10);

    const result = formatChatHistoryForSuggestions([
      { role: "user", content: longMessage },
    ]);

    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBe(
      "User: ".length + CHAT_SUGGESTION_MESSAGE_SNIPPET + 1,
    );
  });
});

describe("sanitizeChatSuggestions", () => {
  it("dedupes suggestions case-insensitively and trims whitespace", () => {
    const sanitized = sanitizeChatSuggestions([
      " Try feature flags ",
      "try Feature Flags",
      "",
      "   ",
      "Investigate performance",
    ]);

    expect(sanitized).toEqual([
      "Try feature flags",
      "Investigate performance",
    ]);
  });

  it("filters keep going suggestions", () => {
    const sanitized = sanitizeChatSuggestions([
      "Keep Going",
      "keep going",
      "KEEP GOING",
      "New idea",
    ]);

    expect(sanitized).toEqual(["New idea"]);
  });
});
