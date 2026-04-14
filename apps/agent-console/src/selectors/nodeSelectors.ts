import type {
  LauncherStatusResponse,
  LocalNodeStatusResponse,
  NodeInventoryConnectionState,
  NodeInventoryRecord,
  NodeKind,
  NodeRecord,
  TaskStreamHealth,
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
    task_stream: localNodeStatus.task_stream || node.task_stream,
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

export function taskStreamModeLabel(connectionMode: TaskStreamHealth["connection_mode"]) {
  if (connectionMode === "ws") return "WebSocket";
  if (connectionMode === "degraded_http_polling") return "降级轮询";
  return "已断开";
}

export function describeTaskStreamHealth(taskStream: TaskStreamHealth | null | undefined) {
  if (!taskStream) {
    return {
      label: "链路未上报",
      detail: "还没有任务流健康信息。",
      tone: "queued" as const,
    };
  }
  if (taskStream.upgrade_required) {
    return {
      label: "需要升级",
      detail: `当前协议 ${taskStream.protocol_version || "unknown"} 已过旧，请升级到 task-stream-v2。`,
      tone: "queued" as const,
    };
  }
  if (taskStream.connection_mode === "ws") {
    return {
      label: "直推在线",
      detail: `协议 ${taskStream.protocol_version || "task-stream-v2"}，最近事件 ${taskStream.last_event_at ? formatTimeLabel(taskStream.last_event_at, true) : "刚建立"}`,
      tone: "human" as const,
    };
  }
  if (taskStream.connection_mode === "degraded_http_polling") {
    return {
      label: "降级轮询",
      detail: `已进入 HTTP polling 兜底，累计 ${taskStream.fallback_poll_count} 次 fallback。`,
      tone: "queued" as const,
    };
  }
  return {
    label: "链路断开",
    detail: taskStream.last_disconnect_at
      ? `最近断流 ${formatTimeLabel(taskStream.last_disconnect_at, true)}，关闭码 ${taskStream.last_disconnect_code ?? "-"}。`
      : "等待节点重新建立任务流连接。",
    tone: "queued" as const,
  };
}
