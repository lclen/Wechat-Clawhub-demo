import { useEffect } from "react";
import { launcherShouldRunGateway } from "../selectors/launcherSelectors";
import { buildNodeDiagnosticsWebSocketUrl } from "../transportUrls";
import type {
  LauncherStatusResponse,
  NodeDiagnosticsRecord,
  NodeDiagnosticsResponse,
  NodeDiagnosticsStreamEnvelope,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;

type UseNodeDiagnosticsEffectsOptions = {
  requestJson: RequestJson;
  workspace: string;
  selectedNodeId: string | null;
  currentRoleIsConsole: boolean;
  launcherStatus: LauncherStatusResponse | null;
  sessionRemoteGatewayBaseUrl: string;
  shouldUseLocalGatewayApi: boolean;
  shouldUseRemoteGatewayApi: boolean;
  getNodeDiagnosticsCache: (nodeId: string | null) => NodeDiagnosticsRecord | null;
  syncNodeDiagnosticsCache: (nodeId: string, diagnostics: NodeDiagnosticsRecord) => NodeDiagnosticsRecord;
  applyNodeDiagnosticsEntry: (nodeId: string, diagnostics: NodeDiagnosticsRecord | null) => void;
  setSelectedNodeDiagnostics: (next: NodeDiagnosticsRecord | null) => void;
};

export function useNodeDiagnosticsEffects(options: UseNodeDiagnosticsEffectsOptions) {
  const {
    requestJson,
    workspace,
    selectedNodeId,
    launcherStatus,
    sessionRemoteGatewayBaseUrl,
    shouldUseLocalGatewayApi,
    shouldUseRemoteGatewayApi,
    getNodeDiagnosticsCache,
    syncNodeDiagnosticsCache,
    applyNodeDiagnosticsEntry,
    setSelectedNodeDiagnostics,
  } = options;

  useEffect(() => {
    if (workspace !== "connection" || !selectedNodeId) {
      setSelectedNodeDiagnostics(null);
      return;
    }
    const useRemoteGateway = shouldUseRemoteGatewayApi;
    const remoteGateway = useRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    if (useRemoteGateway && !remoteGateway) return;
    if (!useRemoteGateway && !shouldUseLocalGatewayApi) return;
    if (!useRemoteGateway && !launcherShouldRunGateway(launcherStatus)) return;

    let cancelled = false;
    let timer = 0;
    let reconnectTimer = 0;
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;
    const nodeId = selectedNodeId;
    const getReconnectDelay = (attempt: number) => Math.min(15000, 1500 * (2 ** Math.max(0, attempt)));

    const cached = getNodeDiagnosticsCache(nodeId);
    if (cached) {
      applyNodeDiagnosticsEntry(nodeId, cached);
    } else {
      setSelectedNodeDiagnostics(null);
    }

    const scheduleHttpFallback = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const detail = await requestJson<NodeDiagnosticsResponse>(
            useRemoteGateway
              ? `${remoteGateway}/api/nodes/${encodeURIComponent(nodeId)}/diagnostics`
              : `/api/nodes/${encodeURIComponent(nodeId)}/diagnostics`,
          );
          if (cancelled || selectedNodeId !== nodeId) return;
          const entry = syncNodeDiagnosticsCache(nodeId, detail.diagnostics);
          applyNodeDiagnosticsEntry(nodeId, entry);
        } catch {
          if (!cancelled && !cached) {
            applyNodeDiagnosticsEntry(nodeId, null);
          }
        }
      }, 200);
    };

    const connect = () => {
      if (cancelled) return;
      try {
        socket = new WebSocket(buildNodeDiagnosticsWebSocketUrl(nodeId, remoteGateway));
      } catch {
        scheduleHttpFallback();
        reconnectTimer = window.setTimeout(connect, getReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
        return;
      }

      socket.onopen = () => {
        reconnectAttempt = 0;
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        let payload: NodeDiagnosticsStreamEnvelope;
        try {
          payload = JSON.parse(event.data) as NodeDiagnosticsStreamEnvelope;
        } catch {
          return;
        }
        if (payload.type !== "diagnostics_snapshot" || payload.node_id !== nodeId) return;
        const entry = syncNodeDiagnosticsCache(nodeId, payload.diagnostics);
        reconnectAttempt = 0;
        applyNodeDiagnosticsEntry(nodeId, entry);
      };

      socket.onerror = () => {
        scheduleHttpFallback();
        try {
          socket?.close();
        } catch {
          // ignore close errors
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        reconnectTimer = window.setTimeout(connect, getReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
      };
    };

    connect();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // ignore teardown close errors
      }
    };
  }, [applyNodeDiagnosticsEntry, getNodeDiagnosticsCache, launcherStatus, requestJson, selectedNodeId, sessionRemoteGatewayBaseUrl, setSelectedNodeDiagnostics, shouldUseLocalGatewayApi, shouldUseRemoteGatewayApi, syncNodeDiagnosticsCache, workspace]);
}
