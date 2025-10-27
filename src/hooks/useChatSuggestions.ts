import { useCallback, useEffect, useRef, useState } from "react";

import { IpcClient } from "@/ipc/ipc_client";

interface UseChatSuggestionsParams {
  chatId?: number;
  enabled: boolean;
  lastMessageId?: number | string;
  modelSignature: string;
  isStreaming: boolean;
}

interface UseChatSuggestionsResult {
  suggestions: string[];
  isLoading: boolean;
  error: string | null;
  refreshSuggestions: () => Promise<void>;
}

export function useChatSuggestions({
  chatId,
  enabled,
  lastMessageId,
  modelSignature,
  isStreaming,
}: UseChatSuggestionsParams): UseChatSuggestionsResult {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchSuggestions = useCallback(async () => {
    if (!chatId || !enabled) {
      requestIdRef.current += 1;
      setSuggestions([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const response = await IpcClient.getInstance().getChatSuggestions({
        chatId,
      });
      if (requestIdRef.current !== requestId) {
        return;
      }
      setSuggestions(response);
    } catch (err) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      console.error("Failed to fetch chat suggestions", err);
      setError(err instanceof Error ? err.message : String(err));
      setSuggestions([]);
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [chatId, enabled, modelSignature]);

  useEffect(() => {
    if (!enabled) {
      setSuggestions([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (!chatId) {
      setSuggestions([]);
      return;
    }

    if (isStreaming) {
      return;
    }

    void fetchSuggestions();
  }, [chatId, enabled, fetchSuggestions, isStreaming, lastMessageId, modelSignature]);

  return {
    suggestions,
    isLoading,
    error,
    refreshSuggestions: fetchSuggestions,
  };
}
