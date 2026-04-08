import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  resolveInitialWorkspace,
  resolveWorkspaceOnTaskComplete,
  requiresRoleSwitchConfirmation,
  persistWorkspace,
  clearPersistedWorkspace,
  loadPersistedWorkspace,
  resolveRoleBadge,
  validateWorkerGatewayUrl,
  resolveTokenDisplayState,
} from "./roleWorkspace";
import { DiagnosticsConsole } from "./components/Workspaces/Connection/DiagnosticsConsole";
import {
  ConnectionHeroCard,
  ConnectionSignalCard,
  InfoRow,
  MetaPill,
  Metric,
  PrepStrip,
  SetupStepPill,
  SnippetBlock,
  StatusChip,
  ToggleSecretInput,
} from "./components/Workspaces/Connection/ConnectionUi";
import { NodeInventoryPanel } from "./components/Workspaces/Connection/NodeInventoryPanel";
import { NodeModelConfigPanel } from "./components/Workspaces/Connection/NodeModelConfigPanel";
import { OverviewPanel } from "./components/Workspaces/Connection/OverviewPanel";
import { PairingStatusModal } from "./components/Workspaces/Connection/PairingStatusModal";
import { RuntimeLogsPanel } from "./components/Workspaces/Connection/RuntimeLogsPanel";
import { WeChatConfigCard } from "./components/Workspaces/Connection/WeChatConfigCard";
import { LogsWorkspace } from "./components/Workspaces/Logs/LogsWorkspace";
import { LauncherControlPanel } from "./components/Workspaces/QuickSetup/LauncherControlPanel";
import { SessionsWorkspace } from "./components/Workspaces/Sessions/SessionsWorkspace";
import {
  formatDayLabel,
  formatSessionName,
  formatTimeAgo,
  formatWechatIdentity,
  getChannelReleaseHint,
  getSessionBadgeLabel,
  getTypingState,
  roleLabel,
  sessionBadgeTone,
  sessionPreview,
  showDateDivider,
  truncateText,
} from "./components/Workspaces/Sessions/sessionUi";
import type {
  AppSummaryStateCache,
  AppUiStateCache,
  ConsoleSetupConfig,
  DiscoveryPairResponse,
  DiscoveryScanResponse,
  DiscoveredNodeRecord,
  GatewayConsoleSetupRequest,
  GatewayProbeRequest,
  GatewaySetupConfig,
  GatewaySetupSaveRequest,
  GatewaySetupSaveResponse,
  GatewaySummaryEnvelope,
  GatewaySummaryResponse,
  LauncherComponentName,
  LauncherComponentStatus,
  LauncherEnvironmentStatus,
  LauncherLogResponse,
  LauncherMachineRole,
  LauncherNodeCachePolicy,
  LauncherProfile,
  LauncherRedisInstallState,
  LauncherRedisSource,
  LauncherRuntimeModel,
  LauncherStartRequest,
  LauncherState,
  LauncherStatusResponse,
  LauncherWorkdirLayout,
  LocalNodeActionResponse,
  LocalNodeConfigApplyState,
  LocalNodeExportResponse,
  LocalNodeLogsResponse,
  LocalNodeModelConfig,
  LocalNodeModelConfigRequest,
  LocalNodeStatusResponse,
  ManualPairDraft,
  ManualPairRequest,
  MessageRecord,
  ModelCheck,
  ModelStatus,
  NodeCredentialResetRequest,
  NodeDeleteResponse,
  NodeDiagnosticsRecord,
  NodeDiagnosticsResponse,
  NodeDiagnosticsStreamEnvelope,
  NodeInventoryConnectionState,
  NodeInventoryRecord,
  NodeInventorySummary,
  NodeKind,
  NodeListResponse,
  NodeRecord,
  PairingStatus,
  PollResponse,
  PairingDebugEntry,
  QrStart,
  SessionFilter,
  SessionMessageCacheEntry,
  SessionMessagesResponse,
  SessionOverviewEnvelope,
  SessionRecord,
  SessionsResponse,
  SessionStreamEnvelope,
  SessionSwitchAction,
  SessionSwitchRequest,
  SessionSwitchResponse,
  SetupMode,
  SetupProfileResponse,
  SetupRole,
  SetupTaskEnvelope,
  SetupTaskResult,
  SetupTaskStatus,
  SystemStatus,
  WeChatStatus,
  WorkerGatewayConnectionState,
  WorkerNodeSetupConfig,
  WorkspaceTab,
} from "./types";

const FAST_POLL_MS = 1200;
const IDLE_POLL_MS = 3200;
const SUMMARY_FALLBACK_POLL_MS = 10000; // summary WebSocket 降级时的 HTTP 轮询间隔（10 秒）
const RETRY_POLL_MS = 1000; // backend unreachable — retry quickly
const SUMMARY_RETRY_POLL_MS = 3000;
const WS_RECONNECT_BASE_MS = 1500;
const WS_RECONNECT_MAX_MS = 15000;
const SETUP_DRAFT_KEY = "wechat-claw-hub.quick-setup.draft";
const UI_STATE_CACHE_KEY = "wechat-claw-hub.ui-state";
const SUMMARY_STATE_CACHE_KEY = "wechat-claw-hub.summary-state";
const FILTERS: { key: SessionFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "processing", label: "处理中" },
  { key: "human", label: "人工中" },
  { key: "recent", label: "最近活跃" },
];
const DEFAULT_SETUP_ROLES: SetupRole[] = ["gateway_host", "gateway_host_console", "worker_node", "console_only"];

const DEFAULT_GATEWAY_SETUP: GatewaySetupConfig = {
  redis_url: "redis://localhost:6379/0",
  default_agent_id: "default-agent",
  dify_base_url: "",
  dify_api_key: "",
  builtin_model_base_url: "",
  builtin_model_api_key: "",
  builtin_model_name: "",
  wechat_base_url: "https://ilinkai.weixin.qq.com",
  wechat_token: "",
  dispatch_mode_enabled: false,
};

const DEFAULT_WORKER_SETUP: WorkerNodeSetupConfig = {
  node_id: "claw-node-local-1",
  gateway_base_url: "",
  node_token: "",
  pairing_key: "",
  dify_base_url: "",
  dify_api_key: "",
  max_concurrency: 1,
  install_dir: "C:\\wechat-claw-node",
  bundle_path: "",
  discovery_enabled: true,
  discovery_port: 9531,
};

const DEFAULT_CONSOLE_SETUP: ConsoleSetupConfig = {
  gateway_base_url: "",
};
const DEFAULT_MANUAL_PAIR: ManualPairDraft = {
  host: "",
  pairing_port: 9532,
  pairing_key: "",
  node_id: "",
};
const DEFAULT_LOCAL_NODE_MODEL_CONFIG: LocalNodeModelConfigRequest = {
  model_provider: "auto",
  openai_base_url: "",
  openai_api_key: "",
  openai_model: "",
  openai_enable_thinking: false,
  openai_temperature: 0.3,
  openai_top_p: 1,
  openai_max_tokens: 0,
  openai_seed: 0,
  openai_thinking_budget: 0,
  openai_stop: "",
  openai_enable_search: false,
  openai_search_forced: false,
  openai_search_strategy: "turbo",
  openai_enable_search_extension: false,
  openai_multimodal_enabled: true,
  dify_base_url: "",
  dify_api_key: "",
  restart_service: true,
};

function buildLocalNodeModelDraftFromStatus(status: LocalNodeStatusResponse | null): LocalNodeModelConfigRequest {
  return {
    model_provider: status?.model_settings?.model_provider || "auto",
    openai_base_url: status?.model_settings?.openai_base_url || "",
    openai_api_key: status?.model_settings?.openai_api_key || "",
    openai_model: status?.model_settings?.openai_model || "",
    openai_enable_thinking: Boolean(status?.model_settings?.openai_enable_thinking),
    openai_temperature: Number(status?.model_settings?.openai_temperature ?? 0.3),
    openai_top_p: Number(status?.model_settings?.openai_top_p ?? 1),
    openai_max_tokens: Number(status?.model_settings?.openai_max_tokens ?? 0),
    openai_seed: Number(status?.model_settings?.openai_seed ?? 0),
    openai_thinking_budget: Number(status?.model_settings?.openai_thinking_budget ?? 0),
    openai_stop: status?.model_settings?.openai_stop || "",
    openai_enable_search: Boolean(status?.model_settings?.openai_enable_search),
    openai_search_forced: Boolean(status?.model_settings?.openai_search_forced),
    openai_search_strategy: status?.model_settings?.openai_search_strategy || "turbo",
    openai_enable_search_extension: Boolean(status?.model_settings?.openai_enable_search_extension),
    openai_multimodal_enabled: status?.model_settings?.openai_multimodal_enabled !== false,
    dify_base_url: status?.model_settings?.dify_base_url || "",
    dify_api_key: status?.model_settings?.dify_api_key || "",
    restart_service: true,
  };
}

const DEFAULT_BUILTIN_MODEL_LABEL = "DashScope OpenAI Compatible（默认 qwen3.5-plus）";
const GATEWAY_NODE_TOKEN_LOCATION = "apps/gateway/.env → WCH_NODE_TOKENS";

function loadSetupDraft() {
  if (typeof window === "undefined") {
    return {
      role: null as SetupRole | null,
      gateway: DEFAULT_GATEWAY_SETUP,
      worker: DEFAULT_WORKER_SETUP,
      console: DEFAULT_CONSOLE_SETUP,
    };
  }
  try {
    const raw = window.localStorage.getItem(SETUP_DRAFT_KEY);
    if (!raw) {
      return {
        role: null as SetupRole | null,
        gateway: DEFAULT_GATEWAY_SETUP,
        worker: DEFAULT_WORKER_SETUP,
        console: DEFAULT_CONSOLE_SETUP,
      };
    }
    const parsed = JSON.parse(raw) as {
      role?: SetupRole;
      gateway?: GatewaySetupConfig;
      worker?: WorkerNodeSetupConfig;
      console?: ConsoleSetupConfig;
    };
    return {
      role: null,
      gateway: { ...DEFAULT_GATEWAY_SETUP, ...(parsed.gateway ?? {}) },
      worker: { ...DEFAULT_WORKER_SETUP, ...(parsed.worker ?? {}), node_token: "" },
      console: { ...DEFAULT_CONSOLE_SETUP, ...(parsed.console ?? {}) },
    };
  } catch {
    return {
      role: null as SetupRole | null,
      gateway: DEFAULT_GATEWAY_SETUP,
      worker: DEFAULT_WORKER_SETUP,
      console: DEFAULT_CONSOLE_SETUP,
    };
  }
}

function clearQuickSetupCache() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SETUP_DRAFT_KEY);
  window.localStorage.removeItem(SUMMARY_STATE_CACHE_KEY);
  clearPersistedWorkspace();
  window.localStorage.removeItem(UI_STATE_CACHE_KEY);
}

function loadUiStateCache(): AppUiStateCache {
  if (typeof window === "undefined") {
    return { workspace: null, selected_session_id: null, selected_node_id: null };
  }
  try {
    const raw = window.localStorage.getItem(UI_STATE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<AppUiStateCache> : {};
    const workspace =
      parsed.workspace === "quick_setup" || parsed.workspace === "sessions" || parsed.workspace === "connection" || parsed.workspace === "logs"
        ? parsed.workspace
        : loadPersistedWorkspace();
    return {
      workspace,
      selected_session_id: typeof parsed.selected_session_id === "string" ? parsed.selected_session_id : null,
      selected_node_id: null,
    };
  } catch {
    return {
      workspace: loadPersistedWorkspace(),
      selected_session_id: null,
      selected_node_id: null,
    };
  }
}

function loadSummaryStateCache(): AppSummaryStateCache {
  if (typeof window === "undefined") {
    return { system_status: null, wechat_status: null, node_list: null, sessions: [] };
  }
  try {
    const raw = window.localStorage.getItem(SUMMARY_STATE_CACHE_KEY);
    if (!raw) return { system_status: null, wechat_status: null, node_list: null, sessions: [] };
    const parsed = JSON.parse(raw) as Partial<AppSummaryStateCache>;
    return {
      system_status: parsed.system_status ?? null,
      wechat_status: parsed.wechat_status ?? null,
      node_list: parsed.node_list ?? null,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { system_status: null, wechat_status: null, node_list: null, sessions: [] };
  }
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) {
    const rawText = await response.text();
    let payload: unknown = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }
    const detail = payload && typeof payload === "object" && "detail" in payload ? (payload as { detail: unknown }).detail : payload;
    const message =
      detail && typeof detail === "object" && "message" in detail
        ? String((detail as { message: unknown }).message)
        : typeof detail === "string"
        ? detail
        : rawText || `Request failed: ${response.status}`;
    const error = new Error(message) as Error & { status?: number; payload?: unknown; code?: string };
    error.status = response.status;
    error.payload = payload;
    if (detail && typeof detail === "object" && "code" in detail) {
      error.code = String((detail as { code: unknown }).code);
    }
    throw error;
  }
  return (await response.json()) as T;
}

function resolvePreferredGatewayBaseUrl(
  profile?: Pick<SetupProfileResponse, "preferred_gateway_base_url" | "console"> | null,
  system?: Pick<SystemStatus, "preferred_gateway_base_url"> | null,
): string {
  return profile?.preferred_gateway_base_url || profile?.console.gateway_base_url || system?.preferred_gateway_base_url || window.location.origin;
}

function runningLauncherComponents(status: LauncherStatusResponse | null): Set<string> {
  return new Set((status?.components || []).filter((item) => item.state === "running").map((item) => item.name));
}

function findLauncherComponent(status: LauncherStatusResponse | null, name: string): LauncherComponentStatus | null {
  return status?.components?.find((item) => item.name === name) ?? null;
}

function isLauncherGatewayOwned(launcherStatus: LauncherStatusResponse | null) {
  const gateway = findLauncherComponent(launcherStatus, "gateway");
  return gateway?.state === "running" && gateway.error_code !== "external_port_in_use";
}

function isExternalGatewayConflict(launcherStatus: LauncherStatusResponse | null) {
  const gateway = findLauncherComponent(launcherStatus, "gateway");
  return gateway?.error_code === "external_port_in_use";
}

function launcherMachineRoleValue(launcherStatus: LauncherStatusResponse | null): LauncherMachineRole | null {
  return launcherStatus?.runtime_model?.machine_role ?? null;
}

function launcherShouldRunGateway(launcherStatus: LauncherStatusResponse | null) {
  return launcherStatus?.runtime_model?.gateway_should_run ?? false;
}

function launcherShouldRunLocalNode(launcherStatus: LauncherStatusResponse | null) {
  return launcherStatus?.runtime_model?.local_node_should_run ?? false;
}

function launcherMachineRoleLabel(launcherStatus: LauncherStatusResponse | null) {
  switch (launcherMachineRoleValue(launcherStatus)) {
    case "gateway":
      return "网关";
    case "node":
      return "节点";
    case "console":
      return "控制台";
    case "gateway_console":
      return "网关 + 控制台";
    default:
      return "未识别";
  }
}

function launcherManagedComponentsLabel(launcherStatus: LauncherStatusResponse | null) {
  const runtime = launcherStatus?.runtime_model;
  if (!runtime) return "等待 launcher 返回运行模型";
  const parts: string[] = [];
  if (runtime.host_redis_should_run) parts.push("host-redis");
  if (runtime.gateway_should_run) parts.push("gateway");
  if (runtime.local_node_should_run) {
    parts.push(runtime.machine_role === "node" ? `worker-node(${launcherStatus?.profile.local_node_id || DEFAULT_WORKER_SETUP.node_id})` : "local-node");
  }
  if (runtime.node_cache_should_run) parts.push("node-cache-redis");
  return parts.length ? parts.join(" / ") : "当前角色不托管本地后端组件";
}

function applyGatewaySummaryToState(
  summary: GatewaySummaryResponse,
  options: {
    setSystemStatus: React.Dispatch<React.SetStateAction<SystemStatus | null>>;
    setWechatStatus: React.Dispatch<React.SetStateAction<WeChatStatus | null>>;
    setWechatBaseUrl: React.Dispatch<React.SetStateAction<string>>;
    syncNodeStateView: (next: NodeListResponse) => void;
  },
) {
  options.setSystemStatus(summary.system);
  if (summary.wechat.base_url) options.setWechatBaseUrl(summary.wechat.base_url);
  options.setWechatStatus(summary.wechat);
  options.syncNodeStateView(summary.nodes);
}

function launcherLocalNodePolicyLabel(launcherStatus: LauncherStatusResponse | null) {
  if (!launcherShouldRunLocalNode(launcherStatus)) return "当前角色不会托管任何本机节点服务";
  if (launcherMachineRoleValue(launcherStatus) === "node") {
    return `当前角色会托管工作节点 ${launcherStatus?.profile.local_node_id || DEFAULT_WORKER_SETUP.node_id}`;
  }
  return "当前角色会托管网关内置 local-node";
}

function summarizeWechatRuntime(launcherStatus: LauncherStatusResponse | null, wechatStatus: WeChatStatus | null, gatewaySetup: GatewaySetupConfig) {
  if (isExternalGatewayConflict(launcherStatus)) {
    return {
      value: wechatStatus?.has_token ? "扫码结果待确认" : "实例不一致",
      tone: "warn" as const,
      detail: "当前前端连到的不是桌面启动器托管网关；扫码或手动连接结果可能不会同步到当前运行实例。",
    };
  }
  if (wechatStatus?.running) {
    return {
      value: "轮询中",
      tone: "good" as const,
      detail: wechatStatus.base_url || gatewaySetup.wechat_base_url || "未配置",
    };
  }
  if (wechatStatus?.has_token) {
    return {
      value: "已保存未连接",
      tone: "warn" as const,
      detail: wechatStatus.base_url || gatewaySetup.wechat_base_url || "未配置",
    };
  }
  return {
    value: "未连接",
    tone: "warn" as const,
    detail: wechatStatus?.base_url || gatewaySetup.wechat_base_url || "未配置",
  };
}

function summarizeLocalNodeRuntime(localNodeStatus: LocalNodeStatusResponse | null, launcherStatus: LauncherStatusResponse | null) {
  if (!localNodeStatus) {
    return {
      label: "未读取",
      detail: "正在等待本机节点诊断接口返回。",
      tone: "warn" as const,
    };
  }
  if (isExternalGatewayConflict(launcherStatus)) {
    return {
      label: "等待主网关",
      detail: "当前 8300 被外部开发网关占用，桌面启动器托管的主网关未接管，本机节点不会注册到错误实例。",
      tone: "warn" as const,
    };
  }
  if (localNodeStatus.state !== "running") {
    return {
      label: "服务未运行",
      detail: localNodeStatus.detail || "本机节点服务尚未启动。",
      tone: "warn" as const,
    };
  }
  if (localNodeStatus.runtime_state === "connected") {
    return {
      label: "已连接",
      detail: localNodeStatus.last_register_at ? `最近注册 ${formatTimeLabel(localNodeStatus.last_register_at, true)}` : "本机节点已注册到当前主网关。",
      tone: "good" as const,
    };
  }
  if (localNodeStatus.runtime_state === "register_failed") {
    return {
      label: "服务运行中，未注册",
      detail: localNodeStatus.last_register_error || localNodeStatus.detail || "本机节点最近一次注册失败。",
      tone: "warn" as const,
    };
  }
  if (localNodeStatus.runtime_state === "needs_repair") {
    return {
      label: "服务运行中，待修复",
      detail: localNodeStatus.last_register_error || localNodeStatus.detail || "当前节点模型或配置不完整，暂时不会注册。",
      tone: "warn" as const,
    };
  }
  if (localNodeStatus.runtime_state === "waiting_pair") {
    return {
      label: "等待网关",
      detail: "当前节点还在等待网关接管或写入正式运行配置。",
      tone: "warn" as const,
    };
  }
  return {
    label: "服务运行中，待注册",
    detail: localNodeStatus.detail || "本机节点服务已启动，正在等待首次 register/heartbeat。",
    tone: "warn" as const,
  };
}

function summarizeGatewayRuntime(
  launcherStatus: LauncherStatusResponse | null,
  systemStatus: SystemStatus | null,
  modelStatus: ModelStatus | null,
) {
  const hostRedis = findLauncherComponent(launcherStatus, "host-redis");
  const gateway = findLauncherComponent(launcherStatus, "gateway");
  if (gateway?.error_code === "external_port_in_use") {
    return {
      value: "端口冲突",
      tone: "warn" as const,
      detail: gateway.detail || "当前 8300 已被外部开发网关占用，请先停止它，再用桌面启动器启动主网关。",
    };
  }
  if (hostRedis?.state === "failed") {
    return {
      value: "Redis 启动失败",
      tone: "warn" as const,
      detail: hostRedis.detail || "主机 Redis 进程启动失败，请先查看 launcher 日志。",
    };
  }
  if (gateway?.state === "failed") {
    return {
      value: "网关启动失败",
      tone: "warn" as const,
      detail: gateway.detail || "主网关进程启动失败，请先查看 launcher 日志。",
    };
  }
  if (hostRedis?.state === "stopped" || gateway?.state === "stopped") {
    return {
      value: "未启动",
      tone: "warn" as const,
      detail: "当前桌面启动器还没有把 Redis 和主网关都拉起来。",
    };
  }
  if (hostRedis?.state === "running" && gateway?.state === "running") {
    return {
      value: systemStatus?.redis_ok ? "运行中" : "运行中但待校验",
      tone: systemStatus?.redis_ok ? ("good" as const) : ("warn" as const),
      detail: modelStatus?.configured ? `Redis 正常，模型 ${modelStatus.model || "-"} 已配置` : "Redis 已启动，模型尚未完成检测或配置",
    };
  }
  return {
    value: systemStatus?.redis_ok ? "待同步" : "待检查",
    tone: systemStatus?.redis_ok ? ("good" as const) : ("warn" as const),
    detail: modelStatus?.configured ? `模型 ${modelStatus.model || "-"} 已配置` : "模型尚未完成检测或配置",
  };
}

function resolveEffectiveRole(currentRole: SetupRole | null, completedRoles: SetupRole[]): SetupRole | null {
  if (currentRole) return currentRole;
  if (completedRoles.includes("worker_node")) return "worker_node";
  if (completedRoles.includes("gateway_host_console")) return "gateway_host_console";
  if (completedRoles.includes("gateway_host")) return "gateway_host";
  if (completedRoles.includes("console_only")) return "console_only";
  return null;
}
function isGatewayRole(role: SetupRole | null) {
  return role === "gateway_host" || role === "gateway_host_console";
}
function isWorkerRole(role: SetupRole | null) {
  return role === "worker_node";
}
function isConsoleRole(role: SetupRole | null) {
  return role === "console_only";
}

function setupRoleToLauncherMachineRole(role: SetupRole): LauncherMachineRole {
  if (role === "gateway_host") return "gateway";
  if (role === "gateway_host_console") return "gateway_console";
  if (role === "worker_node") return "node";
  return "console";
}

function launcherRoleUsesLocalNode(machineRole: LauncherMachineRole) {
  return machineRole === "node" || machineRole === "gateway_console";
}

