import { useEffect } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { syncSessions } from "../consoleStateSync";
import { launcherShouldRunGateway } from "../selectors/launcherSelectors";
import { shouldUseFastPolling } from "../selectors/sessionSelectors";
import { buildSessionOverviewWebSocketUrl, buildSessionWebSocketUrl } from "../transportUrls";
import type {
  LauncherStatusResponse,
  MessageRecord,
  SessionMessageCacheEntry,
  SessionOverviewEnvelope,
  SessionMessagesResponse,
  SessionRecord,
  SessionsResponse,
  SessionStreamEnvelope,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;

type UseSessionWorkspaceEffectsOptions = {
  requestJson: RequestJson;
  workspace: string;
  sessionsLoaded: boolean;
  setSessionsLoaded: (next: boolean) => void;
  currentRoleIsWorker: boolean;
  currentRoleIsConsole: boolean;
  localGatewayManaged: boolean | null;
  sessionRemoteGatewayBaseUrl: string;
  sessionRemoteNodeId: string;
  shouldUseLocalGatewayApi: boolean;
  launcherStatus: LauncherStatusResponse | null;
  selectedSessionId: string | null;
  sessions: SessionRecord[];
  messagesLength: number;
  messagesLoaded: boolean;
  activeTaskId: string | null | undefined;
  queueStatus: string | null | undefined;
  previousMessageSessionIdRef: MutableRefObject<string | null>;
  shouldAutoFollowMessagesRef: MutableRefObject<boolean>;
  pendingHistoryRestoreRef: MutableRefObject<{ sessionId: string; scrollHeight: number; scrollTop: number } | null>;
  messagesRef: RefObject<HTMLDivElement | null>;
  getSessionMessageCache: (sessionId: string | null) => SessionMessageCacheEntry | null;
  applySessionMessageEntry: (sessionId: string, entry: SessionMessageCacheEntry) => void;
  fetchSessionMessages: (
    sessionId: string,
    options?: { remoteGateway?: string | null; afterCount?: number; beforeCount?: number; limit?: number; fallbackToFull?: boolean },
  ) => Promise<SessionMessagesResponse>;
  syncSessionMessageCache: (
    sessionId: string,
    detail: SessionMessagesResponse,
    options?: { preserveExisting?: boolean; mergeMode?: "replace" | "append" | "prepend" },
  ) => SessionMessageCacheEntry;
  scrollMessagesToBottom: () => void;
  setSessions: Dispatch<SetStateAction<SessionRecord[]>>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setActiveSession: Dispatch<SetStateAction<SessionRecord | null>>;
  setMessages: Dispatch<SetStateAction<MessageRecord[]>>;
  setMessageCursor: (next: number) => void;
  setMessageHistoryStart: (next: number) => void;
  setMessageHasMoreBefore: (next: boolean) => void;
  setMessagesLoaded: (next: boolean) => void;
  setNotice: (next: string) => void;
};

export function useSessionWorkspaceEffects(options: UseSessionWorkspaceEffectsOptions) {
  const {
    requestJson,
    workspace,
    sessionsLoaded,
    setSessionsLoaded,
    currentRoleIsWorker,
    currentRoleIsConsole,
    localGatewayManaged,
    sessionRemoteGatewayBaseUrl,
    sessionRemoteNodeId,
    shouldUseLocalGatewayApi,
    launcherStatus,
    selectedSessionId,
    sessions,
    messagesLength,
    messagesLoaded,
    activeTaskId,
    queueStatus,
    previousMessageSessionIdRef,
    shouldAutoFollowMessagesRef,
    pendingHistoryRestoreRef,
    messagesRef,
    getSessionMessageCache,
    applySessionMessageEntry,
    fetchSessionMessages,
    syncSessionMessageCache,
    scrollMessagesToBottom,
    setSessions,
    setSelectedSessionId,
    setActiveSession,
    setMessages,
    setMessageCursor,
    setMessageHistoryStart,
    setMessageHasMoreBefore,
    setMessagesLoaded,
    setNotice,
  } = options;

  useEffect(() => {
    const pendingRestore = pendingHistoryRestoreRef.current;
    if (!pendingRestore || pendingRestore.sessionId !== selectedSessionId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (container) {
        const delta = container.scrollHeight - pendingRestore.scrollHeight;
        container.scrollTop = pendingRestore.scrollTop + delta;
      }
      pendingHistoryRestoreRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messagesLength, selectedSessionId]);

  useEffect(() => {
    const sessionChanged = previousMessageSessionIdRef.current !== selectedSessionId;
    previousMessageSessionIdRef.current = selectedSessionId;
    if (!sessionChanged && !shouldAutoFollowMessagesRef.current) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollMessagesToBottom();
      window.setTimeout(() => scrollMessagesToBottom(), 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messagesLength, messagesLoaded, selectedSessionId, activeTaskId, queueStatus, scrollMessagesToBottom]);

  useEffect(() => {
    if (workspace !== "sessions") return;
    const usesRemoteGateway = currentRoleIsWorker || (currentRoleIsConsole && localGatewayManaged === false);
    const remoteGateway = usesRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    if (usesRemoteGateway && !remoteGateway) return;
    if (!usesRemoteGateway && !shouldUseLocalGatewayApi) return;

    let cancelled = false;
    let reconnectTimer = 0;
    let httpTimer = 0;
    let socket: WebSocket | null = null;
    let socketReady = false;
    let reconnectAttempt = 0;
    const hasInitialSessions = sessionsLoaded;

    const applyOverview = (allSessions: SessionRecord[]) => {
      const nextSessions = currentRoleIsWorker
        ? allSessions.filter((session) => session.assigned_node_id === sessionRemoteNodeId)
        : allSessions;
      syncSessions(nextSessions, setSessions, setSelectedSessionId, setActiveSession);
      setSessionsLoaded(true);
    };

    const getReconnectDelay = (attempt: number) => Math.min(15000, 1500 * (2 ** Math.max(0, attempt)));

    const scheduleHttpPolling = (delay: number) => {
      window.clearTimeout(httpTimer);
      if (cancelled) return;
      httpTimer = window.setTimeout(() => {
        if (!socketReady) {
          void loadOverview();
        }
      }, delay);
    };

    const loadOverview = async () => {
      try {
        const response = await requestJson<SessionsResponse>(
          usesRemoteGateway ? `${remoteGateway}/api/sessions` : "/api/sessions",
        );
        if (cancelled) return;
        applyOverview(response.sessions);
        scheduleHttpPolling(3200);
      } catch {
        if (cancelled) return;
        scheduleHttpPolling(1000);
      }
    };

    const connect = () => {
      if (cancelled) return;
      try {
        socket = new WebSocket(buildSessionOverviewWebSocketUrl(remoteGateway));
      } catch {
        reconnectTimer = window.setTimeout(connect, getReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
        return;
      }

      socket.onopen = () => {
        if (cancelled) return;
        socketReady = true;
        reconnectAttempt = 0;
        window.clearTimeout(httpTimer);
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        let payload: SessionOverviewEnvelope;
        try {
          payload = JSON.parse(event.data) as SessionOverviewEnvelope;
        } catch {
          return;
        }
        if (payload.type !== "sessions_snapshot" || !Array.isArray(payload.sessions)) return;
        applyOverview(payload.sessions);
      };

      socket.onclose = () => {
        if (cancelled) return;
        socketReady = false;
        scheduleHttpPolling(hasInitialSessions ? 3200 : 1000);
        reconnectTimer = window.setTimeout(connect, getReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
      };

      socket.onerror = () => {
        try {
          socket?.close();
        } catch {
          // ignore close errors
        }
      };
    };

    connect();
    if (!hasInitialSessions) {
      scheduleHttpPolling(1000);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(httpTimer);
      try {
        socket?.close();
      } catch {
        // ignore teardown close errors
      }
    };
  }, [currentRoleIsConsole, currentRoleIsWorker, localGatewayManaged, sessionRemoteGatewayBaseUrl, sessionRemoteNodeId, sessionsLoaded, shouldUseLocalGatewayApi, workspace]);

  useEffect(() => {
    shouldAutoFollowMessagesRef.current = true;
    pendingHistoryRestoreRef.current = null;
    if (!selectedSessionId) {
      setActiveSession(null);
      setMessages([]);
      setMessageCursor(0);
      setMessageHistoryStart(0);
      setMessageHasMoreBefore(false);
      setMessagesLoaded(true);
      return;
    }
    const cached = getSessionMessageCache(selectedSessionId);
    if (cached?.loaded) {
      setActiveSession(cached.session ?? sessions.find((item) => item.session_id === selectedSessionId) ?? null);
    setMessages(cached.messages);
      setMessageCursor(cached.cursor);
      setMessageHistoryStart(cached.historyStart);
      setMessageHasMoreBefore(cached.hasMoreBefore);
      setMessagesLoaded(true);
      return;
    }
    setActiveSession(sessions.find((item) => item.session_id === selectedSessionId) ?? null);
    setMessages([]);
    setMessageCursor(0);
    setMessageHistoryStart(0);
    setMessageHasMoreBefore(false);
    setMessagesLoaded(false);
  }, [getSessionMessageCache, selectedSessionId, sessions]);

  useEffect(() => {
    if (workspace !== "sessions") return;
    if (!selectedSessionId) return;
    const remoteGateway = sessionRemoteGatewayBaseUrl;
    const usesRemoteGateway = currentRoleIsWorker || (currentRoleIsConsole && !launcherShouldRunGateway(launcherStatus));
    if (usesRemoteGateway && !remoteGateway) return;
    if (!usesRemoteGateway && !shouldUseLocalGatewayApi) return;

    let cancelled = false;
    let httpTimer = 0;
    let reconnectTimer = 0;
    let socket: WebSocket | null = null;
    let socketReady = false;
    let reconnectAttempt = 0;
    const sessionId = selectedSessionId;
    const getReconnectDelay = (attempt: number) => Math.min(15000, 1500 * (2 ** Math.max(0, attempt)));

    const cached = getSessionMessageCache(sessionId);
    if (cached?.loaded) {
      applySessionMessageEntry(sessionId, cached);
    }

    const loadMessages = async (preferIncremental: boolean) => {
      const nextCached = getSessionMessageCache(sessionId);
      const hasCache = Boolean(nextCached?.loaded);
      const afterCount = preferIncremental && nextCached?.loaded ? nextCached.cursor : 0;
      if (!hasCache && !preferIncremental) {
        setMessagesLoaded(false);
      }
      try {
        const detail = await fetchSessionMessages(sessionId, {
          remoteGateway,
          afterCount,
          limit: !hasCache && !preferIncremental ? 50 : undefined,
          fallbackToFull: true,
        });
        if (cancelled || selectedSessionId !== sessionId) return;
        const entry = syncSessionMessageCache(sessionId, detail, {
          preserveExisting: preferIncremental,
          mergeMode: preferIncremental ? "append" : "replace",
        });
        applySessionMessageEntry(sessionId, entry);
        const nextDelay = shouldUseFastPolling(detail.session) ? 1200 : 3200;
        if (!cancelled) httpTimer = window.setTimeout(() => void loadMessages(true), nextDelay);
      } catch (error) {
        if (cancelled || selectedSessionId !== sessionId) return;
        if (!getSessionMessageCache(sessionId)?.loaded) {
          setMessages([]);
          setMessageCursor(0);
          setMessagesLoaded(true);
        }
        setNotice(`读取会话消息失败：${(error as Error).message}`);
        if (!cancelled) httpTimer = window.setTimeout(() => void loadMessages(Boolean(getSessionMessageCache(sessionId)?.loaded)), 1000);
      }
    };

    const stopHttpPolling = () => {
      window.clearTimeout(httpTimer);
      httpTimer = 0;
    };

    const scheduleHttpPolling = (preferIncremental: boolean) => {
      stopHttpPolling();
      void loadMessages(preferIncremental);
    };

    const connectSessionSocket = () => {
      if (cancelled) return;
      let receivedPayload = false;
      let receivedSnapshot = false;
      let snapshotTimeout = 0;
      try {
        socket = new WebSocket(buildSessionWebSocketUrl(sessionId, remoteGateway));
      } catch {
        scheduleHttpPolling(Boolean(getSessionMessageCache(sessionId)?.loaded));
        reconnectTimer = window.setTimeout(() => {
          connectSessionSocket();
        }, getReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
        return;
      }
      socket.onopen = () => {
        reconnectAttempt = 0;
      };
      snapshotTimeout = window.setTimeout(() => {
        if (cancelled || receivedPayload) return;
        try {
          socket?.close();
        } catch {
          // ignore close errors
        }
        scheduleHttpPolling(Boolean(getSessionMessageCache(sessionId)?.loaded));
      }, 2500);
      socket.onmessage = (event) => {
        if (cancelled || selectedSessionId !== sessionId) return;
        let payload: SessionStreamEnvelope;
        try {
          payload = JSON.parse(event.data) as SessionStreamEnvelope;
        } catch {
          return;
        }
        receivedPayload = true;
        if (payload.type === "snapshot") {
          receivedSnapshot = true;
        }
        window.clearTimeout(snapshotTimeout);
        stopHttpPolling();
        socketReady = true;
        reconnectAttempt = 0;
        const entry = syncSessionMessageCache(
          sessionId,
          {
            session: payload.session,
            messages: payload.messages,
            next_cursor: payload.next_cursor,
            replace_messages: payload.replace_messages,
            history_start: payload.history_start,
            has_more_before: payload.has_more_before,
          },
          {
            preserveExisting: payload.type === "messages_appended",
            mergeMode: payload.type === "messages_appended" ? "append" : "replace",
          },
        );
        applySessionMessageEntry(sessionId, entry);
      };
      socket.onerror = () => {
        if (cancelled) return;
        if (!receivedPayload) {
          scheduleHttpPolling(Boolean(getSessionMessageCache(sessionId)?.loaded));
        }
      };
      socket.onclose = () => {
        window.clearTimeout(snapshotTimeout);
        if (cancelled) return;
        socket = null;
        socketReady = false;
        scheduleHttpPolling(Boolean(getSessionMessageCache(sessionId)?.loaded || receivedSnapshot));
        reconnectTimer = window.setTimeout(() => {
          connectSessionSocket();
        }, getReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
      };
    };

    connectSessionSocket();

    const onVisible = () => {
      if (document.hidden) return;
      window.clearTimeout(reconnectTimer);
      if (socketReady) return;
      scheduleHttpPolling(Boolean(getSessionMessageCache(sessionId)?.loaded));
      connectSessionSocket();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      stopHttpPolling();
      window.clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // ignore teardown close errors
      }
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applySessionMessageEntry, currentRoleIsConsole, currentRoleIsWorker, fetchSessionMessages, getSessionMessageCache, launcherStatus, selectedSessionId, sessionRemoteGatewayBaseUrl, shouldUseLocalGatewayApi, syncSessionMessageCache, workspace]);
}
