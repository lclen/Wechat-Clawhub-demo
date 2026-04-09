import { useEffect } from "react";
import { launcherShouldRunGateway } from "../selectors/launcherSelectors";
import { buildGatewaySummaryWebSocketUrl } from "../transportUrls";
import type {
  GatewaySummaryEnvelope,
  GatewaySummaryResponse,
  LauncherStatusResponse,
  NodeRecord,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;

type UseGatewaySummaryEffectsOptions = {
  requestJson: RequestJson;
  currentRoleIsWorker: boolean;
  currentRoleIsConsole: boolean;
  localGatewayManaged: boolean | null;
  sessionRemoteGatewayBaseUrl: string;
  sessionRemoteNodeId: string;
  shouldUseLocalGatewayApi: boolean;
  shouldUseRemoteGatewayApi: boolean;
  launcherStatus: LauncherStatusResponse | null;
  workspace: string;
  gatewaySummaryStreamActive: boolean;
  setGatewaySummaryStreamActive: (next: boolean) => void;
  setWorkerGatewayProbeTask: (next: {
    task_id: string;
    kind: "gateway_probe";
    status: "succeeded";
    title: string;
    created_at: string;
    updated_at: string;
    summary: string;
    logs: string[];
    metadata: Record<string, string>;
  } | null) => void;
  applyGatewaySummary: (summary: GatewaySummaryResponse) => void;
};

export function useGatewaySummaryEffects(options: UseGatewaySummaryEffectsOptions) {
  const {
    requestJson,
    currentRoleIsWorker,
    currentRoleIsConsole,
    localGatewayManaged,
    sessionRemoteGatewayBaseUrl,
    sessionRemoteNodeId,
    shouldUseLocalGatewayApi,
    shouldUseRemoteGatewayApi,
    launcherStatus,
    workspace,
    gatewaySummaryStreamActive,
    setGatewaySummaryStreamActive,
    setWorkerGatewayProbeTask,
    applyGatewaySummary,
  } = options;

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer = 0;
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;
    const getReconnectDelay = (attempt: number) => Math.min(15000, 1500 * (2 ** Math.max(0, attempt)));
    const usesRemoteGateway = currentRoleIsWorker || (currentRoleIsConsole && localGatewayManaged === false);
    const remoteGateway = usesRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    if (!shouldUseLocalGatewayApi && !usesRemoteGateway) {
      setGatewaySummaryStreamActive(false);
      return;
    }
    if (usesRemoteGateway && !remoteGateway) {
      setGatewaySummaryStreamActive(false);
      return;
    }

    const connect = () => {
      if (cancelled) return;
      try {
        socket = new WebSocket(buildGatewaySummaryWebSocketUrl(remoteGateway));
      } catch {
        setGatewaySummaryStreamActive(false);
        reconnectTimer = window.setTimeout(connect, getReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
        return;
      }

      socket.onopen = () => {
        reconnectAttempt = 0;
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        let payload: GatewaySummaryEnvelope;
        try {
          payload = JSON.parse(event.data) as GatewaySummaryEnvelope;
        } catch {
          return;
        }
        if (payload.type !== "gateway_summary") return;
        setGatewaySummaryStreamActive(true);
        reconnectAttempt = 0;
        applyGatewaySummary(payload.summary);
        if (currentRoleIsWorker) {
          const nodeId = sessionRemoteNodeId;
          const matched = payload.summary.nodes.nodes.find((item) => item.node_id === nodeId);
          if (nodeId) {
            setWorkerGatewayProbeTask({
              task_id: "auto-stream",
              kind: "gateway_probe",
              status: "succeeded",
              title: "检测节点目标网关",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              summary: matched ? `目标网关可达，节点已连接：${nodeId}` : `目标网关可达，但节点未注册/未在线：${nodeId}`,
              logs: [],
              metadata: {
                gateway_base_url: remoteGateway,
                node_id: nodeId,
                node_registered: matched ? "true" : "false",
                node_connection_state: matched?.status || "",
              },
            });
          }
        }
      };

      socket.onerror = () => {
        setGatewaySummaryStreamActive(false);
        try {
          socket?.close();
        } catch {
          // ignore close errors
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setGatewaySummaryStreamActive(false);
        reconnectTimer = window.setTimeout(connect, getReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
      };
    };

    connect();
    return () => {
      cancelled = true;
      setGatewaySummaryStreamActive(false);
      window.clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // ignore teardown close errors
      }
    };
  }, [applyGatewaySummary, currentRoleIsConsole, currentRoleIsWorker, localGatewayManaged, sessionRemoteGatewayBaseUrl, sessionRemoteNodeId, setGatewaySummaryStreamActive, setWorkerGatewayProbeTask, shouldUseLocalGatewayApi]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const setWorkerProbeFromSummary = (summary: GatewaySummaryResponse, nodeId: string, remoteGateway: string) => {
      const allNodes: NodeRecord[] = summary.nodes.nodes || [];
      const matched = allNodes.find((n: NodeRecord) => n.node_id === nodeId);
      setWorkerGatewayProbeTask({
        task_id: "auto-poll",
        kind: "gateway_probe",
        status: "succeeded",
        title: "检测节点目标网关",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        summary: matched ? `目标网关可达，节点已连接：${nodeId}` : `目标网关可达，但节点未注册/未在线：${nodeId}`,
        logs: [],
        metadata: {
          gateway_base_url: remoteGateway,
          node_id: nodeId,
          node_registered: matched ? "true" : "false",
          node_connection_state: matched?.status || "",
        },
      });
    };

    const run = async () => {
      if (gatewaySummaryStreamActive) return;

      if (currentRoleIsWorker) {
        const remoteGateway = sessionRemoteGatewayBaseUrl;
        const nodeId = sessionRemoteNodeId;
        if (!remoteGateway || !nodeId) return;
        let failed = false;
        try {
          const summary = await requestJson<GatewaySummaryResponse>(`${remoteGateway}/api/system/summary`).catch(() => null);
          if (cancelled) return;
          if (summary) {
            applyGatewaySummary(summary);
            setWorkerProbeFromSummary(summary, nodeId, remoteGateway);
          }
        } catch {
          failed = true;
        } finally {
          if (!cancelled) timer = window.setTimeout(() => void run(), failed ? 3000 : 10000);
        }
        return;
      }

      if (!shouldUseLocalGatewayApi && !shouldUseRemoteGatewayApi) {
        if (!cancelled) timer = window.setTimeout(() => void run(), 3200);
        return;
      }

      if (!launcherShouldRunGateway(launcherStatus) && currentRoleIsConsole) {
        const remoteGateway = sessionRemoteGatewayBaseUrl;
        if (!remoteGateway) return;
        let failed = false;
        try {
          const summary = await requestJson<GatewaySummaryResponse>(`${remoteGateway}/api/system/summary`).catch(() => null);
          if (cancelled) return;
          if (summary) {
            applyGatewaySummary(summary);
          }
        } catch {
          failed = true;
        } finally {
          if (!cancelled) timer = window.setTimeout(() => void run(), failed ? 3000 : 10000);
        }
        return;
      }

      if (localGatewayManaged === null) {
        timer = window.setTimeout(() => void run(), 500);
        return;
      }

      let failed = false;
      try {
        const summary = await requestJson<GatewaySummaryResponse>("/api/system/summary");
        if (cancelled) return;
        applyGatewaySummary(summary);
      } catch {
        failed = true;
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void run(), failed ? 3000 : 10000);
      }
    };

    void run();
    const onVisible = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applyGatewaySummary, currentRoleIsConsole, currentRoleIsWorker, gatewaySummaryStreamActive, launcherStatus, localGatewayManaged, requestJson, sessionRemoteGatewayBaseUrl, sessionRemoteNodeId, shouldUseLocalGatewayApi, shouldUseRemoteGatewayApi, workspace, setWorkerGatewayProbeTask]);
}