function buildLauncherStartPayload(
  launcherStatus: LauncherStatusResponse | null,
  machineRole: LauncherMachineRole,
  options?: { dispatchModeEnabled?: boolean; enableNodeCacheRedis?: boolean; localNodeId?: string },
): LauncherStartRequest {
  const dispatchModeEnabled = options?.dispatchModeEnabled ?? (launcherStatus?.profile.dispatch_mode_enabled ?? false);
  const enableNodeCacheRedis = options?.enableNodeCacheRedis
    ?? ((launcherStatus?.profile.node_cache_policy !== "disabled") && launcherRoleUsesLocalNode(machineRole) && !dispatchModeEnabled);
  const localNodeId = machineRole === "node"
    ? (options?.localNodeId?.trim() || launcherStatus?.profile.local_node_id?.trim() || DEFAULT_WORKER_SETUP.node_id)
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

function resolveWorkerNodeId(currentValue: string, launcherProfile?: LauncherProfile | null) {
  const trimmedCurrent = currentValue.trim();
  if (trimmedCurrent && trimmedCurrent !== DEFAULT_WORKER_SETUP.node_id) return currentValue;
  const launcherNodeId = launcherProfile?.local_node_id?.trim();
  if (launcherNodeId && launcherNodeId !== "local-node") return launcherNodeId;
  return currentValue;
}
function resolveWorkerGatewayBaseUrl(
  currentValue: string,
  profile?: Pick<SetupProfileResponse, "console" | "preferred_gateway_base_url" | "last_task"> | null,
  system?: Pick<SystemStatus, "preferred_gateway_base_url"> | null,
) {
  const trimmedCurrent = currentValue.trim();
  if (trimmedCurrent) return trimmedCurrent;
  const taskGatewayBaseUrl = profile?.last_task?.kind === "node_install" ? profile.last_task.metadata.gateway_base_url?.trim() : "";
  if (taskGatewayBaseUrl) return taskGatewayBaseUrl;
  return resolvePreferredGatewayBaseUrl(profile, system);
}

function shouldUseOriginLocalGateway(launcherAvailable: boolean, localGatewayManaged: boolean | null) {
  if (localGatewayManaged === true) return true;
  if (localGatewayManaged === false) return false;
  try {
    const origin = new URL(window.location.origin);
    const isLocalControlOrigin =
      (origin.hostname === "127.0.0.1" || origin.hostname === "localhost")
      && origin.port === "8765";
    if (isLocalControlOrigin && !launcherAvailable) {
      return false;
    }
  } catch {
    // fall through to optimistic default
  }
  return true;
}

function getReconnectDelay(attempt: number) {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * (2 ** safeAttempt));
}

