import type {
  GatewaySetupConfig,
  LauncherComponentStatus,
  LauncherMachineRole,
  LauncherStartRequest,
  LauncherState,
  LauncherStatusResponse,
  LocalNodeStatusResponse,
  ModelStatus,
  NodeInventoryRecord,
  SystemStatus,
  WeChatStatus,
} from "../types";
import { DEFAULT_REMOTE_WORKER_NODE_ID, LEGACY_WORKER_NODE_IDS } from "../quickSetupDefaults";
import { formatTimeLabel } from "./sessionSelectors";
import {
  describeWechatSessionPause,
  resolveWechatRuntimePresentation,
} from "../presenters/wechatStatusPresenter";
import { isGatewayEmbeddedNode } from "./nodeIdentity";

export { describeWechatSessionPause } from "../presenters/wechatStatusPresenter";

export function runningLauncherComponents(status: LauncherStatusResponse | null): Set<string> {
  return new Set((status?.components || []).filter((item) => item.state === "running").map((item) => item.name));
}

export function findLauncherComponent(status: LauncherStatusResponse | null, name: string): LauncherComponentStatus | null {
  return status?.components?.find((item) => item.name === name) ?? null;
}

export function isLauncherGatewayOwned(launcherStatus: LauncherStatusResponse | null) {
  const gateway = findLauncherComponent(launcherStatus, "gateway");
  return gateway?.state === "running" && gateway.error_code !== "external_port_in_use";
}

export function isExternalGatewayConflict(launcherStatus: LauncherStatusResponse | null) {
  const gateway = findLauncherComponent(launcherStatus, "gateway");
  return gateway?.error_code === "external_port_in_use";
}

export function launcherMachineRoleValue(launcherStatus: LauncherStatusResponse | null): LauncherMachineRole | null {
  return launcherStatus?.runtime_model.machine_role ?? null;
}

export function launcherShouldRunGateway(launcherStatus: LauncherStatusResponse | null) {
  return launcherStatus?.runtime_model.gateway_should_run ?? false;
}

export function launcherShouldRunLocalNode(launcherStatus: LauncherStatusResponse | null) {
  return launcherStatus?.runtime_model.local_node_should_run ?? false;
}

export function launcherMachineRoleLabel(launcherStatus: LauncherStatusResponse | null) {
  switch (launcherMachineRoleValue(launcherStatus)) {
    case "gateway":
      return "网关主机";
    case "gateway_console":
      return "网关主机 + 控制台";
    case "node":
      return "工作节点";
    case "console":
      return "控制台";
    default:
      return "未识别";
  }
}

export function launcherManagedComponentsLabel(launcherStatus: LauncherStatusResponse | null) {
  const model = launcherStatus?.runtime_model;
  if (!model) return "未读取";
  const labels: string[] = [];
  if (model.host_redis_should_run) labels.push("主机 Redis");
  if (model.gateway_should_run) labels.push("主网关");
  if (model.local_node_should_run) labels.push("本机节点");
  if (model.node_cache_should_run) labels.push("节点缓存 Redis");
  return labels.length ? labels.join(" / ") : "不托管组件";
}

export function launcherLocalNodePolicyLabel(launcherStatus: LauncherStatusResponse | null) {
  const model = launcherStatus?.runtime_model;
  if (!model) return "未读取";
  return model.local_node_should_run ? "当前角色会托管本机节点。" : "当前角色不会托管本机节点。";
}

export function summarizeWechatRuntime(launcherStatus: LauncherStatusResponse | null, wechatStatus: WeChatStatus | null, gatewaySetup: GatewaySetupConfig) {
  return resolveWechatRuntimePresentation(wechatStatus, {
    gatewayManaged: launcherShouldRunGateway(launcherStatus),
    baseUrlConfigured: Boolean(gatewaySetup.wechat_base_url || wechatStatus?.base_url),
  });
}

