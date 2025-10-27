export const CHAT_SUGGESTION_HISTORY_LIMIT = 6;
export const CHAT_SUGGESTION_MESSAGE_SNIPPET = 600;

export interface SuggestionSourceMessage {
  role: "assistant" | "user" | string;
  content: string;
}

export function formatChatHistoryForSuggestions(
  messages: SuggestionSourceMessage[],
): string {
  if (messages.length === 0) {
    return "";
  }

  return messages
    .map((message) => {
      const speaker = message.role === "assistant" ? "Assistant" : "User";
      const content =
        message.content.length > CHAT_SUGGESTION_MESSAGE_SNIPPET
          ? `${message.content.slice(0, CHAT_SUGGESTION_MESSAGE_SNIPPET)}…`
          : message.content;
      return `${speaker}: ${content}`;
    })
    .join("\n\n");
}

export function sanitizeChatSuggestions(rawSuggestions: string[]): string[] {
  const suggestions = rawSuggestions
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  const seen = new Map<string, string>();
  for (const text of suggestions) {
    const key = text.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, text);
    }
  }

  const uniqueSuggestions = Array.from(seen.values());

  return uniqueSuggestions.filter(
    (text) => text.trim().toLowerCase() !== "keep going",
  );
}