export function App() {
  const initialDraft = loadSetupDraft();
  const initialUiState = useMemo(() => loadUiStateCache(), []);
  const initialSummaryState = useMemo(() => loadSummaryStateCache(), []);
  const [workspace, setWorkspace] = useState<WorkspaceTab>(initialUiState.workspace ?? "quick_setup");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [setupProfile, setSetupProfile] = useState<SetupProfileResponse | null>(null);
  const [setupRole, setSetupRole] = useState<SetupRole | null>(null);
  const [setupMode, setSetupMode] = useState<SetupMode>("role");
  const [gatewaySetup, setGatewaySetup] = useState<GatewaySetupConfig>(initialDraft.gateway);
  const [workerSetup, setWorkerSetup] = useState<WorkerNodeSetupConfig>(initialDraft.worker);
  const [consoleSetup, setConsoleSetup] = useState<ConsoleSetupConfig>(initialDraft.console);
  const [setupTask, setSetupTask] = useState<SetupTaskResult | null>(null);
  const [discoveredNodes, setDiscoveredNodes] = useState<DiscoveredNodeRecord[]>([]);
  const [pairingSecrets, setPairingSecrets] = useState<Record<string, string>>({});
  const [pairingStatuses, setPairingStatuses] = useState<Record<string, PairingStatus>>({});
  const [manualPair, setManualPair] = useState<ManualPairDraft>(DEFAULT_MANUAL_PAIR);
  const [pairingDebugEntries, setPairingDebugEntries] = useState<PairingDebugEntry[]>([]);
  const [pairingModalTaskId, setPairingModalTaskId] = useState<string | null>(null);
  const [pairingModalTask, setPairingModalTask] = useState<SetupTaskResult | null>(null);
  const [pairingModalStartedAt, setPairingModalStartedAt] = useState<number>(0);
  const pairingModalTimerRef = useRef<number | null>(null);
  const [reconfigureConfirmOpen, setReconfigureConfirmOpen] = useState(false);
  const [launcherStatus, setLauncherStatus] = useState<LauncherStatusResponse | null>(null);
  const [launcherAvailable, setLauncherAvailable] = useState(false);
  const [launcherLogs, setLauncherLogs] = useState<Record<string, string>>({});
  const [launcherExpanded, setLauncherExpanded] = useState(false);
  const [envExpanded, setEnvExpanded] = useState(false);
  const [nodeFormAdvanced, setNodeFormAdvanced] = useState(false);
  const [localNodeStatus, setLocalNodeStatus] = useState<LocalNodeStatusResponse | null>(null);
  const [localNodeLogs, setLocalNodeLogs] = useState<LocalNodeLogsResponse | null>(null);
  const [runtimeLogsRefreshing, setRuntimeLogsRefreshing] = useState(false);
  const [localNodeModelDraft, setLocalNodeModelDraft] = useState<LocalNodeModelConfigRequest>(DEFAULT_LOCAL_NODE_MODEL_CONFIG);
  const [localNodeModelDirty, setLocalNodeModelDirty] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [modelCheck, setModelCheck] = useState<ModelCheck | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(initialSummaryState.system_status);
  const [wechatStatus, setWechatStatus] = useState<WeChatStatus | null>(initialSummaryState.wechat_status);
  const [nodes, setNodes] = useState<NodeRecord[]>(initialSummaryState.node_list?.nodes ?? []);
  const [nodeInventory, setNodeInventory] = useState<NodeInventoryRecord[]>(initialSummaryState.node_list?.inventory ?? []);
  const [nodeInventorySummary, setNodeInventorySummary] = useState<NodeInventorySummary>(initialSummaryState.node_list?.summary ?? { paired_total: 0, online_total: 0, offline_total: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialUiState.selected_node_id);
  const [selectedNodeDiagnostics, setSelectedNodeDiagnostics] = useState<NodeDiagnosticsRecord | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>(initialSummaryState.sessions);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialUiState.selected_session_id);
  const [sessionManualNodeId, setSessionManualNodeId] = useState("");
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(
    initialUiState.selected_session_id
      ? initialSummaryState.sessions.find((item) => item.session_id === initialUiState.selected_session_id) ?? initialSummaryState.sessions[0] ?? null
      : initialSummaryState.sessions[0] ?? null,
  );
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(initialSummaryState.sessions.length > 0);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [messageCursor, setMessageCursor] = useState<number>(0);
  const [messageHistoryStart, setMessageHistoryStart] = useState<number>(0);
  const [messageHasMoreBefore, setMessageHasMoreBefore] = useState(false);
  const [messageHistoryLoading, setMessageHistoryLoading] = useState(false);
  const [gatewaySummaryStreamActive, setGatewaySummaryStreamActive] = useState(false);
  const [qr, setQr] = useState<QrStart | null>(null);
  const [qrImageSrc, setQrImageSrc] = useState("");
  const [pollState, setPollState] = useState<PollResponse | null>(null);
  const [wechatBaseUrl, setWechatBaseUrl] = useState(initialSummaryState.wechat_status?.base_url || "https://ilinkai.weixin.qq.com");
  const [manualToken, setManualToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("正在读取主网关状态。");
  const [now, setNow] = useState(Date.now());
  const [workerGatewayProbeTask, setWorkerGatewayProbeTask] = useState<SetupTaskResult | null>(null);
  const [workerPairingKeyVisible, setWorkerPairingKeyVisible] = useState(false);
  const [workerModelExpanded, setWorkerModelExpanded] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const workerGatewayAutoProbeKeyRef = useRef("");
  const shouldAutoFollowMessagesRef = useRef(true);
  const previousMessageSessionIdRef = useRef<string | null>(null);
  const pendingHistoryRestoreRef = useRef<{ sessionId: string; scrollHeight: number; scrollTop: number } | null>(null);
  const sessionMessageCacheRef = useRef<Map<string, SessionMessageCacheEntry>>(new Map());
  const nodeDiagnosticsCacheRef = useRef<Map<string, NodeDiagnosticsRecord>>(new Map());
  const effectiveRole = resolveEffectiveRole(setupRole, setupProfile?.completed_roles ?? []);
  const currentRoleIsWorker = isWorkerRole(effectiveRole);
  const currentRoleIsConsole = isConsoleRole(effectiveRole);
  const runtimeMachineRole = launcherMachineRoleValue(launcherStatus);
  const localGatewayManaged = launcherAvailable ? launcherShouldRunGateway(launcherStatus) : null;
  const shouldUseLocalGatewayApi = shouldUseOriginLocalGateway(launcherAvailable, localGatewayManaged);
  const shouldUseRemoteGatewayApi = currentRoleIsWorker || (currentRoleIsConsole && localGatewayManaged === false);
  const shouldUseWorkerLocalApi = currentRoleIsWorker && localGatewayManaged === false;
  const sessionRemoteGatewayBaseUrl = currentRoleIsWorker
    ? workerSetup.gateway_base_url.trim()
    : currentRoleIsConsole
      ? (consoleSetup.gateway_base_url.trim() || setupProfile?.console.gateway_base_url || "")
      : (systemStatus?.preferred_gateway_base_url || setupProfile?.preferred_gateway_base_url || "");
  const sessionRemoteNodeId = currentRoleIsWorker ? workerSetup.node_id.trim() : "";

  function scrollMessagesToBottom() {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }

  function isMessageStreamNearBottom() {
    const container = messagesRef.current;
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
  }

  function handleMessageStreamScroll() {
    shouldAutoFollowMessagesRef.current = isMessageStreamNearBottom();
    const container = messagesRef.current;
    if (
      container &&
      container.scrollTop <= 24 &&
      selectedSessionId &&
      messageHasMoreBefore &&
      !messageHistoryLoading
    ) {
      void loadOlderSessionMessages();
    }
  }

  function resolveHistoryStart(detail: SessionMessagesResponse, fallbackCursor?: number) {
    if (typeof detail.history_start === "number" && Number.isFinite(detail.history_start)) {
      return Math.max(0, detail.history_start);
    }
    const basis = typeof fallbackCursor === "number" ? fallbackCursor : detail.next_cursor;
    return Math.max(0, basis - detail.messages.length);
  }

  function syncNodeStateView(next: NodeListResponse, options?: { selectNode?: boolean }) {
    syncNodeState(
      next,
      setNodes,
      setNodeInventory,
      setNodeInventorySummary,
      setSelectedNodeId,
      { selectNode: options?.selectNode ?? workspace === "connection" },
    );
  }

  async function refreshGatewaySummarySnapshot() {
    const usesRemoteGateway = currentRoleIsWorker || (currentRoleIsConsole && localGatewayManaged === false);
    const remoteGateway = usesRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    if (usesRemoteGateway) {
      if (!remoteGateway) return null;
      const summary = await requestJson<GatewaySummaryResponse>(`${remoteGateway}/api/system/summary`);
      applyGatewaySummaryToState(summary, {
        setSystemStatus,
        setWechatStatus,
        setWechatBaseUrl,
        syncNodeStateView,
      });
      return summary;
    }
    if (localGatewayManaged === false) {
      return null;
    }
    const summary = await requestJson<GatewaySummaryResponse>("/api/system/summary");
    applyGatewaySummaryToState(summary, {
      setSystemStatus,
      setWechatStatus,
      setWechatBaseUrl,
      syncNodeStateView,
    });
    return summary;
  }

  function syncSetupProfileState(
    profile: SetupProfileResponse,
    preferredGatewayBaseUrl: string,
    options?: { syncLastTask?: boolean; system?: SystemStatus | null },
  ) {
    setSetupProfile(profile);
    if (options?.syncLastTask) {
      setSetupTask(profile.last_task);
    }
    setWorkerGatewayProbeTask(profile.last_task?.kind === "gateway_probe" ? profile.last_task : null);
    setGatewaySetup(profile.gateway);
    setConsoleSetup({ ...profile.console, gateway_base_url: profile.console.gateway_base_url || preferredGatewayBaseUrl });
    setWorkerSetup((current) => ({
      ...current,
      node_id: resolveWorkerNodeId(current.node_id, launcherStatus?.profile),
      gateway_base_url: resolveWorkerGatewayBaseUrl(current.gateway_base_url, profile, options?.system ?? systemStatus),
      dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
      dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
      node_token: "",
    }));
  }

  function upsertSessionInView(nextSession: SessionRecord) {
    setSessions((current) => {
      const exists = current.some((item) => item.session_id === nextSession.session_id);
      const next = exists
        ? current.map((item) => (item.session_id === nextSession.session_id ? nextSession : item))
        : [nextSession, ...current];
      return next;
    });
    setSelectedSessionId((current) => current ?? nextSession.session_id);
    setActiveSession((current) => (current?.session_id === nextSession.session_id ? nextSession : current));
  }

  useEffect(() => {
    window.localStorage.setItem(
      SETUP_DRAFT_KEY,
      JSON.stringify({
        gateway: gatewaySetup,
        worker: workerSetup,
        console: consoleSetup,
      }),
    );
  }, [gatewaySetup, workerSetup, consoleSetup]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        UI_STATE_CACHE_KEY,
        JSON.stringify({
          workspace,
          selected_session_id: selectedSessionId,
          selected_node_id: null,
        } satisfies AppUiStateCache),
      );
    } catch {
      // ui state cache is best-effort
    }
    persistWorkspace(workspace);
  }, [selectedNodeId, selectedSessionId, workspace]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SUMMARY_STATE_CACHE_KEY,
        JSON.stringify({
          system_status: systemStatus,
          wechat_status: wechatStatus,
          node_list: { nodes, inventory: nodeInventory, summary: nodeInventorySummary },
          sessions: sessions.slice(0, 50),
        } satisfies AppSummaryStateCache),
      );
    } catch {
      // summary cache is best-effort
    }
  }, [nodeInventory, nodeInventorySummary, nodes, sessions, systemStatus, wechatStatus]);

  useEffect(() => {
    if (!workerSetup.pairing_key.trim()) return;
    setManualPair((current) => (current.pairing_key.trim() ? current : { ...current, pairing_key: workerSetup.pairing_key.trim() }));
  }, [workerSetup.pairing_key]);

  // 移除自动探测 useEffect，统一使用 summary 轮询获取节点状态
  // 节点角色下的探测状态由 summary 轮询自动构造（见 Line 1218-1257）

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!qr?.qrcode_url) return setQrImageSrc("");
      if (qr.qrcode_url.startsWith("data:image/")) return setQrImageSrc(qr.qrcode_url);
      if (!qr.qrcode_url.startsWith("http")) return setQrImageSrc(`data:image/png;base64,${qr.qrcode_url}`);
      try {
        const dataUrl = await QRCode.toDataURL(qr.qrcode_url, { margin: 1, width: 360, color: { dark: "#151312", light: "#fffaf3" } });
        if (!cancelled) setQrImageSrc(dataUrl);
      } catch {
        if (!cancelled) setQrImageSrc("");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [qr]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (pairingModalTimerRef.current !== null) {
        window.clearInterval(pairingModalTimerRef.current);
      }
    };
  }, []);

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
  }, [messages.length, selectedSessionId]);

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
  }, [messages.length, messagesLoaded, selectedSessionId, activeSession?.active_task_id, activeSession?.queue_status]);

  useEffect(() => {
    // 只在接入中心工作区时轮询本地节点状态
    if (!launcherAvailable || workspace !== "connection") return;
    let cancelled = false;
    let timer = 0;
    const run = async () => {
      try {
        const status = await requestJson<LocalNodeStatusResponse>("/local/node/status");
        if (cancelled) return;
        setLocalNodeStatus(status);
        if (!localNodeModelDirty) {
          setLocalNodeModelDraft(buildLocalNodeModelDraftFromStatus(status));
        }
      } catch {
        // keep local diagnostics polling best-effort
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void run(), 4000);
      }
    };
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [launcherAvailable, workspace, localNodeModelDirty]);

  useEffect(() => {
    if (!launcherAvailable || workspace !== "logs") return;
    let cancelled = false;
    let timer = 0;
    const run = async () => {
      await refreshRuntimeLogs({ silent: true });
      if (!cancelled) {
        timer = window.setTimeout(() => void run(), 4000);
      }
    };
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [launcherAvailable, launcherStatus, workspace]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;
    const init = async () => {
      let launcherSt: LauncherStatusResponse | null = null;
      try {
        // 先检查 launcher 状态，按角色决定是否需要启动 gateway
        try {
          launcherSt = await requestJson<LauncherStatusResponse>("/local/bootstrap/status");
        } catch { /* launcher 不可用时跳过 */ }
        if (cancelled) return;

        if (launcherSt) {
          const launcherProfile = launcherSt.profile;
          setLauncherStatus(launcherSt);
          setLauncherAvailable(true);
          setWorkerSetup((current) => ({
            ...current,
            node_id: resolveWorkerNodeId(current.node_id, launcherProfile),
            gateway_base_url: launcherProfile.gateway_base_url?.trim() || current.gateway_base_url,
          }));
          const runtimeRole = launcherMachineRoleValue(launcherSt);
          const gatewayShouldRun = launcherShouldRunGateway(launcherSt);
          // 无本地 gateway 的机器，不再继续请求本机 /api/*
          if (!gatewayShouldRun) {
            if (runtimeRole === "node") {
              try {
                const localProfile = await requestJson<SetupProfileResponse>("/local/setup/profile");
                if (!cancelled) {
                  setSetupProfile(localProfile);
                  const initialWorkspace = localProfile.setup_completed
                    ? (initialUiState.workspace ?? resolveInitialWorkspace(localProfile))
                    : "quick_setup";
                  setWorkspace(initialWorkspace);
                  setSetupMode(localProfile.setup_completed ? "status" : "role");
                }
              } catch {
                // ignore launcher-only setup bootstrap errors
              }
              setNotice("当前为节点角色，网关运行在远端机器上。");
            } else {
              setWorkspace(initialUiState.workspace ?? "quick_setup");
              setSetupMode("role");
              setNotice(runtimeRole === "console" ? "当前为控制台角色，本机不托管网关；请选择并连接目标网关。" : "当前机器未托管本地网关，请先选择角色并完成连接。");
            }
            return;
          }
        }

        const summaryPromise = requestJson<GatewaySummaryResponse>("/api/system/summary").catch(() => null);
        const profile = await requestJson<SetupProfileResponse>("/api/setup/profile");
        if (cancelled) return;
        const bootstrapSystem = initialSummaryState.system_status ?? systemStatus;
        const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, bootstrapSystem);
        setSetupProfile(profile);
        const initialWorkspace = profile.setup_completed
          ? (initialUiState.workspace ?? resolveInitialWorkspace(profile))
          : "quick_setup";
        setWorkspace(initialWorkspace);
        setSetupTask(profile.last_task);
        setWorkerGatewayProbeTask(profile.last_task?.kind === "gateway_probe" ? profile.last_task : null);
        setSetupMode(profile.setup_completed ? "status" : "role");
        setGatewaySetup(profile.gateway);
        setConsoleSetup({ ...profile.console, gateway_base_url: profile.console.gateway_base_url || preferredGatewayBaseUrl });
        setWorkerSetup((current) => ({
          ...current,
          node_id: resolveWorkerNodeId(current.node_id, launcherSt?.profile),
          gateway_base_url: resolveWorkerGatewayBaseUrl(current.gateway_base_url, profile, bootstrapSystem),
          dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
          dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
        }));
        setNotice(
          profile.recommended_workspace === "quick_setup"
            ? "检测到这是首次启动，先完成快速配置。"
            : bootstrapSystem
              ? (bootstrapSystem.redis_ok
                  ? "已从缓存恢复主网关摘要，正在同步最新状态。"
                  : "已恢复上次主网关摘要，正在重新校验当前状态。")
              : "正在同步主网关最新状态…",
        );

        const summary = await summaryPromise;
        if (!cancelled && summary) {
          applyGatewaySummaryToState(summary, {
            setSystemStatus,
            setWechatStatus,
            setWechatBaseUrl,
            syncNodeStateView,
          });
          setWorkerSetup((current) => ({
            ...current,
            gateway_base_url: resolveWorkerGatewayBaseUrl(current.gateway_base_url, profile, summary.system),
          }));
          setNotice(
            profile.recommended_workspace === "quick_setup"
              ? "检测到这是首次启动，先完成快速配置。"
              : summary.system.redis_ok
                ? "主网关在线。微信、节点和会话概览会通过实时流持续更新。"
                : "主网关已启动，但 Redis 当前不可用。",
          );
        }

        void requestJson<ModelStatus>("/api/models/builtin/status").then((model) => {
          if (cancelled) return;
          setModelStatus(model);
        });
      } catch (error) {
        if (!cancelled) {
          const runtimeRole = launcherMachineRoleValue(launcherSt);
          const localGatewayManaged = launcherShouldRunGateway(launcherSt);
          const isRemoteGatewayRole = runtimeRole === "node" || runtimeRole === "console" || localGatewayManaged === false;
          setNotice(isRemoteGatewayRole ? (runtimeRole === "console" ? "当前为控制台角色，本机不托管网关。" : "当前为节点角色，网关运行在远端机器上。") : "正在等待主网关启动…");
          if (!isRemoteGatewayRole) retryTimer = window.setTimeout(() => void init(), RETRY_POLL_MS);
        }
      }
    };
    void init();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (workspace !== "quick_setup" || !setupProfile?.setup_completed) return;
    setSetupMode((current) => (current === "config" || current === "preview" ? current : "status"));
  }, [workspace, setupProfile?.setup_completed]);

  async function fetchSessionMessages(
    sessionId: string,
    options?: { remoteGateway?: string | null; afterCount?: number; beforeCount?: number; limit?: number; fallbackToFull?: boolean },
  ) {
    const remoteGateway = options?.remoteGateway?.trim() || "";
    const afterCount = options?.afterCount ?? 0;
    const beforeCount = options?.beforeCount;
    const limit = options?.limit;
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
      if (options?.fallbackToFull && afterCount > 0 && failure.status === 400) {
        const fullUrl = remoteGateway
          ? `${remoteGateway}/api/sessions/${encodeURIComponent(sessionId)}/messages`
          : `/api/sessions/${encodeURIComponent(sessionId)}/messages`;
        return await requestJson<SessionMessagesResponse>(fullUrl);
      }
      throw error;
    }
  }

  function mergeMessages(current: MessageRecord[], incoming: MessageRecord[]) {
    if (!incoming.length) return current;
    const merged = new Map(current.map((message) => [message.message_id, message]));
    for (const message of incoming) {
      merged.set(message.message_id, message);
    }
    return Array.from(merged.values()).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  function getSessionMessageCache(sessionId: string | null) {
    if (!sessionId) return null;
    return sessionMessageCacheRef.current.get(sessionId) ?? null;
  }

  function shouldPreserveSessionHistory(current: SessionMessageCacheEntry | undefined, detail: SessionMessagesResponse) {
    if (!current?.loaded) return false;
    if (!detail.replace_messages) return false;
    if (detail.next_cursor < current.cursor) return false;
    const incomingHistoryStart = resolveHistoryStart(detail, current.cursor);
    if (current.historyStart < incomingHistoryStart) return true;
    return current.messages.length > detail.messages.length;
  }

  function syncSessionMessageCache(
    sessionId: string,
    detail: SessionMessagesResponse,
    options?: { preserveExisting?: boolean; mergeMode?: "replace" | "append" | "prepend" },
  ) {
    const current = sessionMessageCacheRef.current.get(sessionId);
    const preserveHistory = shouldPreserveSessionHistory(current, detail);
    const mergeMode = options?.mergeMode ?? (detail.replace_messages ? "replace" : "append");
    const nextMessages =
      preserveHistory
        ? mergeMessages(current?.messages ?? [], detail.messages)
        : mergeMode === "prepend"
          ? mergeMessages(detail.messages, current?.messages ?? [])
          : options?.preserveExisting && current?.loaded && !detail.replace_messages
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
  }

  function applySessionMessageEntry(sessionId: string, entry: SessionMessageCacheEntry) {
    if (selectedSessionId !== sessionId) return;
    setActiveSession(entry.session ?? null);
    setMessages(entry.messages);
    setMessageCursor(entry.cursor);
    setMessageHistoryStart(entry.historyStart);
    setMessageHasMoreBefore(entry.hasMoreBefore);
    setMessagesLoaded(entry.loaded);
  }

  async function loadOlderSessionMessages() {
    if (!selectedSessionId || messageHistoryLoading || !messageHasMoreBefore || messageHistoryStart <= 0) {
      return;
    }
    const sessionId = selectedSessionId;
    const usesRemoteGateway = currentRoleIsWorker || (currentRoleIsConsole && !launcherShouldRunGateway(launcherStatus));
    const remoteGateway = usesRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    if (usesRemoteGateway && !remoteGateway) {
      return;
    }
    if (!usesRemoteGateway && !shouldUseLocalGatewayApi) {
      return;
    }

    const current = getSessionMessageCache(sessionId);
    const beforeCount = current?.historyStart ?? messageHistoryStart;
    if (beforeCount <= 0) {
      return;
    }

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
      if (selectedSessionId !== sessionId) {
        return;
      }
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
  }

  function getNodeDiagnosticsCache(nodeId: string | null) {
    if (!nodeId) return null;
    return nodeDiagnosticsCacheRef.current.get(nodeId) ?? null;
  }

  function syncNodeDiagnosticsCache(nodeId: string, diagnostics: NodeDiagnosticsRecord) {
    nodeDiagnosticsCacheRef.current.set(nodeId, diagnostics);
    return diagnostics;
  }

  function applyNodeDiagnosticsEntry(nodeId: string, diagnostics: NodeDiagnosticsRecord | null) {
    if (selectedNodeId !== nodeId) return;
    setSelectedNodeDiagnostics(diagnostics);
  }

  function clearNodeDiagnosticsCache(nodeId?: string | null) {
    if (!nodeId) {
      nodeDiagnosticsCacheRef.current.clear();
      return;
    }
    nodeDiagnosticsCacheRef.current.delete(nodeId);
  }

  function buildSessionWebSocketUrl(sessionId: string, remoteGateway?: string | null) {
    const baseUrl = remoteGateway?.trim() || window.location.origin;
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/api/sessions/${encodeURIComponent(sessionId)}/ws`;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function buildSessionOverviewWebSocketUrl(remoteGateway?: string | null) {
    const baseUrl = remoteGateway?.trim() || window.location.origin;
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/sessions/overview/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function buildNodeDiagnosticsWebSocketUrl(nodeId: string, remoteGateway?: string | null) {
    const baseUrl = remoteGateway?.trim() || window.location.origin;
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/api/nodes/${encodeURIComponent(nodeId)}/diagnostics/ws`;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function buildGatewaySummaryWebSocketUrl(remoteGateway?: string | null) {
    const baseUrl = remoteGateway?.trim() || window.location.origin;
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/system/summary/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer = 0;
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;
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
        applyGatewaySummaryToState(payload.summary, {
          setSystemStatus,
          setWechatStatus,
          setWechatBaseUrl,
          syncNodeStateView,
        });
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
  }, [currentRoleIsConsole, currentRoleIsWorker, localGatewayManaged, sessionRemoteGatewayBaseUrl, sessionRemoteNodeId, shouldUseLocalGatewayApi]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const run = async () => {
      // WebSocket 连接成功时跳过 HTTP 轮询
      if (gatewaySummaryStreamActive) {
        return;
      }
      // 所有工作区都需要 summary 数据（节点状态、微信状态、系统状态）
      // 移除 sessions 工作区的特殊处理，统一使用 WebSocket 优先 + HTTP 降级策略
      if (currentRoleIsWorker) {
        const remoteGateway = sessionRemoteGatewayBaseUrl;
        const nodeId = sessionRemoteNodeId;
        if (!remoteGateway || !nodeId) return;
        let failed = false;
        try {
          const summary = await requestJson<GatewaySummaryResponse>(`${remoteGateway}/api/system/summary`).catch(() => null);
          if (cancelled) return;
          if (summary) {
            applyGatewaySummaryToState(summary, {
              setSystemStatus,
              setWechatStatus,
              setWechatBaseUrl,
              syncNodeStateView,
            });
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
          }
        } catch { failed = true; }
        finally {
          // summary 轮询作为 WebSocket 降级，使用较长间隔（10 秒）
          if (!cancelled) timer = window.setTimeout(() => void run(), failed ? SUMMARY_RETRY_POLL_MS : SUMMARY_FALLBACK_POLL_MS);
        }
        return;
      }
      if (!shouldUseLocalGatewayApi && !shouldUseRemoteGatewayApi) {
        if (!cancelled) timer = window.setTimeout(() => void run(), IDLE_POLL_MS);
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
            applyGatewaySummaryToState(summary, {
              setSystemStatus,
              setWechatStatus,
              setWechatBaseUrl,
              syncNodeStateView,
            });
          }
        } catch {
          failed = true;
        } finally {
          // summary 轮询作为 WebSocket 降级，使用较长间隔（10 秒）
          if (!cancelled) timer = window.setTimeout(() => void run(), failed ? SUMMARY_RETRY_POLL_MS : SUMMARY_FALLBACK_POLL_MS);
        }
        return;
      }
      if (localGatewayManaged === null) { timer = window.setTimeout(() => void run(), 500); return; }
      let failed = false;
      try {
        const summary = await requestJson<GatewaySummaryResponse>("/api/system/summary");
        if (cancelled) return;
        applyGatewaySummaryToState(summary, {
          setSystemStatus,
          setWechatStatus,
          setWechatBaseUrl,
          syncNodeStateView,
        });
      } catch {
        failed = true;
        // keep live polling resilient
      } finally {
        // summary 轮询作为 WebSocket 降级，使用较长间隔（10 秒）
        if (!cancelled) timer = window.setTimeout(() => void run(), failed ? SUMMARY_RETRY_POLL_MS : SUMMARY_FALLBACK_POLL_MS);
      }
    };
    void run();
    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); void run(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [currentRoleIsConsole, currentRoleIsWorker, gatewaySummaryStreamActive, launcherStatus, localGatewayManaged, sessionRemoteGatewayBaseUrl, sessionRemoteNodeId, workspace]);

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
        scheduleHttpPolling(IDLE_POLL_MS);
      } catch {
        if (cancelled) return;
        scheduleHttpPolling(RETRY_POLL_MS);
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
        scheduleHttpPolling(hasInitialSessions ? IDLE_POLL_MS : RETRY_POLL_MS);
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
      scheduleHttpPolling(RETRY_POLL_MS);
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
  }, [currentRoleIsConsole, currentRoleIsWorker, localGatewayManaged, sessionRemoteGatewayBaseUrl, sessionRemoteNodeId, shouldUseLocalGatewayApi, sessionsLoaded, workspace]);

  useEffect(() => {
    shouldAutoFollowMessagesRef.current = true;
    pendingHistoryRestoreRef.current = null;
    setMessageHistoryLoading(false);
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
  }, [selectedSessionId, sessions]);

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

    // 立即应用缓存（如果存在），避免 UI 闪烁
    const cached = getSessionMessageCache(sessionId);
    if (cached?.loaded) {
      applySessionMessageEntry(sessionId, cached);
    }

    const loadMessages = async (preferIncremental: boolean) => {
      const cached = getSessionMessageCache(sessionId);
      const hasCache = Boolean(cached?.loaded);
      const afterCount = preferIncremental && cached?.loaded ? cached.cursor : 0;
      // 只有在没有缓存且不是增量加载时才显示加载状态
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
        const nextDelay = shouldUseFastPolling(detail.session) ? FAST_POLL_MS : IDLE_POLL_MS;
        if (!cancelled) httpTimer = window.setTimeout(() => void loadMessages(true), nextDelay);
      } catch (error) {
        if (cancelled || selectedSessionId !== sessionId) return;
        if (!hasCache) {
          setMessages([]);
          setMessageCursor(0);
          setMessagesLoaded(true);
        }
        setNotice(`读取会话消息失败：${(error as Error).message}`);
        if (!cancelled) httpTimer = window.setTimeout(() => void loadMessages(Boolean(getSessionMessageCache(sessionId)?.loaded)), RETRY_POLL_MS);
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
      const wsUrl = buildSessionWebSocketUrl(sessionId, remoteGateway);
      let receivedPayload = false;
      let receivedSnapshot = false;
      let snapshotTimeout = 0;
      try {
        socket = new WebSocket(wsUrl);
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
          // ignore close errors when falling back to HTTP polling
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
  }, [currentRoleIsConsole, currentRoleIsWorker, launcherStatus, localGatewayManaged, selectedSessionId, sessionRemoteGatewayBaseUrl, shouldUseLocalGatewayApi, workspace]);

  useEffect(() => {
    if (workspace !== "connection" || !selectedNodeId) {
      setSelectedNodeDiagnostics(null);
      return;
    }
    const useRemoteGateway = currentRoleIsConsole && !launcherShouldRunGateway(launcherStatus);
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
  }, [currentRoleIsConsole, launcherStatus, selectedNodeId, sessionRemoteGatewayBaseUrl, shouldUseLocalGatewayApi, workspace]);

  useEffect(() => {
    if (!setupTask || (setupTask.status !== "pending" && setupTask.status !== "running")) return;
    if (!launcherShouldRunGateway(launcherStatus)) return; // 无本地网关时任务由 /local 或远端链路处理
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await requestJson<SetupTaskEnvelope>(`/api/setup/tasks/${encodeURIComponent(setupTask.task_id)}`);
        if (cancelled) return;
        setSetupTask(result.task);
        if (result.task.status === "succeeded") {
          if (setupRole === "worker_node") {
            await applyLauncherPolicyForRole("worker_node");
          }
          setNotice(result.task.summary || "快速配置执行完成。");
          const profile = await requestJson<SetupProfileResponse>("/api/setup/profile");
          if (!cancelled) {
            setSetupProfile(profile);
            if (setupRole) {
              setWorkspace((current) => {
                const next = resolveWorkspaceOnTaskComplete("succeeded", setupRole, current);
                persistWorkspace(next);
                return next;
              });
            }
          }
        } else if (result.task.status === "failed") {
          setNotice(result.task.summary || "快速配置执行失败，请检查日志。");
        }
      } catch (error) {
        if (!cancelled) setNotice(`读取配置任务失败：${(error as Error).message}`);
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [launcherStatus, setupRole, setupTask]);

  useEffect(() => {
    if (!setupTask || (!isPairingTaskKind(setupTask.kind) && setupTask.kind !== "node_install")) return;
    pushPairingDebugEntry({
      id: setupTask.task_id,
      kind: setupTask.kind,
      title: setupTask.title,
      status: setupTask.status,
      summary: setupTask.summary,
      logs: setupTask.logs,
      target: setupTask.kind === "discovery_scan"
        ? `局域网广播${setupTask.metadata.discovery_port ? ` · UDP ${setupTask.metadata.discovery_port}` : ""}`
        : setupTask.kind === "node_install"
          ? (setupTask.metadata.install_dir || setupTask.metadata.node_id || "当前节点")
        : setupTask.kind === "gateway_probe"
          ? (setupTask.metadata.gateway_base_url || "目标网关")
        : (setupTask.metadata.lan_ip || setupTask.metadata.host || setupTask.metadata.node_id || "局域网配对"),
      updated_at: setupTask.updated_at,
    });
  }, [setupTask]);

  async function withBusy<T>(name: string, fn: () => Promise<T>) { setBusy(name); try { return await fn(); } finally { setBusy(null); } }
  async function runModelCheck() { try { const result = await withBusy("model-check", () => requestJson<ModelCheck>("/api/models/builtin/check", { method: "POST" })); setModelCheck(result); setNotice(result.configured_model_available ? `内置模型 ${result.configured_model} 可用。` : `内置模型 ${result.configured_model} 未出现在模型列表中，请检查配置。`); } catch (error) { setNotice(`模型检测失败：${(error as Error).message}`); } }
  function pushPairingDebugEntry(entry: PairingDebugEntry) {
    setPairingDebugEntries((current) => {
      const next = [entry, ...current.filter((item) => item.id !== entry.id)];
      return next.slice(0, 12);
    });
  }
  function appendPairingClientError(title: string, target: string, error: Error) {
    pushPairingDebugEntry({
      id: `client-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      kind: "client_error",
      title,
      status: "failed",
      summary: error.message,
      logs: [`前端请求失败：${error.message}`],
      target,
      updated_at: new Date().toISOString(),
    });
  }
  async function startQrFlow() { try { const result = await withBusy("wechat-qr", () => requestJson<QrStart>("/api/wechat/onboard/start", { method: "POST" })); setQr(result); setPollState({ status: "wait" }); setNotice("二维码已生成。请扫码并轮询状态。"); } catch (error) { setNotice(`获取二维码失败：${(error as Error).message}`); } }
  async function pollQrStatus() {
    if (!qr?.qrcode) return setNotice("请先生成二维码。");
    try {
      const result = await withBusy("wechat-poll", () => requestJson<PollResponse>("/api/wechat/onboard/poll", { method: "POST", body: JSON.stringify({ qrcode: qr.qrcode }) }));
      setPollState(result);
      if (result.status === "confirmed" && result.token) {
        await connectWeChat(result.token, result.base_url || wechatBaseUrl);
        return setNotice(
          isLauncherGatewayOwned(launcherStatus)
            ? "微信 token 已写入当前主网关，轮询已启动。"
            : "扫码成功，但当前主网关不是桌面启动器托管实例，状态可能不会同步。",
        );
      }
      setNotice(result.status === "scaned" ? "二维码已扫码，请在手机端确认。" : result.status === "expired" ? "二维码已过期，请重新生成。" : result.status === "error" ? `扫码状态异常：${result.message ?? "未知错误"}` : "等待用户扫码。");
    } catch (error) { setNotice(`轮询失败：${(error as Error).message}`); }
  }
  async function connectWeChat(token: string, baseUrl: string) {
    const status = await withBusy("wechat-connect", () => requestJson<WeChatStatus>("/api/wechat/onboard/connect", { method: "POST", body: JSON.stringify({ token, base_url: baseUrl, enable_polling: true }) }));
    setWechatStatus(status); setManualToken(token); if (status.base_url) setWechatBaseUrl(status.base_url); return status;
  }
  async function connectManualToken() { if (!manualToken.trim()) return setNotice("请先填写 token，或通过扫码自动获取。"); try { await connectWeChat(manualToken.trim(), wechatBaseUrl.trim()); setNotice(isLauncherGatewayOwned(launcherStatus) ? "微信 token 已写入当前主网关，轮询已启动。" : "已提交手动 token，但当前主网关不是桌面启动器托管实例，状态可能不会同步。"); } catch (error) { setNotice(`手动连接失败：${(error as Error).message}`); } }
  async function disconnectWeChat() { try { const status = await withBusy("wechat-disconnect", () => requestJson<WeChatStatus>("/api/wechat/onboard/disconnect", { method: "POST" })); setWechatStatus(status); setNotice("微信轮询已停止。"); } catch (error) { setNotice(`断开失败：${(error as Error).message}`); } }
  async function ensureLauncherRuntimeForQuickSetup(role: SetupRole) {
    if (!launcherAvailable || !launcherStatus?.profile.workdir) return;
    if (!isGatewayRole(role)) return; // 仅网关类角色在进入配置前预热本地组件
    const targetMachineRole = setupRoleToLauncherMachineRole(role);
    const running = runningLauncherComponents(launcherStatus);
    const needsHost = true;
    const needsGateway = true;
    const needsLocalNode = targetMachineRole === "gateway_console" && !gatewaySetup.dispatch_mode_enabled;
    const shouldStart =
      launcherMachineRoleValue(launcherStatus) !== targetMachineRole ||
      (needsHost && !running.has("host-redis")) ||
      (needsGateway && !running.has("gateway")) ||
      (needsLocalNode && !running.has("local-node"));
    if (!shouldStart) return;
    try {
      const status = await withBusy(
        "launcher-start",
        () => requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify(buildLauncherStartPayload(launcherStatus, targetMachineRole, {
            dispatchModeEnabled: gatewaySetup.dispatch_mode_enabled,
            localNodeId: targetMachineRole === "node" ? workerSetup.node_id : undefined,
          })),
        }),
      );
      applyLauncherStatusState(status);
      setNotice(`已为${roleName(role)}预启动本地组件，便于立即配置网关与节点。`);
    } catch (error) {
      const failure = error as Error & { code?: string };
      setNotice(failure.code === "external_port_in_use" ? `主网关端口被其它进程占用：${failure.message}` : `预启动本地组件失败：${failure.message}`);
    }
  }
  async function applyLauncherPolicyForRole(role: SetupRole) {
    if (!launcherAvailable) return;
    const targetMachineRole = setupRoleToLauncherMachineRole(role);
    try {
      const status = await withBusy("launcher-start", () =>
        requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify(buildLauncherStartPayload(launcherStatus, targetMachineRole, {
            dispatchModeEnabled: gatewaySetup.dispatch_mode_enabled,
            localNodeId: targetMachineRole === "node" ? workerSetup.node_id : undefined,
          })),
        }),
      );
      applyLauncherStatusState(status);
      setNotice(`已按${roleName(role)}收敛本地运行模型。`);
    } catch (error) {
      const failure = error as Error & { code?: string };
      setNotice(failure.code === "external_port_in_use" ? `主网关端口被其它进程占用：${failure.message}` : `按角色收敛本地运行模型失败：${failure.message}`);
    }
  }
  function selectSetupRole(role: SetupRole) {
    const completedRoles = setupProfile?.completed_roles ?? [];
    if (requiresRoleSwitchConfirmation(completedRoles, role)) {
      setReconfigureConfirmOpen(true);
      return;
    }
    setSetupRole(role);
    setSetupMode("config");
    setSetupTask(null);
    setReconfigureConfirmOpen(false);
    void ensureLauncherRuntimeForQuickSetup(role);
  }
  function returnToSetupStatus() {
    setSetupRole(null);
    setSetupTask(null);
    setReconfigureConfirmOpen(false);
    setSetupMode(setupProfile?.setup_completed ? "status" : "role");
  }
  function resetCurrentSetupDraft() {
    const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(setupProfile, systemStatus);
    setGatewaySetup(setupProfile?.gateway ?? DEFAULT_GATEWAY_SETUP);
    setConsoleSetup(
      setupProfile?.console
        ? { ...setupProfile.console, gateway_base_url: setupProfile.console.gateway_base_url || preferredGatewayBaseUrl }
        : { ...DEFAULT_CONSOLE_SETUP, gateway_base_url: preferredGatewayBaseUrl },
    );
    setWorkerSetup((current) => ({
      ...DEFAULT_WORKER_SETUP,
      ...current,
      node_id: resolveWorkerNodeId(current.node_id, launcherStatus?.profile),
      gateway_base_url: setupProfile?.console.gateway_base_url || preferredGatewayBaseUrl,
      dify_base_url: setupProfile?.gateway.dify_base_url || DEFAULT_WORKER_SETUP.dify_base_url,
      dify_api_key: setupProfile?.gateway.dify_api_key || DEFAULT_WORKER_SETUP.dify_api_key,
      node_token: "",
    }));
    setDiscoveredNodes([]);
    setPairingSecrets({});
    setPairingStatuses({});
    setManualPair((current) => ({ ...DEFAULT_MANUAL_PAIR, pairing_key: current.pairing_key || workerSetup.pairing_key || "" }));
    setSetupTask(null);
    setWorkerGatewayProbeTask(null);
    workerGatewayAutoProbeKeyRef.current = "";
    setNotice("已重置当前填写内容。");
  }
  async function refreshSetupProfile() {
    const profile = shouldUseLocalGatewayApi
      ? await requestJson<SetupProfileResponse>("/api/setup/profile")
      : await requestJson<SetupProfileResponse>("/local/setup/profile");
    const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, systemStatus);
    syncSetupProfileState(profile, preferredGatewayBaseUrl, { system: systemStatus });
  }
  async function refreshQuickSetupStatus() {
    try {
      if (!shouldUseLocalGatewayApi) {
        const remoteGateway = sessionRemoteGatewayBaseUrl.trim();
        const [profile, remoteSummary] = await Promise.all([
          requestJson<SetupProfileResponse>("/local/setup/profile"),
          remoteGateway
            ? requestJson<GatewaySummaryResponse>(`${remoteGateway}/api/system/summary`).catch(() => null)
            : Promise.resolve(null),
        ]);
        const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, remoteSummary?.system ?? systemStatus);
        syncSetupProfileState(profile, preferredGatewayBaseUrl, {
          syncLastTask: true,
          system: remoteSummary?.system ?? systemStatus,
        });
        if (remoteSummary) {
          applyGatewaySummaryToState(remoteSummary, {
            setSystemStatus,
            setWechatStatus,
            setWechatBaseUrl,
            syncNodeStateView,
          });
        }
        if (launcherAvailable) {
          await refreshLauncherStatus();
        }
        setNotice(
          remoteGateway
            ? currentRoleIsWorker
              ? "已刷新当前节点状态与远端网关连接信息。"
              : "已刷新当前连接状态。"
            : "已刷新当前本机状态。",
        );
        return;
      }
      const [profile, summary, model] = await Promise.all([
        requestJson<SetupProfileResponse>("/api/setup/profile"),
        refreshGatewaySummarySnapshot(),
        requestJson<ModelStatus>("/api/models/builtin/status"),
      ]);
      const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, summary?.system ?? systemStatus);
      syncSetupProfileState(profile, preferredGatewayBaseUrl, {
        syncLastTask: true,
        system: summary?.system ?? systemStatus,
      });
      setModelStatus(model);
      if (launcherAvailable) {
        await refreshLauncherStatus();
      }
      setNotice("已刷新当前连接状态。");
    } catch (error) {
      setNotice(`刷新快速配置状态失败：${(error as Error).message}`);
    }
  }
  async function refreshSystemStatus() {
    if (!shouldUseLocalGatewayApi) return;
    return (await refreshGatewaySummarySnapshot())?.system ?? null;
  }
  async function refreshSessionDetail(sessionId: string) {
    const remoteGateway = sessionRemoteGatewayBaseUrl;
    const detail = await fetchSessionMessages(sessionId, { remoteGateway });
    const entry = syncSessionMessageCache(sessionId, detail);
    applySessionMessageEntry(sessionId, entry);
  }
  async function runGatewaySetup() {
    try {
      const payload: GatewaySetupSaveRequest = {
        config: gatewaySetup,
        console_gateway_base_url: consoleSetup.gateway_base_url || undefined,
      };
      const result = await withBusy(
        "setup-gateway",
        () => requestJson<GatewaySetupSaveResponse>("/api/setup/gateway/save", { method: "POST", body: JSON.stringify(payload) }),
      );
      setSetupTask(result.task);
      setSetupMode("result");
      if (gatewaySetup.wechat_base_url) setWechatBaseUrl(gatewaySetup.wechat_base_url);
      if (gatewaySetup.wechat_token) setManualToken(gatewaySetup.wechat_token);
      await refreshSetupProfile();
      await applyLauncherPolicyForRole("gateway_host");
      setNotice(result.task.summary);
    } catch (error) {
      setNotice(`保存网关配置失败：${(error as Error).message}`);
    }
  }
  async function runWorkerSetup(options?: { showResultScreen?: boolean }) {
    const showResultScreen = options?.showResultScreen ?? true;
    try {
      if (launcherAvailable && runtimeMachineRole !== "node") {
        await applyLauncherPolicyForRole("worker_node");
      }
      if (launcherAvailable && workerSetup.gateway_base_url.trim()) {
        await requestJson<LauncherStatusResponse>("/local/bootstrap/set-gateway-url", {
          method: "POST",
          body: JSON.stringify({ gateway_base_url: workerSetup.gateway_base_url.trim() }),
        });
        await refreshLauncherStatus();
      }
      const result = await withBusy(
        "setup-worker",
        () => requestJson<SetupTaskEnvelope>(
          "/local/node/install",
          { method: "POST", body: JSON.stringify({ config: workerSetup }) }
        ),
      );
      setSetupTask(result.task);
      if (showResultScreen) setSetupMode("result");
      setWorkerSetup((current) => ({
        ...current,
        gateway_base_url: result.task.metadata.gateway_base_url || current.gateway_base_url,
        node_token: "",
      }));
      workerGatewayAutoProbeKeyRef.current = "";
      await refreshSetupProfile();
      setNotice("节点安装任务已启动；本次不会生成 token，安装完成后请到网关角色下完成配对。");
    } catch (error) {
      setNotice(`启动工作节点安装失败：${(error as Error).message}`);
    }
  }
  async function runConsoleSetup() {
    try {
      const result = await withBusy(
        "setup-console",
        () => requestJson<SetupTaskEnvelope>("/api/setup/console/connect", { method: "POST", body: JSON.stringify({ config: consoleSetup }) }),
      );
      setSetupTask(result.task);
      setSetupMode("result");
      await refreshSetupProfile();
      await applyLauncherPolicyForRole("console_only");
      setNotice(result.task.summary);
    } catch (error) {
      setNotice(`校验控制台连接失败：${(error as Error).message}`);
    }
  }
  async function runGatewayConsoleSetup() {
    try {
      const payload: GatewayConsoleSetupRequest = { gateway: gatewaySetup, console: consoleSetup };
      const result = await withBusy(
        "setup-gateway-console",
        () => requestJson<SetupTaskEnvelope>("/api/setup/gateway-console/run", { method: "POST", body: JSON.stringify(payload) }),
      );
      setSetupTask(result.task);
      setSetupMode("result");
      if (gatewaySetup.wechat_base_url) setWechatBaseUrl(gatewaySetup.wechat_base_url);
      if (gatewaySetup.wechat_token) setManualToken(gatewaySetup.wechat_token);
      await refreshSetupProfile();
      await applyLauncherPolicyForRole("gateway_host_console");
      setNotice(result.task.summary);
    } catch (error) {
      setNotice(`执行网关主机+控制台配置失败：${(error as Error).message}`);
    }
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
          if (!next[item.discovery_id] && workerSetup.pairing_key.trim()) next[item.discovery_id] = workerSetup.pairing_key.trim();
        }
        return next;
      });
      setNotice(result.task.summary || `已发现 ${result.nodes.length} 台局域网候选机器。`);
    } catch (error) {
      appendPairingClientError("扫描局域网节点", "局域网广播", error as Error);
      setNotice(`搜索局域网节点失败：${(error as Error).message}`);
    }
  }
  /**
   * 手动触发网关探测（仅用于 quick_setup 工作区的"检测连接"按钮）
   *
   * 注意：节点角色和控制台角色的自动探测已统一到 summary 轮询中，
   * 不再需要调用此函数进行自动探测。
   */
  async function probeWorkerGateway(options?: { silent?: boolean; reason?: "manual" | "auto" | "post-install" }) {
    const gatewayBaseUrl = workerSetup.gateway_base_url.trim();
    if (!gatewayBaseUrl) return setNotice("请先填写目标网关地址。");
    const nodeId = workerSetup.node_id.trim();
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
      workerGatewayAutoProbeKeyRef.current = `${gatewayBaseUrl}::${nodeId}`;
      if (!silent) setNotice(result.task.summary || `目标网关检测完成：${gatewayBaseUrl}`);
    } catch (error) {
      workerGatewayAutoProbeKeyRef.current = `${gatewayBaseUrl}::${nodeId}`;
      appendPairingClientError("检测目标网关", gatewayBaseUrl, error as Error);
      if (!silent) setNotice(`检测目标网关失败：${(error as Error).message}`);
    }
  }
  function updateNodeState(next: NodeListResponse) {
    syncNodeStateView(next);
  }
  function applyLauncherStatusState(status: LauncherStatusResponse) {
    setLauncherStatus(status);
    setLauncherAvailable(true);
    setWorkerSetup((current) => ({
      ...current,
      node_id: resolveWorkerNodeId(current.node_id, status.profile),
      gateway_base_url: status.profile.gateway_base_url?.trim() || current.gateway_base_url,
    }));
  }
  async function refreshLauncherStatus() {
    try {
      const status = await requestJson<LauncherStatusResponse>("/local/bootstrap/status");
      applyLauncherStatusState(status);
    } catch {
      setLauncherAvailable(false);
    }
  }
  const refreshLocalNodeStatus = useCallback(async () => {
    if (!launcherAvailable) return;
    try {
      const status = await requestJson<LocalNodeStatusResponse>("/local/node/status");
      setLocalNodeStatus(status);
      if (!localNodeModelDirty) {
        setLocalNodeModelDraft(buildLocalNodeModelDraftFromStatus(status));
      }
    } catch {
      // local diagnostics are best-effort
    }
  }, [launcherAvailable, localNodeModelDirty]);
  async function refreshLocalNodeLogs() {
    if (!launcherAvailable) return;
    try {
      const logs = await requestJson<LocalNodeLogsResponse>("/local/node/logs");
      setLocalNodeLogs(logs);
    } catch {
      // local logs are best-effort
    }
  }
  async function refreshLocalNodeDiagnostics() {
    await Promise.all([refreshLocalNodeStatus(), refreshLocalNodeLogs()]);
  }
  async function refreshRuntimeLogs(options?: { silent?: boolean }) {
    if (!launcherAvailable) return;
    const trackedComponents = (launcherStatus?.components || []).filter((component) =>
      ["gateway", "host-redis", "local-node", "node-cache-redis"].includes(component.name)
        && (component.log_path || component.state !== "stopped" || component.error_code),
    );
    setRuntimeLogsRefreshing(true);
    try {
      const launcherLogResults = await Promise.all(
        trackedComponents.map(async (component) => {
          try {
            const result = await requestJson<LauncherLogResponse>(`/local/bootstrap/logs/${encodeURIComponent(component.name)}`);
            return [component.name, result.content || "暂无日志"] as const;
          } catch {
            return [component.name, "日志读取失败"] as const;
          }
        }),
      );
      setLauncherLogs((current) => ({
        ...current,
        ...Object.fromEntries(launcherLogResults),
      }));
      if (launcherStatus?.profile.enable_local_node) {
        await refreshLocalNodeLogs();
      }
    } catch (error) {
      if (!options?.silent) {
        setNotice(`刷新运行日志失败：${(error as Error).message}`);
      }
    } finally {
      setRuntimeLogsRefreshing(false);
    }
  }
  function updateLocalNodeModelDraft<K extends keyof LocalNodeModelConfigRequest>(key: K, value: LocalNodeModelConfigRequest[K]) {
    setLocalNodeModelDirty(true);
    setLocalNodeModelDraft((current) => ({ ...current, [key]: value }));
  }
  async function saveLocalNodeModelConfig() {
    if (localNodeModelDraft.model_provider === "openai") {
      if (!localNodeModelDraft.openai_base_url.trim()) {
        setNotice("当前 Provider 已切换为 OpenAI，请先填写 OpenAI Base URL。");
        return;
      }
      if (!localNodeModelDraft.openai_api_key.trim()) {
        setNotice("当前 Provider 已切换为 OpenAI，请先填写 OpenAI API Key。");
        return;
      }
      if (!localNodeModelDraft.openai_model.trim()) {
        setNotice("当前 Provider 已切换为 OpenAI，请先填写 OpenAI Model。");
        return;
      }
    }
    if (localNodeModelDraft.model_provider === "dify") {
      if (!localNodeModelDraft.dify_base_url.trim()) {
        setNotice("当前 Provider 已切换为 Dify，请先填写 Dify Base URL。");
        return;
      }
      if (!localNodeModelDraft.dify_api_key.trim()) {
        setNotice("当前 Provider 已切换为 Dify，请先填写 Dify API Key。");
        return;
      }
    }
    try {
      const result = await withBusy(
        "local-node-model-save",
        () => requestJson<LocalNodeActionResponse>("/local/node/model-config", {
          method: "POST",
          body: JSON.stringify(localNodeModelDraft),
        }),
      );
      setLocalNodeStatus(result.status);
      setLocalNodeModelDirty(false);
      setLocalNodeModelDraft(buildLocalNodeModelDraftFromStatus(result.status));
      void refreshLauncherStatus();
      setNotice(result.detail || "本机节点模型配置已保存。");
    } catch (error) {
      setNotice(`保存本机节点模型配置失败：${(error as Error).message}`);
    }
  }
  async function restartLocalNodeService() {
    try {
      const result = await withBusy(
        "local-node-restart",
        () => requestJson<LocalNodeActionResponse>("/local/node/service/restart", { method: "POST" }),
      );
      setLocalNodeStatus(result.status);
      await refreshLauncherStatus();
      await refreshLocalNodeDiagnostics();
      setNotice(result.detail || "本机节点服务已重启。");
    } catch (error) {
      setNotice(`重启本机节点服务失败：${(error as Error).message}`);
    }
  }
  async function restartGatewayService() {
    if (!launcherAvailable) {
      setNotice("当前未检测到桌面启动器，无法重启主网关。");
      return;
    }
    const currentLauncherStatus = launcherStatus;
    const machineRole = effectiveRole
      ? setupRoleToLauncherMachineRole(effectiveRole)
      : (launcherMachineRoleValue(currentLauncherStatus) || "gateway_console");
    if (!launcherShouldRunGateway(currentLauncherStatus)) {
      setNotice("当前机器不是主网关托管角色，无法在本机重启主网关。");
      return;
    }

    try {
      const restarted = await withBusy("launcher-gateway-restart", async () => {
        await requestJson<LauncherStatusResponse>("/local/bootstrap/stop", {
          method: "POST",
          body: JSON.stringify({ component: "gateway" }),
        });
        return requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify(buildLauncherStartPayload(currentLauncherStatus, machineRole, {
            dispatchModeEnabled: currentLauncherStatus?.profile.dispatch_mode_enabled,
            enableNodeCacheRedis: currentLauncherStatus?.profile.node_cache_policy !== "disabled",
            localNodeId: machineRole === "node" ? workerSetup.node_id : undefined,
          })),
        });
      });
      applyLauncherStatusState(restarted);
      await Promise.all([
        refreshLauncherStatus(),
        refreshGatewaySummarySnapshot().catch(() => null),
        refreshLocalNodeDiagnostics().catch(() => null),
      ]);
      setNotice("主网关已执行重启，当前状态已刷新。");
    } catch (error) {
      setNotice(`重启主网关失败：${(error as Error).message}`);
    }
  }
  async function exportLocalNodeDiagnostics() {
    try {
      const result = await withBusy(
        "local-node-export",
        () => requestJson<LocalNodeExportResponse>("/local/node/diagnostics/export", { method: "POST" }),
      );
      setNotice(result.detail || `诊断包已导出：${result.export_path}`);
    } catch (error) {
      setNotice(`导出本机节点诊断包失败：${(error as Error).message}`);
    }
  }
  async function toggleGatewayDispatchMode(enabled: boolean) {
    const result = await requestJson<SetupTaskEnvelope>("/api/setup/gateway/dispatch-mode", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    setSetupTask(result.task);
  }
  async function toggleLauncherDispatchMode(enabled: boolean) {
    const status = await requestJson<LauncherStatusResponse>("/local/bootstrap/dispatch-mode", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    applyLauncherStatusState(status);
  }
  async function applyDispatchMode(enabled: boolean) {
    try {
      await withBusy("dispatch-mode-toggle", async () => {
        await toggleGatewayDispatchMode(enabled);
        if (launcherAvailable) {
          await toggleLauncherDispatchMode(enabled);
        }
      });
      await Promise.all([
        refreshSetupProfile(),
        refreshGatewaySummarySnapshot(),
        refreshLauncherStatus(),
      ]);
      setNotice(enabled ? "已开启分发模式：当前主机只负责分发，不再由本机节点处理消息。" : "已关闭分发模式：本机节点可重新参与调度。");
    } catch (error) {
      setNotice(`更新分发模式失败：${(error as Error).message}`);
    }
  }

  async function installLauncherRedis(target: "host" | "node-cache", source: LauncherRedisSource) {
    try {
      setNotice(`正在下载 ${target === "host" ? "主机" : "节点缓存"} Redis，会自动尝试镜像源和官方源，请稍候（约 1-3 分钟）...`);
      const status = await withBusy(`launcher-install-${target}`, () => requestJson<LauncherStatusResponse>("/local/bootstrap/install-redis", { method: "POST", body: JSON.stringify({ target, source }) }));
      applyLauncherStatusState(status);
      setNotice(target === "host" ? "主机 Redis 已准备完成。" : "节点缓存 Redis 已准备完成。");
    } catch (error) {
      setNotice(`安装 Redis 失败：${(error as Error).message}`);
    }
  }
  async function startLauncherStack(overrides?: { enableNodeCacheRedis?: boolean }) {
    try {
      const defaultMachineRole = effectiveRole ? setupRoleToLauncherMachineRole(effectiveRole) : (launcherMachineRoleValue(launcherStatus) || "gateway_console");
      const enableNodeCacheRedis = overrides?.enableNodeCacheRedis ?? (launcherStatus?.profile.node_cache_policy !== "disabled");
      const status = await withBusy(
        "launcher-start",
        () => requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify(buildLauncherStartPayload(launcherStatus, defaultMachineRole, {
            dispatchModeEnabled: gatewaySetup.dispatch_mode_enabled,
            enableNodeCacheRedis,
            localNodeId: defaultMachineRole === "node" ? workerSetup.node_id : undefined,
          })),
        }),
      );
      applyLauncherStatusState(status);
      setNotice(defaultMachineRole === "node" ? "节点服务启动命令已下发。" : "本地运行模型启动命令已下发。");
    } catch (error) {
      const failure = error as Error & { code?: string };
      setNotice(failure.code === "external_port_in_use" ? `主网关端口被其它进程占用：${failure.message}` : `启动本地组件失败：${failure.message}`);
    }
  }
  async function stopLauncherStack(component?: string) {
    try {
      const status = await withBusy("launcher-stop", () => requestJson<LauncherStatusResponse>("/local/bootstrap/stop", { method: "POST", body: JSON.stringify({ component: component || null }) }));
      applyLauncherStatusState(status);
      setNotice(component ? `${component} 已停止。` : "已停止所有本地组件。");
    } catch (error) {
      setNotice(`停止组件失败：${(error as Error).message}`);
    }
  }
  async function toggleLauncherNodeCache(enabled: boolean) {
    try {
      const status = await withBusy("launcher-node-cache-toggle", () => requestJson<LauncherStatusResponse>("/local/bootstrap/node-cache/toggle", { method: "POST", body: JSON.stringify({ enabled }) }));
      applyLauncherStatusState(status);
      setNotice(enabled ? "已启用节点本地缓存 Redis。" : "已关闭节点本地缓存 Redis。");
    } catch (error) {
      setNotice(`更新节点缓存策略失败：${(error as Error).message}`);
    }
  }
  async function readLauncherLog(component: string) {
    try {
      const result = await requestJson<LauncherLogResponse>(`/local/bootstrap/logs/${encodeURIComponent(component)}`);
      setLauncherLogs((current) => ({ ...current, [component]: result.content || "暂无日志" }));
    } catch (error) {
      setNotice(`读取组件日志失败：${(error as Error).message}`);
    }
  }
  async function switchSessionNode(sessionId: string, action: SessionSwitchAction, nodeId?: string) {
    if (action === "manual" && !nodeId) {
      setNotice("请先选择要绑定的节点。");
      return;
    }
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
        () => requestJson<SessionSwitchResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/switch-node`, {
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
  }
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
                refreshGatewaySummarySnapshot()
                  .catch(() => undefined);
              }, 2000);
            }
          }
        })
        .catch(() => undefined);
    }, 1500);
    pairingModalTimerRef.current = timerId;
  }

  async function pairLanNode(discovered: DiscoveredNodeRecord) {
    const pairingKey = pairingSecrets[discovered.discovery_id]?.trim();
    if (!pairingKey) return setNotice(`请先为 ${discovered.pairing_label || discovered.hostname} 输入配对密钥。`);
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
      host: manualPair.host.trim(),
      pairing_port: manualPair.pairing_port || 9532,
      pairing_key: manualPair.pairing_key.trim(),
      gateway_base_url: currentGatewayBaseUrl,
      node_id: manualPair.node_id.trim() || undefined,
    };
    if (!payload.host) return setNotice("请先填写目标节点的 IP 或主机名。");
    if (!payload.pairing_key) return setNotice("请先填写目标节点的配对密钥。");
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
      if (workerSetup.node_id.trim() === node.node_id) {
        setWorkerGatewayProbeTask(null);
      }
    } catch (error) {
      setNotice(`删除节点失败：${(error as Error).message}`);
    }
  }
  async function disconnectPairedNode(node: NodeInventoryRecord) {
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
  function submitSetupRole() {
    if (!setupRole) return setNotice("请先选择一个部署角色。");
    if (setupMode === "config") {
      if (setupRole === "worker_node" && !validateWorkerGatewayUrl(workerSetup.gateway_base_url)) {
        return setNotice("请填写目标网关地址后再继续。");
      }
      return setSetupMode("preview");
    }
    if (setupRole === "gateway_host") return void runGatewaySetup();
    if (setupRole === "gateway_host_console") return void runGatewayConsoleSetup();
    if (setupRole === "worker_node") return void runWorkerSetup();
    return void runConsoleSetup();
  }
  async function confirmReconfigure() {
    try {
      const stoppedActions: string[] = [];
      if (wechatStatus?.running && launcherShouldRunGateway(launcherStatus)) {
        const status = await withBusy("reconfigure-disconnect-wechat", () =>
          requestJson<WeChatStatus>("/api/wechat/onboard/disconnect", { method: "POST" }),
        );
        setWechatStatus(status);
        stoppedActions.push("已断开微信连接");
      }
      // 停掉所有 launcher 托管的组件（local-node、node-cache-redis、gateway、host-redis）
      if (launcherAvailable) {
        await withBusy("reconfigure-stop-all", () =>
          requestJson<LauncherStatusResponse>("/local/bootstrap/stop", {
            method: "POST",
            body: JSON.stringify({ component: null }),
          }),
        );
        await refreshLauncherStatus();
        stoppedActions.push("已停止所有本地组件");
      }
      if ((setupCompletedRoles.has("worker_node") || workerSetup.node_id.trim()) && workerSetup.install_dir.trim()) {
        const resetUrl = launcherMachineRoleValue(launcherStatus) === "node" ? "/local/node/reset-credentials" : "/api/setup/node/reset-credentials";
        const result = await withBusy(
          "reconfigure-reset-worker-token",
          () => requestJson<SetupTaskEnvelope>(resetUrl, {
            method: "POST",
            body: JSON.stringify({
              node_id: workerSetup.node_id.trim(),
              install_dir: workerSetup.install_dir.trim(),
            } satisfies NodeCredentialResetRequest),
          }),
        );
        setSetupTask(result.task);
        setWorkerSetup((current) => ({ ...current, node_token: "" }));
        clearNodeDiagnosticsCache(workerSetup.node_id.trim());
        stoppedActions.push("已清空节点配置");
      }
      // 重置后端内存状态（仅网关角色需要）
      if (launcherShouldRunGateway(launcherStatus)) {
        await withBusy("reconfigure-reset-state", () =>
          requestJson<{ removed_nodes: string[]; cleared_memory: boolean }>("/api/setup/reset", { method: "POST" }),
        );
      }
      // 清理前端本地缓存
      clearQuickSetupCache();
      clearNodeDiagnosticsCache();
      persistWorkspace("quick_setup");
      setSetupProfile(null);
      setSetupRole(null);
      setSetupTask(null);
      setGatewaySetup(DEFAULT_GATEWAY_SETUP);
      setWorkerSetup(DEFAULT_WORKER_SETUP);
      setConsoleSetup(DEFAULT_CONSOLE_SETUP);
      setReconfigureConfirmOpen(false);
      setSetupMode("role");
      setWorkspace("quick_setup");
      stoppedActions.push("已清理本地缓存");
      setNotice(`${stoppedActions.join("，")}，已进入重新配置流程。`);
    } catch (error) {
      setNotice(`进入重新配置失败：${(error as Error).message}`);
    }
  }
  function updateGatewaySetup<K extends keyof GatewaySetupConfig>(key: K, value: GatewaySetupConfig[K]) {
    setGatewaySetup((current) => ({ ...current, [key]: value }));
  }
  function updateWorkerSetup<K extends keyof WorkerNodeSetupConfig>(key: K, value: WorkerNodeSetupConfig[K]) {
    setWorkerSetup((current) => ({ ...current, [key]: value }));
  }
  function updateConsoleSetup<K extends keyof ConsoleSetupConfig>(key: K, value: ConsoleSetupConfig[K]) {
    setConsoleSetup((current) => ({ ...current, [key]: value }));
  }
  function updateManualPair<K extends keyof ManualPairDraft>(key: K, value: ManualPairDraft[K]) {
    setManualPair((current) => ({ ...current, [key]: value }));
  }
  function applyPreferredGatewayBaseUrlToWorker() {
    const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(setupProfile, systemStatus);
    updateWorkerSetup("gateway_base_url", preferredGatewayBaseUrl);
    setNotice(`已填入当前默认网关地址：${preferredGatewayBaseUrl}`);
  }

  const selectedSession = useMemo(() => sessions.find((session) => session.session_id === selectedSessionId) ?? activeSession, [sessions, selectedSessionId, activeSession]);
  const selectedNode = useMemo(() => nodes.find((node) => node.node_id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const sessionBindingOptions = useMemo(() => {
    const visibleNodes = nodes.filter((node) => !gatewaySetup.dispatch_mode_enabled || node.node_id !== "local-node");
    const options = visibleNodes.map((node) => ({
      node_id: node.node_id,
      label: `${node.node_id}${node.hostname ? ` · ${node.hostname}` : ""}`,
    }));
    if (selectedSession?.assigned_node_id && !options.some((item) => item.node_id === selectedSession.assigned_node_id)) {
      options.unshift({
        node_id: selectedSession.assigned_node_id,
        label: `${selectedSession.assigned_node_id} · 当前绑定（暂不可用）`,
      });
    }
    return options;
  }, [gatewaySetup.dispatch_mode_enabled, nodes, selectedSession?.assigned_node_id]);
  const filteredSessions = useMemo(() => sessions.filter((session) => matchesFilter(session, sessionFilter, now)), [sessions, sessionFilter, now]);
  const counts = useMemo(() => ({ all: sessions.length, processing: sessions.filter((item) => item.queue_status !== "none" || Boolean(item.active_task_id)).length, human: sessions.filter((item) => item.status === "human_active" || item.status === "handoff_pending").length, recent: sessions.filter((item) => isRecent(item, now)).length }), [sessions, now]);
  const latestUserMessage = useMemo(() => [...messages].reverse().find((message) => message.role === "user") ?? null, [messages]);
  const latestBotMessage = useMemo(() => [...messages].reverse().find((message) => message.role === "bot") ?? null, [messages]);
  const typingState = getTypingState(selectedSession, now);
  const channelReleaseHint = getChannelReleaseHint(selectedSession, now);
  const availableDispatchNodes = useMemo(
    () => nodes.filter((node) => !gatewaySetup.dispatch_mode_enabled || node.node_id !== "local-node").length,
    [nodes, gatewaySetup.dispatch_mode_enabled],
  );
  const setupCompletedRoles = useMemo(() => new Set(setupProfile?.completed_roles ?? []), [setupProfile]);
  const currentRoleDisplay = useMemo(
    () => setupRole ? roleName(setupRole) : (setupProfile?.completed_roles.length ? setupProfile.completed_roles.map(roleName).join(" / ") : "未选择"),
    [setupProfile?.completed_roles, setupRole],
  );
  const currentNodeLanIp = launcherStatus?.local_lan_ip || setupTask?.metadata.lan_ip || "";
  useEffect(() => {
    if (!selectedSession) {
      setSessionManualNodeId("");
      return;
    }
    setSessionManualNodeId((current) => {
      if (current && sessionBindingOptions.some((item) => item.node_id === current)) return current;
      if (selectedSession.assigned_node_id) return selectedSession.assigned_node_id;
      return sessionBindingOptions[0]?.node_id ?? "";
    });
  }, [selectedSession, sessionBindingOptions]);
  const workerGatewayConnection = useMemo(() => {
    const gatewayBaseUrl = workerSetup.gateway_base_url.trim();
    const nodeId = workerSetup.node_id.trim();
    if (!gatewayBaseUrl || !nodeId) {
      return {
        state: "idle" as WorkerGatewayConnectionState,
        label: "未检测",
        detail: "请先填写目标网关地址和节点 ID。",
        remoteNode: null as NodeInventoryRecord | NodeRecord | null,
      };
    }
    const task = workerGatewayProbeTask;
    if (!task || task.kind !== "gateway_probe" || task.metadata.gateway_base_url !== gatewayBaseUrl || (task.metadata.node_id || nodeId) !== nodeId) {
      return {
        state: "idle" as WorkerGatewayConnectionState,
        label: "未检测",
        detail: "已填写目标网关地址，可自动或手动检测当前节点是否注册到该网关。",
        remoteNode: null as NodeInventoryRecord | NodeRecord | null,
      };
    }
    if (task.status === "failed") {
      return {
        state: "gateway_unreachable" as WorkerGatewayConnectionState,
        label: "网关不可达",
        detail: task.summary || "无法连接目标网关。",
        remoteNode: null as NodeInventoryRecord | NodeRecord | null,
      };
    }
    const connectionState = task.metadata.node_connection_state || "";
    const lastError = task.metadata.node_last_error?.trim() || task.metadata.local_node_last_error?.trim() || "";
    const tokenMismatchHint = gatewayTokenMismatchHint(nodeId);
    const inventoryNode = nodeInventory.find((item) => item.node_id === nodeId) ?? null;
    const onlineNode = nodes.find((item) => item.node_id === nodeId) ?? null;
    if (task.metadata.node_registered === "true") {
      return {
        state: "gateway_reachable_node_connected" as WorkerGatewayConnectionState,
        label: "网关可达，节点已连接",
        detail: task.summary || `节点 ${nodeId} 已在目标网关注册。`,
        remoteNode: inventoryNode ?? onlineNode,
      };
    }
    if (connectionState === "auth_failed" || looksLikeGatewayAuthFailure(lastError || task.summary || "")) {
      return {
        state: "gateway_reachable_node_register_failed" as WorkerGatewayConnectionState,
        label: "网关可达，节点鉴权失败",
        detail: `${lastError || task.summary || `节点 ${nodeId} 注册被网关拒绝。`} ${tokenMismatchHint}`.trim(),
        remoteNode: inventoryNode,
      };
    }
    if (connectionState === "pairing_pending") {
      return {
        state: "gateway_reachable_node_pending_confirm" as WorkerGatewayConnectionState,
        label: "网关可达，等待注册确认",
        detail: lastError || task.summary || `节点 ${nodeId} 已接收配置，正在等待 register/heartbeat。`,
        remoteNode: inventoryNode,
      };
    }
    if (connectionState === "register_failed") {
      return {
        state: "gateway_reachable_node_register_failed" as WorkerGatewayConnectionState,
        label: "网关可达，节点注册失败",
        detail: lastError || task.summary || `节点 ${nodeId} 注册失败，请重新配对。`,
        remoteNode: inventoryNode,
      };
    }
    return {
      state: "gateway_reachable_node_missing" as WorkerGatewayConnectionState,
      label: "网关可达，节点未注册",
      detail: task.summary || `目标网关可访问，但尚未发现节点 ${nodeId}。`,
      remoteNode: inventoryNode,
    };
  }, [nodeInventory, nodes, workerGatewayProbeTask, workerSetup.gateway_base_url, workerSetup.node_id]);
  const latestSetupSummary = useMemo(
    () => workerGatewayProbeTask?.summary || setupTask?.summary || setupProfile?.last_task?.summary || (currentRoleIsWorker ? "暂无最近节点安装或回连记录。" : (nodes.length ? `当前有 ${nodes.length} 个在线节点处于纳管范围。` : "暂无最近配置或纳管记录。")),
    [currentRoleIsWorker, nodes.length, setupProfile?.last_task?.summary, setupTask?.summary, workerGatewayProbeTask?.summary],
  );
  const launcherHostRedis = useMemo(() => findLauncherComponent(launcherStatus, "host-redis"), [launcherStatus]);
  const launcherGateway = useMemo(() => findLauncherComponent(launcherStatus, "gateway"), [launcherStatus]);
  const gatewayRuntimeSummary = useMemo(
    () => summarizeGatewayRuntime(launcherStatus, systemStatus, modelStatus),
    [launcherStatus, modelStatus, systemStatus],
  );
  const wechatRuntimeSummary = useMemo(
    () => summarizeWechatRuntime(launcherStatus, wechatStatus, gatewaySetup),
    [gatewaySetup, launcherStatus, wechatStatus],
  );
  const localNodeRuntimeSummary = useMemo(
    () => summarizeLocalNodeRuntime(localNodeStatus, launcherStatus),
    [launcherStatus, localNodeStatus],
  );
  const quickSetupStatusRows = useMemo<Array<{ title: string; value: string; tone: "good" | "warn"; detail: string }>>(() => {
    if (currentRoleIsWorker) {
      return [
        {
          title: "节点配置",
          value: setupCompletedRoles.has("worker_node") ? "已完成" : "待配置",
          tone: setupCompletedRoles.has("worker_node") ? "good" : "warn",
          detail: workerSetup.node_id || "尚未填写节点 ID",
        },
        {
          title: "网关连接状态",
          value: workerGatewayConnection.label,
          tone: workerGatewayConnection.state === "gateway_reachable_node_connected" ? "good" : "warn",
          detail: workerGatewayConnection.detail,
        },
        {
          title: "当前节点 IP",
          value: currentNodeLanIp || "未检测到",
          tone: currentNodeLanIp ? "good" : "warn",
          detail: currentNodeLanIp ? "局域网内其他机器可用这个地址访问当前节点。" : "请先确认当前机器已接入局域网。",
        },
        {
          title: "节点凭据",
          value: "等待网关下发",
          tone: workerSetup.pairing_key.trim() ? "good" : "warn",
          detail: workerSetup.pairing_key.trim() ? "安装阶段不会生成 token；配对时会由网关自动下发。" : "请先填写配对密钥，后续由网关自动下发 token。",
        },
        {
          title: "发现响应",
          value: workerSetup.discovery_enabled ? "已启用" : "已关闭",
          tone: workerSetup.discovery_enabled ? "good" : "warn",
          detail: workerSetup.discovery_enabled ? `UDP ${workerSetup.discovery_port}` : "关闭后不会响应局域网发现",
        },
      ];
    }
    return [
      {
        title: "微信连接",
        value: wechatRuntimeSummary.value,
        tone: wechatRuntimeSummary.tone,
        detail: wechatRuntimeSummary.detail,
      },
      {
        title: "控制台目标",
        value: setupProfile?.console.gateway_base_url || "未配置",
        tone: setupProfile?.console.gateway_base_url && gatewayRuntimeSummary.tone === "good" ? "good" : "warn",
        detail: setupProfile?.console.gateway_base_url
          ? gatewayRuntimeSummary.tone === "good"
            ? "地址已保存；重新配置时会覆盖该地址，不会自动解绑。"
            : `地址已保存，但当前主网关未处于稳定运行状态。${gatewayRuntimeSummary.detail}`
          : "尚未保存默认控制台目标地址。",
      },
      {
        title: "网关运行",
        value: gatewayRuntimeSummary.value,
        tone: gatewayRuntimeSummary.tone,
        detail: gatewayRuntimeSummary.detail,
      },
      {
        title: "节点纳管",
        value: localNodeRuntimeSummary.label === "已连接"
          ? `${nodeInventorySummary.online_total || 1} 个在线节点`
          : nodeInventorySummary.online_total
          ? `${nodeInventorySummary.online_total} 个在线节点`
          : localNodeRuntimeSummary.label,
        tone: localNodeRuntimeSummary.tone === "good" || (gatewayRuntimeSummary.tone !== "warn" && nodeInventorySummary.online_total)
          ? "good"
          : "warn",
        detail: gatewayRuntimeSummary.tone === "warn"
          ? gatewayRuntimeSummary.detail
          : localNodeRuntimeSummary.label === "已连接"
          ? latestSetupSummary
          : localNodeRuntimeSummary.detail,
      },
    ];
  }, [currentNodeLanIp, currentRoleIsWorker, gatewayRuntimeSummary.detail, gatewayRuntimeSummary.tone, gatewayRuntimeSummary.value, latestSetupSummary, localNodeRuntimeSummary.detail, localNodeRuntimeSummary.label, localNodeRuntimeSummary.tone, nodeInventorySummary.online_total, setupCompletedRoles, setupProfile?.console.gateway_base_url, wechatRuntimeSummary.detail, wechatRuntimeSummary.tone, wechatRuntimeSummary.value, workerGatewayConnection.detail, workerGatewayConnection.label, workerGatewayConnection.state, workerSetup.discovery_enabled, workerSetup.discovery_port, workerSetup.node_id, workerSetup.pairing_key]);
  const reconfigureWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (wechatStatus?.running) warnings.push("微信当前处于轮询中；继续后会先断开微信连接，再进入重新配置。");
    if (launcherStatus?.components?.some((item) => item.name === "local-node" && item.state === "running")) {
      warnings.push("本机 Claw 节点当前仍在运行；继续后会先停止本机节点，避免它继续带着旧配置回连。");
    }
    if (setupProfile?.console.gateway_base_url) warnings.push(`当前控制台目标为 ${setupProfile.console.gateway_base_url}；继续后新的配置会覆盖该地址，但不会执行解绑。`);
    if (setupCompletedRoles.has("gateway_host") || setupCompletedRoles.has("gateway_host_console")) warnings.push("主机网关进程不会在这里直接停止；否则当前快速配置接口会一起失效。继续后仅覆盖网关配置项，不会回滚或清空历史配置。");
    if (nodes.length) warnings.push(`当前有 ${nodes.length} 个在线节点；继续后不会自动解绑已纳管节点，节点仍可能继续使用原配置。`);
    if (!warnings.length) warnings.push("当前没有需要先断开的活动连接，确认后将直接进入重新配置。");
    return warnings;
  }, [launcherStatus?.components, nodes.length, setupCompletedRoles, setupProfile?.console.gateway_base_url, wechatStatus?.running]);
  const workerCredentialRows = useMemo<Array<{ label: string; value: string }>>(() => ([
    {
      label: "当前状态",
      value: setupCompletedRoles.has("worker_node")
        ? "当前机器已完成工作节点配置。"
        : "当前机器还没有完成“工作节点”角色配置，所以这里只能先告诉你查看位置，暂时没有可回显的本机节点凭据。",
    },
    { label: "节点 ID", value: workerSetup.node_id || "未填写" },
    {
      label: "节点 Token 状态",
      value: "安装阶段不会生成 token；只有配对成功后，网关才会自动签发并写入节点。",
    },
    {
      label: "配对密钥状态",
      value: workerSetup.pairing_key.trim() ? "当前草稿已填写，可通过“显示密钥”临时查看。" : "当前草稿未填写；若已安装节点，请到节点本机 .env 查看或重新设置。",
    },
    { label: "网关侧查看位置", value: `配对成功后可在 ${GATEWAY_NODE_TOKEN_LOCATION} 查看` },
    { label: "节点侧查看位置", value: `配对成功后可在 ${workerEnvLocations(workerSetup.install_dir)} 查看` },
  ]), [setupCompletedRoles, workerSetup.install_dir, workerSetup.node_id, workerSetup.pairing_key]);
  const installProgressSummary = useMemo(() => {
    if (!setupTask || setupTask.kind !== "node_install") return "";
    if (setupTask.status === "running") return "正在安装当前节点，日志会持续刷新。";
    if (setupTask.status === "succeeded") return "当前节点安装完成。";
    if (setupTask.status === "failed") return "当前节点安装失败，请根据日志排查。";
    return "当前节点安装任务已创建。";
  }, [setupTask]);
  const workerConnectionLog = useMemo(() => {
    if (!currentRoleIsWorker) return "";
    const lines: string[] = [
      `当前节点 ID：${workerSetup.node_id.trim() || "未填写"}`,
      `目标网关：${workerSetup.gateway_base_url.trim() || "未填写"}`,
      `当前连接状态：${workerGatewayConnection.label}`,
      `状态摘要：${workerGatewayConnection.detail}`,
    ];
    if (setupTask?.kind === "node_install") {
      lines.push("");
      lines.push("安装任务日志：");
      lines.push(...(setupTask.logs.length ? setupTask.logs : [setupTask.summary || "当前还没有安装日志。"]));
    }
    if (workerGatewayProbeTask) {
      lines.push("");
      lines.push("网关探测日志：");
      lines.push(...(workerGatewayProbeTask.logs.length ? workerGatewayProbeTask.logs : [workerGatewayProbeTask.summary || "当前还没有网关探测日志。"]));
    }
    if (workerGatewayConnection.remoteNode) {
      lines.push("");
      lines.push("网关侧节点记录：");
      lines.push(`节点角色：${nodeRoleLabel(workerGatewayConnection.remoteNode.node_id, "node_kind" in workerGatewayConnection.remoteNode ? workerGatewayConnection.remoteNode.node_kind : undefined)}`);
      lines.push(`主机名：${workerGatewayConnection.remoteNode.hostname || "未上报"}`);
      lines.push(`局域网 IP：${workerGatewayConnection.remoteNode.lan_ip || "未上报"}`);
      lines.push(`上报状态：${workerGatewayConnection.remoteNode.status || "未上报"}`);
      lines.push(`最近心跳：${workerGatewayConnection.remoteNode.last_heartbeat_at ? formatTimeLabel(workerGatewayConnection.remoteNode.last_heartbeat_at, true) : "暂未上报"}`);
      if (workerGatewayConnection.remoteNode.last_error) {
        lines.push(`最近错误：${workerGatewayConnection.remoteNode.last_error}`);
      }
    }
    return lines.join("\n");
  }, [currentRoleIsWorker, setupTask, workerGatewayConnection.detail, workerGatewayConnection.label, workerGatewayConnection.remoteNode, workerGatewayProbeTask, workerSetup.gateway_base_url, workerSetup.node_id]);
  const localNodeEventPreview = useMemo(() => {
    if (!localNodeLogs?.event_log) return "本机节点最近还没有导出的事件日志。";
    return localNodeLogs.event_log;
  }, [localNodeLogs?.event_log]);
  const runtimeLogEntries = useMemo<Array<{
    id: string;
    title: string;
    subtitle: string;
    statusLabel: string;
    statusTone: "human" | "typing" | "queued";
    summary: string;
    logText: string;
  }>>(() => {
    const entries: Array<{
      id: string;
      title: string;
      subtitle: string;
      statusLabel: string;
      statusTone: "human" | "typing" | "queued";
      summary: string;
      logText: string;
    }> = [];

    for (const component of launcherStatus?.components || []) {
      if (!["gateway", "host-redis", "local-node", "node-cache-redis"].includes(component.name)) continue;
      const logText = launcherLogs[component.name] || "";
      if (!logText && !component.log_path && component.state === "stopped") continue;
      const tone = launcherBadgeTone(component.state);
      entries.push({
        id: `launcher-${component.name}`,
        title: `${launcherComponentName(component.name)} 运行日志`,
        subtitle: [component.detail, component.log_path || ""].filter(Boolean).join(" · ") || "桌面启动器托管组件",
        statusLabel: launcherStateLabel(component.state),
        statusTone: tone === "human" || tone === "typing" ? tone : "queued",
        summary: component.error_code ? `${component.detail || "组件异常"} · code=${component.error_code}` : component.detail || "组件运行中",
        logText: logText || "当前还没有采集到日志输出。",
      });
    }

    if (localNodeLogs) {
      const localNodeLogSources = [
        {
          key: "event",
          title: "本机节点事件日志",
          subtitle: localNodeLogs.event_log_path || localNodeLogs.service_name,
          summary: localNodeStatus?.detail || "节点本地事件与注册链路输出",
          logText: localNodeLogs.event_log,
        },
        {
          key: "wrapper",
          title: "本机节点包装器日志",
          subtitle: localNodeLogs.wrapper_log_path || localNodeLogs.service_name,
          summary: "Windows 服务包装器与启动过程输出",
          logText: localNodeLogs.wrapper_log,
        },
        {
          key: "service",
          title: "本机节点服务日志",
          subtitle: localNodeLogs.service_log_path || localNodeLogs.service_name,
          summary: "节点后端标准输出与运行时异常",
          logText: localNodeLogs.service_log,
        },
      ];
      for (const source of localNodeLogSources) {
        if (!source.logText && !source.subtitle) continue;
        entries.push({
          id: `local-node-${source.key}`,
          title: source.title,
          subtitle: source.subtitle || "本机节点",
          statusLabel: localNodeStatus?.state || "未读取",
          statusTone: localNodeStatus?.state === "running" ? "human" : "queued",
          summary: source.summary,
          logText: source.logText || "当前还没有日志输出。",
        });
      }
    }

    return entries;
  }, [launcherLogs, launcherStatus, localNodeLogs, localNodeStatus?.detail, localNodeStatus?.state]);
  const selectedNodeTimelineText = useMemo(() => {
    if (!selectedNodeDiagnostics?.timeline?.length) return "当前节点最近还没有可用的网关诊断时间线。";
    // Filter out repetitive local-bypass heartbeat/pull-task events to reduce noise
    const filtered = selectedNodeDiagnostics.timeline.filter((item) => {
      if (item.result === "accepted_local_bypass" && (item.category === "heartbeat" || item.category === "pull_task")) return false;
      return true;
    });
    if (!filtered.length) return "当前节点仅有心跳记录（本机直连鉴权），暂无其他诊断事件。";
    return filtered
      .map((item) => `[${formatTimeLabel(item.timestamp, true)}] ${item.category}/${item.result} ${item.trace_id ? `trace=${item.trace_id} ` : ""}${item.message}`)
      .join("\n");
  }, [selectedNodeDiagnostics]);
  const nodeChannelOverview = useMemo(() => {
    return nodeInventory.reduce(
      (acc, node) => {
        const capacity = Math.max(node.channel_capacity ?? 0, 0);
        const inUse = Math.max(node.channel_in_use ?? 0, 0);
        const idle = Math.max(capacity - inUse, 0);
        acc.capacity += capacity;
        acc.inUse += inUse;
        acc.idle += idle;
        if (node.online) {
          acc.onlineCapacity += capacity;
          acc.onlineInUse += inUse;
          acc.onlineIdle += idle;
        }
        return acc;
      },
      {
        capacity: 0,
        inUse: 0,
        idle: 0,
        onlineCapacity: 0,
        onlineInUse: 0,
        onlineIdle: 0,
      },
    );
  }, [nodeInventory]);
  const nodeInventoryHeadline = useMemo(
    () =>
      `已配对 ${nodeInventorySummary.paired_total} / 在线 ${nodeInventorySummary.online_total} / 空闲 ${nodeChannelOverview.onlineIdle} / 占用 ${nodeChannelOverview.onlineInUse}`,
    [nodeChannelOverview.onlineIdle, nodeChannelOverview.onlineInUse, nodeInventorySummary.online_total, nodeInventorySummary.paired_total],
  );
  const currentGatewayBaseUrl = consoleSetup.gateway_base_url || window.location.origin;
  const connectionHeroCards = useMemo<Array<{ eyebrow: string; title: string; detail: string; tone: "good" | "warn" }>>(() => {
    if (currentRoleIsWorker) {
      return [
        {
          eyebrow: "本机节点",
          title: workerGatewayConnection.label,
          detail: workerGatewayConnection.detail,
          tone: workerGatewayConnection.state === "gateway_reachable_node_connected" ? "good" : "warn",
        },
        {
          eyebrow: "目标网关",
          title: workerSetup.gateway_base_url || "未填写局域网网关地址",
          detail: currentNodeLanIp ? `当前节点局域网 IP：${currentNodeLanIp}` : "当前节点还没有检测到可用的局域网地址。",
          tone: workerSetup.gateway_base_url ? "good" : "warn",
        },
        {
          eyebrow: "发现响应",
          title: workerSetup.discovery_enabled ? `UDP ${workerSetup.discovery_port}` : "已关闭",
          detail: workerSetup.discovery_enabled ? "局域网内主机会通过广播搜索并尝试配对当前节点。" : "关闭后需要从网关端按地址直连配对当前节点。",
          tone: workerSetup.discovery_enabled ? "good" : "warn",
        },
      ];
    }
    return [
      {
        eyebrow: "主网关",
        title: gatewayRuntimeSummary.value,
        detail: gatewayRuntimeSummary.detail,
        tone: gatewayRuntimeSummary.tone,
      },
      {
        eyebrow: "微信接入",
        title: wechatRuntimeSummary.value,
        detail: wechatRuntimeSummary.detail,
        tone: wechatRuntimeSummary.tone,
      },
      {
        eyebrow: "节点纳管",
        title: `${nodeInventorySummary.online_total} 在线 / ${nodeInventorySummary.paired_total} 已配对`,
        detail: gatewaySetup.dispatch_mode_enabled
          ? availableDispatchNodes > 0
            ? `分发模式已开启，当前有 ${availableDispatchNodes} 个可用于分发的远端节点。`
            : "分发模式已开启，但当前没有可用于接单的远端节点。"
          : `当前在线节点共有 ${nodeChannelOverview.onlineIdle} 条空闲通道，可继续接入更多节点扩容。`,
        tone: nodeInventorySummary.online_total > 0 ? "good" : "warn",
      },
      {
        eyebrow: "模型基线",
        title: modelStatus?.model || "未配置",
        detail: modelStatus?.base_url || "先完成模型检测和配置保存，再开始接入联调。",
        tone: modelStatus?.configured ? "good" : "warn",
      },
    ];
  }, [
    availableDispatchNodes,
    currentNodeLanIp,
    currentRoleIsWorker,
    gatewayRuntimeSummary.detail,
    gatewayRuntimeSummary.tone,
    gatewayRuntimeSummary.value,
    gatewaySetup.dispatch_mode_enabled,
    modelStatus?.base_url,
    modelStatus?.configured,
    modelStatus?.model,
    nodeInventorySummary.online_total,
    nodeInventorySummary.paired_total,
    nodeChannelOverview.onlineIdle,
    wechatRuntimeSummary.detail,
    wechatRuntimeSummary.tone,
    wechatRuntimeSummary.value,
    workerGatewayConnection.detail,
    workerGatewayConnection.label,
    workerGatewayConnection.state,
    workerSetup.discovery_enabled,
    workerSetup.discovery_port,
    workerSetup.gateway_base_url,
  ]);
  const connectionActionTips = useMemo<string[]>(() => {
    if (currentRoleIsWorker) {
      return [
        "先确保当前机器节点安装完成，再检测目标网关是否可达。",
        "若网关可达但节点仍未注册，优先核对配对密钥和网关地址是否一致。",
        "导出本机诊断包前，建议先刷新一次服务状态和事件日志。",
      ];
    }
    return [
      "先看总览区四个信号，再决定是先配微信、先测模型，还是先纳管节点。",
      "广播扫描适合同网段首轮发现；多网卡或跨网段场景优先使用按地址直连配对。",
      "当分发模式开启但在线节点为 0 时，网关只能接入消息，无法完成实际回复。",
    ];
  }, [currentRoleIsWorker]);
  const connectionPrepItems = useMemo<Array<{ label: string; detail: string; tone: "good" | "warn" }>>(
    () => [
      {
        label: "模型可用",
        detail: modelStatus?.configured ? modelStatus.model : "尚未检测",
        tone: modelStatus?.configured ? "good" : "warn",
      },
      {
        label: "微信已连接",
        detail: wechatRuntimeSummary.value,
        tone: wechatRuntimeSummary.tone,
      },
      {
        label: "节点在线",
        detail: `${systemStatus?.active_nodes ?? 0} 个节点`,
        tone: (systemStatus?.active_nodes ?? 0) > 0 ? "good" : "warn",
      },
    ],
    [modelStatus?.configured, modelStatus?.model, systemStatus?.active_nodes, wechatRuntimeSummary.tone, wechatRuntimeSummary.value],
  );
  const connectionSignalCards = useMemo<Array<{ label: string; value: string; meta: string; tone: "good" | "warn" }>>(
    () => [
      {
        label: "模型",
        value: modelStatus?.configured ? "已就绪" : "待检测",
        meta: modelStatus?.model || "未配置模型",
        tone: modelStatus?.configured ? "good" : "warn",
      },
      {
        label: "微信",
        value: wechatRuntimeSummary.value,
        meta: wechatStatus?.has_token ? "Token 已存在" : "尚未写入 Token",
        tone: wechatRuntimeSummary.tone,
      },
      {
        label: "Redis",
        value: systemStatus?.redis_ok ? "正常" : "未就绪",
        meta: systemStatus?.redis_ok ? "主状态存储可用" : "请先恢复主存储",
        tone: systemStatus?.redis_ok ? "good" : "warn",
      },
      {
        label: "调度",
        value: systemStatus?.dispatch_mode_enabled ? "分发模式" : "本机处理",
        meta: `${systemStatus?.active_nodes ?? 0} 个在线节点`,
        tone: (systemStatus?.active_nodes ?? 0) > 0 || !systemStatus?.dispatch_mode_enabled ? "good" : "warn",
      },
      {
        label: "通道池",
        value: `${nodeChannelOverview.onlineIdle} 空闲`,
        meta:
          nodeChannelOverview.onlineCapacity > 0
            ? `${nodeChannelOverview.onlineInUse} 占用 / ${nodeChannelOverview.onlineCapacity} 总量`
            : "在线节点尚未上报通道容量",
        tone: nodeChannelOverview.onlineIdle > 0 || nodeChannelOverview.onlineCapacity === 0 ? "good" : "warn",
      },
    ],
    [
      modelStatus?.configured,
      modelStatus?.model,
      nodeChannelOverview.onlineCapacity,
      nodeChannelOverview.onlineIdle,
      nodeChannelOverview.onlineInUse,
      systemStatus?.active_nodes,
      systemStatus?.dispatch_mode_enabled,
      systemStatus?.redis_ok,
      wechatRuntimeSummary.tone,
      wechatRuntimeSummary.value,
      wechatStatus?.has_token,
    ],
  );
  const nodeInventoryCards = useMemo<Array<{
    nodeId: string;
    title: string;
    subtitle: string;
    kind: NodeKind;
    badge: string;
    badgeTone: "human" | "typing" | "queued";
    address: string;
    detail: string;
    platform: string;
    version: string;
    concurrency: string;
    channels: string;
    channelIdle: string;
    channelBusy: string;
    channelCapacity: string;
    channelUsagePercent: number;
    channelPressureLabel: string;
    channelPressureTone: "good" | "warn" | "busy";
    authFailed: boolean;
    selected: boolean;
    actions: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  }>>(
    () =>
      nodeInventory.map((node) => {
        const presentation = resolveInventoryNodePresentation(node, localNodeStatus, launcherStatus);
        const channelCapacity = Math.max(node.channel_capacity ?? 0, 0);
        const channelBusy = Math.max(node.channel_in_use ?? 0, 0);
        const channelIdle = Math.max(channelCapacity - channelBusy, 0);
        const channelUsagePercent = channelCapacity > 0 ? Math.min(100, Math.round((channelBusy / channelCapacity) * 100)) : 0;
        const channelPressureTone = !node.online
          ? "warn"
          : channelIdle <= 0 && channelCapacity > 0
            ? "busy"
            : channelIdle <= 1
              ? "warn"
              : "good";
        const channelPressureLabel = !node.online
          ? "节点离线"
          : channelCapacity <= 0
            ? "待上报"
            : channelIdle <= 0
              ? "已满载"
              : channelIdle <= 1
                ? "接近满载"
                : "可继续接入";
        return {
          nodeId: node.node_id,
          title: node.hostname || node.node_id,
          subtitle: node.node_id,
          kind: node.node_kind,
          badge: presentation.badge,
          badgeTone: presentation.tone as "human" | "typing" | "queued",
          address: getInventoryNodeAddress(node),
          detail: presentation.detail,
          platform: node.platform || "未知",
          version: node.node_version || "-",
          concurrency: String(node.max_concurrency ?? "-"),
          channels: `${channelBusy} / ${channelCapacity}`,
          channelIdle: String(channelIdle),
          channelBusy: String(channelBusy),
          channelCapacity: String(channelCapacity),
          channelUsagePercent,
          channelPressureLabel,
          channelPressureTone,
          authFailed: node.connection_state === "auth_failed",
          selected: selectedNodeId === node.node_id,
          actions: [
            {
              label: selectedNodeId === node.node_id ? "收起诊断" : "查看诊断",
              onClick: () => setSelectedNodeId(selectedNodeId === node.node_id ? null : node.node_id),
            },
            ...(node.node_kind === "remote" && node.paired
              ? [
                  {
                    label: busy === `delete-node-${node.node_id}` ? "处理中..." : "删除节点",
                    onClick: () => void deletePairedNode(node),
                    disabled: busy !== null,
                  },
                ]
              : []),
            ...(node.node_kind === "remote" && node.online
              ? [
                  {
                    label: busy === `disconnect-node-${node.node_id}` ? "处理中..." : "断开连接",
                    onClick: () => void disconnectPairedNode(node),
                    disabled: busy !== null,
                  },
                ]
              : []),
          ],
        };
      }),
    [busy, deletePairedNode, disconnectPairedNode, launcherStatus, localNodeStatus, nodeInventory, selectedNodeId],
  );
  const selectedNodeDiagnosticsView = useMemo(() => {
    if (!selectedNodeId || !selectedNodeDiagnostics) return null;
    const rows: Array<{ label: string; value: string; multiline?: boolean }> = [
      { label: "连接状态", value: selectedNodeDiagnostics.connection_state || "未记录" },
      {
        label: "最近配对",
        value: selectedNodeDiagnostics.last_pairing_status
          ? `${selectedNodeDiagnostics.last_pairing_status}${selectedNodeDiagnostics.last_pairing_at ? ` · ${formatTimeLabel(selectedNodeDiagnostics.last_pairing_at, true)}` : ""}`
          : "暂无",
      },
      {
        label: "最近注册",
        value: selectedNodeDiagnostics.last_register_result
          ? `${selectedNodeDiagnostics.last_register_result}${selectedNodeDiagnostics.last_register_at ? ` · ${formatTimeLabel(selectedNodeDiagnostics.last_register_at, true)}` : ""}`
          : "暂无",
      },
      {
        label: "最近心跳",
        value: selectedNodeDiagnostics.last_heartbeat_at ? formatTimeLabel(selectedNodeDiagnostics.last_heartbeat_at, true) : "暂无",
      },
    ];
    if (selectedNodeDiagnostics.last_auth_decision) {
      rows.push({ label: "最近鉴权", value: selectedNodeDiagnostics.last_auth_decision });
      if (selectedNodeDiagnostics.last_auth_failure_at) {
        rows.push({ label: "鉴权失败时间", value: formatTimeLabel(selectedNodeDiagnostics.last_auth_failure_at, true) });
      }
      if (selectedNodeDiagnostics.expected_token_masked) {
        rows.push({ label: "期望 Token", value: selectedNodeDiagnostics.expected_token_masked });
      }
      if (selectedNodeDiagnostics.provided_token_masked) {
        rows.push({ label: "实际 Token", value: selectedNodeDiagnostics.provided_token_masked });
      }
      if (selectedNodeDiagnostics.expected_token_masked && selectedNodeDiagnostics.provided_token_masked) {
        rows.push({
          label: "Token 对比",
          value: `期望：${selectedNodeDiagnostics.expected_token_masked} / 实际提供：${selectedNodeDiagnostics.provided_token_masked}`,
          multiline: true,
        });
      }
      if (selectedNodeDiagnostics.last_auth_client_host) {
        rows.push({ label: "来源地址", value: selectedNodeDiagnostics.last_auth_client_host });
      }
    }
    if (selectedNodeDiagnostics.last_error) {
      rows.push({ label: "最近错误", value: selectedNodeDiagnostics.last_error, multiline: true });
    }
    return {
      nodeId: selectedNodeId,
      kind: selectedNodeDiagnostics.node_kind || null,
      traceId: selectedNodeDiagnostics.last_pairing_trace_id || null,
      rows,
      timelineText: selectedNodeDiagnostics.timeline?.length ? selectedNodeTimelineText : null,
      onClose: () => setSelectedNodeId(null),
    };
  }, [selectedNodeDiagnostics, selectedNodeId, selectedNodeTimelineText]);
  const wechatStatusRows = useMemo(
    () => [
      { label: "接入状态", value: wechatRuntimeSummary.value, multiline: true },
      { label: "Token 状态", value: wechatStatus?.has_token ? "已写入当前网关" : "尚未写入" },
      { label: "运行状态", value: wechatStatus?.running ? "轮询中" : "未轮询" },
      ...(wechatStatus?.last_error ? [{ label: "最近错误", value: wechatStatus.last_error, multiline: true }] : []),
    ],
    [wechatRuntimeSummary.value, wechatStatus?.has_token, wechatStatus?.last_error, wechatStatus?.running],
  );
  const pairingDebugViewEntries = useMemo<Array<{
    id: string;
    title: string;
    target: string;
    updatedAtLabel: string;
    statusLabel: string;
    statusTone: "human" | "typing" | "queued";
    summary: string;
    logText: string;
  }>>(
    () =>
      pairingDebugEntries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        target: entry.target,
        updatedAtLabel: formatTimeLabel(entry.updated_at, true),
        statusLabel: pairingDebugStatusLabel(entry.status),
        statusTone: (entry.status === "succeeded" ? "human" : entry.status === "running" || entry.status === "pending" ? "typing" : "queued") as "human" | "typing" | "queued",
        summary: entry.summary || "等待更多日志...",
        logText: entry.logs.length ? entry.logs.join("\n") : "暂无详细日志",
      })),
    [pairingDebugEntries],
  );

  return (
    <div className="console-app">
      <div className="console-grain" />
      <div className="console-shell">
        <header className="console-topbar">
          <div className="topbar-main">
            <div className="topbar-kicker">wechat-claw-hub</div>
            <div className="topbar-title">微信 Agent 运维工作台</div>
            <div className="topbar-copy">
              {workspace === "connection"
                ? "接入中心优先展示当前运行态、接入结果和关键配置。"
                : workspace === "logs"
                  ? "日志中心集中查看运行日志、配对日志和节点回连输出。"
                  : "把快速配置、接入联调、日志中心和会话观察拆成四个一级工作区，首次启动先走向导，后续也能随时重配。"}
            </div>
          </div>
          <div className="topbar-status-row">
            {currentRoleIsWorker ? (
              <>
                <StatusChip label="目标网关" value={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "已连接" : workerSetup.gateway_base_url ? "可达" : "未填写"} tone={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "good" : "warn"} />
                <StatusChip label="节点" value={workerSetup.node_id || "未配置"} tone={workerSetup.node_id ? "good" : "warn"} />
                <StatusChip label="注册状态" value={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "已注册" : workerGatewayConnection.state === "idle" ? "未检测" : workerGatewayConnection.label} tone={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "good" : "warn"} />
                <StatusChip label="模型" value={localNodeStatus?.active_model_provider || localNodeStatus?.configured_model_provider || "未配置"} tone={localNodeStatus?.inference_ready ? "good" : "warn"} />
              </>
            ) : (
              <>
                <StatusChip label="网关" value={gatewayRuntimeSummary.value} tone={gatewayRuntimeSummary.tone} />
                <StatusChip label="微信" value={wechatRuntimeSummary.value} tone={wechatRuntimeSummary.tone} />
                <StatusChip label="节点" value={`${nodeInventorySummary.online_total} 在线`} tone={nodeInventorySummary.online_total > 0 ? "good" : "warn"} />
                <StatusChip label="模型" value={modelStatus?.model || "未配置"} tone={modelStatus?.configured ? "good" : "warn"} />
              </>
            )}
          </div>
          <div className="topbar-notice">{notice}</div>
        </header>

        <div className="workspace-tabs" role="tablist" aria-label="Primary workspaces">
          <button type="button" className={`workspace-tab ${workspace === "quick_setup" ? "workspace-tab-active" : ""}`} onClick={() => setWorkspace("quick_setup")}>快速配置</button>
          <button type="button" className={`workspace-tab ${workspace === "sessions" ? "workspace-tab-active" : ""}`} onClick={() => setWorkspace("sessions")}>
            {(() => { const badge = resolveRoleBadge(effectiveRole); return badge?.tab === "sessions" ? <span className="workspace-tab-badge">会话观察台<span className={`role-badge role-badge-${badge.variant}`}>{badge.label}</span></span> : "会话观察台"; })()}
          </button>
          <button type="button" className={`workspace-tab ${workspace === "connection" ? "workspace-tab-active" : ""}`} onClick={() => setWorkspace("connection")}>
            {(() => { const badge = resolveRoleBadge(effectiveRole); return badge?.tab === "connection" ? <span className="workspace-tab-badge">接入中心<span className={`role-badge role-badge-${badge.variant}`}>{badge.label}</span></span> : "接入中心"; })()}
          </button>
          <button type="button" className={`workspace-tab ${workspace === "logs" ? "workspace-tab-active" : ""}`} onClick={() => setWorkspace("logs")}>
            日志中心
          </button>
        </div>

        {workspace === "quick_setup" ? (
          <section className="workspace-frame quick-setup-workspace">
            <div className="workspace-heading">
              <div><div className="section-kicker">首次启动向导</div><h2>先选角色，再用最短路径把本机跑起来</h2></div>
              <div className="workspace-caption">{currentRoleIsWorker ? "当前按节点视角收敛界面，只配置这台机器如何安装、回连网关和响应局域网发现。" : currentRoleIsConsole ? "当前按控制台视角收敛界面，只保留控制台连接与观察相关能力。" : "首版支持当前这台机器上的受控执行：保存网关配置、组合完成“网关主机+控制台”、单独校验控制台目标，以及纳管局域网中的其它节点。"}</div>
            </div>

            <div className="quick-setup-layout">
              <section className="surface">
                <div className="section-head">
                  <div><div className="section-kicker">步骤导航</div><h3>配置流程</h3></div>
                  <span className="small-note">{setupMode === "status" ? "当前连接状态" : setupMode === "role" ? "选择角色" : setupMode === "config" ? "填写参数" : setupMode === "preview" ? "执行前确认" : "查看结果"}</span>
                </div>
                <div className="quick-setup-steps">
                  <SetupStepPill label="0. 当前连接" active={setupMode === "status"} done={setupMode !== "status"} />
                  <SetupStepPill label="1. 选择角色" active={setupMode === "role"} done={setupMode === "config" || setupMode === "preview" || setupMode === "result"} />
                  <SetupStepPill label="2. 基础参数" active={setupMode === "config"} done={setupMode === "preview" || setupMode === "result"} />
                  <SetupStepPill label="3. 执行确认" active={setupMode === "preview"} done={setupMode === "result"} />
                  <SetupStepPill label="4. 执行结果" active={setupMode === "result"} done={Boolean(setupTask && setupTask.status === "succeeded")} />
                </div>
                <div className="info-stack">
                  <InfoRow label="推荐入口" value={setupProfile?.recommended_workspace === "quick_setup" ? "当前仍建议先完成快速配置" : "已可直接进入联调或会话观察"} multiline />
                  <InfoRow label="当前角色" value={currentRoleDisplay} multiline />
                  <InfoRow label="已完成角色" value={setupProfile?.completed_roles.length ? setupProfile.completed_roles.map(roleName).join(" / ") : "暂无"} multiline />
                  <InfoRow label="最近任务" value={setupTask?.title || setupProfile?.last_task?.title || "暂无"} multiline />
                </div>
              </section>

              <div className="quick-setup-main">
                {launcherAvailable && effectiveRole ? (
                  <LauncherControlPanel
                    currentRoleIsWorker={currentRoleIsWorker}
                    launcherExpanded={launcherExpanded}
                    envExpanded={envExpanded}
                    launcherStatus={launcherStatus}
                    launcherLogs={launcherLogs}
                    busyKey={busy}
                    dispatchModeEnabled={gatewaySetup.dispatch_mode_enabled}
                    hostRedisFailed={launcherHostRedis?.state === "failed"}
                    gatewayFailed={launcherGateway?.state === "failed"}
                    onRefreshLauncherStatus={refreshLauncherStatus}
                    onToggleLauncherExpanded={() => setLauncherExpanded((value) => !value)}
                    onReadLauncherLog={readLauncherLog}
                    onStopComponent={(name) => void stopLauncherStack(name)}
                    onToggleEnvExpanded={() => setEnvExpanded((value) => !value)}
                    onInstallHostRedis={() => installLauncherRedis("host", launcherStatus?.profile.redis_source || "mirror")}
                    onToggleDispatchMode={() => void applyDispatchMode(!gatewaySetup.dispatch_mode_enabled)}
                    onToggleNodeCache={() => toggleLauncherNodeCache(launcherStatus?.profile.node_cache_policy === "disabled")}
                    onInstallNodeCacheRedis={() => installLauncherRedis("node-cache", launcherStatus?.profile.node_cache_redis_source || "mirror")}
                    onStartLauncherStack={() => void startLauncherStack()}
                    onStopLauncherStack={() => void stopLauncherStack()}
                    launcherMachineRoleLabel={launcherMachineRoleLabel}
                    launcherManagedComponentsLabel={launcherManagedComponentsLabel}
                    launcherLocalNodePolicyLabel={launcherLocalNodePolicyLabel}
                    launcherEnvironmentLabel={launcherEnvironmentLabel}
                    launcherComponentName={launcherComponentName}
                    launcherStateLabel={launcherStateLabel}
                    launcherBadgeTone={launcherBadgeTone}
                  />
                ) : null}

                {setupMode === "status" ? (
                  <section className="surface">
                    <div className="section-head">
                      <div><div className="section-kicker">当前连接状态</div><h3>先确认当前主机和连接状态</h3></div>
                      <div className="inline-actions">
                        <button type="button" className="ghost-button" onClick={refreshQuickSetupStatus} disabled={busy !== null}>{busy === "reconfigure-disconnect-wechat" ? "处理中..." : "刷新状态"}</button>
                        <button type="button" onClick={() => setReconfigureConfirmOpen((current) => !current)} disabled={busy !== null}>{reconfigureConfirmOpen ? "收起确认" : "重新配置"}</button>
                      </div>
                    </div>
                    <div className="status-grid">
                      {quickSetupStatusRows.map((item) => (
                        <PrepStrip key={item.title} label={item.title} detail={`${item.value} · ${item.detail}`} tone={item.tone} />
                      ))}
                    </div>
                    <div className="info-stack">
                      <InfoRow label="当前角色" value={currentRoleDisplay} multiline />
                      {currentRoleIsWorker ? (
                        <>
                          <InfoRow label="目标网关" value={workerSetup.gateway_base_url || "-"} multiline />
                          <InfoRow label="连接状态" value={workerGatewayConnection.label} multiline />
                          <InfoRow label="安装目录" value={workerSetup.install_dir || "-"} multiline />
                          <InfoRow label="最近任务" value={latestSetupSummary} multiline />
                        </>
                      ) : (
                        <>
                          <InfoRow label="微信 Base URL" value={wechatStatus?.base_url || gatewaySetup.wechat_base_url || "-"} multiline />
                          <InfoRow label="控制台目标网关" value={setupProfile?.console.gateway_base_url || "-"} multiline />
                          <InfoRow label="网关运行状态" value={`${gatewayRuntimeSummary.value} · ${gatewayRuntimeSummary.detail}`} multiline />
                          <InfoRow label="节点" value={nodeInventorySummary.online_total ? `${nodeInventorySummary.online_total} 个在线` : "暂无在线节点"} multiline />
                        </>
                      )}
                    </div>
                    <div
                      className="launcher-env-head"
                      onClick={() => setEnvExpanded(v => !v)}
                      style={{marginTop: 14}}
                    >
                      <span className="section-kicker">节点凭据</span>
                      <span className="launcher-env-status good" style={{marginLeft: 8}}>
                        {workerSetup.pairing_key.trim() ? "密钥已填写" : "待填写"}
                      </span>
                      <span className="launcher-env-toggle">{envExpanded ? "▲" : "▼"}</span>
                    </div>
                    {envExpanded ? (
                      <div className="info-stack" style={{marginTop: 8}}>
                        {workerCredentialRows.map((item) => <InfoRow key={item.label} label={item.label} value={item.value} multiline />)}
                      </div>
                    ) : null}
                    {reconfigureConfirmOpen ? (
                      <section className="surface surface-subsection reconfigure-panel">
                        <div className="section-head">
                          <div><div className="section-kicker">重新配置确认</div><h3>确认是否断开当前连接并重新配置</h3></div>
                        </div>
                        <div className="snippet-stack">
                          <SnippetBlock label="将发生的变化" content={reconfigureWarnings.join("\n")} />
                          <SnippetBlock label="支持直接断开的连接" content={wechatStatus?.running ? "微信连接：继续后将先调用断开接口，再进入角色选择。" : "当前没有处于运行中的微信连接。"} />
                        </div>
                        <div className="inline-actions quick-setup-actions">
                          <button type="button" onClick={() => void confirmReconfigure()} disabled={busy !== null}>{busy === "reconfigure-disconnect-wechat" ? "断开中..." : wechatStatus?.running ? "断开微信并继续" : "确认并继续"}</button>
                          <button type="button" className="ghost-button" onClick={() => setReconfigureConfirmOpen(false)} disabled={busy !== null}>取消</button>
                        </div>
                      </section>
                    ) : null}
                  </section>
                ) : null}

                {setupMode === "role" ? (
                  <section className="surface">
                    <div className="section-head"><div><div className="section-kicker">角色选择</div><h3>这台机器现在要扮演什么角色？</h3></div></div>
                    <div className="role-card-grid">
                      {(setupProfile?.available_roles ?? DEFAULT_SETUP_ROLES).map((role) => (
                        <button key={role} type="button" className={`role-card ${setupRole === role ? "role-card-active" : ""}`} onClick={() => selectSetupRole(role)}>
                          <div className="role-card-top">
                            <strong>{roleName(role)}</strong>
                            {setupCompletedRoles.has(role) ? <span className="session-badge session-badge-human">已配置</span> : null}
                          </div>
                          <div className="role-card-copy">{roleDescription(role)}</div>
                          <div className="role-card-meta">{roleAction(role)}</div>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {setupMode !== "status" && setupMode !== "role" && setupRole ? (
                  <>
                    <section className="surface">
                      <div className="section-head">
                        <div><div className="section-kicker">当前角色</div><h3>{roleName(setupRole)}</h3></div>
                        <div className="inline-actions">
                          <button type="button" className="ghost-button" onClick={() => { clearQuickSetupCache(); persistWorkspace("quick_setup"); setSetupRole(null); setSetupTask(null); setSetupMode("role"); }}>重新选角色</button>
                          {setupProfile?.setup_completed ? <button type="button" className="ghost-button" onClick={returnToSetupStatus}>返回状态总览</button> : null}
                          <button type="button" className="ghost-button" onClick={resetCurrentSetupDraft}>重置当前填写内容</button>
                        </div>
                      </div>
                      {setupMode === "config" ? (
                        setupRole === "gateway_host" || setupRole === "gateway_host_console" ? (
                          <>
                            <div className="form-grid">
                              <label><span>Redis URL</span><input value={gatewaySetup.redis_url} onChange={(event) => updateGatewaySetup("redis_url", event.target.value)} /></label>
                              <label><span>默认 Agent ID</span><input value={gatewaySetup.default_agent_id} onChange={(event) => updateGatewaySetup("default_agent_id", event.target.value)} /></label>
                              <label><span>主网关访问地址</span><input value={consoleSetup.gateway_base_url} onChange={(event) => updateConsoleSetup("gateway_base_url", event.target.value)} placeholder="节点回连主机时使用这个地址" /></label>
                    <label><span>Dify Base URL（留空则默认走内置模型）</span><input value={gatewaySetup.dify_base_url} onChange={(event) => updateGatewaySetup("dify_base_url", event.target.value)} placeholder="https://api.dify.ai/v1" /></label>
                    <label><span>Dify API Key</span><textarea value={gatewaySetup.dify_api_key} onChange={(event) => updateGatewaySetup("dify_api_key", event.target.value)} placeholder="留空时保留当前已保存值；若同时未填 Dify Base URL，则回退到内置模型。" /></label>
                    <label><span>内置模型 Base URL</span><input value={gatewaySetup.builtin_model_base_url} onChange={(event) => updateGatewaySetup("builtin_model_base_url", event.target.value)} placeholder="留空时默认使用 DashScope OpenAI Compatible" /></label>
                    <label><span>内置模型 API Key</span><textarea value={gatewaySetup.builtin_model_api_key} onChange={(event) => updateGatewaySetup("builtin_model_api_key", event.target.value)} placeholder="留空则保留当前已保存的内置模型密钥。" /></label>
                    <label><span>内置模型名称</span><input value={gatewaySetup.builtin_model_name} onChange={(event) => updateGatewaySetup("builtin_model_name", event.target.value)} placeholder="留空时默认使用 qwen3.5-plus" /></label>
                              <label><span>微信 Base URL</span><input value={gatewaySetup.wechat_base_url} onChange={(event) => updateGatewaySetup("wechat_base_url", event.target.value)} /></label>
                    <label><span>微信 Token</span><textarea value={gatewaySetup.wechat_token} onChange={(event) => updateGatewaySetup("wechat_token", event.target.value)} placeholder="留空则保留当前已保存 token；填写后保存会尝试直接刷新连接。" /></label>
                            </div>
                            <section className="surface surface-subsection">
                              <div className="section-head">
                                <div><div className="section-kicker">自动发现</div><h3>搜索局域网内已运行的工作节点</h3></div>
                                <button type="button" onClick={scanLanNodes} disabled={busy !== null}>{busy === "setup-discovery-scan" ? "搜索中..." : "搜索局域网节点"}</button>
                              </div>
                              {!discoveredNodes.length ? <div className="empty-state">保存主机配置后，点击“搜索局域网节点”即可发现同网段内已运行且开启发现响应的 `claw-node`。</div> : (
                                <div className="discovery-list">
                                  {discoveredNodes.map((item) => (
                                    <div key={item.discovery_id} className="discovery-card">
                                      <div className="discovery-card-top">
                                        <div>
                                          <div className="node-card-title">{item.pairing_label || item.hostname}</div>
                                          <div className="node-card-subtitle">{[item.lan_ip || "-", item.platform || "-", item.node_version || "-"].join(" · ")}</div>
                                        </div>
                                        <span className={`session-badge session-badge-${pairingStatusTone(pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending"))}`}>{pairingStatusLabel(pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending"))}</span>
                                      </div>
                                      <div className="node-card-grid">
                                        <div><div className="node-card-label">局域网 IP</div><div className="node-card-value">{item.lan_ip || "未上报"}</div></div>
                                        <div><div className="node-card-label">配对端口</div><div className="node-card-value">{item.pairing_port}</div></div>
                                        <div><div className="node-card-label">能力</div><div className="node-card-value">{item.capabilities.join(", ") || "未声明"}</div></div>
                                        <div><div className="node-card-label">正式节点 ID</div><div className="node-card-value">{item.node_id || "配对时自动生成"}</div></div>
                                      </div>
                                      <div className="discovery-actions">
                                        <input value={pairingSecrets[item.discovery_id] || ""} onChange={(event) => setPairingSecrets((current) => ({ ...current, [item.discovery_id]: event.target.value }))} placeholder="输入该机器的配对密钥" />
                                        <button type="button" onClick={() => pairLanNode(item)} disabled={busy !== null}>{busy === "setup-discovery-pair" ? "连接中..." : "输入密钥并连接"}</button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </section>
                          </>
                        ) : setupRole === "worker_node" ? (
                          <div className="worker-wizard">
                            {/* 1 Identity: IP + port */}
                            <div className="worker-wizard-identity" style={{ marginBottom: 16 }}>
                              <div className="worker-wizard-identity-ip">{currentNodeLanIp || "检测中…"}</div>
                              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                                端口：{workerSetup.discovery_port} &nbsp;&middot;&nbsp; 这是本机节点的地址，网关管理员需要用这个地址来发现和配对你的节点
                              </div>
                            </div>

                            <div className="form-grid">
                              <label><span>节点 ID</span><input value={workerSetup.node_id} onChange={(event) => updateWorkerSetup("node_id", event.target.value)} /></label>

                              {/* 2 Gateway URL + probe */}
                              <label>
                                <span>目标网关地址 <span style={{ color: "var(--red, #c0392b)" }}>*</span></span>
                                <div className="field-with-action">
                                  <input
                                    value={workerSetup.gateway_base_url}
                                    onChange={(event) => updateWorkerSetup("gateway_base_url", event.target.value)}
                                    placeholder="例如 http://192.168.0.18:8300"
                                    style={!validateWorkerGatewayUrl(workerSetup.gateway_base_url) && workerSetup.gateway_base_url !== "" ? { borderColor: "var(--red, #c0392b)" } : undefined}
                                  />
                                  <button type="button" className="ghost-button" onClick={applyPreferredGatewayBaseUrlToWorker}>填入本机地址</button>
                                  <button type="button" className="ghost-button" onClick={() => void probeWorkerGateway({ reason: "manual" })} disabled={busy !== null}>
                                    {busy === "setup-gateway-probe" ? "检测中..." : "检测连接"}
                                  </button>
                                </div>
                                {workerGatewayProbeTask ? (
                                  <div style={{ fontSize: 12, marginTop: 4, color: workerGatewayConnection.state === "gateway_reachable_node_connected" || workerGatewayConnection.state === "gateway_reachable_node_pending_confirm" ? "var(--green)" : "var(--amber)" }}>
                                    {workerGatewayConnection.label}
                                  </div>
                                ) : null}
                              </label>

                              {/* 3 Pairing key */}
                              <label>
                                <span>配对密鑰</span>
                                <div className="field-with-action">
                                  <input type={workerPairingKeyVisible ? "text" : "password"} value={workerSetup.pairing_key} onChange={(event) => updateWorkerSetup("pairing_key", event.target.value)} placeholder="节点与网关需保持一致" autoComplete="new-password" />
                                  <button type="button" className="ghost-button" onClick={() => setWorkerPairingKeyVisible((current) => !current)}>{workerPairingKeyVisible ? "隐藏" : "显示"}</button>
                                </div>
                                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>配对密鑰由你自己设定，网关管理员在配对时需要输入相同的密鑰</div>
                              </label>

                              <label><span>安装目录</span><input value={workerSetup.install_dir} onChange={(event) => updateWorkerSetup("install_dir", event.target.value)} /></label>
                              <label><span>发现响应端口</span><input type="number" value={workerSetup.discovery_port} onChange={(event) => updateWorkerSetup("discovery_port", Number(event.target.value) || 9531)} /></label>
                              <label><span>启用局域网发现</span><input type="checkbox" checked={workerSetup.discovery_enabled} onChange={(event) => updateWorkerSetup("discovery_enabled", event.target.checked)} /></label>
                              <label><span>Bundle 路径（可选）</span><input value={workerSetup.bundle_path} onChange={(event) => updateWorkerSetup("bundle_path", event.target.value)} placeholder="留空则自动查找" /></label>
                            </div>

                            {/* 4 Token readonly */}
                            <div className="worker-token-readonly" style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>节点 Token（只读）</div>
                              <div>{resolveTokenDisplayState(workerSetup.node_token).status === "waiting" ? "空（等待网关配对后自动下发）" : "已配对"}</div>
                              <div style={{ fontSize: 12, marginTop: 4 }}>Token 无需手动填写，完成配对后网关会自动将 Token 写入本机配置</div>
                            </div>

                            {/* 5 Model config collapsible */}
                            <div className="worker-model-collapse" style={{ marginTop: 16 }}>
                              <div className="worker-model-collapse-header" onClick={() => setWorkerModelExpanded((v) => !v)}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>模型配置（可选）</span>
                                <span style={{ fontSize: 12, color: "var(--muted)" }}>{workerModelExpanded ? "收起" : "展开"}</span>
                              </div>
                              {!workerModelExpanded ? (
                                <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
                                  模型配置可选，不填写时使用网关内置模型（{gatewaySetup.builtin_model_name || DEFAULT_BUILTIN_MODEL_LABEL}）
                                </div>
                              ) : (
                                <div className="worker-model-collapse-body">
                                  <div className="form-grid">
                                    <label><span>Dify Base URL</span><input value={workerSetup.dify_base_url} onChange={(event) => updateWorkerSetup("dify_base_url", event.target.value)} /></label>
                                    <label><span>Dify API Key</span><textarea value={workerSetup.dify_api_key} onChange={(event) => updateWorkerSetup("dify_api_key", event.target.value)} /></label>
                                    <label><span>最大并发</span><input type="number" value={workerSetup.max_concurrency} onChange={(event) => updateWorkerSetup("max_concurrency", Number(event.target.value) || 1)} /></label>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="form-grid">
                            <label><span>目标网关地址</span><input value={consoleSetup.gateway_base_url} onChange={(event) => updateConsoleSetup("gateway_base_url", event.target.value)} /></label>
                          </div>
                        )
                      ) : setupMode === "preview" ? (
                        <div className="snippet-stack">
                          <SnippetBlock label="将执行的动作" content={previewContent(setupRole, gatewaySetup, workerSetup, consoleSetup)} />
                          <SnippetBlock label="预期产物" content={previewOutcome(setupRole)} />
                        </div>
                      ) : (
                        <div className="snippet-stack">
                          <SnippetBlock label="执行摘要" content={setupTask?.summary || "任务尚未启动。"} />
                          {setupTask?.kind === "node_install" ? <SnippetBlock label="安装进度" content={installProgressSummary} /> : null}
                          <SnippetBlock label="最新日志" content={setupTask?.logs?.length ? setupTask.logs.join("\n") : "等待日志输出…"} />
                        </div>
                      )}
                      <div className="inline-actions quick-setup-actions">
                        {setupMode === "config" ? <button type="button" onClick={() => setSetupMode("preview")}>下一步：确认执行</button> : null}
                        {setupMode === "preview" ? <button type="button" onClick={submitSetupRole} disabled={busy !== null}>{busy === "setup-gateway" || busy === "setup-gateway-console" || busy === "setup-worker" || busy === "setup-console" ? "执行中..." : "开始执行"}</button> : null}
                        {setupMode === "preview" || setupMode === "result" ? <button type="button" className="ghost-button" onClick={() => setSetupMode("config")}>返回修改参数</button> : null}
                        {setupMode === "result" ? <button type="button" className="ghost-button" onClick={refreshSetupProfile}>刷新配置状态</button> : null}
                        {setupMode === "result" ? <button type="button" className="ghost-button" onClick={() => setWorkspace("connection")}>去接入中心</button> : null}
                      </div>
                    </section>
                  </>
                ) : null}
              </div>
            </div>
          </section>
        ) : workspace === "connection" ? (
          <section className="workspace-frame connection-workspace">
            <div className="workspace-heading">
              <div><div className="section-kicker">{currentRoleIsWorker ? "节点工作台" : "接入中心"}</div><h2>{currentRoleIsWorker ? "聚焦本机节点安装、回连与发现响应" : "先确认网关、微信、节点和模型都处于可用状态"}</h2></div>
              <div className="workspace-caption">{currentRoleIsWorker ? "当前角色不会展示网关纳管、微信接入和分发模式操作。" : "摘要优先，细节折叠，常规联调不再需要一路向下翻整页表单。"}</div>
            </div>
            {!currentRoleIsWorker ? (
              <div className="connection-layout-stack">
                <OverviewPanel
                  heroCards={connectionHeroCards}
                  prepItems={connectionPrepItems}
                  signalCards={connectionSignalCards}
                  consoleTarget={setupProfile?.console.gateway_base_url || currentGatewayBaseUrl}
                  modelCheckText={modelCheck ? (modelCheck.configured_model_available ? "可用" : "未命中模型列表") : null}
                  lastError={wechatStatus?.last_error || null}
                  dispatchWarning={gatewaySetup.dispatch_mode_enabled && availableDispatchNodes === 0 ? "已开启分发模式，但暂无可用远端节点；网关无法完成实际回复。" : null}
                  onRunModelCheck={runModelCheck}
                  onToggleDispatch={() => void applyDispatchMode(!gatewaySetup.dispatch_mode_enabled)}
                  runModelCheckLabel={busy === "model-check" ? "检测中..." : "检测模型"}
                  toggleDispatchLabel={busy === "dispatch-mode-toggle" ? "切换中..." : gatewaySetup.dispatch_mode_enabled ? "关闭分发模式" : "开启分发模式"}
                  busy={busy !== null}
                />

                <div className="connection-section-grid">
                  <NodeInventoryPanel headline={nodeInventoryHeadline} cards={nodeInventoryCards} selectedDiagnostics={selectedNodeDiagnosticsView} />
                  <WeChatConfigCard
                    statusRows={wechatStatusRows}
                    qrImageSrc={qrImageSrc}
                    pollStatus={pollState?.status ?? "未开始"}
                    wechatBaseUrl={wechatBaseUrl}
                    manualToken={manualToken}
                    busyKey={busy}
                    onWechatBaseUrlChange={setWechatBaseUrl}
                    onManualTokenChange={setManualToken}
                    onStartQrFlow={startQrFlow}
                    onPollQrStatus={pollQrStatus}
                    onConnectManualToken={connectManualToken}
                    onDisconnectWeChat={disconnectWeChat}
                  />
                </div>

                <div className="connection-section-grid">
                  <div className="connection-panel-stack">
                    <section className="surface">
                      <div className="section-head">
                        <div><div className="section-kicker">节点与模型参数</div><h3>添加或修复远端工作节点</h3></div>
                        <button type="button" className="ghost-button" onClick={applyPreferredGatewayBaseUrlToWorker}>
                          填入当前网关地址
                        </button>
                      </div>
                      <div className="inline-tip">
                        基础安装信息直接展示，按地址直连和局域网扫描收纳到折叠区，降低首次配置时的认知负担。
                      </div>
                      <div className="connection-form-grid">
                        <label><span>节点 ID</span><input value={workerSetup.node_id} onChange={(event) => updateWorkerSetup("node_id", event.target.value)} /></label>
                        <label><span>目标网关地址</span><input value={workerSetup.gateway_base_url} onChange={(event) => updateWorkerSetup("gateway_base_url", event.target.value)} placeholder="http://192.168.0.18:8300" /></label>
                        <label>
                          <span>配对密钥</span>
                          <div className="field-with-action">
                            <input type={workerPairingKeyVisible ? "text" : "password"} value={workerSetup.pairing_key} onChange={(event) => updateWorkerSetup("pairing_key", event.target.value)} placeholder="节点与网关保持一致" autoComplete="new-password" />
                            <button type="button" className="ghost-button" onClick={() => setWorkerPairingKeyVisible((current) => !current)}>
                              {workerPairingKeyVisible ? "隐藏" : "显示"}
                            </button>
                          </div>
                        </label>
                        <label><span>安装目录</span><input value={workerSetup.install_dir} onChange={(event) => updateWorkerSetup("install_dir", event.target.value)} /></label>
                      </div>
                      <details className="form-advanced-details connection-fold-card">
                        <summary>
                          <span className="section-kicker">高级选项</span>
                          <span className="connection-fold-hint">发现响应、并发与 bundle 路径</span>
                        </summary>
                        <div className="connection-form-grid">
                          <label><span>Dify Base URL</span><input value={workerSetup.dify_base_url} onChange={(event) => updateWorkerSetup("dify_base_url", event.target.value)} /></label>
                          <label><span>Dify API Key</span><textarea value={workerSetup.dify_api_key} onChange={(event) => updateWorkerSetup("dify_api_key", event.target.value)} /></label>
                          <label><span>最大并发</span><input type="number" value={workerSetup.max_concurrency} onChange={(event) => updateWorkerSetup("max_concurrency", Number(event.target.value) || 1)} /></label>
                          <label><span>发现响应端口</span><input type="number" value={workerSetup.discovery_port} onChange={(event) => updateWorkerSetup("discovery_port", Number(event.target.value) || 9531)} /></label>
                          <label className="checkbox-row"><input type="checkbox" checked={workerSetup.discovery_enabled} onChange={(event) => updateWorkerSetup("discovery_enabled", event.target.checked)} /><span>启用局域网发现</span></label>
                          <label><span>Bundle 路径（可选）</span><input value={workerSetup.bundle_path} onChange={(event) => updateWorkerSetup("bundle_path", event.target.value)} placeholder="留空则自动查找" /></label>
                        </div>
                      </details>
                      <div className="inline-actions" style={{ marginTop: 14 }}>
                        <button type="button" onClick={() => void runWorkerSetup({ showResultScreen: false })} disabled={busy !== null}>
                          {busy === "setup-worker" ? "安装中..." : "安装当前机器节点"}
                        </button>
                      </div>
                    </section>

                    <section className="surface" style={{ padding: "12px 20px" }}>
                      <details className="form-advanced-details connection-fold-card">
                        <summary>
                          <span className="section-kicker">高级功能</span>
                          <span className="connection-fold-hint">按地址直接纳管远端节点</span>
                        </summary>
                        <div className="inline-tip">
                          如果广播扫描搜不到节点，可直接填写工作节点 IP/主机名和配对密钥；更适合多网卡、跨网段调试。
                        </div>
                        <div className="connection-form-grid">
                          <label><span>目标 IP / 主机名</span><input value={manualPair.host} onChange={(event) => updateManualPair("host", event.target.value)} placeholder="例如 192.168.0.23" /></label>
                          <label><span>配对端口</span><input type="number" value={manualPair.pairing_port} onChange={(event) => updateManualPair("pairing_port", Number(event.target.value) || 9532)} /></label>
                          <label><span>配对密钥</span><ToggleSecretInput value={manualPair.pairing_key} onChange={(event) => updateManualPair("pairing_key", event.target.value)} placeholder="与目标节点上的 CLAW_PAIRING_KEY 一致" autoComplete="new-password" /></label>
                          <label><span>指定节点 ID（可选）</span><input value={manualPair.node_id} onChange={(event) => updateManualPair("node_id", event.target.value)} placeholder="留空则自动生成或沿用远端值" /></label>
                        </div>
                        <div className="inline-actions">
                          <button type="button" onClick={() => void manualPairNode()} disabled={busy !== null}>
                            {busy === "setup-manual-pair" ? "连接中..." : "按地址配对"}
                          </button>
                        </div>
                      </details>
                    </section>

                    <section className="surface" style={{ padding: "12px 20px" }}>
                      <details className="form-advanced-details connection-fold-card">
                        <summary>
                          <span className="section-kicker">局域网发现</span>
                          <span className="connection-fold-hint">扫描并批量纳管附近节点</span>
                        </summary>
                        <div className="section-head compact-head">
                          <button type="button" onClick={scanLanNodes} disabled={busy !== null}>
                            {busy === "setup-discovery-scan" ? "搜索中..." : "搜索局域网节点"}
                          </button>
                        </div>
                        <div className="inline-tip">
                          当前网关回连地址：{currentGatewayBaseUrl}。扫描后可以直接输入密钥配对，适合调试和节点替换。
                        </div>
                        {!discoveredNodes.length ? (
                          <div className="empty-state">还没有扫描结果。先确认目标机器已运行 `claw-node` 并开启发现响应，然后点击“搜索局域网节点”。</div>
                        ) : (
                          <div className="discovery-list">
                            {discoveredNodes.map((item) => (
                              <div key={item.discovery_id} className="discovery-card">
                                <div className="discovery-card-top">
                                  <div>
                                    <div className="node-card-title">{item.pairing_label || item.hostname}</div>
                                    <div className="node-card-subtitle">{[item.lan_ip || "-", item.platform || "-", item.node_version || "-"].join(" · ")}</div>
                                  </div>
                                  <span className={`session-badge session-badge-${pairingStatusTone(pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending"))}`}>
                                    {pairingStatusLabel(pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending"))}
                                  </span>
                                </div>
                                <div className="node-card-grid">
                                  <div><div className="node-card-label">局域网 IP</div><div className="node-card-value">{item.lan_ip || "未上报"}</div></div>
                                  <div><div className="node-card-label">配对端口</div><div className="node-card-value">{item.pairing_port}</div></div>
                                  <div><div className="node-card-label">能力</div><div className="node-card-value">{item.capabilities.join(", ") || "未声明"}</div></div>
                                  <div><div className="node-card-label">正式节点 ID</div><div className="node-card-value">{item.node_id || "配对时自动生成"}</div></div>
                                </div>
                                <div className="discovery-actions">
                                  <input value={pairingSecrets[item.discovery_id] || ""} onChange={(event) => setPairingSecrets((current) => ({ ...current, [item.discovery_id]: event.target.value }))} placeholder="输入该机器的配对密钥" />
                                  <button type="button" onClick={() => pairLanNode(item)} disabled={busy !== null}>
                                    {busy === "setup-discovery-pair" ? "连接中..." : "输入密钥并连接"}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </details>
                    </section>
                  </div>

                  <NodeModelConfigPanel
                    launcherAvailable={launcherAvailable}
                    busyKey={busy}
                    status={localNodeStatus}
                    runtimeSummary={localNodeRuntimeSummary}
                    gatewayControl={{
                      managed: launcherShouldRunGateway(launcherStatus),
                      state: launcherStatus?.components.find((item) => item.name === "gateway")?.state || "未读取",
                      onRestart: () => void restartGatewayService(),
                      disabled:
                        busy !== null ||
                        !launcherAvailable ||
                        !launcherShouldRunGateway(launcherStatus),
                      busy: busy === "launcher-gateway-restart",
                    }}
                    eventPreview=""
                    draft={localNodeModelDraft}
                    onChange={updateLocalNodeModelDraft}
                    onRefresh={() => void refreshLocalNodeDiagnostics()}
                    onRestart={() => void restartLocalNodeService()}
                    onSave={() => void saveLocalNodeModelConfig()}
                    onExport={() => void exportLocalNodeDiagnostics()}
                  />
                </div>
              </div>
            ) : (
              <div className="connection-layout-stack">
                <section className="surface connection-overview" style={{ padding: "16px", background: "transparent", boxShadow: "none" }}>
                  <div className="connection-hero-grid">
                    {connectionHeroCards.map((card) => (
                      <ConnectionHeroCard key={`${card.eyebrow}-${card.title}`} eyebrow={card.eyebrow} title={card.title} detail={card.detail} tone={card.tone} />
                    ))}
                  </div>
                </section>

                <div className="connection-grid">
                  <div className="connection-status-column">
                    <div className="worker-wizard-identity" style={{ marginBottom: 12 }}>
                      <div className="worker-wizard-identity-ip">
                        {workerGatewayConnection.remoteNode?.lan_ip || String(localNodeStatus?.diagnostics?.lan_ip || currentNodeLanIp || "检测中…")}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                        端口：{workerSetup.discovery_port} &nbsp;&middot;&nbsp; 当前机器节点地址，网关管理员可使用该地址配对
                      </div>
                    </div>

                    <section className="surface surface-tight">
                      <div className="section-head">
                        <div>
                          <div className="section-kicker">节点工作台</div>
                          <h3>当前节点状态</h3>
                        </div>
                      </div>
                      <div className="prep-strip-list">
                        <PrepStrip label="节点配置" detail={setupCompletedRoles.has("worker_node") ? "当前机器节点已完成配置" : "尚未完成节点配置"} tone={setupCompletedRoles.has("worker_node") ? "good" : "warn"} />
                        <PrepStrip label="目标网关地址" detail={workerSetup.gateway_base_url || "未填写局域网网关地址"} tone={workerSetup.gateway_base_url ? "good" : "warn"} />
                        <PrepStrip label="发现响应" detail={workerSetup.discovery_enabled ? `已启用 UDP ${workerSetup.discovery_port}` : "当前已关闭"} tone={workerSetup.discovery_enabled ? "good" : "warn"} />
                        <PrepStrip
                          label="Token 状态"
                          detail={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "已配对" : resolveTokenDisplayState(workerSetup.node_token).status === "waiting" ? "等待网关下发 token" : "已配对"}
                          tone={workerGatewayConnection.state === "gateway_reachable_node_connected" || resolveTokenDisplayState(workerSetup.node_token).status === "paired" ? "good" : "warn"}
                        />
                      </div>
                    </section>

                    <section className="surface">
                      <div className="section-head">
                        <div>
                          <div className="section-kicker">节点安装</div>
                          <h3>安装或重装当前机器节点</h3>
                        </div>
                      </div>
                      <div className="form-grid">
                        <label><span>节点 ID</span><input value={workerSetup.node_id} onChange={(event) => updateWorkerSetup("node_id", event.target.value)} /></label>
                        <label><span>目标网关地址</span><input value={workerSetup.gateway_base_url} onChange={(event) => updateWorkerSetup("gateway_base_url", event.target.value)} placeholder="http://192.168.0.18:8300" /></label>
                        <label>
                          <span>配对密钥</span>
                          <div className="field-with-action">
                            <input type={workerPairingKeyVisible ? "text" : "password"} value={workerSetup.pairing_key} onChange={(event) => updateWorkerSetup("pairing_key", event.target.value)} placeholder="节点与网关保持一致" autoComplete="new-password" />
                            <button type="button" className="ghost-button" onClick={() => setWorkerPairingKeyVisible((current) => !current)}>
                              {workerPairingKeyVisible ? "隐藏" : "显示"}
                            </button>
                          </div>
                        </label>
                        <label><span>安装目录</span><input value={workerSetup.install_dir} onChange={(event) => updateWorkerSetup("install_dir", event.target.value)} /></label>
                      </div>
                      <details className="form-advanced-details connection-fold-card">
                        <summary>
                          <span className="section-kicker">高级选项</span>
                          <span className="connection-fold-hint">发现响应、并发与 bundle 路径</span>
                        </summary>
                        <div className="connection-form-grid">
                          <label><span>Dify Base URL</span><input value={workerSetup.dify_base_url} onChange={(event) => updateWorkerSetup("dify_base_url", event.target.value)} /></label>
                          <label><span>Dify API Key</span><textarea value={workerSetup.dify_api_key} onChange={(event) => updateWorkerSetup("dify_api_key", event.target.value)} /></label>
                          <label><span>最大并发</span><input type="number" value={workerSetup.max_concurrency} onChange={(event) => updateWorkerSetup("max_concurrency", Number(event.target.value) || 1)} /></label>
                          <label><span>发现响应端口</span><input type="number" value={workerSetup.discovery_port} onChange={(event) => updateWorkerSetup("discovery_port", Number(event.target.value) || 9531)} /></label>
                          <label className="checkbox-row"><input type="checkbox" checked={workerSetup.discovery_enabled} onChange={(event) => updateWorkerSetup("discovery_enabled", event.target.checked)} /><span>启用局域网发现</span></label>
                          <label><span>Bundle 路径（可选）</span><input value={workerSetup.bundle_path} onChange={(event) => updateWorkerSetup("bundle_path", event.target.value)} placeholder="留空则自动查找" /></label>
                        </div>
                      </details>
                      <div className="inline-actions" style={{ marginTop: 14 }}>
                        <button type="button" onClick={() => void runWorkerSetup({ showResultScreen: false })} disabled={busy !== null}>
                          {busy === "setup-worker" ? "安装中..." : "安装当前机器节点"}
                        </button>
                        <button type="button" className="ghost-button" onClick={() => void probeWorkerGateway()} disabled={busy !== null}>
                          {busy === "setup-gateway-probe" ? "检测中..." : "检测目标网关"}
                        </button>
                      </div>
                    </section>

                    <section className="surface node-role-surface">
                      <div className="section-head">
                        <div>
                          <div className="section-kicker">节点说明</div>
                          <h3>节点角色只配置当前机器，不纳管其它节点</h3>
                        </div>
                      </div>
                      <div className="inline-tip">
                        当前角色只负责这台机器自己的安装、回连、凭据与发现响应。扫描并纳管其它节点需要切回网关角色操作。
                      </div>
                      <div className="info-stack">
                        <InfoRow label="节点身份" value="远端工作节点（当前机器）" multiline />
                        <InfoRow label="目标网关地址" value={workerSetup.gateway_base_url || "未填写"} multiline />
                        <InfoRow label="网关连接状态" value={workerGatewayConnection.label} multiline />
                        <InfoRow label="连接详情" value={workerGatewayConnection.detail} multiline />
                        <InfoRow label="节点 ID" value={workerSetup.node_id || "未填写"} multiline />
                        <InfoRow label="配对密钥" value={workerSetup.pairing_key.trim() ? "已填写，可在上方显示/修改" : "未填写"} multiline />
                        {workerGatewayConnection.remoteNode ? <InfoRow label="网关侧节点记录" value={summarizeRemoteNode(workerGatewayConnection.remoteNode)} multiline /> : null}
                      </div>
                    </section>
                  </div>

                  <div className="connection-action-column">
                    <NodeModelConfigPanel
                      launcherAvailable={launcherAvailable}
                      busyKey={busy}
                      status={localNodeStatus}
                      runtimeSummary={localNodeRuntimeSummary}
                      gatewayControl={null}
                      eventPreview=""
                      draft={localNodeModelDraft}
                      onChange={updateLocalNodeModelDraft}
                      onRefresh={() => void refreshLocalNodeDiagnostics()}
                      onRestart={() => void restartLocalNodeService()}
                      onSave={() => void saveLocalNodeModelConfig()}
                      onExport={() => void exportLocalNodeDiagnostics()}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : workspace === "logs" ? (
          <LogsWorkspace
            currentRoleIsWorker={currentRoleIsWorker}
            workerConnectionLog={workerConnectionLog}
            runtimeLogEntries={runtimeLogEntries}
            runtimeLogsRefreshing={runtimeLogsRefreshing}
            pairingDebugViewEntries={pairingDebugViewEntries}
            onRefreshRuntimeLogs={() => void refreshRuntimeLogs()}
            onClearPairingDebugEntries={() => setPairingDebugEntries([])}
          />
        ) : (
          <SessionsWorkspace
            effectiveRole={effectiveRole}
            systemStatus={systemStatus}
            currentGatewayBaseUrl={currentGatewayBaseUrl}
            sessionsLoaded={sessionsLoaded}
            sessions={sessions}
            filteredSessions={filteredSessions}
            sessionFilter={sessionFilter}
            filters={FILTERS}
            counts={counts}
            selectedSessionId={selectedSessionId}
            selectedSession={selectedSession}
            sessionManualNodeId={sessionManualNodeId}
            sessionBindingOptions={sessionBindingOptions}
            messages={messages}
            messagesLoaded={messagesLoaded}
            typingState={typingState}
            channelReleaseHint={channelReleaseHint}
            latestUserMessage={latestUserMessage}
            latestBotMessage={latestBotMessage}
            wechatRuntimeSummaryValue={wechatRuntimeSummary.value}
            now={now}
            inspectorOpen={inspectorOpen}
            busyKey={busy}
            currentRoleIsWorker={currentRoleIsWorker}
            messagesRef={messagesRef}
            onGoToQuickSetup={() => setWorkspace("quick_setup")}
            onChangeFilter={setSessionFilter}
            onSelectSession={setSelectedSessionId}
            onMessageScroll={handleMessageStreamScroll}
            onOpenInspector={() => setInspectorOpen(true)}
            onCloseInspector={() => setInspectorOpen(false)}
            onChangeSessionManualNodeId={setSessionManualNodeId}
            onBindSessionNode={(sessionId) => void switchSessionNode(sessionId, "manual", sessionManualNodeId)}
            onRestoreSessionAuto={(sessionId) => void switchSessionNode(sessionId, "auto")}
          />
        )}
      </div>
      {(() => {
        const isPairingTimeout =
          pairingModalTaskId !== null &&
          pairingModalTask?.status !== "succeeded" &&
          pairingModalTask?.status !== "failed" &&
          now - pairingModalStartedAt > 30000;
        const pairingStatusText = isPairingTimeout
          ? "配对超时，请检查节点是否在线"
          : pairingModalTask?.status === "succeeded"
            ? "配对成功，节点已上线"
            : pairingModalTask?.status === "failed"
              ? (pairingModalTask.summary?.includes("密钥")
                  ? "配对失败：密钥错误，请检查配对密钥是否一致"
                  : pairingModalTask.summary?.includes("写入")
                    ? "配对失败：节点配置写入失败，请检查节点磁盘权限"
                    : `配对失败：${pairingModalTask.summary}`)
              : "正在连接节点...";
        return (
          <PairingStatusModal
            open={pairingModalTaskId !== null}
            statusText={pairingStatusText}
            showSpinner={(pairingModalTask?.status === "running" || pairingModalTask === null) && !isPairingTimeout}
            showActions={pairingModalTask?.status === "failed" || isPairingTimeout}
            onClose={closePairingModal}
          />
        );
      })()}
    </div>
  );
}

function syncSessions(next: SessionRecord[], setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>>, setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>, setActiveSession: React.Dispatch<React.SetStateAction<SessionRecord | null>>) {
  setSessions(next);
  setSelectedSessionId((current) => current && next.some((item) => item.session_id === current) ? current : (next[0]?.session_id ?? null));
  setActiveSession((current) => current ? (next.find((item) => item.session_id === current.session_id) ?? next[0] ?? null) : (next[0] ?? null));
}
function syncNodeState(
  next: NodeListResponse,
  setNodes: React.Dispatch<React.SetStateAction<NodeRecord[]>>,
  setNodeInventory: React.Dispatch<React.SetStateAction<NodeInventoryRecord[]>>,
  setNodeInventorySummary: React.Dispatch<React.SetStateAction<NodeInventorySummary>>,
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>,
  options?: { selectNode?: boolean },
) {
  setNodes(next.nodes);
  setNodeInventory(next.inventory);
  setNodeInventorySummary(next.summary);
  if (options?.selectNode === false) {
    setSelectedNodeId(null);
    return;
  }
  setSelectedNodeId((current) =>
    current && next.inventory.some((item) => item.node_id === current)
      ? current
      : null,
  );
}
function matchesFilter(session: SessionRecord, filter: SessionFilter, now: number) { return filter === "processing" ? session.queue_status !== "none" || Boolean(session.active_task_id) : filter === "human" ? session.status === "human_active" || session.status === "handoff_pending" : filter === "recent" ? isRecent(session, now) : true; }
function isRecent(session: SessionRecord, now: number) { const updatedAt = new Date(session.updated_at).getTime(); return !Number.isNaN(updatedAt) && now - updatedAt <= 30 * 60 * 1000; }
function getNodeAddress(node: NodeRecord) {
  if (node.advertised_address) return node.advertised_address;
  if (node.base_url && /^https?:\/\//i.test(node.base_url)) return node.base_url;
  if (node.lan_ip) return node.lan_ip;
  if (node.hostname) return node.hostname;
  return node.base_url || "未上报";
}
function getInventoryNodeAddress(node: NodeInventoryRecord) {
  if (node.advertised_address) return node.advertised_address;
  if (node.base_url && /^https?:\/\//i.test(node.base_url)) return node.base_url;
  if (node.lan_ip) return node.lan_ip;
  if (node.hostname) return node.hostname;
  return node.base_url || "暂未上报";
}
function roleName(role: SetupRole) {
  if (role === "gateway_host") return "网关主机";
  if (role === "gateway_host_console") return "网关主机+控制台";
  if (role === "worker_node") return "工作节点";
  return "控制台";
}
function isPairingTaskKind(kind: SetupTaskResult["kind"]) {
  return kind === "discovery_scan" || kind === "discovery_pair" || kind === "manual_pair" || kind === "gateway_probe";
}
function roleDescription(role: SetupRole) {
  if (role === "gateway_host") return "保存网关基础配置，并主动搜索局域网里已经运行的可配对节点。";
  if (role === "gateway_host_console") return "一次完成网关配置保存与控制台目标校验，适合本机同时承担主网关和运维控制台。";
  if (role === "worker_node") return "把这台机器配置成节点，重点完成本机安装、回连主网关、凭据维护与发现响应设置。";
  return "校验控制台要连接的主网关地址，适合纯观察和接管机器。";
}
function roleAction(role: SetupRole) {
  if (role === "gateway_host") return "会写入网关 .env、刷新微信运行配置，并通过 UDP 广播搜索候选节点。";
  if (role === "gateway_host_console") return "会先写入网关配置，再串行校验控制台目标网关地址，并把该地址保存为后续默认值。";
  if (role === "worker_node") return "会调用 install-claw-node.ps1，并把主网关地址、节点凭据、配对密钥和发现端口写入本机配置。";
  return "会验证目标主网关健康状态，不会安装任何服务。";
}
function workerEnvLocations(installDir: string) {
  if (!installDir.trim()) return "节点安装目录下的 bundle\\claw-node\\.env（或 bundle\\claw-node\\services\\claw-node\\.env）";
  return [
    `${installDir}\\bundle\\claw-node\\.env`,
    `${installDir}\\bundle\\claw-node\\services\\claw-node\\.env`,
  ].join("\n");
}
function previewContent(role: SetupRole, gateway: GatewaySetupConfig, worker: WorkerNodeSetupConfig, consoleConfig: ConsoleSetupConfig) {
  if (role === "gateway_host") return [
    `写入网关配置：Redis=${gateway.redis_url}`,
    `默认 Agent=${gateway.default_agent_id}`,
    `节点回连地址=${consoleConfig.gateway_base_url || "未填写"}`,
    `Dify=${gateway.dify_base_url || "未填写（将默认使用内置模型）"}`,
    `内置模型=${gateway.builtin_model_name || DEFAULT_BUILTIN_MODEL_LABEL}`,
    `微信 Base URL=${gateway.wechat_base_url}`,
    gateway.wechat_token ? "若 token 已填写，将尝试刷新微信运行配置。" : "本次不会刷新微信 token。",
    "保存成功后即可点击“搜索局域网节点”，对候选机器输入配对密钥完成连接。",
  ].join("\n");
  if (role === "gateway_host_console") return [
    `写入网关配置：Redis=${gateway.redis_url}`,
    `默认 Agent=${gateway.default_agent_id}`,
    `控制台目标网关=${consoleConfig.gateway_base_url || "未填写"}`,
    `Dify=${gateway.dify_base_url || "未填写（将默认使用内置模型）"}`,
    `内置模型=${gateway.builtin_model_name || DEFAULT_BUILTIN_MODEL_LABEL}`,
    `微信 Base URL=${gateway.wechat_base_url}`,
    gateway.wechat_token ? "若 token 已填写，将尝试刷新微信运行配置。" : "本次不会刷新微信 token。",
    "执行时会先保存网关配置，再校验控制台目标网关；若校验失败，不回滚已保存的网关配置。",
  ].join("\n");
  if (role === "worker_node") return [
    `安装当前机器节点，节点 ID=${worker.node_id}`,
    `连接局域网网关=${worker.gateway_base_url || "未填写"}`,
    `安装目录=${worker.install_dir}`,
    `最大并发=${worker.max_concurrency}`,
    "节点 Token=安装阶段不生成，将在配对时由网关自动下发",
    `配对密钥=${worker.pairing_key ? "已填写" : "未填写"}`,
    `发现响应=${worker.discovery_enabled ? `开启（UDP ${worker.discovery_port}）` : "关闭"}`,
    `Bundle=${worker.bundle_path || "自动查找常见路径；缺失时尝试现打包"}`,
  ].join("\n");
  return [
    `校验控制台目标网关=${consoleConfig.gateway_base_url}`,
    "成功后会把这个地址作为后续重配默认值保存。",
  ].join("\n");
}
function previewOutcome(role: SetupRole) {
  if (role === "gateway_host") return "保存后的配置会体现在快速配置档案中；部分运行时配置会即时应用，仍建议重启网关确认最终状态。";
  if (role === "gateway_host_console") return "成功后会同时记录网关配置和控制台默认网关地址；若控制台校验失败，会保留已保存的网关配置并在结果页提示失败原因。";
  if (role === "worker_node") return "成功后会返回当前机器节点的安装日志、节点 ID、主网关回连信息和安装目录；失败时保留错误摘要，便于重试。";
  return "成功后会记录控制台默认网关地址，并可继续进入接入中心或会话观察台。";
}
function pairingStatusLabel(status: PairingStatus) {
  return status === "paired"
    ? "已确认连接"
    : status === "paired_pending_confirm"
    ? "待确认"
    : status === "register_failed"
    ? "注册失败"
    : status === "auth_failed"
    ? "密钥错误"
    : status === "already_paired"
    ? "已纳管"
    : status === "offline"
    ? "离线"
    : "待连接";
}
function pairingStatusTone(status: PairingStatus) {
  return status === "paired"
    ? "human"
    : status === "paired_pending_confirm" || status === "already_paired"
    ? "typing"
    : status === "register_failed" || status === "auth_failed"
    ? "queued"
    : "idle";
}
function nodeRoleLabel(nodeId: string, nodeKind?: NodeKind) {
  if (nodeKind === "local") return "网关内置节点";
  if (nodeKind === "remote") return "远端工作节点";
  return nodeId === "local-node" || nodeId.startsWith("claw-node-local") ? "网关内置节点" : "远端工作节点";
}
function nodeInventoryBadgeLabel(connectionState: NodeInventoryConnectionState, paired: boolean) {
  if (connectionState === "connected") return "在线";
  if (connectionState === "pairing_pending") return "待确认";
  if (connectionState === "register_failed" || connectionState === "auth_failed") return "异常";
  if (connectionState === "paired_offline") return "离线";
  return paired ? "离线" : "未纳管";
}
function nodeInventoryBadgeTone(connectionState: NodeInventoryConnectionState) {
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
function describeInventoryConnection(node: NodeInventoryRecord) {
  if (node.connection_state === "connected") return node.status || "healthy";
  if (node.connection_state === "pairing_pending") return node.last_error || "已下发配置，等待注册确认";
  if (node.connection_state === "register_failed") return node.last_error || "注册失败";
  if (node.connection_state === "auth_failed") return node.last_error || "鉴权失败，需要重新配对";
  if (node.connection_state === "paired_offline") return node.last_error || "暂未上报";
  return node.status || "未纳管";
}
function resolveInventoryNodePresentation(node: NodeInventoryRecord, localNodeStatus: LocalNodeStatusResponse | null, launcherStatus: LauncherStatusResponse | null) {
  if (node.node_kind !== "local" || node.node_id !== "local-node") {
    return {
      badge: nodeInventoryBadgeLabel(node.connection_state, node.paired),
      tone: nodeInventoryBadgeTone(node.connection_state),
      detail: describeInventoryConnection(node),
    };
  }
  const runtime = summarizeLocalNodeRuntime(localNodeStatus, launcherStatus);
  const tone = runtime.tone === "good" ? "human" : "queued";
  return {
    badge: runtime.label,
    tone,
    detail: runtime.detail,
  };
}
function summarizeRemoteNode(node: NodeInventoryRecord | NodeRecord) {
  return [
    `${node.hostname || node.node_id}（${nodeRoleLabel(node.node_id, "node_kind" in node ? node.node_kind : undefined)}）`,
    node.lan_ip || "未上报 IP",
    node.last_error || node.status || "未上报状态",
    node.last_heartbeat_at ? formatTimeLabel(node.last_heartbeat_at, true) : "暂无心跳",
  ].join(" · ");
}
function looksLikeGatewayAuthFailure(detail: string) {
  const normalized = detail.toLowerCase();
  return ["401 unauthorized", "unauthorized", "invalid node token", "node token is not configured"].some((marker) => normalized.includes(marker));
}
function gatewayTokenMismatchHint(nodeId: string) {
  return `请核对目标网关 ${GATEWAY_NODE_TOKEN_LOCATION} 中 ${nodeId} 对应的 token，是否与当前节点保存的一致。`;
}
function pairingDebugStatusLabel(status: PairingDebugEntry["status"]) { return status === "succeeded" ? "成功" : status === "running" ? "进行中" : status === "pending" ? "等待中" : "失败"; }
function launcherEnvironmentLabel(name: string) {
  return name === "python" ? "Python 运行时" : name === "node_install_script" ? "节点安装脚本" : name === "node_bundle" ? "节点 bundle" : name === "winsw" ? "Windows 服务包装器" : name;
}
function launcherComponentName(name: string) { return name === "host-redis" ? "主机 Redis" : name === "node-cache-redis" ? "节点缓存 Redis" : name === "gateway" ? "主网关" : name === "local-node" ? "本机 Claw 节点" : name === "console" ? "控制台" : name === "launcher" ? "桌面启动器" : name; }
function launcherStateLabel(state: LauncherState) { return state === "running" ? "运行中" : state === "starting" ? "启动中" : state === "degraded" ? "降级" : state === "failed" ? "失败" : "已停止"; }
function launcherBadgeTone(state: LauncherState) { return state === "running" ? "human" : state === "starting" ? "typing" : state === "degraded" ? "queued" : state === "failed" ? "queued" : "idle"; }
function shouldUseFastPolling(session: SessionRecord | null) { return !!session && (session.queue_status === "pending" || session.queue_status === "inflight" || Boolean(session.active_task_id)); }
function formatTimeLabel(value: string, withSeconds = false) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined }); }