export function summarizeLocalNodeRuntime(
  localNodeStatus: LocalNodeStatusResponse | null,
  launcherStatus: LauncherStatusResponse | null,
  inventoryNode?: NodeInventoryRecord | null,
) {
  if (!launcherShouldRunLocalNode(launcherStatus)) {
    if (inventoryNode && isGatewayEmbeddedNode(inventoryNode) && !launcherShouldRunGateway(launcherStatus)) {
      return {
        label: "已连接",
        detail: inventoryNode.last_register_at
          ? `远端网关最近注册 ${formatTimeLabel(inventoryNode.last_register_at, true)}`
          : inventoryNode.last_heartbeat_at
            ? `远端网关最近心跳 ${formatTimeLabel(inventoryNode.last_heartbeat_at, true)}`
            : "远端网关的内置节点已在目标网关上报状态。",
        tone: "good" as const,
      };
    }
    return { label: "未托管", detail: "当前角色不会在本机托管 claw-node。", tone: "warn" as const };
  }
  if (
    !localNodeStatus
    && inventoryNode
    && inventoryNode.node_kind === "local"
    && inventoryNode.connection_state === "connected"
  ) {
    return {
      label: "已连接",
      detail: inventoryNode.last_register_at
        ? `最近注册 ${formatTimeLabel(inventoryNode.last_register_at, true)}`
        : inventoryNode.last_heartbeat_at
          ? `最近心跳 ${formatTimeLabel(inventoryNode.last_heartbeat_at, true)}`
          : "本机节点已注册到当前主网关。",
      tone: "good" as const,
    };
  }
  if (!localNodeStatus) {
    return { label: "读取中", detail: "正在读取本机节点运行态。", tone: "warn" as const };
  }
  if (
    localNodeStatus.state === "running"
    || localNodeStatus.runtime_state === "running"
    || localNodeStatus.runtime_state === "connected"
  ) {
    return {
      label: "已连接",
      detail: localNodeStatus.last_register_at ? `最近注册 ${formatTimeLabel(localNodeStatus.last_register_at, true)}` : "本机节点已注册到当前主网关。",
      tone: "good" as const,
    };
  }
  return {
    label: localNodeStatus.service_state || localNodeStatus.state || "未运行",
    detail: localNodeStatus.detail || localNodeStatus.last_register_error || "本机节点当前未处于稳定运行状态。",
    tone: "warn" as const,
  };
}

export function summarizeGatewayRuntime(
  launcherStatus: LauncherStatusResponse | null,
  systemStatus: SystemStatus | null,
  modelStatus: ModelStatus | null,
) {
  if (!launcherShouldRunGateway(launcherStatus)) {
    return { value: "远端网关", detail: "当前机器不托管主网关。", tone: "warn" as const };
  }
  if (!systemStatus) {
    return { value: "读取中", detail: "正在读取主网关摘要。", tone: "warn" as const };
  }
  if (!systemStatus.redis_ok) {
    return { value: "Redis 异常", detail: "主网关已启动，但 Redis 当前不可用。", tone: "warn" as const };
  }
  if (!modelStatus?.configured) {
    return { value: "已启动", detail: "主网关在线，但内置模型尚未配置。", tone: "warn" as const };
  }
  return { value: "在线", detail: `当前已连接 ${systemStatus.active_nodes} 个节点。`, tone: "good" as const };
}

function launcherRoleUsesLocalNode(machineRole: LauncherMachineRole) {
  return machineRole === "node" || machineRole === "gateway_console";
}

export function buildLauncherStartPayload(
  launcherStatus: LauncherStatusResponse | null,
  machineRole: LauncherMachineRole,
  options?: { dispatchModeEnabled?: boolean; enableNodeCacheRedis?: boolean; localNodeId?: string },
): LauncherStartRequest {
  const dispatchModeEnabled = options?.dispatchModeEnabled ?? (launcherStatus?.profile.dispatch_mode_enabled ?? false);
  const enableNodeCacheRedis = options?.enableNodeCacheRedis
    ?? (((launcherStatus?.profile.node_cache_policy ?? "disabled") !== "disabled") && launcherRoleUsesLocalNode(machineRole) && !dispatchModeEnabled);
  const requestedNodeId = options?.localNodeId?.trim() || launcherStatus?.profile.local_node_id?.trim() || DEFAULT_REMOTE_WORKER_NODE_ID;
  const localNodeId = machineRole === "node"
    ? (LEGACY_WORKER_NODE_IDS.has(requestedNodeId) ? DEFAULT_REMOTE_WORKER_NODE_ID : requestedNodeId)
    : "local-node";
  return {
    machine_role: machineRole,
    enable_node_cache_redis: enableNodeCacheRedis,
    dispatch_mode_enabled: dispatchModeEnabled,
    redis_source: launcherStatus?.profile.redis_source || "mirror",
    node_cache_redis_source: launcherStatus?.profile.node_cache_redis_source || "mirror",
    local_node_id: localNodeId,
  };
}

export function launcherComponentName(name: string) {
  return name === "host-redis" ? "主机 Redis" : name === "node-cache-redis" ? "节点缓存 Redis" : name === "gateway" ? "主网关" : name === "local-node" ? "本机 Claw 节点" : name === "console" ? "控制台" : name === "launcher" ? "桌面启动器" : name;
}

export function launcherStateLabel(state: LauncherState) {
  return state === "running" ? "运行中" : state === "starting" ? "启动中" : state === "degraded" ? "降级" : state === "failed" ? "失败" : "已停止";
}

export function launcherBadgeTone(state: LauncherState) {
  return state === "running" ? "human" : state === "starting" ? "typing" : state === "degraded" ? "queued" : state === "failed" ? "queued" : "idle";
}

export function launcherEnvironmentLabel(name: string) {
  return name === "python" ? "Python 运行时" : name === "node_install_script" ? "节点安装脚本" : name === "node_bundle" ? "节点 bundle" : name === "winsw" ? "Windows 服务包装器" : name;
}
