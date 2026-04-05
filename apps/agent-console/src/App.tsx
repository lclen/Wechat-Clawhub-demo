import { useEffect, useMemo, useRef, useState } from "react";
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

type ModelStatus = { configured: boolean; base_url: string; model: string };
type SystemStatus = { app_name: string; environment: string; version: string; redis_ok: boolean; dify_configured: boolean; wechat_configured: boolean; active_nodes: number; dispatch_mode_enabled: boolean; gateway_bind_host: string; preferred_lan_ip: string | null; preferred_gateway_base_url: string; timestamp: string };
type ModelCheck = { ok: boolean; configured_model: string; available_models: string[]; configured_model_available: boolean };
type WeChatStatus = { configured: boolean; running: boolean; base_url: string; has_token: boolean; last_error: string | null; received_messages: number; sent_messages: number };
type SessionStatus = "bot_active" | "handoff_pending" | "human_active" | "closing";
type QueueStatus = "none" | "pending" | "inflight";
type RoutingMode = "auto" | "manual";
type SessionRecord = { session_id: string; channel: string; user_id: string; agent_id: string; status: SessionStatus; assigned_node_id: string | null; assigned_slot_id: string | null; active_task_id: string | null; queue_status: QueueStatus; context_summary: string; context_version: number; routing_mode: RoutingMode; slot_bound_at: string | null; slot_expires_at: string | null; reply_context_token: string | null; handoff_ticket_id: string | null; claimed_by: string | null; message_count: number; last_message_at: string; last_dispatch_at: string | null; created_at: string; updated_at: string; version: number };
type MessageRecord = { message_id: string; session_id: string; channel: string; user_id: string; role: "user" | "bot" | "human" | "system"; content: string; created_at: string; actor_id: string | null; node_id: string | null; metadata: Record<string, string> };
type NodeRecord = { node_id: string; base_url: string; advertised_address: string | null; lan_ip: string | null; max_concurrency: number; current_load: number; status: string; last_heartbeat_at: string; updated_at: string; last_error: string | null; load_ratio: number; node_version: string | null; platform: string | null; hostname: string | null; capabilities: string[]; channel_capacity: number; channel_in_use: number };
type NodeKind = "local" | "remote";
type NodeInventoryConnectionState = "connected" | "pairing_pending" | "register_failed" | "auth_failed" | "paired_offline" | "online_unpaired";
type NodeInventoryRecord = { node_id: string; node_kind: NodeKind; paired: boolean; online: boolean; connection_state: NodeInventoryConnectionState; status: string | null; last_heartbeat_at: string | null; updated_at: string | null; hostname: string | null; lan_ip: string | null; platform: string | null; node_version: string | null; advertised_address: string | null; last_error: string | null; base_url: string | null; max_concurrency: number | null; current_load: number | null; channel_capacity: number | null; channel_in_use: number | null; last_pairing_trace_id: string | null; last_register_result: string | null; last_register_at: string | null; last_auth_failure_at: string | null };
type NodeInventorySummary = { paired_total: number; online_total: number; offline_total: number };
type NodeListResponse = { nodes: NodeRecord[]; inventory: NodeInventoryRecord[]; summary: NodeInventorySummary };
type NodeDiagnosticsEvent = { timestamp: string; level: string; category: string; result: string; message: string; trace_id: string; metadata: Record<string, string> };
type NodeDiagnosticsRecord = { node_id: string; node_kind: NodeKind; connection_state: NodeInventoryConnectionState; last_error: string; last_pairing_trace_id: string; last_pairing_status: string; last_pairing_at: string | null; last_register_result: string; last_register_at: string | null; last_heartbeat_result: string; last_heartbeat_at: string | null; last_auth_failure_at: string | null; last_auth_decision: string; last_auth_client_host: string; last_auth_path: string; expected_token_masked: string; provided_token_masked: string; timeline: NodeDiagnosticsEvent[] };
type NodeDiagnosticsResponse = { node_id: string; diagnostics: NodeDiagnosticsRecord };
type NodeDiagnosticsStreamEnvelope = { type: "diagnostics_snapshot"; node_id: string; diagnostics: NodeDiagnosticsRecord };
type SessionsResponse = { sessions: SessionRecord[] };
type SessionMessagesResponse = { session: SessionRecord; messages: MessageRecord[]; next_cursor: number; replace_messages: boolean };
type SessionStreamEnvelope = SessionMessagesResponse & { type: "snapshot" | "messages_appended" };
type SessionOverviewEnvelope = { type: "sessions_snapshot"; sessions: SessionRecord[] };
type GatewaySummaryEnvelope = { type: "gateway_summary"; summary: { system: SystemStatus; wechat: WeChatStatus; nodes: NodeListResponse } };
type SessionMessageCacheEntry = {
  session: SessionRecord | null;
  messages: MessageRecord[];
  cursor: number;
  loaded: boolean;
  lastLoadedAt: number;
};
type SessionSwitchResponse = { ok: boolean; session: SessionRecord; detail: string };
type QrStart = { qrcode: string; qrcode_url: string };
type PollResponse = { status: string; token?: string; base_url?: string; message?: string; bot_id?: string; user_id?: string };
type SetupRole = "gateway_host" | "gateway_host_console" | "worker_node" | "console_only";
type SetupTaskStatus = "pending" | "running" | "succeeded" | "failed";
type GatewaySetupConfig = { redis_url: string; default_agent_id: string; dify_base_url: string; dify_api_key: string; builtin_model_base_url: string; builtin_model_api_key: string; builtin_model_name: string; wechat_base_url: string; wechat_token: string; dispatch_mode_enabled: boolean };
type WorkerNodeSetupConfig = { node_id: string; gateway_base_url: string; node_token: string; pairing_key: string; dify_base_url: string; dify_api_key: string; max_concurrency: number; install_dir: string; bundle_path: string; discovery_enabled: boolean; discovery_port: number };
type ConsoleSetupConfig = { gateway_base_url: string };
type PairingStatus = "pending" | "paired" | "paired_pending_confirm" | "register_failed" | "auth_failed" | "already_paired" | "offline";
type DiscoveredNodeRecord = { discovery_id: string; node_id: string | null; pairing_label: string | null; hostname: string; lan_ip: string | null; platform: string | null; node_version: string | null; capabilities: string[]; advertised_address: string | null; pairing_required: boolean; already_paired: boolean; pairing_port: number; last_seen_at: string };
type SetupTaskResult = { task_id: string; kind: "gateway_save" | "gateway_console_setup" | "node_install" | "console_connect" | "gateway_probe" | "discovery_scan" | "discovery_pair" | "manual_pair"; status: SetupTaskStatus; title: string; created_at: string; updated_at: string; summary: string; logs: string[]; metadata: Record<string, string> };
type SetupProfileResponse = { recommended_workspace: "quick_setup" | "connection" | "sessions"; setup_completed: boolean; completed_roles: SetupRole[]; available_roles: SetupRole[]; preferred_gateway_base_url: string; gateway: GatewaySetupConfig; console: ConsoleSetupConfig; last_task: SetupTaskResult | null };
type GatewaySetupSaveResponse = { task: SetupTaskResult; restart_required: boolean; applied_runtime: string[] };
type GatewaySetupSaveRequest = { config: GatewaySetupConfig; console_gateway_base_url?: string };
type GatewayConsoleSetupRequest = { gateway: GatewaySetupConfig; console: ConsoleSetupConfig };
type GatewayProbeRequest = { gateway_base_url: string; node_id?: string; timeout_ms?: number };
type NodeCredentialResetRequest = { node_id: string; install_dir: string };
type SetupTaskEnvelope = { task: SetupTaskResult };
type NodeDeleteResponse = { ok: boolean; node_id: string; removed_pairing: boolean; removed_runtime: boolean; detail: string };
type DiscoveryScanResponse = { task: SetupTaskResult; nodes: DiscoveredNodeRecord[] };
type DiscoveryPairResponse = { task: SetupTaskResult; pairing_status: PairingStatus; node_id: string | null };
type ManualPairRequest = { host: string; pairing_port: number; pairing_key: string; gateway_base_url: string; node_id?: string };
type LauncherState = "stopped" | "starting" | "running" | "degraded" | "failed";
type LauncherRedisSource = "github" | "mirror";
type LauncherNodeCachePolicy = "disabled" | "optional" | "enabled";
type LauncherMachineRole = "gateway" | "node" | "console" | "gateway_console";
type LauncherComponentStatus = { name: string; state: LauncherState; pid: number | null; detail: string; error_code: string; started_at: string | null; log_path: string | null };
type LauncherProfile = { workdir: string; gateway_port: number; gateway_base_url?: string; launcher_port: number; host_redis_port: number; node_cache_redis_port: number; enable_local_node: boolean; enable_gateway: boolean; node_cache_policy: LauncherNodeCachePolicy; dispatch_mode_enabled: boolean; redis_source: LauncherRedisSource; node_cache_redis_source: LauncherRedisSource; bootstrap_completed: boolean };
type LauncherRuntimeModel = { machine_role: LauncherMachineRole; gateway_should_run: boolean; host_redis_should_run: boolean; local_node_should_run: boolean; node_cache_should_run: boolean; runtime_authority: string };
type LauncherWorkdirLayout = { root: string; host_redis_dir: string; transcript_dir: string; identity_dir: string; memory_dir: string; log_dir: string; runtime_dir: string; config_dir: string; node_cache_dir: string };
type LauncherRedisInstallState = { installed: boolean; source: LauncherRedisSource; archive_path: string; executable_path: string; version: string; detail: string };
type LauncherEnvironmentCheck = { name: string; ready: boolean; detail: string };
type LauncherEnvironmentStatus = { ready: boolean; python_version: string; checks: LauncherEnvironmentCheck[] };
type LauncherStatusResponse = { profile: LauncherProfile; runtime_model: LauncherRuntimeModel; layout: LauncherWorkdirLayout; host_redis: LauncherRedisInstallState; node_cache_redis: LauncherRedisInstallState; environment: LauncherEnvironmentStatus; components: LauncherComponentStatus[]; local_lan_ip: string };
type LauncherStartRequest = { machine_role?: LauncherMachineRole; enable_local_node?: boolean; enable_gateway?: boolean; enable_node_cache_redis: boolean; dispatch_mode_enabled: boolean; redis_source: LauncherRedisSource; node_cache_redis_source: LauncherRedisSource };
type LauncherLogResponse = { component: string; log_path: string | null; content: string };
type LocalNodeModelConfig = { model_provider: string; openai_base_url: string; openai_model: string; openai_enable_thinking: boolean; openai_api_key_configured: boolean; dify_base_url: string; dify_api_key_configured: boolean };
type LocalNodeModelConfigRequest = { model_provider: string; openai_base_url: string; openai_api_key: string; openai_model: string; openai_enable_thinking: boolean; dify_base_url: string; dify_api_key: string; restart_service: boolean };
type LocalNodeStatusResponse = { service_name: string; state: string; pid: number | null; node_kind: NodeKind; config_path: string; diagnostics_path: string; install_dir: string; detail: string; service_state: string; runtime_state: string; last_register_result: string; last_register_error: string; last_register_at: string | null; diagnostics: Record<string, unknown>; model_settings: LocalNodeModelConfig };
type LocalNodeLogsResponse = { service_name: string; event_log_path: string | null; service_log_path: string | null; wrapper_log_path: string | null; event_log: string; service_log: string; wrapper_log: string };
type LocalNodeActionResponse = { ok: boolean; detail: string; status: LocalNodeStatusResponse };
type LocalNodeExportResponse = { ok: boolean; export_path: string; detail: string };
type WorkspaceTab = "quick_setup" | "sessions" | "connection";
type SessionFilter = "all" | "processing" | "human" | "recent";
type SetupMode = "status" | "role" | "config" | "preview" | "result";
type LauncherComponentName = "host-redis" | "gateway" | "local-node" | "node-cache-redis";
type ManualPairDraft = { host: string; pairing_port: number; pairing_key: string; node_id: string };
type PairingDebugEntry = {
  id: string;
  kind: "discovery_scan" | "discovery_pair" | "manual_pair" | "gateway_probe" | "node_install" | "client_error";
  title: string;
  status: SetupTaskStatus | "failed";
  summary: string;
  logs: string[];
  target: string;
  updated_at: string;
};
type WorkerGatewayConnectionState =
  | "idle"
  | "gateway_unreachable"
  | "gateway_reachable_node_missing"
  | "gateway_reachable_node_pending_confirm"
  | "gateway_reachable_node_register_failed"
  | "gateway_reachable_node_connected";

