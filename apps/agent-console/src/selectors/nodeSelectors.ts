import type {
  LauncherStatusResponse,
  LocalNodeStatusResponse,
  NodeInventoryConnectionState,
  NodeInventoryRecord,
  NodeKind,
  NodeRecord,
} from "../types";
import { summarizeLocalNodeRuntime } from "./launcherSelectors";
import { formatTimeLabel } from "./sessionSelectors";

export function getNodeAddress(node: NodeRecord) {
  if (node.advertised_address) return node.advertised_address;
  if (node.base_url && /^https?:\/\//i.test(node.base_url)) return node.base_url;
  if (node.lan_ip) return node.lan_ip;
  if (node.hostname) return node.hostname;
  return node.base_url || "未上报";
}

export function getInventoryNodeAddress(node: NodeInventoryRecord) {
  if (node.advertised_address) return node.advertised_address;
  if (node.base_url && /^https?:\/\//i.test(node.base_url)) return node.base_url;
  if (node.lan_ip) return node.lan_ip;
  if (node.hostname) return node.hostname;
  return node.base_url || "暂未上报";
}

export function normalizeInventoryRuntimeMetrics(
  node: NodeInventoryRecord,
  localNodeStatus: LocalNodeStatusResponse | null,
): NodeInventoryRecord {
  const isLocalInventoryNode = node.node_kind === "local" && node.node_id === "local-node";
  if (!isLocalInventoryNode || !localNodeStatus) {
    return node;
  }
  const assessment = localNodeStatus.channel_assessment;
  const nextChannelCapacity = Number.isFinite(assessment?.current_channel_capacity)
    ? Math.max(assessment.current_channel_capacity, 0)
    : node.channel_capacity;
  const nextMaxConcurrency = Number.isFinite(assessment?.current_max_concurrency)
    ? Math.max(assessment.current_max_concurrency, 0)
    : node.max_concurrency;
  if (nextChannelCapacity === node.channel_capacity && nextMaxConcurrency === node.max_concurrency) {
    return node;
  }
  return {
    ...node,
    channel_capacity: nextChannelCapacity,
    max_concurrency: nextMaxConcurrency,
  };
}

export function nodeRoleLabel(nodeId: string, nodeKind?: NodeKind) {
  if (nodeKind === "local") return "网关内置节点";
  if (nodeKind === "remote") return "远端工作节点";
  return nodeId === "local-node" || nodeId.startsWith("claw-node-local") ? "网关内置节点" : "远端工作节点";
}

export function nodeInventoryBadgeLabel(connectionState: NodeInventoryConnectionState, paired: boolean) {
  if (connectionState === "connected") return "在线";
  if (connectionState === "pairing_pending") return "待确认";
  if (connectionState === "register_failed" || connectionState === "auth_failed") return "异常";
  if (connectionState === "paired_offline") return "离线";
  return paired ? "离线" : "未纳管";
}

export function nodeInventoryBadgeTone(connectionState: NodeInventoryConnectionState) {
  return connectionState === "connected"
    ? "human"
    : connectionState === "pairing_pending"
      ? "typing"
      : connectionState === "register_failed" || connectionState === "auth_failed"
        ? "queued"
        : connectionState === "paired_offline"
          ? "queued"
          : "idle";
}

export function describeInventoryConnection(node: NodeInventoryRecord) {
  if (node.connection_state === "connected") return node.status || "healthy";
  if (node.connection_state === "pairing_pending") return node.last_error || "已下发配置，等待注册确认";
  if (node.connection_state === "register_failed") return node.last_error || "注册失败";
  if (node.connection_state === "auth_failed") return node.last_error || "鉴权失败，需要重新配对";
  if (node.connection_state === "paired_offline") return node.last_error || "暂未上报";
  return node.status || "未纳管";
}

export function resolveInventoryNodePresentation(node: NodeInventoryRecord, localNodeStatus: LocalNodeStatusResponse | null, launcherStatus: LauncherStatusResponse | null) {
  if (node.node_kind !== "local" || node.node_id !== "local-node") {
    return {
      badge: nodeInventoryBadgeLabel(node.connection_state, node.paired),
      tone: nodeInventoryBadgeTone(node.connection_state),
      detail: describeInventoryConnection(node),
    };
  }
  const runtime = summarizeLocalNodeRuntime(localNodeStatus, launcherStatus, node);
  const tone = runtime.tone === "good" ? "human" : "queued";
  return {
    badge: runtime.label,
    tone,
    detail: runtime.detail,
  };
}

export function summarizeRemoteNode(node: NodeInventoryRecord | NodeRecord) {
  return [
    `${node.hostname || node.node_id}（${nodeRoleLabel(node.node_id, "node_kind" in node ? node.node_kind : undefined)}）`,
    node.lan_ip || "未上报 IP",
    node.last_error || node.status || "未上报状态",
    node.last_heartbeat_at ? formatTimeLabel(node.last_heartbeat_at, true) : "暂无心跳",
  ].join(" · ");
}
