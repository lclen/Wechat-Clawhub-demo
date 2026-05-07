import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { syncSessions } from "../consoleStateSync";
import { shouldUseFastPolling } from "../selectors/sessionSelectors";
import { buildSessionOverviewWebSocketUrl, buildSessionWebSocketUrl } from "../transportUrls";
import type {
  LauncherStatusResponse,
  MessageRecord,
  SessionMessageCacheEntry,
  SessionOverviewEnvelope,
  SessionMessagesResponse,
  SessionRecord,
  SessionScrollState,
  SessionsResponse,
  SessionStreamEnvelope,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;

const SESSION_POLL_OWNER_STORAGE_PREFIX = "agent-console:session-poll-owner:";
const SESSION_POLL_TAB_ID_STORAGE_KEY = "agent-console:session-poll-tab-id";
const SESSION_POLL_OWNER_TTL_MS = 15000;
const SESSION_POLL_OWNER_REFRESH_MS = 5000;

type SessionPollOwnerRecord = {
  tabId: string;
  expiresAt: number;
};

function getSessionPollTabId() {
  const existing = window.sessionStorage.getItem(SESSION_POLL_TAB_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const created =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(SESSION_POLL_TAB_ID_STORAGE_KEY, created);
  return created;
}

function readSessionPollOwner(sessionId: string): SessionPollOwnerRecord | null {
  try {
    const raw = window.localStorage.getItem(`${SESSION_POLL_OWNER_STORAGE_PREFIX}${sessionId}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as SessionPollOwnerRecord;
    if (!parsed?.tabId || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionPollOwner(sessionId: string, record: SessionPollOwnerRecord) {
  try {
    window.localStorage.setItem(`${SESSION_POLL_OWNER_STORAGE_PREFIX}${sessionId}`, JSON.stringify(record));
  } catch {
    // ignore storage failures
  }
}

function clearSessionPollOwner(sessionId: string, tabId: string) {
  const current = readSessionPollOwner(sessionId);
  if (!current || current.tabId !== tabId) {
    return;
  }
  try {
    window.localStorage.removeItem(`${SESSION_POLL_OWNER_STORAGE_PREFIX}${sessionId}`);
  } catch {
    // ignore storage failures
  }
}

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
  shouldUseRemoteGatewayApi: boolean;
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
  restoredSessionScrollRef: MutableRefObject<SessionScrollState | null>;
  messagesRef: RefObject<HTMLDivElement | null>;
  getPersistedSessionScroll: (sessionId: string | null) => SessionScrollState | null;
  getSessionMessageCache: (sessionId: string | null) => SessionMessageCacheEntry | null;
  applySessionMessageEntry: (sessionId: string, entry: SessionMessageCacheEntry) => void;
  fetchSessionMessages: (
    sessionId: string,
    options?: { remoteGateway?: string | null; afterCount?: number; beforeCount?: number; limit?: number; fallbackToFull?: boolean },
  ) => Promise<SessionMessagesResponse>;
  isIncrementalSessionMessagesEmpty: (detail: SessionMessagesResponse, previousCursor: number) => boolean;
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
  persistSessionScrollState: () => void;
};

export function useSessionWorkspaceEffects(options: UseSessionWorkspaceEffectsOptions) {
  const {
    requestJson,
    workspace,
    sessionsLoaded,
    setSessionsLoaded,
    currentRoleIsWorker,
    sessionRemoteGatewayBaseUrl,
    sessionRemoteNodeId,
    shouldUseLocalGatewayApi,
    shouldUseRemoteGatewayApi,
    selectedSessionId,
    sessions,
    messagesLength,
    messagesLoaded,
    activeTaskId,
    queueStatus,
    previousMessageSessionIdRef,
    shouldAutoFollowMessagesRef,
    pendingHistoryRestoreRef,
    restoredSessionScrollRef,
    messagesRef,
    getPersistedSessionScroll,
    getSessionMessageCache,
    applySessionMessageEntry,
    fetchSessionMessages,
    isIncrementalSessionMessagesEmpty,
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
    persistSessionScrollState,
  } = options;
  const previousSelectedSessionIdRef = useRef<string | null>(selectedSessionId);
  const SESSION_HTTP_POLL_BASE_MS = 1800;
  const SESSION_HTTP_POLL_SLOW_MS = 3600;
  const SESSION_HTTP_POLL_EMPTY_BACKOFF_MS = [2200, 4200, 7000, 12000];

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
        persistSessionScrollState();
      }
      pendingHistoryRestoreRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messagesLength, messagesRef, persistSessionScrollState, selectedSessionId]);

  useEffect(() => {
    if (workspace !== "sessions" || !messagesLoaded || !selectedSessionId) {
      return;
    }
    const persistedScroll =
      restoredSessionScrollRef.current?.session_id === selectedSessionId
        ? restoredSessionScrollRef.current
        : getPersistedSessionScroll(selectedSessionId);
    if (!persistedScroll) {
      return;
    }
    if (pendingHistoryRestoreRef.current?.sessionId === selectedSessionId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (!container) return;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      if (persistedScroll.follow_bottom) {
        container.scrollTop = maxScrollTop;
      } else {
        container.scrollTop = Math.min(maxScrollTop, Math.max(0, maxScrollTop - persistedScroll.offset_from_bottom));
      }
      shouldAutoFollowMessagesRef.current = persistedScroll.follow_bottom;
      previousMessageSessionIdRef.current = selectedSessionId;
      restoredSessionScrollRef.current = null;
      persistSessionScrollState();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    messagesLoaded,
    messagesLength,
    messagesRef,
    getPersistedSessionScroll,
    pendingHistoryRestoreRef,
    persistSessionScrollState,
    previousMessageSessionIdRef,
    restoredSessionScrollRef,
    selectedSessionId,
    shouldAutoFollowMessagesRef,
    workspace,
  ]);

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
    const usesRemoteGateway = shouldUseRemoteGatewayApi;
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
  }, [currentRoleIsWorker, sessionRemoteGatewayBaseUrl, sessionRemoteNodeId, sessionsLoaded, shouldUseLocalGatewayApi, shouldUseRemoteGatewayApi, workspace]);

  useEffect(() => {
    const sessionChanged = previousSelectedSessionIdRef.current !== selectedSessionId;
    previousSelectedSessionIdRef.current = selectedSessionId;
    if (sessionChanged) {
      shouldAutoFollowMessagesRef.current = true;
      pendingHistoryRestoreRef.current = null;
      restoredSessionScrollRef.current = getPersistedSessionScroll(selectedSessionId);
    }
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
  }, [getPersistedSessionScroll, getSessionMessageCache, pendingHistoryRestoreRef, restoredSessionScrollRef, selectedSessionId, sessions, shouldAutoFollowMessagesRef]);

  useEffect(() => {
    if (workspace !== "sessions") return;
    if (!selectedSessionId) return;
    const usesRemoteGateway = shouldUseRemoteGatewayApi;
    const remoteGateway = usesRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    if (usesRemoteGateway && !remoteGateway) return;
    if (!usesRemoteGateway && !shouldUseLocalGatewayApi) return;

    let cancelled = false;
    let httpTimer = 0;
    let reconnectTimer = 0;
    let socket: WebSocket | null = null;
    let socketReady = false;
    let reconnectAttempt = 0;
    let requestInFlight = false;
    let emptyIncrementalCount = 0;
    const sessionId = selectedSessionId;
    const tabId = getSessionPollTabId();
    const getReconnectDelay = (attempt: number) => Math.min(15000, 1500 * (2 ** Math.max(0, attempt)));
    let ownerHeartbeatTimer = 0;

    const cached = getSessionMessageCache(sessionId);
    if (cached?.loaded) {
      applySessionMessageEntry(sessionId, cached);
    }

    const stopHttpPolling = () => {
      window.clearTimeout(httpTimer);
      httpTimer = 0;
    };

    const stopOwnerHeartbeat = () => {
      window.clearTimeout(ownerHeartbeatTimer);
      ownerHeartbeatTimer = 0;
    };

    const claimPollingOwnership = () => {
      if (document.hidden) {
        return false;
      }
      const current = readSessionPollOwner(sessionId);
      const now = Date.now();
      if (current && current.tabId !== tabId && current.expiresAt > now) {
        return false;
      }
      writeSessionPollOwner(sessionId, {
        tabId,
        expiresAt: now + SESSION_POLL_OWNER_TTL_MS,
      });
      return true;
    };

    const scheduleOwnerHeartbeat = () => {
      stopOwnerHeartbeat();
      if (cancelled || document.hidden) {
        return;
      }
      if (!claimPollingOwnership()) {
        return;
      }
      ownerHeartbeatTimer = window.setTimeout(() => {
        scheduleOwnerHeartbeat();
      }, SESSION_POLL_OWNER_REFRESH_MS);
    };

    const canRunTimerPolling = () => {
      if (document.hidden) {
        return false;
      }
      if (claimPollingOwnership()) {
        scheduleOwnerHeartbeat();
        return true;
      }
      return false;
    };

    const getIncrementalBackoffDelay = (session: SessionRecord | null, emptyCount: number) => {
      if (emptyCount <= 0) {
        return shouldUseFastPolling(session) ? SESSION_HTTP_POLL_BASE_MS : SESSION_HTTP_POLL_SLOW_MS;
      }
      return SESSION_HTTP_POLL_EMPTY_BACKOFF_MS[Math.min(emptyCount - 1, SESSION_HTTP_POLL_EMPTY_BACKOFF_MS.length - 1)];
    };

    const scheduleHttpPolling = (delay: number, preferIncremental: boolean) => {
      stopHttpPolling();
      if (cancelled) return;
      if (!canRunTimerPolling()) return;
      httpTimer = window.setTimeout(() => {
        if (!canRunTimerPolling()) {
          return;
        }
        void loadMessages(preferIncremental, "timer");
      }, delay);
    };

    const loadMessages = async (preferIncremental: boolean, trigger: "bootstrap" | "timer" | "reconnect" | "visibility") => {
      if (cancelled || selectedSessionId !== sessionId || requestInFlight) {
        return;
      }
      if (document.hidden && trigger !== "visibility") {
        return;
      }
      if (socketReady && trigger === "timer") {
        return;
      }
      const nextCached = getSessionMessageCache(sessionId);
      const hasCache = Boolean(nextCached?.loaded);
      const afterCount = preferIncremental && nextCached?.loaded ? nextCached.cursor : 0;
      if (!hasCache && !preferIncremental) {
        setMessagesLoaded(false);
      }
      requestInFlight = true;
      try {
        const detail = await fetchSessionMessages(sessionId, {
          remoteGateway,
          afterCount,
          limit: !hasCache && !preferIncremental ? 50 : undefined,
          fallbackToFull: true,
        });
        if (cancelled || selectedSessionId !== sessionId) return;
        const previousCursor = nextCached?.cursor ?? 0;
        const entry = syncSessionMessageCache(sessionId, detail, {
          preserveExisting: preferIncremental,
          mergeMode: preferIncremental ? "append" : "replace",
        });
        applySessionMessageEntry(sessionId, entry);
        emptyIncrementalCount = preferIncremental && isIncrementalSessionMessagesEmpty(detail, previousCursor) ? emptyIncrementalCount + 1 : 0;
        if (!socketReady) {
          scheduleHttpPolling(getIncrementalBackoffDelay(detail.session, emptyIncrementalCount), true);
        }
      } catch (error) {
        if (cancelled || selectedSessionId !== sessionId) return;
        if (!getSessionMessageCache(sessionId)?.loaded) {
          setMessages([]);
          setMessageCursor(0);
          setMessagesLoaded(true);
        }
        setNotice(`读取会话消息失败：${(error as Error).message}`);
        emptyIncrementalCount += 1;
        scheduleHttpPolling(
          getIncrementalBackoffDelay(getSessionMessageCache(sessionId)?.session ?? null, emptyIncrementalCount),
          Boolean(getSessionMessageCache(sessionId)?.loaded),
        );
      } finally {
        requestInFlight = false;
      }
    };

    const connectSessionSocket = () => {
      if (cancelled) return;
      let receivedPayload = false;
      let receivedSnapshot = false;
      let snapshotTimeout = 0;
      try {
        socket = new WebSocket(buildSessionWebSocketUrl(sessionId, remoteGateway));
      } catch {
        void loadMessages(Boolean(getSessionMessageCache(sessionId)?.loaded), "reconnect");
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
        void loadMessages(Boolean(getSessionMessageCache(sessionId)?.loaded), "bootstrap");
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
        emptyIncrementalCount = 0;
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
          void loadMessages(Boolean(getSessionMessageCache(sessionId)?.loaded), "reconnect");
        }
      };
      socket.onclose = () => {
        window.clearTimeout(snapshotTimeout);
        if (cancelled) return;
        socket = null;
        socketReady = false;
        if (!document.hidden) {
          scheduleHttpPolling(
            receivedSnapshot ? SESSION_HTTP_POLL_SLOW_MS : SESSION_HTTP_POLL_BASE_MS,
            Boolean(getSessionMessageCache(sessionId)?.loaded || receivedSnapshot),
          );
        }
        reconnectTimer = window.setTimeout(() => {
          connectSessionSocket();
        }, getReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
      };
    };

    connectSessionSocket();
    scheduleOwnerHeartbeat();

    const onVisible = () => {
      if (document.hidden) {
        stopHttpPolling();
        stopOwnerHeartbeat();
        return;
      }
      scheduleOwnerHeartbeat();
      window.clearTimeout(reconnectTimer);
      if (socketReady) return;
      void loadMessages(Boolean(getSessionMessageCache(sessionId)?.loaded), "visibility");
      connectSessionSocket();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      stopHttpPolling();
      stopOwnerHeartbeat();
      window.clearTimeout(reconnectTimer);
      clearSessionPollOwner(sessionId, tabId);
      try {
        socket?.close();
      } catch {
        // ignore teardown close errors
      }
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applySessionMessageEntry, currentRoleIsWorker, fetchSessionMessages, getSessionMessageCache, selectedSessionId, sessionRemoteGatewayBaseUrl, shouldUseLocalGatewayApi, shouldUseRemoteGatewayApi, syncSessionMessageCache, workspace]);
}