type AppUiStateCache = {
  workspace: WorkspaceTab | null;
  selected_session_id: string | null;
  selected_node_id: string | null;
};

type AppSummaryStateCache = {
  wechat_status: WeChatStatus | null;
  node_list: NodeListResponse | null;
  sessions: SessionRecord[];
};

const FAST_POLL_MS = 1200;
const IDLE_POLL_MS = 3200;
const RETRY_POLL_MS = 1000; // backend unreachable — retry quickly
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
  dify_base_url: "",
  dify_api_key: "",
  restart_service: true,
};

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
      parsed.workspace === "quick_setup" || parsed.workspace === "sessions" || parsed.workspace === "connection"
        ? parsed.workspace
        : loadPersistedWorkspace();
    return {
      workspace,
      selected_session_id: typeof parsed.selected_session_id === "string" ? parsed.selected_session_id : null,
      selected_node_id: typeof parsed.selected_node_id === "string" ? parsed.selected_node_id : null,
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
    return { wechat_status: null, node_list: null, sessions: [] };
  }
  try {
    const raw = window.localStorage.getItem(SUMMARY_STATE_CACHE_KEY);
    if (!raw) return { wechat_status: null, node_list: null, sessions: [] };
    const parsed = JSON.parse(raw) as Partial<AppSummaryStateCache>;
    return {
      wechat_status: parsed.wechat_status ?? null,
      node_list: parsed.node_list ?? null,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { wechat_status: null, node_list: null, sessions: [] };
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
  if (runtime.local_node_should_run) parts.push("local-node");
  if (runtime.node_cache_should_run) parts.push("node-cache-redis");
  return parts.length ? parts.join(" / ") : "当前角色不托管本地后端组件";
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
  options?: { dispatchModeEnabled?: boolean; enableNodeCacheRedis?: boolean },
): LauncherStartRequest {
  const dispatchModeEnabled = options?.dispatchModeEnabled ?? (launcherStatus?.profile.dispatch_mode_enabled ?? false);
  const enableNodeCacheRedis = options?.enableNodeCacheRedis
    ?? ((launcherStatus?.profile.node_cache_policy !== "disabled") && launcherRoleUsesLocalNode(machineRole) && !dispatchModeEnabled);
  return {
    machine_role: machineRole,
    enable_node_cache_redis: enableNodeCacheRedis,
    dispatch_mode_enabled: dispatchModeEnabled,
    redis_source: launcherStatus?.profile.redis_source || "mirror",
    node_cache_redis_source: launcherStatus?.profile.node_cache_redis_source || "mirror",
  };
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
  const [localNodeModelDraft, setLocalNodeModelDraft] = useState<LocalNodeModelConfigRequest>(DEFAULT_LOCAL_NODE_MODEL_CONFIG);
  const [localNodeModelDirty, setLocalNodeModelDirty] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [modelCheck, setModelCheck] = useState<ModelCheck | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [wechatStatus, setWechatStatus] = useState<WeChatStatus | null>(initialSummaryState.wechat_status);
  const [nodes, setNodes] = useState<NodeRecord[]>(initialSummaryState.node_list?.nodes ?? []);
  const [nodeInventory, setNodeInventory] = useState<NodeInventoryRecord[]>(initialSummaryState.node_list?.inventory ?? []);
  const [nodeInventorySummary, setNodeInventorySummary] = useState<NodeInventorySummary>(initialSummaryState.node_list?.summary ?? { paired_total: 0, online_total: 0, offline_total: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialUiState.selected_node_id);
  const [selectedNodeDiagnostics, setSelectedNodeDiagnostics] = useState<NodeDiagnosticsRecord | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>(initialSummaryState.sessions);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialUiState.selected_session_id);
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(
    initialUiState.selected_session_id
      ? initialSummaryState.sessions.find((item) => item.session_id === initialUiState.selected_session_id) ?? initialSummaryState.sessions[0] ?? null
      : initialSummaryState.sessions[0] ?? null,
  );
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(initialSummaryState.sessions.length > 0);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [messageCursor, setMessageCursor] = useState<number>(0);
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
  const sessionMessageCacheRef = useRef<Map<string, SessionMessageCacheEntry>>(new Map());
  const effectiveRole = resolveEffectiveRole(setupRole, setupProfile?.completed_roles ?? []);
  const currentRoleIsWorker = isWorkerRole(effectiveRole);
  const currentRoleIsConsole = isConsoleRole(effectiveRole);
  const runtimeMachineRole = launcherMachineRoleValue(launcherStatus);
  const localGatewayManaged = launcherAvailable ? launcherShouldRunGateway(launcherStatus) : null;
  const shouldUseLocalGatewayApi = localGatewayManaged !== false;
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
          selected_node_id: selectedNodeId,
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
          wechat_status: wechatStatus,
          node_list: { nodes, inventory: nodeInventory, summary: nodeInventorySummary },
          sessions: sessions.slice(0, 50),
        } satisfies AppSummaryStateCache),
      );
    } catch {
      // summary cache is best-effort
    }
  }, [nodeInventory, nodeInventorySummary, nodes, sessions, wechatStatus]);

  useEffect(() => {
    if (!workerSetup.pairing_key.trim()) return;
    setManualPair((current) => (current.pairing_key.trim() ? current : { ...current, pairing_key: workerSetup.pairing_key.trim() }));
  }, [workerSetup.pairing_key]);

  useEffect(() => {
    if (!currentRoleIsWorker) return;
    // 节点角色下 live poll 已自动更新探测状态，不需要单独触发
    if (!launcherShouldRunGateway(launcherStatus)) return;
    const gatewayBaseUrl = workerSetup.gateway_base_url.trim();
    const nodeId = workerSetup.node_id.trim();
    if (!gatewayBaseUrl || !nodeId || busy === "setup-gateway-probe") return;
    const probeKey = `${gatewayBaseUrl}::${nodeId}`;
    if (workerGatewayAutoProbeKeyRef.current === probeKey) return;
    const timer = window.setTimeout(() => {
      void probeWorkerGateway({ silent: true, reason: "auto" });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [busy, currentRoleIsWorker, launcherStatus, workerSetup.gateway_base_url, workerSetup.node_id]);

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
    let cancelled = false;
    requestJson<LauncherStatusResponse>("/local/bootstrap/status")
      .then((status) => {
        if (cancelled) return;
        setLauncherStatus(status);
        setLauncherAvailable(true);
      })
      .catch(() => {
        if (!cancelled) setLauncherAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          setLocalNodeModelDraft({
            model_provider: status.model_settings?.model_provider || "auto",
            openai_base_url: status.model_settings?.openai_base_url || "",
            openai_api_key: "",
            openai_model: status.model_settings?.openai_model || "",
            openai_enable_thinking: Boolean(status.model_settings?.openai_enable_thinking),
            dify_base_url: status.model_settings?.dify_base_url || "",
            dify_api_key: "",
            restart_service: true,
          });
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
          setLauncherStatus(launcherSt);
          setLauncherAvailable(true);
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

        const [system, profile] = await Promise.all([
          requestJson<SystemStatus>("/api/system/status"),
          requestJson<SetupProfileResponse>("/api/setup/profile"),
        ]);
        if (cancelled) return;
        const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, system);
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
          gateway_base_url: resolveWorkerGatewayBaseUrl(current.gateway_base_url, profile, system),
          dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
          dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
        }));
        setSystemStatus(system);
        setNotice(
          profile.recommended_workspace === "quick_setup"
            ? "检测到这是首次启动，先完成快速配置。"
            : system.redis_ok
              ? "主网关在线，正在加载微信、节点和会话概览…"
              : "主网关已启动，但 Redis 当前不可用。",
        );

        void Promise.allSettled([
          requestJson<ModelStatus>("/api/models/builtin/status").then((model) => {
            if (cancelled) return;
            setModelStatus(model);
          }),
          requestJson<WeChatStatus>("/api/wechat/onboard/status").then((wechat) => {
            if (cancelled) return;
            if (wechat.base_url) setWechatBaseUrl(wechat.base_url);
            setWechatStatus(wechat);
          }),
          requestJson<NodeListResponse>("/api/nodes").then((nodeList) => {
            if (cancelled) return;
            syncNodeStateView(nodeList);
          }),
          requestJson<SessionsResponse>("/api/sessions").then((sessionList) => {
            if (cancelled) return;
            syncSessions(sessionList.sessions, setSessions, setSelectedSessionId, setActiveSession);
            setSessionsLoaded(true);
            setNotice(
              profile.recommended_workspace === "quick_setup"
                ? "检测到这是首次启动，先完成快速配置。"
                : system.redis_ok
                  ? (sessionList.sessions.length ? "主网关在线。默认进入会话观察台。" : "主网关在线。可以先在接入中心做模型检测。")
                  : "主网关已启动，但 Redis 当前不可用。",
            );
          }),
        ]);
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
    options?: { remoteGateway?: string | null; afterCount?: number; limit?: number; fallbackToFull?: boolean },
  ) {
    const remoteGateway = options?.remoteGateway?.trim() || "";
    const afterCount = options?.afterCount ?? 0;
    const limit = options?.limit;
    const params = new URLSearchParams();
    if (afterCount > 0) params.append("after_count", String(afterCount));
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

  function syncSessionMessageCache(
    sessionId: string,
    detail: SessionMessagesResponse,
    options?: { preserveExisting?: boolean },
  ) {
    const current = sessionMessageCacheRef.current.get(sessionId);
    const nextMessages =
      options?.preserveExisting && current?.loaded && !detail.replace_messages
        ? mergeMessages(current.messages, detail.messages)
        : detail.replace_messages
          ? detail.messages
          : mergeMessages(current?.messages ?? [], detail.messages);
    const entry: SessionMessageCacheEntry = {
      session: detail.session,
      messages: nextMessages,
      cursor: detail.next_cursor,
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
    setMessagesLoaded(entry.loaded);
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
    const usesRemoteGateway = currentRoleIsWorker || (currentRoleIsConsole && localGatewayManaged === false);
    const remoteGateway = usesRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    if (localGatewayManaged === false && !usesRemoteGateway) {
      setGatewaySummaryStreamActive(false);
      return;
    }
    if (usesRemoteGateway && !remoteGateway) {
      setGatewaySummaryStreamActive(false);
      return;
    }
    if (!usesRemoteGateway && localGatewayManaged === null) {
      setGatewaySummaryStreamActive(false);
      return;
    }

    const connect = () => {
      if (cancelled) return;
      try {
        socket = new WebSocket(buildGatewaySummaryWebSocketUrl(remoteGateway));
      } catch {
        setGatewaySummaryStreamActive(false);
        reconnectTimer = window.setTimeout(connect, RETRY_POLL_MS);
        return;
      }

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
        setSystemStatus(payload.summary.system);
        if (payload.summary.wechat.base_url) setWechatBaseUrl(payload.summary.wechat.base_url);
        setWechatStatus(payload.summary.wechat);
        syncNodeStateView(payload.summary.nodes);
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
        reconnectTimer = window.setTimeout(connect, RETRY_POLL_MS);
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
  }, [currentRoleIsConsole, currentRoleIsWorker, localGatewayManaged, sessionRemoteGatewayBaseUrl, sessionRemoteNodeId]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const run = async () => {
      if (gatewaySummaryStreamActive) {
        return;
      }
      if (workspace === "sessions") {
        return;
      }
      if (currentRoleIsWorker) {
        const remoteGateway = sessionRemoteGatewayBaseUrl;
        const nodeId = sessionRemoteNodeId;
        if (!remoteGateway || !nodeId) return;
        let failed = false;
        try {
          const nodeResp = await requestJson<NodeListResponse>(`${remoteGateway}/api/nodes`).catch(() => null);
          if (cancelled) return;
          // 更新节点连接状态
          if (nodeResp) {
            const allNodes: NodeRecord[] = nodeResp.nodes || nodeResp || [];
            const matched = allNodes.find((n: NodeRecord) => n.node_id === nodeId);
            // Update nodes state so workerGatewayConnection.remoteNode gets populated
            syncNodeStateView({ nodes: allNodes, inventory: [], summary: { paired_total: 0, online_total: allNodes.length, offline_total: 0 } });
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
          if (!cancelled) timer = window.setTimeout(() => void run(), failed ? RETRY_POLL_MS : IDLE_POLL_MS);
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
          const [wechat, nodeList] = await Promise.all([
            requestJson<WeChatStatus>(`${remoteGateway}/api/wechat/onboard/status`).catch(() => null),
            requestJson<NodeListResponse>(`${remoteGateway}/api/nodes`).catch(() => null),
          ]);
          if (cancelled) return;
          if (wechat) {
            if (wechat.base_url) setWechatBaseUrl(wechat.base_url);
            setWechatStatus(wechat);
          }
          if (nodeList) syncNodeStateView(nodeList);
        } catch {
          failed = true;
        } finally {
          if (!cancelled) timer = window.setTimeout(() => void run(), failed ? RETRY_POLL_MS : IDLE_POLL_MS);
        }
        return;
      }
      if (localGatewayManaged === null) { timer = window.setTimeout(() => void run(), 500); return; }
      let failed = false;
      try {
        const [wechat, nodeList] = await Promise.all([
          requestJson<WeChatStatus>("/api/wechat/onboard/status"),
          requestJson<NodeListResponse>("/api/nodes"),
        ]);
        if (cancelled) return;
        if (wechat.base_url) setWechatBaseUrl(wechat.base_url);
        setWechatStatus(wechat);
        syncNodeStateView(nodeList);
      } catch {
        failed = true;
        // keep live polling resilient
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void run(), failed ? RETRY_POLL_MS : IDLE_POLL_MS);
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

    let cancelled = false;
    let reconnectTimer = 0;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      try {
        socket = new WebSocket(buildSessionOverviewWebSocketUrl(remoteGateway));
      } catch {
        reconnectTimer = window.setTimeout(connect, RETRY_POLL_MS);
        return;
      }

      socket.onmessage = (event) => {
        if (cancelled) return;
        let payload: SessionOverviewEnvelope;
        try {
          payload = JSON.parse(event.data) as SessionOverviewEnvelope;
        } catch {
          return;
        }
        if (payload.type !== "sessions_snapshot" || !Array.isArray(payload.sessions)) return;
        const nextSessions = currentRoleIsWorker
          ? payload.sessions.filter((session) => session.assigned_node_id === sessionRemoteNodeId)
          : payload.sessions;
        syncSessions(nextSessions, setSessions, setSelectedSessionId, setActiveSession);
        setSessionsLoaded(true);
      };

      socket.onclose = () => {
        if (cancelled) return;
        reconnectTimer = window.setTimeout(connect, RETRY_POLL_MS);
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
    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // ignore teardown close errors
      }
    };
  }, [currentRoleIsConsole, currentRoleIsWorker, localGatewayManaged, sessionRemoteGatewayBaseUrl, sessionRemoteNodeId, workspace]);

  useEffect(() => {
    shouldAutoFollowMessagesRef.current = true;
    if (!selectedSessionId) {
      setActiveSession(null);
      setMessages([]);
      setMessageCursor(0);
      setMessagesLoaded(true);
      return;
    }
    const cached = getSessionMessageCache(selectedSessionId);
    if (cached?.loaded) {
      setActiveSession(cached.session ?? sessions.find((item) => item.session_id === selectedSessionId) ?? null);
      setMessages(cached.messages);
      setMessageCursor(cached.cursor);
      setMessagesLoaded(true);
      return;
    }
    setActiveSession(sessions.find((item) => item.session_id === selectedSessionId) ?? null);
    setMessages([]);
    setMessageCursor(0);
    setMessagesLoaded(false);
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (workspace !== "sessions") return;
    if (!selectedSessionId) return;
    const remoteGateway = sessionRemoteGatewayBaseUrl;
    const usesRemoteGateway = currentRoleIsWorker || (currentRoleIsConsole && !launcherShouldRunGateway(launcherStatus));
    if (usesRemoteGateway && !remoteGateway) return;

    let cancelled = false;
    let httpTimer = 0;
    let reconnectTimer = 0;
    let socket: WebSocket | null = null;
    let socketReady = false;
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
        const entry = syncSessionMessageCache(sessionId, detail, { preserveExisting: preferIncremental });
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
        return;
      }
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
        const entry = syncSessionMessageCache(
          sessionId,
          {
            session: payload.session,
            messages: payload.messages,
            next_cursor: payload.next_cursor,
            replace_messages: payload.replace_messages,
          },
          { preserveExisting: payload.type === "messages_appended" },
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
        }, 3000);
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
  }, [currentRoleIsConsole, currentRoleIsWorker, launcherStatus, localGatewayManaged, selectedSessionId, sessionRemoteGatewayBaseUrl, workspace]);

  useEffect(() => {
    if (workspace !== "connection" || !selectedNodeId) {
      setSelectedNodeDiagnostics(null);
      return;
    }
    const useRemoteGateway = currentRoleIsConsole && !launcherShouldRunGateway(launcherStatus);
    const remoteGateway = useRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    if (useRemoteGateway && !remoteGateway) return;
    if (!useRemoteGateway && !launcherShouldRunGateway(launcherStatus)) return;
    let cancelled = false;
    let timer = 0;
    let reconnectTimer = 0;
    let socket: WebSocket | null = null;

    const scheduleHttpFallback = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const detail = await requestJson<NodeDiagnosticsResponse>(
            useRemoteGateway
              ? `${remoteGateway}/api/nodes/${encodeURIComponent(selectedNodeId)}/diagnostics`
              : `/api/nodes/${encodeURIComponent(selectedNodeId)}/diagnostics`,
          );
          if (!cancelled) setSelectedNodeDiagnostics(detail.diagnostics);
        } catch {
          if (!cancelled) setSelectedNodeDiagnostics(null);
        }
      }, 200);
    };

    const connect = () => {
      if (cancelled) return;
      try {
        socket = new WebSocket(buildNodeDiagnosticsWebSocketUrl(selectedNodeId, remoteGateway));
      } catch {
        scheduleHttpFallback();
        reconnectTimer = window.setTimeout(connect, RETRY_POLL_MS);
        return;
      }

      socket.onmessage = (event) => {
        if (cancelled) return;
        let payload: NodeDiagnosticsStreamEnvelope;
        try {
          payload = JSON.parse(event.data) as NodeDiagnosticsStreamEnvelope;
        } catch {
          return;
        }
        if (payload.type !== "diagnostics_snapshot" || payload.node_id !== selectedNodeId) return;
        setSelectedNodeDiagnostics(payload.diagnostics);
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
        reconnectTimer = window.setTimeout(connect, RETRY_POLL_MS);
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
  }, [currentRoleIsConsole, launcherStatus, selectedNodeId, sessionRemoteGatewayBaseUrl, workspace]);

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
      await withBusy(
        "launcher-start",
        () => requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify(buildLauncherStartPayload(launcherStatus, targetMachineRole, {
            dispatchModeEnabled: gatewaySetup.dispatch_mode_enabled,
          })),
        }),
      );
      await refreshLauncherStatus();
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
      await withBusy("launcher-start", () =>
        requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify(buildLauncherStartPayload(launcherStatus, targetMachineRole, {
            dispatchModeEnabled: gatewaySetup.dispatch_mode_enabled,
          })),
        }),
      );
      await refreshLauncherStatus();
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
    setSetupProfile(profile);
    setWorkerGatewayProbeTask(profile.last_task?.kind === "gateway_probe" ? profile.last_task : null);
    setGatewaySetup(profile.gateway);
    setConsoleSetup({ ...profile.console, gateway_base_url: profile.console.gateway_base_url || preferredGatewayBaseUrl });
    setWorkerSetup((current) => ({
      ...current,
      gateway_base_url: resolveWorkerGatewayBaseUrl(current.gateway_base_url, profile, systemStatus),
      dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
      dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
      node_token: "",
    }));
  }
  async function refreshQuickSetupStatus() {
    try {
      if (!shouldUseLocalGatewayApi) {
        const profile = await requestJson<SetupProfileResponse>("/local/setup/profile");
        const remoteGateway = sessionRemoteGatewayBaseUrl.trim();
        const remoteWechat = currentRoleIsConsole && remoteGateway
          ? await requestJson<WeChatStatus>(`${remoteGateway}/api/wechat/onboard/status`).catch(() => null)
          : null;
        const remoteNodeList = remoteGateway
          ? await requestJson<NodeListResponse>(`${remoteGateway}/api/nodes`).catch(() => null)
          : null;
        const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, systemStatus);
        setSetupProfile(profile);
        setSetupTask(profile.last_task);
        setWorkerGatewayProbeTask(profile.last_task?.kind === "gateway_probe" ? profile.last_task : null);
        setGatewaySetup(profile.gateway);
        setConsoleSetup({ ...profile.console, gateway_base_url: profile.console.gateway_base_url || preferredGatewayBaseUrl });
        setWorkerSetup((current) => ({
          ...current,
          gateway_base_url: resolveWorkerGatewayBaseUrl(current.gateway_base_url, profile, systemStatus),
          dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
          dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
          node_token: "",
        }));
        if (remoteWechat) {
          setWechatStatus(remoteWechat);
          if (remoteWechat.base_url) setWechatBaseUrl(remoteWechat.base_url);
        }
        if (remoteNodeList) {
          syncNodeStateView(remoteNodeList);
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
      const [profile, system, model, wechat, nodeList] = await Promise.all([
        requestJson<SetupProfileResponse>("/api/setup/profile"),
        requestJson<SystemStatus>("/api/system/status"),
        requestJson<ModelStatus>("/api/models/builtin/status"),
        requestJson<WeChatStatus>("/api/wechat/onboard/status"),
        requestJson<NodeListResponse>("/api/nodes"),
      ]);
      const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, system);
      setSetupProfile(profile);
      setSetupTask(profile.last_task);
      setWorkerGatewayProbeTask(profile.last_task?.kind === "gateway_probe" ? profile.last_task : null);
      setGatewaySetup(profile.gateway);
      setConsoleSetup({ ...profile.console, gateway_base_url: profile.console.gateway_base_url || preferredGatewayBaseUrl });
      setWorkerSetup((current) => ({
        ...current,
        gateway_base_url: resolveWorkerGatewayBaseUrl(current.gateway_base_url, profile, system),
        dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
        dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
        node_token: "",
      }));
      setSystemStatus(system);
      setModelStatus(model);
      setWechatStatus(wechat);
      if (wechat.base_url) setWechatBaseUrl(wechat.base_url);
      syncNodeStateView(nodeList);
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
    const system = await requestJson<SystemStatus>("/api/system/status");
    setSystemStatus(system);
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
  async function refreshLauncherStatus() {
    try {
      const status = await requestJson<LauncherStatusResponse>("/local/bootstrap/status");
      setLauncherStatus(status);
      setLauncherAvailable(true);
    } catch {
      setLauncherAvailable(false);
    }
  }
  async function refreshLocalNodeStatus() {
    if (!launcherAvailable) return;
    try {
      const status = await requestJson<LocalNodeStatusResponse>("/local/node/status");
      setLocalNodeStatus(status);
      if (!localNodeModelDirty) {
        setLocalNodeModelDraft({
          model_provider: status.model_settings?.model_provider || "auto",
          openai_base_url: status.model_settings?.openai_base_url || "",
          openai_api_key: "",
          openai_model: status.model_settings?.openai_model || "",
          openai_enable_thinking: Boolean(status.model_settings?.openai_enable_thinking),
          dify_base_url: status.model_settings?.dify_base_url || "",
          dify_api_key: "",
          restart_service: true,
        });
      }
    } catch {
      // local diagnostics are best-effort
    }
  }
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
  function updateLocalNodeModelDraft<K extends keyof LocalNodeModelConfigRequest>(key: K, value: LocalNodeModelConfigRequest[K]) {
    setLocalNodeModelDirty(true);
    setLocalNodeModelDraft((current) => ({ ...current, [key]: value }));
  }
  async function saveLocalNodeModelConfig() {
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
      setLocalNodeModelDraft({
        model_provider: result.status.model_settings?.model_provider || "auto",
        openai_base_url: result.status.model_settings?.openai_base_url || "",
        openai_api_key: "",
        openai_model: result.status.model_settings?.openai_model || "",
        openai_enable_thinking: Boolean(result.status.model_settings?.openai_enable_thinking),
        dify_base_url: result.status.model_settings?.dify_base_url || "",
        dify_api_key: "",
        restart_service: true,
      });
      await refreshLauncherStatus();
      await refreshLocalNodeStatus();
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
    await requestJson<LauncherStatusResponse>("/local/bootstrap/dispatch-mode", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
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
        refreshSystemStatus(),
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
      await withBusy(`launcher-install-${target}`, () => requestJson<LauncherStatusResponse>("/local/bootstrap/install-redis", { method: "POST", body: JSON.stringify({ target, source }) }));
      await refreshLauncherStatus();
      setNotice(target === "host" ? "主机 Redis 已准备完成。" : "节点缓存 Redis 已准备完成。");
    } catch (error) {
      setNotice(`安装 Redis 失败：${(error as Error).message}`);
    }
  }
  async function startLauncherStack(overrides?: { enableNodeCacheRedis?: boolean }) {
    try {
      const defaultMachineRole = effectiveRole ? setupRoleToLauncherMachineRole(effectiveRole) : (launcherMachineRoleValue(launcherStatus) || "gateway_console");
      const enableNodeCacheRedis = overrides?.enableNodeCacheRedis ?? (launcherStatus?.profile.node_cache_policy !== "disabled");
      await withBusy(
        "launcher-start",
        () => requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify(buildLauncherStartPayload(launcherStatus, defaultMachineRole, {
            dispatchModeEnabled: gatewaySetup.dispatch_mode_enabled,
            enableNodeCacheRedis,
          })),
        }),
      );
      await refreshLauncherStatus();
      setNotice(defaultMachineRole === "node" ? "节点服务启动命令已下发。" : "本地运行模型启动命令已下发。");
    } catch (error) {
      const failure = error as Error & { code?: string };
      setNotice(failure.code === "external_port_in_use" ? `主网关端口被其它进程占用：${failure.message}` : `启动本地组件失败：${failure.message}`);
    }
  }
  async function stopLauncherStack(component?: string) {
    try {
      await withBusy("launcher-stop", () => requestJson<LauncherStatusResponse>("/local/bootstrap/stop", { method: "POST", body: JSON.stringify({ component: component || null }) }));
      await refreshLauncherStatus();
      setNotice(component ? `${component} 已停止。` : "已停止所有本地组件。");
    } catch (error) {
      setNotice(`停止组件失败：${(error as Error).message}`);
    }
  }
  async function toggleLauncherNodeCache(enabled: boolean) {
    try {
      await withBusy("launcher-node-cache-toggle", () => requestJson<LauncherStatusResponse>("/local/bootstrap/node-cache/toggle", { method: "POST", body: JSON.stringify({ enabled }) }));
      await refreshLauncherStatus();
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
  async function switchSessionNode(sessionId: string) {
    try {
      const result = await withBusy(
        "session-switch-node",
        () => requestJson<SessionSwitchResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/switch-node`, {
          method: "POST",
          body: JSON.stringify({ reason: "console_manual_switch" }),
        }),
      );
      setActiveSession(result.session);
      await Promise.all([
        requestJson<SessionsResponse>("/api/sessions").then((sessionList) => {
          syncSessions(sessionList.sessions, setSessions, setSelectedSessionId, setActiveSession);
        }),
        refreshSessionDetail(sessionId),
        requestJson<NodeListResponse>("/api/nodes").then((nodeList) => {
          syncNodeStateView(nodeList);
        }),
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
                requestJson<NodeListResponse>("/api/nodes")
                  .then((refreshed) => syncNodeStateView(refreshed))
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
      const refreshedNodes = await requestJson<NodeListResponse>("/api/nodes");
      syncNodeStateView(refreshedNodes);
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
      const refreshedNodes = await requestJson<NodeListResponse>("/api/nodes");
      syncNodeStateView(refreshedNodes);
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
      const refreshedNodes = await requestJson<NodeListResponse>("/api/nodes");
      syncNodeStateView(refreshedNodes);
      setNotice(result.detail || `已删除节点 ${node.node_id}。`);
      if (workerSetup.node_id.trim() === node.node_id) {
        setWorkerGatewayProbeTask(null);
      }
    } catch (error) {
      setNotice(`删除节点失败：${(error as Error).message}`);
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
  const nodeInventoryHeadline = useMemo(
    () => `已配对 ${nodeInventorySummary.paired_total} / 在线 ${nodeInventorySummary.online_total} / 离线 ${nodeInventorySummary.offline_total}`,
    [nodeInventorySummary.offline_total, nodeInventorySummary.online_total, nodeInventorySummary.paired_total],
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
          : "当前允许本机节点直接参与处理，也可以继续纳管更多远端节点。",
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

  return (
    <div className="console-app">
      <div className="console-grain" />
      <div className="console-shell">
        <header className="console-topbar">
          <div className="topbar-main">
            <div className="topbar-kicker">wechat-claw-hub</div>
            <div className="topbar-title">微信 Agent 运维工作台</div>
            <div className="topbar-copy">把快速配置、接入联调和会话观察拆成三个一级工作区，首次启动先走向导，后续也能随时重配。</div>
          </div>
          <div className="topbar-status-row">
            {currentRoleIsWorker ? (
              <>
                <StatusChip label="目标网关" value={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "已连接" : workerSetup.gateway_base_url ? "可达" : "未填写"} tone={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "good" : "warn"} />
                <StatusChip label="节点" value={workerSetup.node_id || "未配置"} tone={workerSetup.node_id ? "good" : "warn"} />
                <StatusChip label="注册状态" value={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "已注册" : workerGatewayConnection.state === "idle" ? "未检测" : workerGatewayConnection.label} tone={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "good" : "warn"} />
                <StatusChip label="模型" value={localNodeStatus?.model_settings?.model_provider && (localNodeStatus.model_settings.openai_api_key_configured || localNodeStatus.model_settings.dify_api_key_configured) ? localNodeStatus.model_settings.model_provider : "未配置"} tone={localNodeStatus?.model_settings?.openai_api_key_configured || localNodeStatus?.model_settings?.dify_api_key_configured ? "good" : "warn"} />
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
                  <section className="surface surface-subsection">
                    <div className="section-head">
                      <div><div className="section-kicker">桌面启动器</div><h3>{currentRoleIsWorker ? "本机节点托管环境" : "单机一体化运行"}</h3></div>
                      <div className="inline-actions">
                        <button type="button" className="ghost-button" onClick={refreshLauncherStatus}>刷新</button>
                        <button type="button" className="ghost-button" onClick={() => setLauncherExpanded(v => !v)}>{launcherExpanded ? "收起" : "展开详情"}</button>
                      </div>
                    </div>

                    {/* 组件状态摘要行 — 始终可见 */}
                    <div className="launcher-component-rows">
                      {(launcherStatus?.components || []).filter(c => c.name !== "local-node" && !(currentRoleIsWorker && (c.name === "host-redis" || c.name === "gateway"))).map((component) => (
                        <div key={component.name} className="launcher-row">
                          <div className="launcher-row-left">
                            <span className={`launcher-dot launcher-dot-${launcherBadgeTone(component.state)}`} />
                            <span className="launcher-row-name">{launcherComponentName(component.name)}</span>
                            <span className="launcher-row-detail">{component.detail || "等待启动"}</span>
                          </div>
                          <div className="launcher-row-right">
                            <span className={`session-badge session-badge-${launcherBadgeTone(component.state)}`}>{launcherStateLabel(component.state)}</span>
                            <button type="button" className="ghost-button launcher-row-btn" onClick={() => readLauncherLog(component.name)}>日志</button>
                            {component.name !== "launcher" && component.name !== "console" ? (
                              <button type="button" className="ghost-button launcher-row-btn" onClick={() => stopLauncherStack(component.name)} disabled={busy !== null}>停止</button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    {launcherHostRedis?.state === "failed" || launcherGateway?.state === "failed" ? (
                      <div className="topbar-notice dispatch-warning" style={{ marginTop: 12 }}>
                        当前桌面启动器检测到主机 Redis 或主网关启动失败。下方“当前连接状态”会优先按这里的运行结果显示，请先查看对应日志并重新拉起。
                      </div>
                    ) : null}

                    {/* 展开后的日志区 */}
                    {Object.entries(launcherLogs).map(([name, content]) => content ? (
                      <div key={name} className="launcher-log-block">
                        <div className="launcher-log-label">{launcherComponentName(name)} 日志</div>
                        <SnippetBlock label="" content={content} />
                      </div>
                    ) : null)}

                    {/* 展开详情区 */}
                    {launcherExpanded ? (
                      <>
                        <div className="info-stack" style={{marginTop: 14}}>
                          <InfoRow label="机器角色" value={launcherMachineRoleLabel(launcherStatus)} />
                          <InfoRow label="托管组件" value={launcherManagedComponentsLabel(launcherStatus)} multiline />
                          <InfoRow label="存储库目录" value={launcherStatus?.layout.root || "尚未选择"} multiline />
                          <InfoRow label="节点缓存策略" value={launcherStatus?.profile.node_cache_policy === "disabled" ? "关闭" : "已启用"} />
                          <InfoRow label="本机节点策略" value={launcherShouldRunLocalNode(launcherStatus) ? "当前角色会托管 local-node" : "当前角色不会托管 local-node"} multiline />
                          {!currentRoleIsWorker ? <InfoRow label="分发模式" value={gatewaySetup.dispatch_mode_enabled ? "已开启（主机只分发）" : "已关闭（本机节点可处理）"} /> : null}
                        </div>

                        <div className="launcher-env-head" onClick={() => setEnvExpanded(v => !v)}>
                          <span className="section-kicker">环境检测</span>
                          <span className={`launcher-env-status ${launcherStatus?.environment.ready ? "good" : "warn"}`}>
                            {launcherStatus?.environment.ready ? "已就绪" : "存在缺失项"}
                          </span>
                          <span className="launcher-env-toggle">{envExpanded ? "▲" : "▼"}</span>
                        </div>
                        {envExpanded ? (
                          <div className="info-stack">
                            <InfoRow label="Python 版本" value={launcherStatus?.environment.python_version || "未检测到"} />
                            {(launcherStatus?.environment.checks || []).map((item) => (
                              <InfoRow key={item.name} label={launcherEnvironmentLabel(item.name)} value={`${item.ready ? "已就绪" : "缺失"} · ${item.detail}`} multiline />
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    <div className="inline-actions quick-setup-actions" style={{marginTop: 14}}>
                      {!currentRoleIsWorker ? <button type="button" onClick={() => installLauncherRedis("host", launcherStatus?.profile.redis_source || "mirror")} disabled={busy !== null}>{busy === "launcher-install-host" ? "下载中..." : launcherStatus?.host_redis.installed ? "重装主机 Redis" : "安装主机 Redis"}</button> : null}
                      {!currentRoleIsWorker ? <button type="button" className="ghost-button" onClick={() => applyDispatchMode(!gatewaySetup.dispatch_mode_enabled)} disabled={busy !== null}>{busy === "dispatch-mode-toggle" ? "切换中..." : gatewaySetup.dispatch_mode_enabled ? "关闭分发模式" : "开启分发模式"}</button> : null}
                      <button type="button" className="ghost-button" onClick={() => toggleLauncherNodeCache(launcherStatus?.profile.node_cache_policy === "disabled")} disabled={busy !== null}>{launcherStatus?.profile.node_cache_policy === "disabled" ? "启用节点缓存" : "关闭节点缓存"}</button>
                      {launcherStatus?.profile.node_cache_policy !== "disabled" ? <button type="button" className="ghost-button" onClick={() => installLauncherRedis("node-cache", launcherStatus?.profile.node_cache_redis_source || "mirror")} disabled={busy !== null}>{busy === "launcher-install-node-cache" ? "下载中..." : launcherStatus?.node_cache_redis.installed ? "重装节点缓存 Redis" : "安装节点缓存 Redis"}</button> : null}
                      {!currentRoleIsWorker ? <button type="button" onClick={() => void startLauncherStack()} disabled={busy !== null}>{busy === "launcher-start" ? "启动中..." : launcherHostRedis?.state === "failed" || launcherGateway?.state === "failed" ? "重新拉起" : "一键启动"}</button> : <button type="button" onClick={() => void startLauncherStack()} disabled={busy !== null}>{busy === "launcher-start" ? "启动中..." : "启动节点服务"}</button>}
                      <button type="button" className="ghost-button" onClick={() => stopLauncherStack()} disabled={busy !== null}>{busy === "launcher-stop" ? "停止中..." : "停止全部"}</button>
                    </div>
                  </section>
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
              <div><div className="section-kicker">{currentRoleIsWorker ? "节点工作台" : "接入中心"}</div><h2>{currentRoleIsWorker ? "聚焦本机节点安装、回连与发现响应" : "连接前先确认模型、微信和节点都已就绪"}</h2></div>
              <div className="workspace-caption">{currentRoleIsWorker ? "当前角色不会展示网关纳管、微信接入和分发模式操作。" : "保留原有 API，不改协议，只重组桌面工作流。"}</div>
            </div>
            <section className="surface connection-overview">
              <div className="connection-overview-main">
                <div>
                  <div className="section-kicker">{currentRoleIsWorker ? "操作重点" : "联调总览"}</div>
                  <h3>{currentRoleIsWorker ? "先让这台机器稳定回连，再看诊断细节" : "把接入中心变成一张可执行的运行面板"}</h3>
                </div>
                <div className="connection-overview-copy">
                  {connectionActionTips.map((tip) => (
                    <div key={tip} className="connection-overview-tip">{tip}</div>
                  ))}
                </div>
              </div>
              <div className="connection-hero-grid">
                {connectionHeroCards.map((card) => (
                  <ConnectionHeroCard key={`${card.eyebrow}-${card.title}`} eyebrow={card.eyebrow} title={card.title} detail={card.detail} tone={card.tone} />
                ))}
              </div>
            </section>
            <div className="connection-grid">
              <div className="connection-status-column">
                {!currentRoleIsWorker ? (
                <section className="surface surface-tight">
                  <div className="section-head"><div><div className="section-kicker">准备流程</div><h3>接入状态</h3></div><button onClick={runModelCheck} disabled={busy !== null}>{busy === "model-check" ? "检测中..." : "检测模型"}</button></div>
                  <div className="prep-strip-list">
                    <PrepStrip label="模型可用" detail={modelStatus?.configured ? modelStatus.model : "尚未检测"} tone={modelStatus?.configured ? "good" : "warn"} />
                    <PrepStrip label="微信已连接" detail={wechatRuntimeSummary.value} tone={wechatRuntimeSummary.tone} />
                    <PrepStrip label="节点在线" detail={`${systemStatus?.active_nodes ?? 0} 个节点`} tone={(systemStatus?.active_nodes ?? 0) > 0 ? "good" : "warn"} />
                  </div>
                </section>
                ) : (
                <>
                  {/* IP/port identity block - req 3.6 */}
                  <div className="worker-wizard-identity" style={{ marginBottom: 12 }}>
                    <div className="worker-wizard-identity-ip">{workerGatewayConnection.remoteNode?.lan_ip || localNodeStatus?.diagnostics?.lan_ip as string || currentNodeLanIp || "检测中…"}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                      端口：{workerSetup.discovery_port} &nbsp;&middot;&nbsp; 本机节点地址，网关管理员可用此地址配对
                    </div>
                  </div>
                  <section className="surface surface-tight">
                    <div className="section-head"><div><div className="section-kicker">节点工作台</div><h3>当前节点状态</h3></div></div>
                    <div className="prep-strip-list">
                      <PrepStrip label="节点配置" detail={setupCompletedRoles.has("worker_node") ? "当前机器节点已完成配置" : "尚未完成节点配置"} tone={setupCompletedRoles.has("worker_node") ? "good" : "warn"} />
                      <PrepStrip label="目标网关地址" detail={workerSetup.gateway_base_url || "未填写局域网网关地址"} tone={workerSetup.gateway_base_url ? "good" : "warn"} />
                      <PrepStrip label="发现响应" detail={workerSetup.discovery_enabled ? `已启用 UDP ${workerSetup.discovery_port}` : "当前已关闭"} tone={workerSetup.discovery_enabled ? "good" : "warn"} />
                      {/* Token status - req 3.7 */}
                      <PrepStrip
                        label="Token 状态"
                        detail={workerGatewayConnection.state === "gateway_reachable_node_connected" ? "已配对" : resolveTokenDisplayState(workerSetup.node_token).status === "waiting" ? "等待网关下发 token" : "已配对"}
                        tone={workerGatewayConnection.state === "gateway_reachable_node_connected" || resolveTokenDisplayState(workerSetup.node_token).status === "paired" ? "good" : "warn"}
                      />
                    </div>
                  </section>
                </>
                )}
                {!currentRoleIsWorker ? <section className="surface">
                  <div className="section-head"><div><div className="section-kicker">运行摘要</div><h3>系统状态</h3></div><button type="button" className="ghost-button" onClick={() => void applyDispatchMode(!gatewaySetup.dispatch_mode_enabled)} disabled={busy !== null}>{busy === "dispatch-mode-toggle" ? "切换中..." : gatewaySetup.dispatch_mode_enabled ? "关闭分发模式" : "开启分发模式"}</button></div>
                  <div className="connection-signal-grid">
                    <ConnectionSignalCard
                      label="模型"
                      value={modelStatus?.configured ? "已就绪" : "待检测"}
                      meta={modelStatus?.model || "未配置模型"}
                      tone={modelStatus?.configured ? "good" : "warn"}
                    />
                    <ConnectionSignalCard
                      label="微信"
                      value={wechatRuntimeSummary.value}
                      meta={wechatStatus?.has_token ? "Token 已存在" : "尚未写入 Token"}
                      tone={wechatRuntimeSummary.tone}
                    />
                    <ConnectionSignalCard
                      label="Redis"
                      value={systemStatus?.redis_ok ? "正常" : "未就绪"}
                      meta={systemStatus?.redis_ok ? "主状态存储可用" : "请先恢复主存储"}
                      tone={systemStatus?.redis_ok ? "good" : "warn"}
                    />
                    <ConnectionSignalCard
                      label="调度"
                      value={systemStatus?.dispatch_mode_enabled ? "分发模式" : "本机处理"}
                      meta={`${systemStatus?.active_nodes ?? 0} 个在线节点`}
                      tone={(systemStatus?.active_nodes ?? 0) > 0 || !systemStatus?.dispatch_mode_enabled ? "good" : "warn"}
                    />
                  </div>
                  <div className="connection-signal-note">
                    当前控制台目标：{setupProfile?.console.gateway_base_url || currentGatewayBaseUrl}
                  </div>
                  {modelCheck ? <div className="info-stack" style={{marginTop: 10}}><InfoRow label="模型检测" value={modelCheck.configured_model_available ? "可用" : "未命中模型列表"} /></div> : null}
                  {wechatStatus?.last_error ? <div className="info-stack" style={{marginTop: 6}}><InfoRow label="最近错误" value={wechatStatus.last_error} multiline /></div> : null}
                  {gatewaySetup.dispatch_mode_enabled && availableDispatchNodes === 0 ? <div className="topbar-notice dispatch-warning" style={{marginTop: 12}}>已开启分发模式，但暂无可用远端节点；网关无法完成实际回复。</div> : null}
                </section> : null}

                {!currentRoleIsWorker ? <section className="surface">
                  <div className="section-head">
                    <div><div className="section-kicker">节点清单</div><h3>已接入节点总览</h3></div>
                    <span className="small-note">{nodeInventoryHeadline}</span>
                  </div>
                  {!nodeInventory.length ? (
                    <div className="empty-state">当前还没有已接入节点。本机内置节点和远端工作节点会在这里统一显示，但会明确区分角色来源。</div>
                  ) : (
                    <div className="connection-node-grid">
                      {nodeInventory.map((node) => {
                        const presentation = resolveInventoryNodePresentation(node, localNodeStatus, launcherStatus);
                        return (
                        <article key={node.node_id} className={`connection-node-card ${selectedNodeId === node.node_id ? "connection-node-card-active" : ""}`}>
                          <div className="connection-node-card-top">
                            <div className="connection-node-card-head">
                              <div className="connection-node-card-title-row">
                                <div className="node-card-title">{node.hostname || node.node_id}</div>
                                <span className={`node-kind-tag node-kind-tag-${node.node_kind}`}>{node.node_kind === "local" ? "网关内置" : "远端工作节点"}</span>
                                {node.connection_state === "auth_failed" ? <span className="auth-failed-badge" title="节点 token 不匹配，请重新配对或重置凭据">鉴权失败</span> : null}
                              </div>
                              <div className="node-card-subtitle">{node.node_id}</div>
                            </div>
                            <span className={`session-badge session-badge-${presentation.tone}`}>{presentation.badge}</span>
                          </div>
                          <div className="connection-node-address">{getInventoryNodeAddress(node)}</div>
                          <div className="connection-node-detail">{presentation.detail}</div>
                          <div className="connection-node-stats">
                            <div className="connection-node-stat">
                              <span>平台</span>
                              <strong>{node.platform || "未知"}</strong>
                            </div>
                            <div className="connection-node-stat">
                              <span>版本</span>
                              <strong>{node.node_version || "-"}</strong>
                            </div>
                            <div className="connection-node-stat">
                              <span>并发</span>
                              <strong>{node.max_concurrency ?? "-"}</strong>
                            </div>
                            <div className="connection-node-stat">
                              <span>通道</span>
                              <strong>{node.channel_in_use ?? 0} / {node.channel_capacity ?? 0}</strong>
                            </div>
                          </div>
                          <div className="connection-node-card-actions">
                            <button type="button" className="ghost-button launcher-row-btn" onClick={() => setSelectedNodeId(selectedNodeId === node.node_id ? null : node.node_id)}>
                              {selectedNodeId === node.node_id ? "收起诊断" : "查看诊断"}
                            </button>
                            {node.node_kind === "remote" && node.paired ? <button type="button" className="ghost-button launcher-row-btn" onClick={() => void deletePairedNode(node)} disabled={busy !== null}>{busy === `delete-node-${node.node_id}` ? "处理中..." : "删除节点"}</button> : null}
                            {node.node_kind === "remote" && node.online ? <button type="button" className="ghost-button launcher-row-btn" onClick={async () => { if (!window.confirm(`确认断开节点 ${node.node_id} 的连接吗？配对凭据保留，节点重启后可自动重连。`)) return; try { const r = await withBusy(`disconnect-node-${node.node_id}`, () => requestJson<NodeDeleteResponse>(`/api/nodes/${encodeURIComponent(node.node_id)}/disconnect`, { method: "POST" })); const refreshed = await requestJson<NodeListResponse>("/api/nodes"); syncNodeStateView(refreshed); setNotice(r.detail || `已断开节点 ${node.node_id}。`); } catch (e) { setNotice(`断开失败：${(e as Error).message}`); } }} disabled={busy !== null}>{busy === `disconnect-node-${node.node_id}` ? "处理中..." : "断开连接"}</button> : null}
                          </div>
                        </article>
                      )})}
                    </div>
                  )}
                </section> : null}
                {!currentRoleIsWorker && selectedNodeId ? <section className="surface">
                  <div className="section-head">
                    <div>
                      <div className="section-kicker">节点诊断</div>
                      <h3 style={{display:"flex",alignItems:"center",gap:8}}>
                        {selectedNodeId}
                        {selectedNodeDiagnostics?.node_kind ? <span className={`node-kind-tag node-kind-tag-${selectedNodeDiagnostics.node_kind}`}>{selectedNodeDiagnostics.node_kind === "local" ? "网关内置" : "远端工作节点"}</span> : null}
                      </h3>
                    </div>
                    <div className="inline-actions">
                      {selectedNodeDiagnostics?.last_pairing_trace_id ? <span className="small-note" style={{fontFamily:"monospace",fontSize:11}}>trace: {selectedNodeDiagnostics.last_pairing_trace_id.slice(0,16)}…</span> : null}
                      <button type="button" className="ghost-button launcher-row-btn" onClick={() => setSelectedNodeId(null)}>关闭</button>
                    </div>
                  </div>
                  <div className="info-stack">
                    <InfoRow label="连接状态" value={selectedNodeDiagnostics?.connection_state || "未记录"} />
                    <InfoRow label="最近配对" value={selectedNodeDiagnostics?.last_pairing_status ? `${selectedNodeDiagnostics.last_pairing_status}${selectedNodeDiagnostics.last_pairing_at ? ` · ${formatTimeLabel(selectedNodeDiagnostics.last_pairing_at, true)}` : ""}` : "暂无"} />
                    <InfoRow label="最近注册" value={selectedNodeDiagnostics?.last_register_result ? `${selectedNodeDiagnostics.last_register_result}${selectedNodeDiagnostics.last_register_at ? ` · ${formatTimeLabel(selectedNodeDiagnostics.last_register_at, true)}` : ""}` : "暂无"} />
                    <InfoRow label="最近心跳" value={selectedNodeDiagnostics?.last_heartbeat_at ? formatTimeLabel(selectedNodeDiagnostics.last_heartbeat_at, true) : "暂无"} />
                    {selectedNodeDiagnostics?.last_auth_decision ? (
                      <>
                        <InfoRow label="最近鉴权" value={selectedNodeDiagnostics.last_auth_decision} />
                        {selectedNodeDiagnostics.last_auth_failure_at ? <InfoRow label="鉴权失败时间" value={formatTimeLabel(selectedNodeDiagnostics.last_auth_failure_at, true)} /> : null}
                        {selectedNodeDiagnostics.expected_token_masked ? <InfoRow label="期望 Token" value={selectedNodeDiagnostics.expected_token_masked} /> : null}
                        {selectedNodeDiagnostics.provided_token_masked ? <InfoRow label="实际 Token" value={selectedNodeDiagnostics.provided_token_masked} /> : null}
                        {selectedNodeDiagnostics.expected_token_masked && selectedNodeDiagnostics.provided_token_masked ? (
                          <InfoRow label="Token 对比" value={`期望：${selectedNodeDiagnostics.expected_token_masked} / 实际提供：${selectedNodeDiagnostics.provided_token_masked}`} multiline />
                        ) : null}
                        {selectedNodeDiagnostics.last_auth_client_host ? <InfoRow label="来源地址" value={selectedNodeDiagnostics.last_auth_client_host} /> : null}
                      </>
                    ) : null}
                    {selectedNodeDiagnostics?.last_error ? <InfoRow label="最近错误" value={selectedNodeDiagnostics.last_error} multiline /> : null}
                  </div>
                  {selectedNodeDiagnostics?.timeline?.length ? <SnippetBlock label="诊断时间线" content={selectedNodeTimelineText} /> : null}
                </section> : null}
                <section className="surface">
                  <div className="section-head">
                    <div><div className="section-kicker">{currentRoleIsWorker ? "节点安装" : "节点纳管"}</div><h3>{currentRoleIsWorker ? "安装或重装当前机器节点" : "网关配置后继续添加工作节点"}</h3></div>
                    {!currentRoleIsWorker ? <button type="button" className="ghost-button" onClick={applyPreferredGatewayBaseUrlToWorker}>填入当前网关地址</button> : null}
                  </div>
                  <div className="form-grid">
                    <label><span>节点 ID</span><input value={workerSetup.node_id} onChange={(event) => updateWorkerSetup("node_id", event.target.value)} /></label>
                    <label><span>目标网关地址</span><input value={workerSetup.gateway_base_url} onChange={(event) => updateWorkerSetup("gateway_base_url", event.target.value)} placeholder="http://192.168.0.18:8300" /></label>
                    <label>
                      <span>配对密钥</span>
                      <div className="field-with-action">
                        <input type={workerPairingKeyVisible ? "text" : "password"} value={workerSetup.pairing_key} onChange={(event) => updateWorkerSetup("pairing_key", event.target.value)} placeholder="节点与网关保持一致" autoComplete="new-password" />
                        <button type="button" className="ghost-button" onClick={() => setWorkerPairingKeyVisible((current) => !current)}>{workerPairingKeyVisible ? "隐藏" : "显示"}</button>
                      </div>
                    </label>
                    <label><span>安装目录</span><input value={workerSetup.install_dir} onChange={(event) => updateWorkerSetup("install_dir", event.target.value)} /></label>
                  </div>
                  <div className="launcher-env-head" onClick={() => setNodeFormAdvanced(v => !v)} style={{marginTop: 8}}>
                    <span className="section-kicker">高级选项</span>
                    <span className="launcher-env-toggle">{nodeFormAdvanced ? "▲" : "▼"}</span>
                  </div>
                  {nodeFormAdvanced ? (
                    <div className="form-grid" style={{marginTop: 10}}>
                      <label><span>Dify Base URL</span><input value={workerSetup.dify_base_url} onChange={(event) => updateWorkerSetup("dify_base_url", event.target.value)} /></label>
                      <label><span>Dify API Key</span><textarea value={workerSetup.dify_api_key} onChange={(event) => updateWorkerSetup("dify_api_key", event.target.value)} /></label>
                      <label><span>最大并发</span><input type="number" value={workerSetup.max_concurrency} onChange={(event) => updateWorkerSetup("max_concurrency", Number(event.target.value) || 1)} /></label>
                      <label><span>发现响应端口</span><input type="number" value={workerSetup.discovery_port} onChange={(event) => updateWorkerSetup("discovery_port", Number(event.target.value) || 9531)} /></label>
                      <label><span>启用局域网发现</span><input type="checkbox" checked={workerSetup.discovery_enabled} onChange={(event) => updateWorkerSetup("discovery_enabled", event.target.checked)} /></label>
                      <label><span>Bundle 路径（可选）</span><input value={workerSetup.bundle_path} onChange={(event) => updateWorkerSetup("bundle_path", event.target.value)} placeholder="留空则自动查找" /></label>
                    </div>
                  ) : null}
                  <div className="inline-actions" style={{marginTop: 14}}>
                    <button type="button" onClick={() => void runWorkerSetup({ showResultScreen: false })} disabled={busy !== null}>{busy === "setup-worker" ? "安装中..." : "安装当前机器节点"}</button>
                    {currentRoleIsWorker ? <button type="button" className="ghost-button" onClick={() => void probeWorkerGateway()} disabled={busy !== null}>{busy === "setup-gateway-probe" ? "检测中..." : "检测目标网关"}</button> : null}
                  </div>
                </section>
              </div>
              <div className="connection-action-column">
                {!currentRoleIsWorker && setupProfile ? (
                  <>
                    <section className="surface">
                      <div className="section-head">
                        <div><div className="section-kicker">直连配对</div><h3>按地址直接纳管工作节点</h3></div>
                      </div>
                      <div className="inline-tip">
                        如果广播扫描搜不到节点，可直接填写工作节点 IP/主机名和配对密钥；更适合多网卡、跨网段调试。
                      </div>
                      <div className="form-grid">
                        <label><span>目标 IP / 主机名</span><input value={manualPair.host} onChange={(event) => updateManualPair("host", event.target.value)} placeholder="例如 192.168.0.23" /></label>
                        <label><span>配对端口</span><input type="number" value={manualPair.pairing_port} onChange={(event) => updateManualPair("pairing_port", Number(event.target.value) || 9532)} /></label>
                        <label><span>配对密钥</span><input type="password" value={manualPair.pairing_key} onChange={(event) => updateManualPair("pairing_key", event.target.value)} placeholder="与目标节点上的 CLAW_PAIRING_KEY 一致" autoComplete="new-password" /></label>
                        <label><span>指定节点 ID（可选）</span><input value={manualPair.node_id} onChange={(event) => updateManualPair("node_id", event.target.value)} placeholder="留空则自动生成或沿用远端值" /></label>
                      </div>
                      <div className="inline-actions">
                        <button type="button" onClick={() => void manualPairNode()} disabled={busy !== null}>{busy === "setup-manual-pair" ? "连接中..." : "按地址配对"}</button>
                      </div>
                    </section>
                    <section className="surface">
                      <div className="section-head">
                        <div><div className="section-kicker">节点配对</div><h3>扫描并纳管局域网工作节点</h3></div>
                        <button type="button" onClick={scanLanNodes} disabled={busy !== null}>{busy === "setup-discovery-scan" ? "搜索中..." : "搜索局域网节点"}</button>
                      </div>
                      <div className="inline-tip">
                        当前网关回连地址：{currentGatewayBaseUrl}。扫描后可以直接输入密钥配对，适合调试和节点替换。
                      </div>
                      {!discoveredNodes.length ? <div className="empty-state">还没有扫描结果。先确认目标机器已运行 `claw-node` 并开启发现响应，然后点击“搜索局域网节点”。</div> : (
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
                    <section className="surface">
                      <div className="section-head">
                        <div><div className="section-kicker">本机诊断</div><h3>网关内置节点的 Windows 服务、配置路径与本地事件</h3></div>
                        <div className="inline-actions">
                          <button type="button" className="ghost-button" onClick={() => void refreshLocalNodeDiagnostics()} disabled={!launcherAvailable || busy !== null}>刷新</button>
                          <button type="button" className="ghost-button" onClick={() => void restartLocalNodeService()} disabled={!launcherAvailable || busy !== null}>{busy === "local-node-restart" ? "重启中..." : "重启服务"}</button>
                          <button type="button" className="ghost-button" onClick={() => void saveLocalNodeModelConfig()} disabled={!launcherAvailable || busy !== null}>{busy === "local-node-model-save" ? "保存中..." : "保存模型并应用"}</button>
                          <button type="button" className="ghost-button" onClick={() => void exportLocalNodeDiagnostics()} disabled={!launcherAvailable || busy !== null}>{busy === "local-node-export" ? "导出中..." : "导出诊断包"}</button>
                        </div>
                      </div>
                      <div className="inline-tip">
                        这里展示的是网关当前机器自带的内置节点，不是局域网中其它远端工作节点。它会直接跟随 launcher 托管的主网关运行。
                      </div>
                      <div className="info-stack">
                        <InfoRow label="节点身份" value={localNodeStatus?.node_kind === "local" ? "网关内置节点" : nodeRoleLabel("local-node", localNodeStatus?.node_kind)} multiline />
                        <InfoRow label="服务状态" value={localNodeStatus?.state || "未读取"} />
                        <InfoRow label="网关注册状态" value={localNodeRuntimeSummary.label} multiline />
                        <InfoRow label="服务名" value={localNodeStatus?.service_name || "未读取"} multiline />
                        <InfoRow label="配置文件" value={localNodeStatus?.config_path || "未读取"} multiline />
                        <InfoRow label="诊断文件" value={localNodeStatus?.diagnostics_path || "未读取"} multiline />
                        <InfoRow label="运行详情" value={localNodeRuntimeSummary.detail || localNodeStatus?.detail || "未读取"} multiline />
                        <InfoRow label="本地状态机" value={localNodeStatus?.runtime_state || String(localNodeStatus?.diagnostics?.current_state || "未记录")} multiline />
                        <InfoRow label="最近注册结果" value={localNodeStatus?.last_register_result || "暂无"} multiline />
                        <InfoRow label="最近注册时间" value={localNodeStatus?.last_register_at ? formatTimeLabel(localNodeStatus.last_register_at, true) : "暂无"} />
                        <InfoRow label="模型提供方" value={localNodeStatus?.model_settings?.model_provider || "auto"} />
                        <InfoRow label="OpenAI Key" value={localNodeStatus?.model_settings?.openai_api_key_configured ? "已配置" : "未配置"} />
                        <InfoRow label="Dify Key" value={localNodeStatus?.model_settings?.dify_api_key_configured ? "已配置" : "未配置"} />
                      </div>
                      <div className="form-grid">
                        <label>
                          <span>模型提供方</span>
                          <select value={localNodeModelDraft.model_provider} onChange={(event) => updateLocalNodeModelDraft("model_provider", event.target.value)}>
                            <option value="auto">auto</option>
                            <option value="openai">openai</option>
                            <option value="dify">dify</option>
                          </select>
                        </label>
                        <label>
                          <span>OpenAI Base URL</span>
                          <input value={localNodeModelDraft.openai_base_url} onChange={(event) => updateLocalNodeModelDraft("openai_base_url", event.target.value)} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                        </label>
                        <label>
                          <span>OpenAI Model</span>
                          <input value={localNodeModelDraft.openai_model} onChange={(event) => updateLocalNodeModelDraft("openai_model", event.target.value)} placeholder="qwen3.5-plus" />
                        </label>
                        <label>
                          <span>OpenAI API Key</span>
                          <input type="password" value={localNodeModelDraft.openai_api_key} onChange={(event) => updateLocalNodeModelDraft("openai_api_key", event.target.value)} placeholder={localNodeStatus?.model_settings?.openai_api_key_configured ? "留空表示继续使用当前 Key" : "输入新的 API Key"} autoComplete="new-password" />
                        </label>
                        <label>
                          <span>Dify Base URL</span>
                          <input value={localNodeModelDraft.dify_base_url} onChange={(event) => updateLocalNodeModelDraft("dify_base_url", event.target.value)} placeholder="https://api.dify.ai/v1" />
                        </label>
                        <label>
                          <span>Dify API Key</span>
                          <input type="password" value={localNodeModelDraft.dify_api_key} onChange={(event) => updateLocalNodeModelDraft("dify_api_key", event.target.value)} placeholder={localNodeStatus?.model_settings?.dify_api_key_configured ? "留空表示继续使用当前 Key" : "输入新的 API Key"} autoComplete="new-password" />
                        </label>
                      </div>
                      <div className="inline-actions">
                        <label className="checkbox-row">
                          <input type="checkbox" checked={localNodeModelDraft.openai_enable_thinking} onChange={(event) => updateLocalNodeModelDraft("openai_enable_thinking", event.target.checked)} />
                          <span>启用 OpenAI Thinking</span>
                        </label>
                        <label className="checkbox-row">
                          <input type="checkbox" checked={localNodeModelDraft.restart_service} onChange={(event) => updateLocalNodeModelDraft("restart_service", event.target.checked)} />
                          <span>保存后自动重启服务</span>
                        </label>
                      </div>
                      <SnippetBlock label="本机节点事件日志" content={localNodeEventPreview} />
                    </section>
                  </>
                ) : (
                  <>
                    <section className="surface node-role-surface">
                      <div className="section-head"><div><div className="section-kicker">节点说明</div><h3>节点角色只配置当前机器，不纳管其它节点</h3></div></div>
                      <div className="inline-tip">
                        你当前选择的是节点角色，这里只保留当前机器这一个远端工作节点的安装、回连、凭据和发现响应相关功能；网关内置节点属于主网关自身，扫描并纳管其它节点需要切换回网关角色。
                      </div>
                      <div className="info-stack">
                        <InfoRow label="节点身份" value="远端工作节点（当前机器）" multiline />
                        <InfoRow label="目标网关地址" value={workerSetup.gateway_base_url || "未填写"} multiline />
                        <InfoRow label="网关连接状态" value={workerGatewayConnection.label} multiline />
                        <InfoRow label="连接详情" value={workerGatewayConnection.detail} multiline />
                        <InfoRow label="节点 ID" value={workerSetup.node_id || "未填写"} multiline />
                        <InfoRow label="配对密钥" value={workerSetup.pairing_key.trim() ? "已填写，可在左侧表单中显示/修改" : "未填写"} multiline />
                        {workerGatewayConnection.remoteNode ? <InfoRow label="网关侧节点记录" value={summarizeRemoteNode(workerGatewayConnection.remoteNode)} multiline /> : null}
                      </div>
                      <SnippetBlock label="节点连接日志" content={workerConnectionLog || "这里会显示当前节点被连接、探测、注册和心跳确认的详细日志。"} />
                    </section>
                    {launcherAvailable ? (
                    <section className="surface">
                      <div className="section-head">
                        <div><div className="section-kicker">推理后端</div><h3>配置当前节点的模型</h3></div>
                        <div className="inline-actions">
                          <button type="button" className="ghost-button" onClick={() => void saveLocalNodeModelConfig()} disabled={busy !== null}>{busy === "local-node-model-save" ? "保存中..." : "保存并应用"}</button>
                        </div>
                      </div>
                      <div className="inline-tip">
                        节点需要配置推理后端才能接单处理任务。保存后会自动重启节点服务。
                      </div>
                      <div className="form-grid">
                        <label>
                          <span>模型提供方</span>
                          <select value={localNodeModelDraft.model_provider} onChange={(event) => updateLocalNodeModelDraft("model_provider", event.target.value)}>
                            <option value="auto">auto</option>
                            <option value="openai">openai</option>
                            <option value="dify">dify</option>
                          </select>
                        </label>
                        <label>
                          <span>OpenAI Base URL</span>
                          <input value={localNodeModelDraft.openai_base_url} onChange={(event) => updateLocalNodeModelDraft("openai_base_url", event.target.value)} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                        </label>
                        <label>
                          <span>OpenAI Model</span>
                          <input value={localNodeModelDraft.openai_model} onChange={(event) => updateLocalNodeModelDraft("openai_model", event.target.value)} placeholder="qwen3.5-plus" />
                        </label>
                        <label>
                          <span>OpenAI API Key</span>
                          <input type="password" value={localNodeModelDraft.openai_api_key} onChange={(event) => updateLocalNodeModelDraft("openai_api_key", event.target.value)} placeholder={localNodeStatus?.model_settings?.openai_api_key_configured ? "留空表示继续使用当前 Key" : "输入新的 API Key"} autoComplete="new-password" />
                        </label>
                        <label>
                          <span>Dify Base URL</span>
                          <input value={localNodeModelDraft.dify_base_url} onChange={(event) => updateLocalNodeModelDraft("dify_base_url", event.target.value)} placeholder="https://api.dify.ai/v1" />
                        </label>
                        <label>
                          <span>Dify API Key</span>
                          <input type="password" value={localNodeModelDraft.dify_api_key} onChange={(event) => updateLocalNodeModelDraft("dify_api_key", event.target.value)} placeholder={localNodeStatus?.model_settings?.dify_api_key_configured ? "留空表示继续使用当前 Key" : "输入新的 API Key"} autoComplete="new-password" />
                        </label>
                      </div>
                      <div className="inline-actions">
                        <label className="checkbox-row">
                          <input type="checkbox" checked={localNodeModelDraft.openai_enable_thinking} onChange={(event) => updateLocalNodeModelDraft("openai_enable_thinking", event.target.checked)} />
                          <span>启用 OpenAI Thinking</span>
                        </label>
                        <label className="checkbox-row">
                          <input type="checkbox" checked={localNodeModelDraft.restart_service} onChange={(event) => updateLocalNodeModelDraft("restart_service", event.target.checked)} />
                          <span>保存后自动重启服务</span>
                        </label>
                      </div>
                      <div className="info-stack" style={{marginTop: 10}}>
                        <InfoRow label="当前提供方" value={localNodeStatus?.model_settings?.model_provider || "未读取"} />
                        <InfoRow label="OpenAI Key" value={localNodeStatus?.model_settings?.openai_api_key_configured ? "已配置" : "未配置"} />
                        <InfoRow label="Dify Key" value={localNodeStatus?.model_settings?.dify_api_key_configured ? "已配置" : "未配置"} />
                      </div>
                    </section>
                    ) : null}
                  </>
                )}
                <section className="surface">
                  <div className="section-head">
                    <div><div className="section-kicker">调试日志</div><h3>{currentRoleIsWorker ? "网关探测与节点回连定位" : "配对过程与问题定位"}</h3></div>
                    <div className="inline-actions">
                      <span className="small-note">保留最近 12 条扫描/配对记录</span>
                      <button type="button" className="ghost-button" onClick={() => setPairingDebugEntries([])} disabled={!pairingDebugEntries.length}>清空日志</button>
                    </div>
                  </div>
                  {!pairingDebugEntries.length ? <div className="empty-state">{currentRoleIsWorker ? "这里会显示目标网关探测、节点回连检测和失败原因，方便定位当前节点为什么连不上网关。" : "这里会显示扫描、直连配对、失败原因和返回日志，方便快速定位问题。"}</div> : (
                    <div className="pairing-debug-list">
                      {pairingDebugEntries.map((entry) => (
                        <article key={entry.id} className="pairing-debug-card">
                          <div className="pairing-debug-top">
                            <div>
                              <div className="node-card-title">{entry.title}</div>
                              <div className="node-card-subtitle">{entry.target} · {formatTimeLabel(entry.updated_at, true)}</div>
                            </div>
                            <span className={`session-badge session-badge-${entry.status === "succeeded" ? "human" : entry.status === "running" || entry.status === "pending" ? "typing" : "queued"}`}>{pairingDebugStatusLabel(entry.status)}</span>
                          </div>
                          <div className="pairing-debug-summary">{entry.summary || "等待更多日志..."}</div>
                          <pre className="pairing-debug-log">{entry.logs.length ? entry.logs.join("\n") : "暂无详细日志"}</pre>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                {!currentRoleIsWorker ? <section className="surface surface-feature">
                  <div className="section-head"><div><div className="section-kicker">扫码接入</div><h3>连接微信 Bot</h3></div><div className="inline-actions"><button onClick={startQrFlow} disabled={busy !== null}>{busy === "wechat-qr" ? "生成中..." : "生成二维码"}</button><button onClick={pollQrStatus} disabled={!qr || busy !== null}>{busy === "wechat-poll" ? "轮询中..." : "轮询状态"}</button></div></div>
                  <div className="qr-stage">
                    <div className="qr-frame">{qrImageSrc ? <img className="qr-image" src={qrImageSrc} alt="WeChat QR code" /> : <div className="qr-placeholder">点击“生成二维码”后，这里会显示扫码图。</div>}</div>
                    <div className="qr-meta"><div className="qr-status-line"><span>当前状态</span><strong>{pollState?.status ?? "未开始"}</strong></div><div className="small-note">支持扫码自动接入，也支持复制 token 做手动连接测试。</div></div>
                  </div>
                </section> : null}
                {!currentRoleIsWorker ? <section className="surface">
                  <div className="section-head"><div><div className="section-kicker">手动模式</div><h3>Token 连接</h3></div></div>
                  <div className="form-grid">
                    <label><span>WeChat Base URL</span><input value={wechatBaseUrl} onChange={(event) => setWechatBaseUrl(event.target.value)} placeholder="https://ilinkai.weixin.qq.com" /></label>
                    <label><span>手动 Token</span><textarea value={manualToken} onChange={(event) => setManualToken(event.target.value)} placeholder="也可以先扫码，扫码确认后会自动填入并接入。" /></label>
                  </div>
                  <div className="inline-actions"><button onClick={connectManualToken} disabled={busy !== null}>{busy === "wechat-connect" ? "连接中..." : "使用当前 Token 连接"}</button><button onClick={disconnectWeChat} disabled={busy !== null}>断开连接</button></div>
                </section> : null}
              </div>
            </div>
          </section>
        ) : (
          <section className="workspace-frame session-workspace">
            {/* console_only gateway status banner - req 4.2, 4.5 */}
            {effectiveRole === "console_only" ? (
              systemStatus !== null ? (
                <div className="console-gateway-banner">
                  <span>网关：{currentGatewayBaseUrl}</span>
                  <span>Redis：{systemStatus.redis_ok ? "在线" : "不可用"}</span>
                  <span>在线节点：{systemStatus.active_nodes}</span>
                </div>
              ) : sessionsLoaded ? (
                <div className="console-gateway-banner-error">
                  <span>目标网关不可达</span>
                  <button type="button" className="ghost-button" onClick={() => setWorkspace("quick_setup")}>前往快速配置</button>
                </div>
              ) : null
            ) : null}
            <aside className="session-rail surface">
              <div className="rail-channel-card">
                <div className="rail-channel-top"><div><div className="section-kicker">微信通道</div><h3>默认 Agent 接入</h3></div><span className="count-badge">{sessions.length}</span></div>
                <div className="rail-channel-meta"><span>{wechatRuntimeSummary.value}</span><span>{systemStatus?.active_nodes ?? 0} 节点</span></div>
              </div>
              <div className="rail-heading"><div><div className="section-kicker">筛选</div><h3>会话列表</h3></div><span className="small-note">{sessionsLoaded ? "实时" : "加载中"}</span></div>
              <div className="filter-row" role="tablist" aria-label="Session filters">
                {FILTERS.map((item) => <button key={item.key} type="button" className={`filter-chip ${sessionFilter === item.key ? "filter-chip-active" : ""}`} onClick={() => setSessionFilter(item.key)}>{item.label} {counts[item.key]}</button>)}
              </div>
              <div className="session-list">
                {!sessionsLoaded ? <div className="empty-state">正在读取会话列表…</div> : !filteredSessions.length ? <div className="empty-state">当前筛选条件下还没有会话。</div> : filteredSessions.map((session) => (
                  <button key={session.session_id} type="button" className={`session-card ${session.session_id === selectedSessionId ? "session-card-active" : ""}`} onClick={() => setSelectedSessionId(session.session_id)} title={`${session.user_id}\n${session.session_id}`}>
                    <div className="session-card-top">
                      <div className="session-card-title-wrap">
                        <div className="session-card-title">{formatSessionName(session.user_id)}</div>
                        <div className="session-card-channel">{session.channel}</div>
                        <div className="session-card-id" title={session.user_id}>{formatWechatIdentity(session.user_id)}</div>
                      </div>
                      <span className={`session-badge session-badge-${sessionBadgeTone(session)}`}>{getSessionBadgeLabel(session)}</span>
                    </div>
                    <div className="session-card-preview">{sessionPreview(session)}</div>
                    <div className="session-card-meta"><span>{formatTimeAgo(session.last_message_at, now)}</span><span>{session.assigned_node_id || "待分配节点"}</span></div>
                    <div className="session-card-meta"><span>{session.message_count} 条消息</span><span className="truncate-inline">{truncateText(session.session_id, 12, 10)}</span></div>
                  </button>
                ))}
              </div>
            </aside>

            <div className="chat-column">
              <div className="chat-column-shell">
                <div className="surface stage-header">
                  {selectedSession ? (
                    <>
                      <div className="stage-header-main">
                        <div><div className="section-kicker">当前会话</div><h2>{formatSessionName(selectedSession.user_id)}</h2><div className="subtitle-stack"><span title={selectedSession.user_id}>{selectedSession.user_id}</span><span>{selectedSession.channel}</span><span title={selectedSession.session_id}>{selectedSession.session_id}</span></div></div>
                        <div className="stage-meta-row"><MetaPill label="Agent" value={selectedSession.agent_id} /><MetaPill label="节点" value={selectedSession.assigned_node_id || "未绑定"} /><MetaPill label="槽位" value={selectedSession.assigned_slot_id || "未占用"} /><MetaPill label="路由" value={selectedSession.routing_mode === "manual" ? "手动切换" : "自动分配"} /><MetaPill label="状态" value={getSessionBadgeLabel(selectedSession)} />{!currentRoleIsWorker ? <button type="button" className="ghost-button session-switch-trigger" onClick={() => void switchSessionNode(selectedSession.session_id)} disabled={busy !== null}>{busy === "session-switch-node" ? "切换中..." : "切换节点"}</button> : null}<button type="button" className="memory-inline-trigger" onClick={() => setInspectorOpen(true)}>会话记忆</button></div>
                      </div>
                      <div className="header-status-line"><span>上下文版本 v{selectedSession.context_version}</span><span>最后调度 {formatTimeLabel(selectedSession.last_dispatch_at || selectedSession.updated_at, true)}</span><span>{typingState || channelReleaseHint || "当前没有活跃任务"}</span></div>
                    </>
                  ) : <div className="empty-state empty-state-tall">选择一个会话，或先在微信里给机器人发一条消息。</div>}
                </div>

                <section className="surface transcript-surface">
                  <div className="section-head compact-head"><div><div className="section-kicker">Transcript</div><h3>聊天时间线</h3></div>{typingState ? <div className="typing-status-inline">{typingState}</div> : null}</div>
                  <div ref={messagesRef} className="message-stream" onScroll={handleMessageStreamScroll}>
                    {!selectedSession ? <div className="empty-state">选择一个会话后，这里会显示完整聊天内容。</div> : !messagesLoaded ? <div className="empty-state"><span className="loading-spinner" />正在加载聊天内容…</div> : !messages.length ? <div className="empty-state">当前会话还没有消息。</div> : messages.map((message, index) => (
                      <div key={message.message_id}>
                        {showDateDivider(messages, index) ? <div className="date-divider">{formatDayLabel(message.created_at)}</div> : null}
                        <div className={`message-row message-row-${message.role === "user" ? "user" : "assistant"}`}>
                          <div className={`message-bubble message-bubble-${message.role}`}>
                            <div className="message-role-line"><span className="message-role">{roleLabel(message.role)}</span>{message.node_id || message.actor_id ? <span className="message-role-meta">{message.node_id || message.actor_id}</span> : null}<span>{formatTimeLabel(message.created_at, true)}</span></div>
                            <div className="message-content">{message.content}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {typingState && selectedSession ? <div className="message-row message-row-assistant"><div className="message-bubble message-bubble-typing"><div className="typing-line"><span className="typing-dots" aria-hidden="true"><span /><span /><span /></span><span>{typingState}</span></div></div></div> : null}
                  </div>
                </section>

                <div
                  className={`drawer-overlay ${inspectorOpen ? "is-visible" : ""}`}
                  onClick={() => setInspectorOpen(false)}
                  aria-hidden={inspectorOpen ? "false" : "true"}
                />
                <aside className={`side-drawer ${inspectorOpen ? "is-visible" : ""}`} aria-hidden={inspectorOpen ? "false" : "true"}>
                  <section className="drawer-panel">
                    <div className="section-head compact-head">
                      <div>
                        <div className="section-kicker">右侧检查器</div>
                        <h3>会话记忆</h3>
                      </div>
                      <button type="button" className="drawer-close" onClick={() => setInspectorOpen(false)}>
                        收起
                      </button>
                    </div>
                    <div className="inspector-collapsed-note">
                      模型自动记录的会话记忆会在这里展示，不占用主聊天工作区宽度。
                    </div>
                    <div className="context-summary">
                      {selectedSession?.context_summary || "当前还没有摘要，首版先依赖会话上下文版本与最近消息维持跨节点一致性。"}
                    </div>
                    <div className="memory-meta-block">
                      <InfoRow label="当前用户" value={selectedSession ? formatWechatIdentity(selectedSession.user_id) : "未选中会话"} multiline />
                      <InfoRow label="会话 ID" value={selectedSession?.session_id || "-"} multiline />
                      <InfoRow label="上下文版本" value={selectedSession ? `v${selectedSession.context_version}` : "-"} />
                      <InfoRow label="当前节点" value={selectedSession?.assigned_node_id || "未绑定"} />
                      <InfoRow label="当前槽位" value={selectedSession?.assigned_slot_id || "未占用"} />
                      <InfoRow label="路由模式" value={selectedSession ? (selectedSession.routing_mode === "manual" ? "手动切换" : "自动分配") : "-"} />
                      <InfoRow label="通道状态" value={channelReleaseHint || (selectedSession?.assigned_slot_id ? "通道租约有效" : "等待重新分配")} multiline />
                      <InfoRow label="最近用户消息" value={latestUserMessage?.content || "暂无"} multiline />
                      <InfoRow label="最近 Bot 回复" value={latestBotMessage?.content || "暂无"} multiline />
                    </div>
                  </section>
                </aside>
              </div>
            </div>

          </section>
        )}
      </div>
      {(() => {
        const isPairingTimeout = pairingModalTaskId !== null && pairingModalTask?.status !== "succeeded" && pairingModalTask?.status !== "failed" && now - pairingModalStartedAt > 30000;
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
        return pairingModalTaskId !== null ? (
          <div className="pairing-modal-overlay" onClick={() => { if (pairingModalTask?.status === "failed" || isPairingTimeout) closePairingModal(); }}>
            <div className="pairing-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="pairing-modal-title">节点配对</div>
              <div className="pairing-modal-status">{pairingStatusText}</div>
              {(pairingModalTask?.status === "running" || pairingModalTask === null) && !isPairingTimeout ? (
                <div className="pairing-modal-spinner" aria-label="配对中" />
              ) : null}
              {(pairingModalTask?.status === "failed" || isPairingTimeout) ? (
                <div className="pairing-modal-actions">
                  <button type="button" onClick={closePairingModal}>重试</button>
                  <button type="button" className="ghost-button" onClick={closePairingModal}>关闭</button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null;
      })()}
    </div>
  );
}

function StatusChip({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" }) { return <div className={`status-chip status-chip-${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
function SetupStepPill({ label, active, done }: { label: string; active?: boolean; done?: boolean }) { return <div className={`setup-step-pill ${active ? "setup-step-pill-active" : ""} ${done ? "setup-step-pill-done" : ""}`}>{label}</div>; }
function PrepStrip({ label, detail, tone }: { label: string; detail: string; tone: "good" | "warn" }) { return <div className="prep-strip"><div className={`prep-dot prep-dot-${tone}`} /><div className="prep-copy"><strong>{label}</strong><span>{detail}</span></div></div>; }
function Metric({ title, value }: { title: string; value: string }) { return <div className="metric-card"><div className="metric-title">{title}</div><div className="metric-value">{value}</div></div>; }
function InfoRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) { return <div className="info-row"><span>{label}</span><strong className={multiline ? "multiline" : ""}>{value}</strong></div>; }
function MetaPill({ label, value }: { label: string; value: string }) { return <div className="meta-pill"><span>{label}</span><strong>{value}</strong></div>; }
function SnippetBlock({ label, content }: { label: string; content: string }) { return <div className="snippet-block"><div className="snippet-label">{label}</div><div className="snippet-content">{content}</div></div>; }
function ConnectionHeroCard({ eyebrow, title, detail, tone }: { eyebrow: string; title: string; detail: string; tone: "good" | "warn" }) {
  return (
    <article className={`connection-hero-card connection-hero-card-${tone}`}>
      <div className="connection-hero-eyebrow">{eyebrow}</div>
      <div className="connection-hero-title">{title}</div>
      <div className="connection-hero-detail">{detail}</div>
    </article>
  );
}
function ConnectionSignalCard({ label, value, meta, tone }: { label: string; value: string; meta: string; tone: "good" | "warn" }) {
  return (
    <article className={`connection-signal-card connection-signal-card-${tone}`}>
      <div className="connection-signal-label">{label}</div>
      <div className="connection-signal-value">{value}</div>
      <div className="connection-signal-meta">{meta}</div>
    </article>
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
  setSelectedNodeId((current) => current && next.inventory.some((item) => item.node_id === current) ? current : (next.inventory[0]?.node_id ?? next.nodes[0]?.node_id ?? null));
}
function matchesFilter(session: SessionRecord, filter: SessionFilter, now: number) { return filter === "processing" ? session.queue_status !== "none" || Boolean(session.active_task_id) : filter === "human" ? session.status === "human_active" || session.status === "handoff_pending" : filter === "recent" ? isRecent(session, now) : true; }
function isRecent(session: SessionRecord, now: number) { const updatedAt = new Date(session.updated_at).getTime(); return !Number.isNaN(updatedAt) && now - updatedAt <= 30 * 60 * 1000; }
function formatSessionName(userId: string) { return truncateText(userId.replace(/^wechat:/, ""), 10, 8); }
function formatWechatIdentity(userId: string) { return userId.startsWith("wechat:") ? userId : `微信ID ${userId}`; }
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
function sessionPreview(session: SessionRecord) { return session.status === "human_active" ? `人工已接管${session.claimed_by ? ` · ${session.claimed_by}` : ""}` : session.status === "handoff_pending" ? "用户请求转人工，等待坐席认领" : session.queue_status === "inflight" ? `${session.assigned_node_id || "节点"} 正在处理` : session.queue_status === "pending" ? "消息已入队，等待节点领取" : (session.context_summary || "当前没有新的处理事件"); }
function sessionBadgeTone(session: SessionRecord) { return session.status === "human_active" || session.status === "handoff_pending" ? "human" : session.queue_status === "pending" ? "queued" : session.queue_status === "inflight" || session.active_task_id ? "typing" : "idle"; }
function getSessionBadgeLabel(session: SessionRecord) { return session.queue_status === "inflight" ? "处理中" : session.queue_status === "pending" ? "排队中" : session.status === "human_active" ? "人工中" : session.status === "handoff_pending" ? "待接管" : "空闲"; }
function getTypingState(session: SessionRecord | null, now: number) { if (!session) return ""; if (session.queue_status === "pending") return `消息已入队，等待 ${session.assigned_node_id || "可用节点"} 领取任务`; if (session.queue_status === "inflight" || session.active_task_id) { const elapsed = session.last_dispatch_at ? Math.max(1, Math.floor((now - new Date(session.last_dispatch_at).getTime()) / 1000)) : null; return `${session.assigned_node_id || "Agent"} 正在输入${elapsed ? `，已处理 ${elapsed}s` : ""}`; } return ""; }
function getChannelReleaseHint(session: SessionRecord | null, now: number) {
  if (!session || session.assigned_slot_id || !session.slot_expires_at) return "";
  const releasedAt = new Date(session.slot_expires_at).getTime();
  if (Number.isNaN(releasedAt) || now < releasedAt) return "";
  return "当前通道已释放，等待下次消息自动重新分配。";
}
function shouldUseFastPolling(session: SessionRecord | null) { return !!session && (session.queue_status === "pending" || session.queue_status === "inflight" || Boolean(session.active_task_id)); }
function roleLabel(role: MessageRecord["role"]) { return role === "user" ? "微信用户" : role === "bot" ? "Agent 回复" : role === "human" ? "人工坐席" : "系统事件"; }
function truncateText(value: string, start = 6, end = 6) { return value.length <= start + end + 3 ? value : `${value.slice(0, start)}...${value.slice(-end)}`; }
function formatTimeLabel(value: string, withSeconds = false) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined }); }
function formatDayLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }); }
function formatTimeAgo(value: string, now: number) { const time = new Date(value).getTime(); if (Number.isNaN(time)) return "-"; const diff = Math.max(0, now - time); const minutes = Math.floor(diff / 60000); if (minutes < 1) return "刚刚"; if (minutes < 60) return `${minutes} 分钟前`; const hours = Math.floor(minutes / 60); return hours < 24 ? `${hours} 小时前` : formatDayLabel(value); }
function showDateDivider(messages: MessageRecord[], index: number) { if (!index) return true; return new Date(messages[index].created_at).toDateString() !== new Date(messages[index - 1].created_at).toDateString(); }
