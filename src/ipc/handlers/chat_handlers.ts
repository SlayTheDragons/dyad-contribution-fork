import { ipcMain } from "electron";
import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { desc, eq, and, like } from "drizzle-orm";
import type { ChatSearchResult, ChatSummary } from "../../lib/schemas";
import * as git from "isomorphic-git";
import * as fs from "fs";
import { createLoggedHandler } from "./safe_handle";
import {
  CHAT_SUGGESTION_HISTORY_LIMIT,
  CHAT_SUGGESTION_MESSAGE_SNIPPET,
  formatChatHistoryForSuggestions,
  sanitizeChatSuggestions,
} from "./chat_suggestions";

import log from "electron-log";
import { getDyadAppPath } from "../../paths/paths";
import { UpdateChatParams } from "../ipc_types";
import { readSettings } from "../../main/settings";
import { generateObject } from "ai";
import { z } from "zod";
import { getModelClient } from "../utils/get_model_client";

const logger = log.scope("chat_handlers");
const handle = createLoggedHandler(logger);

const ChatSuggestionSchema = z.object({
  suggestions: z
    .array(z.string().min(1).max(160))
    .min(1)
    .max(3),
});

export function registerChatHandlers() {
  handle("create-chat", async (_, appId: number): Promise<number> => {
    // Get the app's path first
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
      columns: {
        path: true,
      },
    });

    if (!app) {
      throw new Error("App not found");
    }

    let initialCommitHash = null;
    try {
      // Get the current git revision of main branch
      initialCommitHash = await git.resolveRef({
        fs,
        dir: getDyadAppPath(app.path),
        ref: "main",
      });
    } catch (error) {
      logger.error("Error getting git revision:", error);
      // Continue without the git revision
    }

    // Create a new chat
    const [chat] = await db
      .insert(chats)
      .values({
        appId,
        initialCommitHash,
      })
      .returning();
    logger.info(
      "Created chat:",
      chat.id,
      "for app:",
      appId,
      "with initial commit hash:",
      initialCommitHash,
    );
    return chat.id;
  });

  ipcMain.handle("get-chat", async (_, chatId: number) => {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      with: {
        messages: {
          orderBy: (messages, { asc }) => [asc(messages.createdAt)],
        },
      },
    });

    if (!chat) {
      throw new Error("Chat not found");
    }

    return chat;
  });

  handle("get-chats", async (_, appId?: number): Promise<ChatSummary[]> => {
    // If appId is provided, filter chats for that app
    const query = appId
      ? db.query.chats.findMany({
          where: eq(chats.appId, appId),
          columns: {
            id: true,
            title: true,
            createdAt: true,
            appId: true,
          },
          orderBy: [desc(chats.createdAt)],
        })
      : db.query.chats.findMany({
          columns: {
            id: true,
            title: true,
            createdAt: true,
            appId: true,
          },
          orderBy: [desc(chats.createdAt)],
        });

    const allChats = await query;
    return allChats;
  });

  handle("delete-chat", async (_, chatId: number): Promise<void> => {
    await db.delete(chats).where(eq(chats.id, chatId));
  });

  handle("update-chat", async (_, { chatId, title }: UpdateChatParams) => {
    await db.update(chats).set({ title }).where(eq(chats.id, chatId));
  });

  handle("delete-messages", async (_, chatId: number): Promise<void> => {
    await db.delete(messages).where(eq(messages.chatId, chatId));
  });

  handle(
    "chat:get-suggestions",
    async (_event, { chatId }: { chatId: number }): Promise<string[]> => {
      try {
        const settings = readSettings();
        if (!settings.enableChatSuggestions) {
          return [];
        }

        const suggestionModel = settings.chatSuggestionModel ?? settings.selectedModel;
        if (!suggestionModel) {
          return [];
        }

        const history = await db
          .select({ role: messages.role, content: messages.content })
          .from(messages)
          .where(eq(messages.chatId, chatId))
          .orderBy(desc(messages.createdAt))
          .limit(CHAT_SUGGESTION_HISTORY_LIMIT);

        const orderedHistory = history.reverse();
        const conversation = formatChatHistoryForSuggestions(orderedHistory);

        const { modelClient } = await getModelClient(suggestionModel, settings);
        const result = await generateObject({
          model: modelClient.model,
          schema: ChatSuggestionSchema,
          system:
            "You are a coding copilot suggesting concise follow-up prompts. Offer up to three actionable ideas that help progress the project. Keep each suggestion under 120 characters and avoid repeating earlier instructions.",
          prompt: `Conversation so far:\n${conversation || "No prior messages."}\n\nSuggest up to three distinct next messages the user could send.`,
          maxRetries: 1,
        });

        const suggestions = sanitizeChatSuggestions(result.object.suggestions);

        return suggestions.slice(0, 3);
      } catch (error) {
        logger.error(`Error generating chat suggestions for chat ${chatId}:`, error);
        return [];
      }
    },
  );

  handle(
    "search-chats",
    async (_, appId: number, query: string): Promise<ChatSearchResult[]> => {
      // 1) Find chats by title and map to ChatSearchResult with no matched message
      const chatTitleMatches = await db
        .select({
          id: chats.id,
          appId: chats.appId,
          title: chats.title,
          createdAt: chats.createdAt,
        })
        .from(chats)
        .where(and(eq(chats.appId, appId), like(chats.title, `%${query}%`)))
        .orderBy(desc(chats.createdAt))
        .limit(10);

      const titleResults: ChatSearchResult[] = chatTitleMatches.map((c) => ({
        id: c.id,
        appId: c.appId,
        title: c.title,
        createdAt: c.createdAt,
        matchedMessageContent: null,
      }));

      // 2) Find messages that match and join to chats to build one result per message
      const messageResults = await db
        .select({
          id: chats.id,
          appId: chats.appId,
          title: chats.title,
          createdAt: chats.createdAt,
          matchedMessageContent: messages.content,
        })
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(
          and(eq(chats.appId, appId), like(messages.content, `%${query}%`)),
        )
        .orderBy(desc(chats.createdAt))
        .limit(10);

      // Combine: keep title matches and per-message matches
      const combined: ChatSearchResult[] = [...titleResults, ...messageResults];
      const uniqueChats = Array.from(
        new Map(combined.map((item) => [item.id, item])).values(),
      );

      // Sort newest chats first
      uniqueChats.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return uniqueChats;
    },
  );
}
