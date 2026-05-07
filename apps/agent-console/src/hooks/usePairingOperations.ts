import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { hasText, safeTrim } from "../stringUtils";
import type {
  DiscoveryPairResponse,
  DiscoveryScanResponse,
  DiscoveredNodeRecord,
  GatewayProbeRequest,
  ManualPairDraft,
  ManualPairRequest,
  NodeDeleteResponse,
  NodeInventoryRecord,
  PairingStatus,
  SetupTaskEnvelope,
  SetupTaskResult,
  WorkerNodeSetupConfig,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;
type WithBusy = <T>(key: string, task: () => Promise<T>) => Promise<T>;

type UsePairingOperationsOptions = {
  requestJson: RequestJson;
  withBusy: WithBusy;
  canManageNodes: boolean;
  workerSetup: WorkerNodeSetupConfig;
  pairingSecrets: Record<string, string>;
  manualPair: ManualPairDraft;
  currentGatewayBaseUrl: string;
  currentNodeLanIp: string;
  shouldUseWorkerLocalApi: boolean;
  runtimeMachineRole: string | null;
  pairingModalTimerRef: MutableRefObject<number | null>;
  setSetupTask: (next: SetupTaskResult | null) => void;
  setDiscoveredNodes: (next: DiscoveredNodeRecord[]) => void;
  setPairingStatuses: Dispatch<SetStateAction<Record<string, PairingStatus>>>;
  setPairingSecrets: Dispatch<SetStateAction<Record<string, string>>>;
  setWorkerGatewayProbeTask: (next: SetupTaskResult | null) => void;
  setPairingModalTaskId: (next: string | null) => void;
  setPairingModalTask: (next: SetupTaskResult | null) => void;
  setPairingModalStartedAt: (next: number) => void;
  setManualPair: Dispatch<SetStateAction<ManualPairDraft>>;
  setNotice: (next: string) => void;
  refreshGatewaySummarySnapshot: () => Promise<unknown>;
  clearNodeDiagnosticsCache: (nodeId?: string | null) => void;
  onWorkerGatewayProbeUpdated: (key: string) => void;
  pushPairingDebugEntry: (entry: {
    id: string;
    kind: "discovery_scan" | "discovery_pair" | "manual_pair" | "gateway_probe" | "node_install" | "client_error";
    title: string;
    status: "pending" | "running" | "succeeded" | "failed";
    summary: string;
    logs: string[];
    target: string;
    updated_at: string;
  }) => void;
  appendPairingClientError: (title: string, target: string, error: Error) => void;
};

export function usePairingOperations(options: UsePairingOperationsOptions) {
  const {
    requestJson,
    withBusy,
    canManageNodes,
    workerSetup,
    pairingSecrets,
    manualPair,
    currentGatewayBaseUrl,
    currentNodeLanIp,
    shouldUseWorkerLocalApi,
    runtimeMachineRole,
    pairingModalTimerRef,
    setSetupTask,
    setDiscoveredNodes,
    setPairingStatuses,
    setPairingSecrets,
    setWorkerGatewayProbeTask,
    setPairingModalTaskId,
    setPairingModalTask,
    setPairingModalStartedAt,
    setManualPair,
    setNotice,
    refreshGatewaySummarySnapshot,
    clearNodeDiagnosticsCache,
    onWorkerGatewayProbeUpdated,
    pushPairingDebugEntry,
    appendPairingClientError,
  } = options;

  function closePairingModal() {
    if (pairingModalTimerRef.current !== null) {
      window.clearInterval(pairingModalTimerRef.current);
      pairingModalTimerRef.current = null;
    }
    setPairingModalTaskId(null);
    setPairingModalTask(null);
  }

  function startPairingModal(taskId: string) {
    if (pairingModalTimerRef.current !== null) {
      window.clearInterval(pairingModalTimerRef.current);
      pairingModalTimerRef.current = null;
    }
    const startedAt = Date.now();
    setPairingModalTaskId(taskId);
    setPairingModalStartedAt(startedAt);
    setPairingModalTask(null);
    const timerId = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > 30000) {
        window.clearInterval(timerId);
        pairingModalTimerRef.current = null;
        return;
      }
      requestJson<SetupTaskEnvelope>(`/api/setup/tasks/${taskId}`)
        .then((envelope) => {
          setPairingModalTask(envelope.task);
          if (envelope.task.status === "succeeded" || envelope.task.status === "failed") {
            window.clearInterval(timerId);
            pairingModalTimerRef.current = null;
            if (envelope.task.status === "succeeded") {
              window.setTimeout(() => {
                closePairingModal();
                refreshGatewaySummarySnapshot().catch(() => undefined);
              }, 2000);
            }
          }
        })
        .catch(() => undefined);
    }, 1500);
    pairingModalTimerRef.current = timerId;
  }

  async function scanLanNodes() {
    try {
      pushPairingDebugEntry({
        id: `scan-${Date.now()}`,
        kind: "discovery_scan",
        title: "扫描局域网节点",
        status: "running",
        summary: "正在发送广播并等待节点响应。",
        logs: [
          `开始扫描，回连网关地址：${currentGatewayBaseUrl}`,
          `当前机器局域网 IP：${currentNodeLanIp || "未识别"}`,
          "调试说明：接口返回后会在这里追加完整的网关扫描日志。",
        ],
        target: "局域网广播",
        updated_at: new Date().toISOString(),
      });
      const result = await withBusy(
        "setup-discovery-scan",
        () => requestJson<DiscoveryScanResponse>("/api/setup/discovery/scan", { method: "POST", body: JSON.stringify({ timeout_ms: 1500 }) }),
      );
      setSetupTask(result.task);
      setDiscoveredNodes(result.nodes);
      setPairingStatuses(Object.fromEntries(result.nodes.map((item) => [item.discovery_id, item.already_paired ? "already_paired" : "pending"])));
      setPairingSecrets((current) => {
        const next = { ...current };
        for (const item of result.nodes) {
          if (!next[item.discovery_id] && hasText(workerSetup.pairing_key)) next[item.discovery_id] = safeTrim(workerSetup.pairing_key);
        }
        return next;
      });
      setNotice(result.task.summary || `已发现 ${result.nodes.length} 台局域网候选机器。`);
    } catch (error) {
      appendPairingClientError("扫描局域网节点", "局域网广播", error as Error);
      setNotice(`搜索局域网节点失败：${(error as Error).message}`);
    }
  }

  async function probeWorkerGateway(options?: { silent?: boolean; reason?: "manual" | "auto" | "post-install" }) {
    const gatewayBaseUrl = safeTrim(workerSetup.gateway_base_url);
    if (!gatewayBaseUrl) {
      setNotice("请先填写目标网关地址。");
      return;
    }
    const nodeId = safeTrim(workerSetup.node_id);
    const silent = options?.silent ?? false;
    try {
      pushPairingDebugEntry({
        id: `gateway-probe-${Date.now()}`,
        kind: "gateway_probe",
        title: "检测目标网关",
        status: "running",
        summary: `准备检测 ${gatewayBaseUrl}`,
        logs: [
          `目标网关地址：${gatewayBaseUrl}`,
          `当前节点 IP：${currentNodeLanIp || "未识别"}`,
          `当前节点 ID：${nodeId || "未填写"}`,
          "调试说明：接口返回后会在这里追加网关探测日志。",
        ],
        target: gatewayBaseUrl,
        updated_at: new Date().toISOString(),
      });
      const payload: GatewayProbeRequest = { gateway_base_url: gatewayBaseUrl, node_id: nodeId || undefined, timeout_ms: 3000 };
      const probeUrl = shouldUseWorkerLocalApi || runtimeMachineRole === "node" ? "/local/gateway/probe" : "/api/setup/gateway/probe";
      const result = await withBusy(
        "setup-gateway-probe",
        () => requestJson<SetupTaskEnvelope>(probeUrl, { method: "POST", body: JSON.stringify(payload) }),
      );
      setSetupTask(result.task);
      setWorkerGatewayProbeTask(result.task);
      onWorkerGatewayProbeUpdated(`${gatewayBaseUrl}::${nodeId}`);
      if (!silent) {
        setNotice(result.task.summary || `目标网关检测完成：${gatewayBaseUrl}`);
      }
    } catch (error) {
      onWorkerGatewayProbeUpdated(`${gatewayBaseUrl}::${nodeId}`);
      appendPairingClientError("检测目标网关", gatewayBaseUrl, error as Error);
      if (!silent) {
        setNotice(`检测目标网关失败：${(error as Error).message}`);
      }
    }
  }

  async function pairLanNode(discovered: DiscoveredNodeRecord) {
    const pairingKey = safeTrim(pairingSecrets[discovered.discovery_id]);
    if (!pairingKey) {
      setNotice(`请先为 ${discovered.pairing_label || discovered.hostname} 输入配对密钥。`);
      return;
    }
    const target = `${discovered.lan_ip || discovered.hostname}:${discovered.pairing_port}`;
    setPairingStatuses((current) => ({ ...current, [discovered.discovery_id]: "pending" }));
    pushPairingDebugEntry({
      id: `pair-${discovered.discovery_id}-${Date.now()}`,
      kind: "discovery_pair",
      title: "扫描结果配对",
      status: "running",
      summary: `准备连接 ${target}`,
      logs: [
        `目标节点：${discovered.pairing_label || discovered.hostname}`,
        `目标地址：${target}`,
        `网关回连地址：${currentGatewayBaseUrl}`,
      ],
      target,
      updated_at: new Date().toISOString(),
    });
    try {
      const result = await withBusy(
        "setup-discovery-pair",
        () => requestJson<DiscoveryPairResponse>("/api/setup/discovery/pair", {
          method: "POST",
          body: JSON.stringify({
            discovery_id: discovered.discovery_id,
            pairing_key: pairingKey,
            gateway_base_url: currentGatewayBaseUrl,
            node_id: discovered.node_id || undefined,
          }),
        }),
      );
      setSetupTask(result.task);
      setPairingStatuses((current) => ({ ...current, [discovered.discovery_id]: result.pairing_status }));
      startPairingModal(result.task.task_id);
      await refreshGatewaySummarySnapshot();
    } catch (error) {
      setPairingStatuses((current) => ({ ...current, [discovered.discovery_id]: "offline" }));
      appendPairingClientError("扫描结果配对", target, error as Error);
      setNotice(`配对节点失败：${(error as Error).message}`);
    }
  }

  async function manualPairNode() {
    const payload: ManualPairRequest = {
      host: safeTrim(manualPair.host),
      pairing_port: manualPair.pairing_port || 9532,
      pairing_key: safeTrim(manualPair.pairing_key),
      gateway_base_url: currentGatewayBaseUrl,
      node_id: safeTrim(manualPair.node_id) || undefined,
    };
    if (!payload.host) {
      setNotice("请先填写目标节点的 IP 或主机名。");
      return;
    }
    if (!payload.pairing_key) {
      setNotice("请先填写目标节点的配对密钥。");
      return;
    }
    const target = `${payload.host}:${payload.pairing_port}`;
    pushPairingDebugEntry({
      id: `manual-${target}-${Date.now()}`,
      kind: "manual_pair",
      title: "按地址配对",
      status: "running",
      summary: `准备直连 ${target}`,
      logs: [
        `目标地址：${target}`,
        `网关回连地址：${currentGatewayBaseUrl}`,
        `指定节点 ID：${payload.node_id || "未指定"}`,
      ],
      target,
      updated_at: new Date().toISOString(),
    });
    try {
      const result = await withBusy(
        "setup-manual-pair",
        () => requestJson<DiscoveryPairResponse>("/api/setup/manual-pair", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
      setSetupTask(result.task);
      startPairingModal(result.task.task_id);
      setManualPair((current) => ({
        ...current,
        node_id: result.node_id || current.node_id,
      }));
      await refreshGatewaySummarySnapshot();
    } catch (error) {
      appendPairingClientError("按地址配对", target, error as Error);
      setNotice(`按地址配对失败：${(error as Error).message}`);
    }
  }

  async function deletePairedNode(node: NodeInventoryRecord) {
    if (!canManageNodes) {
      setNotice("当前角色只能查看节点状态，不能删除节点。");
      return;
    }
    const confirmed = window.confirm(`确认从网关删除节点 ${node.node_id} 吗？这会移除配对凭据，并清理当前运行态记录。`);
    if (!confirmed) return;
    try {
      const result = await withBusy(
        `delete-node-${node.node_id}`,
        () => requestJson<NodeDeleteResponse>(`/api/nodes/${encodeURIComponent(node.node_id)}`, { method: "DELETE" }),
      );
      clearNodeDiagnosticsCache(node.node_id);
      await refreshGatewaySummarySnapshot();
      setNotice(result.detail || `已删除节点 ${node.node_id}。`);
      if (safeTrim(workerSetup.node_id) === node.node_id) {
        setWorkerGatewayProbeTask(null);
      }
    } catch (error) {
      setNotice(`删除节点失败：${(error as Error).message}`);
    }
  }

  async function disconnectPairedNode(node: NodeInventoryRecord) {
    if (!canManageNodes) {
      setNotice("当前角色只能查看节点状态，不能断开节点连接。");
      return;
    }
    const confirmed = window.confirm(`确认断开节点 ${node.node_id} 的连接吗？配对凭据保留，节点重启后可自动重连。`);
    if (!confirmed) return;
    try {
      const result = await withBusy(
        `disconnect-node-${node.node_id}`,
        () => requestJson<NodeDeleteResponse>(`/api/nodes/${encodeURIComponent(node.node_id)}/disconnect`, { method: "POST" }),
      );
      clearNodeDiagnosticsCache(node.node_id);
      await refreshGatewaySummarySnapshot();
      setNotice(result.detail || `已断开节点 ${node.node_id}。`);
    } catch (error) {
      setNotice(`断开失败：${(error as Error).message}`);
    }
  }

  return {
    scanLanNodes,
    probeWorkerGateway,
    closePairingModal,
    pairLanNode,
    manualPairNode,
    deletePairedNode,
    disconnectPairedNode,
  };
}
