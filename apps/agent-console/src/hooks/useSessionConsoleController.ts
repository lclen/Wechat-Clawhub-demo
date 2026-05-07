import { useCallback } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type {
  AppUiStateCache,
  GatewaySummaryResponse,
  MessageRecord,
  SessionMessageCacheEntry,
  SessionMessagesResponse,
  SessionRecord,
  SessionSwitchAction,
  SessionSwitchRequest,
  SessionSwitchResponse,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;
type WithBusy = <T>(key: string, task: () => Promise<T>) => Promise<T>;

type UseSessionConsoleControllerOptions = {
  requestJson: RequestJson;
  withBusy: WithBusy;
  messagesRef: RefObject<HTMLDivElement | null>;
  shouldAutoFollowMessagesRef: MutableRefObject<boolean>;
  pendingHistoryRestoreRef: MutableRefObject<{ sessionId: string; scrollHeight: number; scrollTop: number } | null>;
  sessionMessageCacheRef: MutableRefObject<Map<string, SessionMessageCacheEntry>>;
  selectedSessionId: string | null;
  messageHistoryLoading: boolean;
  messageHasMoreBefore: boolean;
  messageHistoryStart: number;
  shouldUseLocalGatewayApi: boolean;
  shouldUseRemoteGatewayApi: boolean;
  sessionRemoteGatewayBaseUrl: string;
  setSessions: Dispatch<SetStateAction<SessionRecord[]>>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setActiveSession: Dispatch<SetStateAction<SessionRecord | null>>;
  setMessages: Dispatch<SetStateAction<MessageRecord[]>>;
  setMessageCursor: Dispatch<SetStateAction<number>>;
  setMessageHistoryStart: Dispatch<SetStateAction<number>>;
  setMessageHasMoreBefore: Dispatch<SetStateAction<boolean>>;
  setMessagesLoaded: Dispatch<SetStateAction<boolean>>;
  setMessageHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setNotice: (next: string) => void;
  refreshGatewaySummarySnapshot: () => Promise<GatewaySummaryResponse | null>;
  saveUiStateCache: (patch: Partial<AppUiStateCache>) => void;
};

export function useSessionConsoleController(options: UseSessionConsoleControllerOptions) {
  const {
    requestJson,
    withBusy,
    messagesRef,
    shouldAutoFollowMessagesRef,
    pendingHistoryRestoreRef,
    sessionMessageCacheRef,
    selectedSessionId,
    messageHistoryLoading,
    messageHasMoreBefore,
    messageHistoryStart,
    shouldUseLocalGatewayApi,
    shouldUseRemoteGatewayApi,
    sessionRemoteGatewayBaseUrl,
    setSessions,
    setSelectedSessionId,
    setActiveSession,
    setMessages,
    setMessageCursor,
    setMessageHistoryStart,
    setMessageHasMoreBefore,
    setMessagesLoaded,
    setMessageHistoryLoading,
    setNotice,
    refreshGatewaySummarySnapshot,
    saveUiStateCache,
  } = options;

  const persistSessionScrollState = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return;
    saveUiStateCache({
      session_scroll: selectedSessionId
        ? {
            session_id: selectedSessionId,
            scroll_top: container.scrollTop,
            offset_from_bottom: Math.max(0, container.scrollHeight - container.clientHeight - container.scrollTop),
            follow_bottom: shouldAutoFollowMessagesRef.current,
          }
        : null,
    });
  }, [messagesRef, saveUiStateCache, selectedSessionId, shouldAutoFollowMessagesRef]);

  const scrollMessagesToBottom = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    shouldAutoFollowMessagesRef.current = true;
    persistSessionScrollState();
  }, [messagesRef, persistSessionScrollState, shouldAutoFollowMessagesRef]);

  const isMessageStreamNearBottom = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
  }, [messagesRef]);

  const resolveHistoryStart = useCallback((detail: SessionMessagesResponse, fallbackCursor?: number) => {
    if (typeof detail.history_start === "number" && Number.isFinite(detail.history_start)) {
      return Math.max(0, detail.history_start);
    }
    const basis = typeof fallbackCursor === "number" ? fallbackCursor : detail.next_cursor;
    return Math.max(0, basis - detail.messages.length);
  }, []);

  const isIncrementalSessionMessagesEmpty = useCallback(
    (detail: SessionMessagesResponse, previousCursor: number) =>
      !detail.replace_messages && detail.messages.length === 0 && detail.next_cursor <= previousCursor,
    [],
  );

  const fetchSessionMessages = useCallback(async (
    sessionId: string,
    fetchOptions?: { remoteGateway?: string | null; afterCount?: number; beforeCount?: number; limit?: number; fallbackToFull?: boolean },
  ) => {
    const remoteGateway = fetchOptions?.remoteGateway?.trim() || "";
    const afterCount = fetchOptions?.afterCount ?? 0;
    const beforeCount = fetchOptions?.beforeCount;
    const limit = fetchOptions?.limit;
    const params = new URLSearchParams();
    if (afterCount > 0) params.append("after_count", String(afterCount));
    if (beforeCount !== undefined && beforeCount > 0) params.append("before_count", String(beforeCount));
    if (limit !== undefined && limit > 0) params.append("limit", String(limit));
    const query = params.toString() ? `?${params.toString()}` : "";
    const url = remoteGateway
      ? `${remoteGateway}/api/sessions/${encodeURIComponent(sessionId)}/messages${query}`
      : `/api/sessions/${encodeURIComponent(sessionId)}/messages${query}`;
    try {
      return await requestJson<SessionMessagesResponse>(url);
    } catch (error) {
      const failure = error as Error & { status?: number };
      if (fetchOptions?.fallbackToFull && afterCount > 0 && failure.status === 400) {
        const fullUrl = remoteGateway
          ? `${remoteGateway}/api/sessions/${encodeURIComponent(sessionId)}/messages`
          : `/api/sessions/${encodeURIComponent(sessionId)}/messages`;
        return await requestJson<SessionMessagesResponse>(fullUrl);
      }
      throw error;
    }
  }, [requestJson]);

  const mergeMessages = useCallback((current: MessageRecord[], incoming: MessageRecord[]) => {
    if (!incoming.length) return current;
    const merged = new Map(current.map((message) => [message.message_id, message]));
    for (const message of incoming) {
      merged.set(message.message_id, message);
    }
    return Array.from(merged.values()).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, []);

  const getSessionMessageCache = useCallback((sessionId: string | null) => {
    if (!sessionId) return null;
    return sessionMessageCacheRef.current.get(sessionId) ?? null;
  }, [sessionMessageCacheRef]);

  const shouldPreserveSessionHistory = useCallback((current: SessionMessageCacheEntry | undefined, detail: SessionMessagesResponse) => {
    if (!current?.loaded) return false;
    if (!detail.replace_messages) return false;
    if (detail.next_cursor < current.cursor) return false;
    const incomingHistoryStart = resolveHistoryStart(detail, current.cursor);
    if (current.historyStart < incomingHistoryStart) return true;
    return current.messages.length > detail.messages.length;
  }, [resolveHistoryStart]);

  const syncSessionMessageCache = useCallback((
    sessionId: string,
    detail: SessionMessagesResponse,
    syncOptions?: { preserveExisting?: boolean; mergeMode?: "replace" | "append" | "prepend" },
  ) => {
    const current = sessionMessageCacheRef.current.get(sessionId);
    const preserveHistory = shouldPreserveSessionHistory(current, detail);
    const mergeMode = syncOptions?.mergeMode ?? (detail.replace_messages ? "replace" : "append");
    const nextMessages =
      preserveHistory
        ? mergeMessages(current?.messages ?? [], detail.messages)
        : mergeMode === "prepend"
          ? mergeMessages(detail.messages, current?.messages ?? [])
          : syncOptions?.preserveExisting && current?.loaded && !detail.replace_messages
            ? mergeMessages(current.messages, detail.messages)
            : detail.replace_messages
              ? detail.messages
              : mergeMessages(current?.messages ?? [], detail.messages);
    const responseHistoryStart = resolveHistoryStart(detail, current?.cursor);
    const responseHasMoreBefore =
      typeof detail.has_more_before === "boolean"
        ? detail.has_more_before
        : responseHistoryStart > 0;
    const nextHistoryStart =
      preserveHistory
        ? current?.historyStart ?? responseHistoryStart
        : mergeMode === "append"
          ? current?.historyStart ?? responseHistoryStart
          : responseHistoryStart;
    const nextHasMoreBefore =
      preserveHistory
        ? current?.hasMoreBefore ?? responseHasMoreBefore
        : mergeMode === "append"
          ? current?.hasMoreBefore ?? responseHasMoreBefore
          : responseHasMoreBefore;
    const entry: SessionMessageCacheEntry = {
      session: detail.session,
      messages: nextMessages,
      cursor: detail.next_cursor,
      historyStart: nextHistoryStart,
      hasMoreBefore: nextHasMoreBefore,
      loaded: true,
      lastLoadedAt: Date.now(),
    };
    sessionMessageCacheRef.current.set(sessionId, entry);
    return entry;
  }, [mergeMessages, resolveHistoryStart, sessionMessageCacheRef, shouldPreserveSessionHistory]);

  const applySessionMessageEntry = useCallback((sessionId: string, entry: SessionMessageCacheEntry) => {
    if (selectedSessionId !== sessionId) return;
    setActiveSession(entry.session ?? null);
    setMessages(entry.messages);
    setMessageCursor(entry.cursor);
    setMessageHistoryStart(entry.historyStart);
    setMessageHasMoreBefore(entry.hasMoreBefore);
    setMessagesLoaded(entry.loaded);
  }, [selectedSessionId, setActiveSession, setMessageCursor, setMessageHasMoreBefore, setMessageHistoryStart, setMessages, setMessagesLoaded]);

  const loadOlderSessionMessages = useCallback(async () => {
    if (!selectedSessionId || messageHistoryLoading || !messageHasMoreBefore || messageHistoryStart <= 0) {
      return;
    }
    const sessionId = selectedSessionId;
    const usesRemoteGateway = shouldUseRemoteGatewayApi;
    const remoteGateway = usesRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    if (usesRemoteGateway && !remoteGateway) return;
    if (!usesRemoteGateway && !shouldUseLocalGatewayApi) return;

    const current = getSessionMessageCache(sessionId);
    const beforeCount = current?.historyStart ?? messageHistoryStart;
    if (beforeCount <= 0) return;

    const container = messagesRef.current;
    if (container) {
      pendingHistoryRestoreRef.current = {
        sessionId,
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    } else {
      pendingHistoryRestoreRef.current = null;
    }
    shouldAutoFollowMessagesRef.current = false;
    setMessageHistoryLoading(true);
    try {
      const detail = await fetchSessionMessages(sessionId, {
        remoteGateway,
        beforeCount,
        limit: Math.min(50, beforeCount),
      });
      if (selectedSessionId !== sessionId) return;
      const entry = syncSessionMessageCache(sessionId, detail, { mergeMode: "prepend" });
      applySessionMessageEntry(sessionId, entry);
    } catch (error) {
      pendingHistoryRestoreRef.current = null;
      setNotice(`加载更早消息失败：${(error as Error).message}`);
    } finally {
      if (selectedSessionId === sessionId) {
        setMessageHistoryLoading(false);
      }
    }
  }, [applySessionMessageEntry, fetchSessionMessages, getSessionMessageCache, messageHasMoreBefore, messageHistoryLoading, messageHistoryStart, messagesRef, pendingHistoryRestoreRef, selectedSessionId, sessionRemoteGatewayBaseUrl, setMessageHistoryLoading, setNotice, shouldAutoFollowMessagesRef, shouldUseLocalGatewayApi, shouldUseRemoteGatewayApi, syncSessionMessageCache]);

  const handleMessageStreamScroll = useCallback(() => {
    shouldAutoFollowMessagesRef.current = isMessageStreamNearBottom();
    persistSessionScrollState();
    const container = messagesRef.current;
    if (container && container.scrollTop <= 24 && selectedSessionId && messageHasMoreBefore && !messageHistoryLoading) {
      void loadOlderSessionMessages();
    }
  }, [isMessageStreamNearBottom, loadOlderSessionMessages, messageHasMoreBefore, messageHistoryLoading, messagesRef, persistSessionScrollState, selectedSessionId, shouldAutoFollowMessagesRef]);

  const upsertSessionInView = useCallback((nextSession: SessionRecord) => {
    setSessions((current) => {
      const exists = current.some((item) => item.session_id === nextSession.session_id);
      return exists
        ? current.map((item) => (item.session_id === nextSession.session_id ? nextSession : item))
        : [nextSession, ...current];
    });
    setSelectedSessionId((current) => current ?? nextSession.session_id);
    setActiveSession((current) => (current?.session_id === nextSession.session_id ? nextSession : current));
  }, [setActiveSession, setSelectedSessionId, setSessions]);

  const refreshSessionDetail = useCallback(async (sessionId: string) => {
    const remoteGateway = sessionRemoteGatewayBaseUrl;
    const detail = await fetchSessionMessages(sessionId, { remoteGateway });
    const entry = syncSessionMessageCache(sessionId, detail);
    applySessionMessageEntry(sessionId, entry);
  }, [applySessionMessageEntry, fetchSessionMessages, sessionRemoteGatewayBaseUrl, syncSessionMessageCache]);

  const switchSessionNode = useCallback(async (sessionId: string, action: SessionSwitchAction, nodeId?: string) => {
    if (action === "manual" && !nodeId) {
      setNotice("请先选择要绑定的节点。");
      return;
    }
    const remoteGateway = shouldUseRemoteGatewayApi ? sessionRemoteGatewayBaseUrl.trim() : "";
    const endpoint = remoteGateway
      ? `${remoteGateway}/api/sessions/${encodeURIComponent(sessionId)}/switch-node`
      : `/api/sessions/${encodeURIComponent(sessionId)}/switch-node`;
    try {
      const payload: SessionSwitchRequest = {
        action,
        reason: action === "manual" ? "console_manual_bind" : "console_restore_auto",
      };
      if (action === "manual" && nodeId) {
        payload.node_id = nodeId;
      }
      const result = await withBusy(
        "session-switch-node",
        () => requestJson<SessionSwitchResponse>(endpoint, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
      upsertSessionInView(result.session);
      await Promise.all([
        refreshSessionDetail(sessionId),
        refreshGatewaySummarySnapshot(),
      ]);
      setNotice(result.detail || "已提交会话切换请求。");
    } catch (error) {
      setNotice(`切换会话节点失败：${(error as Error).message}`);
    }
  }, [refreshGatewaySummarySnapshot, refreshSessionDetail, requestJson, sessionRemoteGatewayBaseUrl, setNotice, shouldUseRemoteGatewayApi, upsertSessionInView, withBusy]);

  return {
    scrollMessagesToBottom,
    handleMessageStreamScroll,
    fetchSessionMessages,
    isIncrementalSessionMessagesEmpty,
    getSessionMessageCache,
    syncSessionMessageCache,
    applySessionMessageEntry,
    loadOlderSessionMessages,
    upsertSessionInView,
    refreshSessionDetail,
    switchSessionNode,
    persistSessionScrollState,
  };
}
