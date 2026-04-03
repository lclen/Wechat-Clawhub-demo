import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

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
type NodeInventoryConnectionState = "connected" | "pairing_pending" | "register_failed" | "auth_failed" | "paired_offline" | "online_unpaired";
type NodeInventoryRecord = { node_id: string; paired: boolean; online: boolean; connection_state: NodeInventoryConnectionState; status: string | null; last_heartbeat_at: string | null; updated_at: string | null; hostname: string | null; lan_ip: string | null; platform: string | null; node_version: string | null; advertised_address: string | null; last_error: string | null; base_url: string | null; max_concurrency: number | null; current_load: number | null; channel_capacity: number | null; channel_in_use: number | null };
type NodeInventorySummary = { paired_total: number; online_total: number; offline_total: number };
type NodeListResponse = { nodes: NodeRecord[]; inventory: NodeInventoryRecord[]; summary: NodeInventorySummary };
type NodeMessageItem = { session_id: string; user_id: string; channel: string; role: MessageRecord["role"]; content: string; created_at: string; node_id: string | null };
type SessionsResponse = { sessions: SessionRecord[] };
type SessionMessagesResponse = { session: SessionRecord; messages: MessageRecord[] };
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
type LauncherComponentStatus = { name: string; state: LauncherState; pid: number | null; detail: string; started_at: string | null; log_path: string | null };
type LauncherProfile = { workdir: string; gateway_port: number; launcher_port: number; host_redis_port: number; node_cache_redis_port: number; enable_local_node: boolean; node_cache_policy: LauncherNodeCachePolicy; dispatch_mode_enabled: boolean; redis_source: LauncherRedisSource; node_cache_redis_source: LauncherRedisSource; bootstrap_completed: boolean };
type LauncherWorkdirLayout = { root: string; host_redis_dir: string; transcript_dir: string; identity_dir: string; memory_dir: string; log_dir: string; runtime_dir: string; config_dir: string; node_cache_dir: string };
type LauncherRedisInstallState = { installed: boolean; source: LauncherRedisSource; archive_path: string; executable_path: string; version: string; detail: string };
type LauncherEnvironmentCheck = { name: string; ready: boolean; detail: string };
type LauncherEnvironmentStatus = { ready: boolean; python_version: string; checks: LauncherEnvironmentCheck[] };
type LauncherStatusResponse = { profile: LauncherProfile; layout: LauncherWorkdirLayout; host_redis: LauncherRedisInstallState; node_cache_redis: LauncherRedisInstallState; environment: LauncherEnvironmentStatus; components: LauncherComponentStatus[] };
type LauncherLogResponse = { component: string; log_path: string | null; content: string };
type SelectWorkdirResponse = { profile: LauncherProfile; layout: LauncherWorkdirLayout };
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

const FAST_POLL_MS = 1200;
const IDLE_POLL_MS = 3200;
const SETUP_DRAFT_KEY = "wechat-claw-hub.quick-setup.draft";
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
      role: parsed.role ?? null,
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

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) throw new Error((await response.text()) || `Request failed: ${response.status}`);
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

function roleComponentsToStop(role: SetupRole): LauncherComponentName[] {
  if (role === "console_only") return ["local-node", "gateway", "node-cache-redis", "host-redis"];
  if (role === "worker_node") return ["gateway", "node-cache-redis", "host-redis"];
  return [];
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
  const [workspace, setWorkspace] = useState<WorkspaceTab>("quick_setup");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [setupProfile, setSetupProfile] = useState<SetupProfileResponse | null>(null);
  const [setupRole, setSetupRole] = useState<SetupRole | null>(initialDraft.role);
  const [setupMode, setSetupMode] = useState<SetupMode>(initialDraft.role ? "config" : "role");
  const [gatewaySetup, setGatewaySetup] = useState<GatewaySetupConfig>(initialDraft.gateway);
  const [workerSetup, setWorkerSetup] = useState<WorkerNodeSetupConfig>(initialDraft.worker);
  const [consoleSetup, setConsoleSetup] = useState<ConsoleSetupConfig>(initialDraft.console);
  const [setupTask, setSetupTask] = useState<SetupTaskResult | null>(null);
  const [discoveredNodes, setDiscoveredNodes] = useState<DiscoveredNodeRecord[]>([]);
  const [pairingSecrets, setPairingSecrets] = useState<Record<string, string>>({});
  const [pairingStatuses, setPairingStatuses] = useState<Record<string, PairingStatus>>({});
  const [manualPair, setManualPair] = useState<ManualPairDraft>(DEFAULT_MANUAL_PAIR);
  const [pairingDebugEntries, setPairingDebugEntries] = useState<PairingDebugEntry[]>([]);
  const [reconfigureConfirmOpen, setReconfigureConfirmOpen] = useState(false);
  const [launcherStatus, setLauncherStatus] = useState<LauncherStatusResponse | null>(null);
  const [launcherAvailable, setLauncherAvailable] = useState(false);
  const [launcherLogs, setLauncherLogs] = useState<Record<string, string>>({});
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [modelCheck, setModelCheck] = useState<ModelCheck | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [wechatStatus, setWechatStatus] = useState<WeChatStatus | null>(null);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [nodeInventory, setNodeInventory] = useState<NodeInventoryRecord[]>([]);
  const [nodeInventorySummary, setNodeInventorySummary] = useState<NodeInventorySummary>({ paired_total: 0, online_total: 0, offline_total: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeMessages, setNodeMessages] = useState<NodeMessageItem[]>([]);
  const [nodeMessagesLoaded, setNodeMessagesLoaded] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [qr, setQr] = useState<QrStart | null>(null);
  const [qrImageSrc, setQrImageSrc] = useState("");
  const [pollState, setPollState] = useState<PollResponse | null>(null);
  const [wechatBaseUrl, setWechatBaseUrl] = useState("https://ilinkai.weixin.qq.com");
  const [manualToken, setManualToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("正在读取主网关状态。");
  const [now, setNow] = useState(Date.now());
  const [workerGatewayProbeTask, setWorkerGatewayProbeTask] = useState<SetupTaskResult | null>(null);
  const [workerPairingKeyVisible, setWorkerPairingKeyVisible] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const workerGatewayAutoProbeKeyRef = useRef("");

  useEffect(() => {
    window.localStorage.setItem(
      SETUP_DRAFT_KEY,
      JSON.stringify({
        role: setupRole,
        gateway: gatewaySetup,
        worker: workerSetup,
        console: consoleSetup,
      }),
    );
  }, [setupRole, gatewaySetup, workerSetup, consoleSetup]);

  useEffect(() => {
    if (!workerSetup.pairing_key.trim()) return;
    setManualPair((current) => (current.pairing_key.trim() ? current : { ...current, pairing_key: workerSetup.pairing_key.trim() }));
  }, [workerSetup.pairing_key]);

  useEffect(() => {
    if (!isWorkerRole(resolveEffectiveRole(setupRole, setupProfile?.completed_roles ?? []))) return;
    const gatewayBaseUrl = workerSetup.gateway_base_url.trim();
    const nodeId = workerSetup.node_id.trim();
    if (!gatewayBaseUrl || !nodeId || busy === "setup-gateway-probe") return;
    const probeKey = `${gatewayBaseUrl}::${nodeId}`;
    if (workerGatewayAutoProbeKeyRef.current === probeKey) return;
    const timer = window.setTimeout(() => {
      void probeWorkerGateway({ silent: true, reason: "auto" });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [busy, setupProfile?.completed_roles, setupRole, workerSetup.gateway_base_url, workerSetup.node_id]);

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
    requestAnimationFrame(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    });
  }, [messages.length, activeSession?.active_task_id, activeSession?.queue_status]);

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
    let cancelled = false;
    void (async () => {
      try {
        const [system, model, wechat, nodeList, sessionList, profile] = await Promise.all([
          requestJson<SystemStatus>("/api/system/status"),
          requestJson<ModelStatus>("/api/models/builtin/status"),
          requestJson<WeChatStatus>("/api/wechat/onboard/status"),
          requestJson<NodeListResponse>("/api/nodes"),
          requestJson<SessionsResponse>("/api/sessions"),
          requestJson<SetupProfileResponse>("/api/setup/profile"),
        ]);
        if (cancelled) return;
        const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, system);
        setSetupProfile(profile);
        setWorkspace(profile.recommended_workspace);
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
        setModelStatus(model);
        if (wechat.base_url) setWechatBaseUrl(wechat.base_url);
        setWechatStatus(wechat);
        syncNodeState(nodeList, setNodes, setNodeInventory, setNodeInventorySummary, setSelectedNodeId);
        syncSessions(sessionList.sessions, setSessions, setSelectedSessionId, setActiveSession);
        setSessionsLoaded(true);
        setNotice(
          profile.recommended_workspace === "quick_setup"
            ? "检测到这是首次启动，先完成快速配置。"
            : system.redis_ok
              ? (sessionList.sessions.length ? "主网关在线。默认进入会话观察台。" : "主网关在线。可以先在接入中心做模型检测。")
              : "主网关已启动，但 Redis 当前不可用。",
        );
      } catch (error) {
        if (!cancelled) setNotice(`读取状态失败：${(error as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (workspace !== "quick_setup" || !setupProfile?.setup_completed) return;
    setSetupMode((current) => (current === "config" || current === "preview" ? current : "status"));
  }, [workspace, setupProfile?.setup_completed]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const run = async () => {
      try {
        const detailPromise = selectedSessionId ? requestJson<SessionMessagesResponse>(`/api/sessions/${encodeURIComponent(selectedSessionId)}/messages`) : Promise.resolve(null);
        const [wechat, nodeList, sessionList, detail] = await Promise.all([
          requestJson<WeChatStatus>("/api/wechat/onboard/status"),
          requestJson<NodeListResponse>("/api/nodes"),
          requestJson<SessionsResponse>("/api/sessions"),
          detailPromise,
        ]);
        if (cancelled) return;
        if (wechat.base_url) setWechatBaseUrl(wechat.base_url);
        setWechatStatus(wechat);
        syncNodeState(nodeList, setNodes, setNodeInventory, setNodeInventorySummary, setSelectedNodeId);
        syncSessions(sessionList.sessions, setSessions, setSelectedSessionId, setActiveSession);
        setSessionsLoaded(true);
        if (detail) {
          setActiveSession(detail.session);
          setMessages(detail.messages);
        } else {
          setMessages([]);
        }
        setMessagesLoaded(true);
      } catch {
        // keep live polling resilient
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void run(), shouldUseFastPolling(activeSession) ? FAST_POLL_MS : IDLE_POLL_MS);
      }
    };
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedSessionId, activeSession?.active_task_id, activeSession?.queue_status]);

  useEffect(() => {
    if (!selectedSessionId) {
      setActiveSession(null);
      setMessages([]);
      setMessagesLoaded(true);
      return;
    }
    let cancelled = false;
    setMessagesLoaded(false);
    requestJson<SessionMessagesResponse>(`/api/sessions/${encodeURIComponent(selectedSessionId)}/messages`).then((detail) => {
      if (cancelled) return;
      setActiveSession(detail.session);
      setMessages(detail.messages);
      setMessagesLoaded(true);
    }).catch(() => {
      if (!cancelled) setMessagesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedNodeId) {
      setNodeMessages([]);
      setNodeMessagesLoaded(true);
      return;
    }

    const targetSessions = sessions.filter((session) => session.assigned_node_id === selectedNodeId);
    if (!targetSessions.length) {
      setNodeMessages([]);
      setNodeMessagesLoaded(true);
      return;
    }

    let cancelled = false;
    setNodeMessagesLoaded(false);

    void Promise.all(
      targetSessions.map(async (session) => {
        const detail = await requestJson<SessionMessagesResponse>(
          `/api/sessions/${encodeURIComponent(session.session_id)}/messages`,
        );
        return detail.messages
          .filter((message) => (message.node_id || session.assigned_node_id) === selectedNodeId)
          .map((message) => ({
            session_id: session.session_id,
            user_id: session.user_id,
            channel: session.channel,
            role: message.role,
            content: message.content,
            created_at: message.created_at,
            node_id: message.node_id,
          }));
      }),
    )
      .then((groups) => {
        if (cancelled) return;
        const merged = groups.flat().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 30);
        setNodeMessages(merged);
        setNodeMessagesLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setNodeMessagesLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, sessions]);

  useEffect(() => {
    if (!setupTask || (setupTask.status !== "pending" && setupTask.status !== "running")) return;
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
          if (!cancelled) setSetupProfile(profile);
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
  }, [setupRole, setupTask]);

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
        return setNotice("扫码已确认，微信 bot 已接入主网关。");
      }
      setNotice(result.status === "scaned" ? "二维码已扫码，请在手机端确认。" : result.status === "expired" ? "二维码已过期，请重新生成。" : result.status === "error" ? `扫码状态异常：${result.message ?? "未知错误"}` : "等待用户扫码。");
    } catch (error) { setNotice(`轮询失败：${(error as Error).message}`); }
  }
  async function connectWeChat(token: string, baseUrl: string) {
    const status = await withBusy("wechat-connect", () => requestJson<WeChatStatus>("/api/wechat/onboard/connect", { method: "POST", body: JSON.stringify({ token, base_url: baseUrl, enable_polling: true }) }));
    setWechatStatus(status); setManualToken(token); if (status.base_url) setWechatBaseUrl(status.base_url); return status;
  }
  async function connectManualToken() { if (!manualToken.trim()) return setNotice("请先填写 token，或通过扫码自动获取。"); try { await connectWeChat(manualToken.trim(), wechatBaseUrl.trim()); setNotice("微信 bot 已使用手动 token 连接成功。"); } catch (error) { setNotice(`手动连接失败：${(error as Error).message}`); } }
  async function disconnectWeChat() { try { const status = await withBusy("wechat-disconnect", () => requestJson<WeChatStatus>("/api/wechat/onboard/disconnect", { method: "POST" })); setWechatStatus(status); setNotice("微信轮询已停止。"); } catch (error) { setNotice(`断开失败：${(error as Error).message}`); } }
  async function ensureLauncherRuntimeForQuickSetup(role: SetupRole) {
    if (!launcherAvailable || !launcherStatus?.profile.workdir) return;
    const running = runningLauncherComponents(launcherStatus);
    const needsHost = role !== "worker_node";
    const needsGateway = role !== "worker_node";
    const needsLocalNode = true;
    const shouldStart =
      (needsHost && !running.has("host-redis")) ||
      (needsGateway && !running.has("gateway")) ||
      (needsLocalNode && !running.has("local-node"));
    if (!shouldStart) return;
    try {
      await withBusy(
        "launcher-start",
        () => requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify({
            enable_local_node: true,
            enable_node_cache_redis: launcherStatus.profile.node_cache_policy !== "disabled",
            dispatch_mode_enabled: false,
            redis_source: launcherStatus.profile.redis_source || "mirror",
            node_cache_redis_source: launcherStatus.profile.node_cache_redis_source || "mirror",
          }),
        }),
      );
      await refreshLauncherStatus();
      setNotice(`已为${roleName(role)}预启动本地组件，便于立即配置网关与节点。`);
    } catch (error) {
      setNotice(`预启动本地组件失败：${(error as Error).message}`);
    }
  }
  async function applyLauncherPolicyForRole(role: SetupRole) {
    if (!launcherAvailable) return;
    const stopTargets = roleComponentsToStop(role);
    if (!stopTargets.length) {
      await refreshLauncherStatus();
      return;
    }
    const running = runningLauncherComponents(launcherStatus);
    const targets = stopTargets.filter((item) => running.has(item));
    if (!targets.length) return;
    try {
      await withBusy("launcher-stop", async () => {
        for (const component of targets) {
          await requestJson<LauncherStatusResponse>("/local/bootstrap/stop", {
            method: "POST",
            body: JSON.stringify({ component }),
          });
        }
      });
      await refreshLauncherStatus();
      setNotice(`已按${roleName(role)}收敛本地组件：${targets.map(launcherComponentName).join("、")}。`);
    } catch (error) {
      setNotice(`按角色收敛本地组件失败：${(error as Error).message}`);
    }
  }
  function selectSetupRole(role: SetupRole) {
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
    const profile = await requestJson<SetupProfileResponse>("/api/setup/profile");
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
      syncNodeState(nodeList, setNodes, setNodeInventory, setNodeInventorySummary, setSelectedNodeId);
      if (launcherAvailable) {
        await refreshLauncherStatus();
      }
      setNotice("已刷新当前连接状态。");
    } catch (error) {
      setNotice(`刷新快速配置状态失败：${(error as Error).message}`);
    }
  }
  async function refreshSystemStatus() {
    const system = await requestJson<SystemStatus>("/api/system/status");
    setSystemStatus(system);
  }
  async function refreshSessionDetail(sessionId: string) {
    const detail = await requestJson<SessionMessagesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
    setActiveSession(detail.session);
    setMessages(detail.messages);
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
      const result = await withBusy(
        "setup-worker",
        () => requestJson<SetupTaskEnvelope>("/api/setup/node/install", { method: "POST", body: JSON.stringify({ config: workerSetup }) }),
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
      const result = await withBusy(
        "setup-gateway-probe",
        () => requestJson<SetupTaskEnvelope>("/api/setup/gateway/probe", { method: "POST", body: JSON.stringify(payload) }),
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
    syncNodeState(next, setNodes, setNodeInventory, setNodeInventorySummary, setSelectedNodeId);
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
  async function chooseLauncherWorkdir() {
    try {
      await withBusy("launcher-select-workdir", () => requestJson<SelectWorkdirResponse>("/local/bootstrap/select-workdir", { method: "POST", body: JSON.stringify({ open_dialog: true }) }));
      await refreshLauncherStatus();
      setNotice("已更新存储库目录。");
    } catch (error) {
      setNotice(`选择存储库目录失败：${(error as Error).message}`);
    }
  }
  async function installLauncherRedis(target: "host" | "node-cache", source: LauncherRedisSource) {
    try {
      await withBusy(`launcher-install-${target}`, () => requestJson<LauncherStatusResponse>("/local/bootstrap/install-redis", { method: "POST", body: JSON.stringify({ target, source }) }));
      await refreshLauncherStatus();
      setNotice(target === "host" ? "主机 Redis 已准备完成。" : "节点缓存 Redis 已准备完成。");
    } catch (error) {
      setNotice(`安装 Redis 失败：${(error as Error).message}`);
    }
  }
  async function startLauncherStack(overrides?: { enableLocalNode?: boolean; enableNodeCacheRedis?: boolean }) {
    try {
      const enableNodeCacheRedis = overrides?.enableNodeCacheRedis ?? (launcherStatus?.profile.node_cache_policy !== "disabled");
      const enableLocalNode = overrides?.enableLocalNode ?? (launcherStatus?.profile.enable_local_node ?? true);
      await withBusy(
        "launcher-start",
        () => requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify({
            enable_local_node: enableLocalNode,
            enable_node_cache_redis: enableNodeCacheRedis,
            dispatch_mode_enabled: gatewaySetup.dispatch_mode_enabled,
            redis_source: launcherStatus?.profile.redis_source || "mirror",
            node_cache_redis_source: launcherStatus?.profile.node_cache_redis_source || "mirror",
          }),
        }),
      );
      await refreshLauncherStatus();
      setNotice("一体化组件启动命令已下发。");
    } catch (error) {
      setNotice(`启动本地组件失败：${(error as Error).message}`);
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
          syncNodeState(nodeList, setNodes, setNodeInventory, setNodeInventorySummary, setSelectedNodeId);
        }),
      ]);
      setNotice(result.detail || "已提交会话切换请求。");
    } catch (error) {
      setNotice(`切换会话节点失败：${(error as Error).message}`);
    }
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
      setNotice(result.task.summary || `节点 ${discovered.hostname} 配对结果：${result.pairing_status}`);
      const refreshedNodes = await requestJson<NodeListResponse>("/api/nodes");
      syncNodeState(refreshedNodes, setNodes, setNodeInventory, setNodeInventorySummary, setSelectedNodeId);
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
      setNotice(result.task.summary || `节点 ${payload.host} 配对结果：${result.pairing_status}`);
      setManualPair((current) => ({
        ...current,
        node_id: result.node_id || current.node_id,
      }));
      const refreshedNodes = await requestJson<NodeListResponse>("/api/nodes");
      syncNodeState(refreshedNodes, setNodes, setNodeInventory, setNodeInventorySummary, setSelectedNodeId);
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
      syncNodeState(refreshedNodes, setNodes, setNodeInventory, setNodeInventorySummary, setSelectedNodeId);
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
    if (setupMode === "config") return setSetupMode("preview");
    if (setupRole === "gateway_host") return void runGatewaySetup();
    if (setupRole === "gateway_host_console") return void runGatewayConsoleSetup();
    if (setupRole === "worker_node") return void runWorkerSetup();
    return void runConsoleSetup();
  }
  async function confirmReconfigure() {
    try {
      const stoppedActions: string[] = [];
      if (wechatStatus?.running) {
        const status = await withBusy("reconfigure-disconnect-wechat", () =>
          requestJson<WeChatStatus>("/api/wechat/onboard/disconnect", { method: "POST" }),
        );
        setWechatStatus(status);
        stoppedActions.push("已断开微信连接");
      }
      if (launcherAvailable && launcherStatus?.components?.some((item) => item.name === "local-node" && item.state === "running")) {
        await withBusy("reconfigure-stop-local-node", () =>
          requestJson<LauncherStatusResponse>("/local/bootstrap/stop", {
            method: "POST",
            body: JSON.stringify({ component: "local-node" }),
          }),
        );
        await refreshLauncherStatus();
        stoppedActions.push("已停止本机节点");
      }
      if ((setupCompletedRoles.has("worker_node") || workerSetup.node_id.trim()) && workerSetup.install_dir.trim()) {
        const result = await withBusy(
          "reconfigure-reset-worker-token",
          () => requestJson<SetupTaskEnvelope>("/api/setup/node/reset-credentials", {
            method: "POST",
            body: JSON.stringify({
              node_id: workerSetup.node_id.trim(),
              install_dir: workerSetup.install_dir.trim(),
            } satisfies NodeCredentialResetRequest),
          }),
        );
        setSetupTask(result.task);
        setWorkerSetup((current) => ({ ...current, node_token: "" }));
        stoppedActions.push("已清空本机节点 token");
      }
      setReconfigureConfirmOpen(false);
      setSetupRole(null);
      setSetupTask(null);
      setSetupMode("role");
      setNotice(`${stoppedActions.length ? `${stoppedActions.join("，")}，` : ""}已进入重新配置流程。`);
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
  const effectiveRole = useMemo(() => resolveEffectiveRole(setupRole, setupProfile?.completed_roles ?? []), [setupProfile?.completed_roles, setupRole]);
  const currentRoleIsGateway = isGatewayRole(effectiveRole);
  const currentRoleIsWorker = isWorkerRole(effectiveRole);
  const currentRoleIsConsole = isConsoleRole(effectiveRole);
  const currentRoleDisplay = useMemo(
    () => setupRole ? roleName(setupRole) : (setupProfile?.completed_roles.length ? setupProfile.completed_roles.map(roleName).join(" / ") : "未选择"),
    [setupProfile?.completed_roles, setupRole],
  );
  const currentNodeLanIp = systemStatus?.preferred_lan_ip || setupTask?.metadata.lan_ip || "";
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
        value: wechatStatus?.running ? "轮询中" : (wechatStatus?.has_token ? "已保存未连接" : "未连接"),
        tone: wechatStatus?.running ? "good" : "warn",
        detail: wechatStatus?.base_url || gatewaySetup.wechat_base_url || "未配置",
      },
      {
        title: "控制台目标",
        value: setupProfile?.console.gateway_base_url || "未配置",
        tone: setupProfile?.console.gateway_base_url ? "good" : "warn",
        detail: "重新配置时会覆盖该地址，不会自动解绑。",
      },
      {
        title: "网关运行",
        value: systemStatus?.redis_ok ? "Redis 正常" : "待检查",
        tone: systemStatus?.redis_ok ? "good" : "warn",
        detail: modelStatus?.configured ? `模型 ${modelStatus.model || "-"} 已配置` : "模型尚未完成检测或配置",
      },
      {
        title: "节点纳管",
        value: nodes.length ? `${nodes.length} 个在线节点` : "暂无在线节点",
        tone: nodes.length ? "good" : "warn",
        detail: latestSetupSummary,
      },
    ];
  }, [currentNodeLanIp, currentRoleIsWorker, gatewaySetup.wechat_base_url, latestSetupSummary, modelStatus?.configured, modelStatus?.model, nodes.length, setupCompletedRoles, setupProfile?.console.gateway_base_url, systemStatus?.redis_ok, wechatStatus?.base_url, wechatStatus?.has_token, wechatStatus?.running, workerGatewayConnection.detail, workerGatewayConnection.label, workerGatewayConnection.state, workerSetup.discovery_enabled, workerSetup.discovery_port, workerSetup.node_id, workerSetup.pairing_key]);
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
      lines.push(`节点角色：${nodeRoleLabel(workerGatewayConnection.remoteNode.node_id)}`);
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
  const nodeInventoryHeadline = useMemo(
    () => `已配对 ${nodeInventorySummary.paired_total} / 在线 ${nodeInventorySummary.online_total} / 离线 ${nodeInventorySummary.offline_total}`,
    [nodeInventorySummary.offline_total, nodeInventorySummary.online_total, nodeInventorySummary.paired_total],
  );
  const currentGatewayBaseUrl = consoleSetup.gateway_base_url || window.location.origin;

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
            <StatusChip label="网关" value={systemStatus?.redis_ok ? "Redis 正常" : "待检查"} tone={systemStatus?.redis_ok ? "good" : "warn"} />
            <StatusChip label="微信" value={wechatStatus?.running ? "轮询中" : "未连接"} tone={wechatStatus?.running ? "good" : "warn"} />
            <StatusChip label="节点" value={`${systemStatus?.active_nodes ?? 0} 在线`} tone={(systemStatus?.active_nodes ?? 0) > 0 ? "good" : "warn"} />
            <StatusChip label="模型" value={modelStatus?.model || "未配置"} tone={modelStatus?.configured ? "good" : "warn"} />
          </div>
          <div className="topbar-notice">{notice}</div>
        </header>

        <div className="workspace-tabs" role="tablist" aria-label="Primary workspaces">
          <button type="button" className={`workspace-tab ${workspace === "quick_setup" ? "workspace-tab-active" : ""}`} onClick={() => setWorkspace("quick_setup")}>快速配置</button>
          <button type="button" className={`workspace-tab ${workspace === "sessions" ? "workspace-tab-active" : ""}`} onClick={() => setWorkspace("sessions")}>会话观察台</button>
          <button type="button" className={`workspace-tab ${workspace === "connection" ? "workspace-tab-active" : ""}`} onClick={() => setWorkspace("connection")}>接入中心</button>
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
                {launcherAvailable ? (
                  <section className="surface surface-subsection">
                    <div className="section-head">
                      <div><div className="section-kicker">桌面启动器</div><h3>{currentRoleIsWorker ? "本机节点托管环境" : "单机一体化运行与存储库目录"}</h3></div>
                      <div className="inline-actions">
                        <button type="button" className="ghost-button" onClick={chooseLauncherWorkdir} disabled={busy !== null}>{busy === "launcher-select-workdir" ? "选择中..." : "选择存储库目录"}</button>
                        <button type="button" className="ghost-button" onClick={refreshLauncherStatus}>刷新状态</button>
                      </div>
                    </div>
                    <div className="info-stack">
                      <InfoRow label="存储库目录" value={launcherStatus?.layout.root || "尚未选择"} multiline />
                      <InfoRow label="Transcript" value={launcherStatus?.layout.transcript_dir || "-"} multiline />
                      <InfoRow label="身份信息目录" value={launcherStatus?.layout.identity_dir || "-"} multiline />
                      <InfoRow label="记忆目录" value={launcherStatus?.layout.memory_dir || "-"} multiline />
                      <InfoRow label="节点缓存策略" value={launcherStatus?.profile.node_cache_policy === "disabled" ? "关闭" : "已启用可选节点缓存 Redis"} />
                      {!currentRoleIsWorker ? <InfoRow label="分发模式" value={gatewaySetup.dispatch_mode_enabled ? "已开启（主机只分发）" : "已关闭（本机节点可处理）"} /> : null}
                    </div>
                    <section className="surface surface-subsection">
                      <div className="section-head">
                        <div><div className="section-kicker">环境检测</div><h3>初始化前先检查运行环境，防止重复安装</h3></div>
                      </div>
                      <div className="info-stack">
                        <InfoRow label="整体状态" value={launcherStatus?.environment.ready ? "已具备安装条件" : "存在缺失项"} />
                        <InfoRow label="Python 版本" value={launcherStatus?.environment.python_version || "未检测到"} />
                        {(launcherStatus?.environment.checks || []).map((item) => (
                          <InfoRow key={item.name} label={launcherEnvironmentLabel(item.name)} value={`${item.ready ? "已就绪" : "缺失"} · ${item.detail}`} multiline />
                        ))}
                      </div>
                    </section>
                    <div className="inline-actions quick-setup-actions">
                      {!currentRoleIsWorker ? <button type="button" onClick={() => installLauncherRedis("host", launcherStatus?.profile.redis_source || "mirror")} disabled={busy !== null}>{busy === "launcher-install-host" ? "下载中..." : "安装主机 Redis"}</button> : null}
                      <button type="button" className="ghost-button" onClick={() => startLauncherStack({ enableLocalNode: !(launcherStatus?.profile.enable_local_node ?? true) })} disabled={busy !== null}>{launcherStatus?.profile.enable_local_node ? "关闭本机 Claw 节点" : "启用本机 Claw 节点"}</button>
                      {!currentRoleIsWorker ? <button type="button" className="ghost-button" onClick={() => applyDispatchMode(!gatewaySetup.dispatch_mode_enabled)} disabled={busy !== null}>{busy === "dispatch-mode-toggle" ? "切换中..." : gatewaySetup.dispatch_mode_enabled ? "关闭分发模式" : "开启分发模式"}</button> : null}
                      <button type="button" className="ghost-button" onClick={() => toggleLauncherNodeCache(launcherStatus?.profile.node_cache_policy === "disabled")} disabled={busy !== null}>{launcherStatus?.profile.node_cache_policy === "disabled" ? "启用节点缓存 Redis" : "关闭节点缓存 Redis"}</button>
                      {launcherStatus?.profile.node_cache_policy !== "disabled" ? <button type="button" className="ghost-button" onClick={() => installLauncherRedis("node-cache", launcherStatus?.profile.node_cache_redis_source || "mirror")} disabled={busy !== null}>{busy === "launcher-install-node-cache" ? "下载中..." : "安装节点缓存 Redis"}</button> : null}
                      <button type="button" onClick={() => void startLauncherStack()} disabled={busy !== null}>{busy === "launcher-start" ? "启动中..." : "一键启动"}</button>
                      <button type="button" className="ghost-button" onClick={() => stopLauncherStack()} disabled={busy !== null}>{busy === "launcher-stop" ? "停止中..." : "停止全部"}</button>
                    </div>
                    <div className="discovery-list">
                      {(launcherStatus?.components || []).map((component) => (
                        <div key={component.name} className="discovery-card">
                          <div className="discovery-card-top">
                            <div>
                              <div className="node-card-title">{launcherComponentName(component.name)}</div>
                              <div className="node-card-subtitle">{component.detail || "等待启动"}</div>
                            </div>
                            <span className={`session-badge session-badge-${launcherBadgeTone(component.state)}`}>{launcherStateLabel(component.state)}</span>
                          </div>
                          <div className="inline-actions discovery-actions">
                            <button type="button" className="ghost-button" onClick={() => readLauncherLog(component.name)}>查看日志</button>
                            {component.name !== "launcher" && component.name !== "console" ? <button type="button" className="ghost-button" onClick={() => stopLauncherStack(component.name)} disabled={busy !== null}>停止该组件</button> : null}
                          </div>
                          {launcherLogs[component.name] ? <SnippetBlock label="最近日志" content={launcherLogs[component.name]} /> : null}
                        </div>
                      ))}
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
                          <InfoRow label="当前节点 IP" value={currentNodeLanIp || "-"} multiline />
                          <InfoRow label="目标网关地址" value={workerSetup.gateway_base_url || "-"} multiline />
                          <InfoRow label="网关连接状态" value={workerGatewayConnection.label} multiline />
                          <InfoRow label="节点安装目录" value={workerSetup.install_dir || "-"} multiline />
                          <InfoRow label="发现响应" value={workerSetup.discovery_enabled ? `已启用 · UDP ${workerSetup.discovery_port}` : "已关闭"} multiline />
                          <InfoRow label="最近任务" value={latestSetupSummary} multiline />
                          <SnippetBlock label="节点连接日志" content={workerConnectionLog || "这里会显示当前节点的安装、探测和注册日志。"} />
                        </>
                      ) : (
                        <>
                          <InfoRow label="微信 Base URL" value={wechatStatus?.base_url || gatewaySetup.wechat_base_url || "-"} multiline />
                          <InfoRow label="控制台目标网关" value={setupProfile?.console.gateway_base_url || "-"} multiline />
                          <InfoRow label="模型配置" value={modelStatus?.configured ? `${modelStatus.model || "-"} / ${modelStatus.base_url || "-"}` : DEFAULT_BUILTIN_MODEL_LABEL} multiline />
                          <InfoRow label="节点状态" value={nodes.length ? `${nodes.length} 个在线节点，最近任务：${latestSetupSummary}` : latestSetupSummary} multiline />
                        </>
                      )}
                    </div>
                    <section className="surface surface-subsection">
                      <div className="section-head">
                        <div><div className="section-kicker">节点凭据</div><h3>{currentRoleIsWorker ? "当前节点凭据与回连信息" : "查看 Token 与配对密钥状态"}</h3></div>
                      </div>
                      <div className="info-stack">
                        {workerCredentialRows.map((item) => <InfoRow key={item.label} label={item.label} value={item.value} multiline />)}
                      </div>
                      <SnippetBlock label="当前 token 发放方式" content="安装阶段不会生成 token。请在网关端扫描配对或手动配对，配对成功后由网关自动下发并覆盖节点 token。" />
                    </section>
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
                          <button type="button" className="ghost-button" onClick={() => setSetupMode("role")}>重新选角色</button>
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
                          <>
                            <div className="inline-tip">
                              当前节点 IP：{currentNodeLanIp || "未检测到"}。局域网内其他机器连接或排查当前节点时，可以优先使用这个地址。
                            </div>
                            <div className="form-grid">
                              <label><span>节点 ID</span><input value={workerSetup.node_id} onChange={(event) => updateWorkerSetup("node_id", event.target.value)} /></label>
                              <label>
                                <span>目标网关地址（局域网网关）</span>
                                <div className="field-with-action">
                                  <input value={workerSetup.gateway_base_url} onChange={(event) => updateWorkerSetup("gateway_base_url", event.target.value)} placeholder="填写局域网内实际要连接的网关地址，例如 http://192.168.0.18:8300" />
                                  <button type="button" className="ghost-button" onClick={applyPreferredGatewayBaseUrlToWorker}>填入当前机器的网关地址</button>
                                </div>
                              </label>
                              <label>
                                <span>配对密钥</span>
                                <div className="field-with-action">
                                  <input type={workerPairingKeyVisible ? "text" : "password"} value={workerSetup.pairing_key} onChange={(event) => updateWorkerSetup("pairing_key", event.target.value)} placeholder="给局域网自动连接使用，节点与网关需要保持一致。" autoComplete="new-password" />
                                  <button type="button" className="ghost-button" onClick={() => setWorkerPairingKeyVisible((current) => !current)}>{workerPairingKeyVisible ? "隐藏密钥" : "显示密钥"}</button>
                                </div>
                              </label>
                              <label><span>Dify Base URL</span><input value={workerSetup.dify_base_url} onChange={(event) => updateWorkerSetup("dify_base_url", event.target.value)} /></label>
                              <label><span>Dify API Key</span><textarea value={workerSetup.dify_api_key} onChange={(event) => updateWorkerSetup("dify_api_key", event.target.value)} /></label>
                              <label><span>最大并发</span><input type="number" value={workerSetup.max_concurrency} onChange={(event) => updateWorkerSetup("max_concurrency", Number(event.target.value) || 1)} /></label>
                              <label><span>安装目录</span><input value={workerSetup.install_dir} onChange={(event) => updateWorkerSetup("install_dir", event.target.value)} /></label>
                              <label><span>发现响应端口</span><input type="number" value={workerSetup.discovery_port} onChange={(event) => updateWorkerSetup("discovery_port", Number(event.target.value) || 9531)} /></label>
                              <label><span>启用局域网发现</span><input type="checkbox" checked={workerSetup.discovery_enabled} onChange={(event) => updateWorkerSetup("discovery_enabled", event.target.checked)} /></label>
                              <label><span>Bundle 路径（可选）</span><input value={workerSetup.bundle_path} onChange={(event) => updateWorkerSetup("bundle_path", event.target.value)} placeholder="留空则自动查找常见 bundle 位置，并在缺失时尝试现打包" /></label>
                            </div>
                            <section className="surface surface-subsection">
                              <div className="section-head">
                                <div><div className="section-kicker">连接状态</div><h3>当前节点与目标网关</h3></div>
                                <button type="button" className="ghost-button" onClick={() => void probeWorkerGateway({ reason: "manual" })} disabled={busy !== null}>{busy === "setup-gateway-probe" ? "检测中..." : "立即检测"}</button>
                              </div>
                              <div className="info-stack">
                                <InfoRow label="目标网关地址" value={workerSetup.gateway_base_url || "未填写"} multiline />
                                <InfoRow label="当前连接状态" value={workerGatewayConnection.label} multiline />
                                <InfoRow label="状态说明" value={workerGatewayConnection.detail} multiline />
                                {workerGatewayConnection.remoteNode ? <InfoRow label="网关侧节点回报" value={summarizeRemoteNode(workerGatewayConnection.remoteNode)} multiline /> : null}
                              </div>
                            </section>
                            <section className="surface surface-subsection">
                              <div className="section-head">
                                <div><div className="section-kicker">凭据与查看位置</div><h3>安装前确认节点凭据保存位置</h3></div>
                              </div>
                              <div className="inline-tip">
                                如果网关部署在局域网内另一台机器，请把这里填写成那台网关机器的实际访问地址；只有当当前机器本身就是网关时，才使用“填入当前机器的网关地址”。
                              </div>
                              <div className="info-stack">
                                {workerCredentialRows.map((item) => <InfoRow key={item.label} label={item.label} value={item.value} multiline />)}
                              </div>
                              <SnippetBlock label="当前 token 发放方式" content="当前不会生成节点 token。安装完成后，请回到网关端输入配对密钥，由网关自动下发 token 并确认注册。" />
                            </section>
                          </>
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
            <div className="connection-grid">
              <div className="connection-status-column">
                {!currentRoleIsWorker ? (
                <section className="surface surface-tight">
                  <div className="section-head"><div><div className="section-kicker">准备流程</div><h3>接入状态</h3></div><button onClick={runModelCheck} disabled={busy !== null}>{busy === "model-check" ? "检测中..." : "检测模型"}</button></div>
                  <div className="prep-strip-list">
                    <PrepStrip label="模型可用" detail={modelStatus?.configured ? modelStatus.model : "尚未检测"} tone={modelStatus?.configured ? "good" : "warn"} />
                    <PrepStrip label="微信已连接" detail={wechatStatus?.running ? "轮询中" : "未连接"} tone={wechatStatus?.running ? "good" : "warn"} />
                    <PrepStrip label="节点在线" detail={`${systemStatus?.active_nodes ?? 0} 个节点`} tone={(systemStatus?.active_nodes ?? 0) > 0 ? "good" : "warn"} />
                  </div>
                </section>
                ) : (
                <section className="surface surface-tight">
                  <div className="section-head"><div><div className="section-kicker">节点工作台</div><h3>当前节点状态</h3></div></div>
                  <div className="prep-strip-list">
                    <PrepStrip label="节点配置" detail={setupCompletedRoles.has("worker_node") ? "当前机器节点已完成配置" : "尚未完成节点配置"} tone={setupCompletedRoles.has("worker_node") ? "good" : "warn"} />
                    <PrepStrip label="目标网关地址" detail={workerSetup.gateway_base_url || "未填写局域网网关地址"} tone={workerSetup.gateway_base_url ? "good" : "warn"} />
                    <PrepStrip label="发现响应" detail={workerSetup.discovery_enabled ? `已启用 UDP ${workerSetup.discovery_port}` : "当前已关闭"} tone={workerSetup.discovery_enabled ? "good" : "warn"} />
                  </div>
                </section>
                )}
                {!currentRoleIsWorker ? <section className="surface">
                  <div className="section-head"><div><div className="section-kicker">运行摘要</div><h3>系统状态</h3></div><button type="button" className="ghost-button" onClick={() => void applyDispatchMode(!gatewaySetup.dispatch_mode_enabled)} disabled={busy !== null}>{busy === "dispatch-mode-toggle" ? "切换中..." : gatewaySetup.dispatch_mode_enabled ? "关闭分发模式" : "开启分发模式"}</button></div>
                  <div className="status-grid">
                    <Metric title="环境" value={systemStatus?.environment || "-"} />
                    <Metric title="模型" value={modelStatus?.model || "-"} />
                    <Metric title="微信接入" value={wechatStatus?.running ? "已连接" : "未连接"} />
                    <Metric title="在线节点" value={`${systemStatus?.active_nodes ?? 0}`} />
                    <Metric title="分发模式" value={systemStatus?.dispatch_mode_enabled ? "主机只分发" : "本机可处理"} />
                  </div>
                  {gatewaySetup.dispatch_mode_enabled && availableDispatchNodes === 0 ? <div className="topbar-notice dispatch-warning">当前已开启分发模式，但还没有可用的远端处理节点；网关会继续接收微信消息，但无法完成实际回复。</div> : null}
                </section> : null}
                {!currentRoleIsWorker ? <section className="surface">
                  <div className="section-head"><div><div className="section-kicker">检测回显</div><h3>模型与网关</h3></div></div>
                  <div className="info-stack">
                    <InfoRow label="主网关 Redis" value={systemStatus?.redis_ok ? "正常" : "未就绪"} />
                    <InfoRow label="模型 Base URL" value={modelStatus?.base_url || "-"} />
                    <InfoRow label="微信 Token" value={wechatStatus?.has_token ? "已存在" : "未配置"} />
                    <InfoRow label="模型检测" value={modelCheck ? (modelCheck.configured_model_available ? "可用" : "未命中模型列表") : "尚未检测"} />
                    <InfoRow label="最近错误" value={wechatStatus?.last_error || "无"} multiline />
                  </div>
                </section> : null}

                {!currentRoleIsWorker ? <section className="surface">
                  <div className="section-head">
                    <div><div className="section-kicker">节点清单</div><h3>已接入节点</h3></div>
                    <span className="small-note">{nodeInventoryHeadline}</span>
                  </div>
                  {!nodeInventory.length ? (
                    <div className="empty-state">当前还没有已接入节点。</div>
                  ) : (
                    <div className="node-cards">
                      {nodeInventory.map((node) => (
                        <div key={node.node_id} className="node-card">
                          <div className="node-card-top">
                            <div>
                              <div className="node-card-title">{node.hostname || node.node_id}</div>
                              <div className="node-card-subtitle">{node.node_id} · {nodeRoleLabel(node.node_id)}</div>
                            </div>
                            <div className="inline-actions">
                              <span className={`session-badge session-badge-${nodeInventoryBadgeTone(node.connection_state)}`}>
                                {nodeInventoryBadgeLabel(node.connection_state, node.paired)}
                              </span>
                              {node.paired ? <button type="button" className="ghost-button" onClick={() => void deletePairedNode(node)} disabled={busy !== null}>{busy === `delete-node-${node.node_id}` ? "删除中..." : "删除节点"}</button> : null}
                            </div>
                          </div>
                          <div className="node-card-grid">
                            <div>
                              <div className="node-card-label">局域网地址</div>
                              <div className="node-card-value">{node.lan_ip || "未上报"}</div>
                            </div>
                            <div>
                              <div className="node-card-label">上报地址</div>
                              <div className="node-card-value">{getInventoryNodeAddress(node)}</div>
                            </div>
                            <div>
                              <div className="node-card-label">平台</div>
                              <div className="node-card-value">{node.platform || "未知"}</div>
                            </div>
                            <div>
                              <div className="node-card-label">版本</div>
                              <div className="node-card-value">{node.node_version || "未知"}</div>
                            </div>
                            <div>
                              <div className="node-card-label">连接状态</div>
                              <div className="node-card-value">{describeInventoryConnection(node)}</div>
                            </div>
                            <div>
                              <div className="node-card-label">最近心跳</div>
                              <div className="node-card-value">{node.last_heartbeat_at ? formatTimeLabel(node.last_heartbeat_at, true) : "暂未上报"}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section> : null}
                <section className="surface">
                  <div className="section-head">
                    <div><div className="section-kicker">{currentRoleIsWorker ? "节点安装" : "节点纳管"}</div><h3>{currentRoleIsWorker ? "安装或重装当前机器节点" : "网关配置后继续添加工作节点"}</h3></div>
                    <button type="button" className="ghost-button" onClick={applyPreferredGatewayBaseUrlToWorker}>填入当前机器的网关地址</button>
                  </div>
                  <div className="inline-tip">
                    {currentRoleIsWorker ? "这里仅用于把当前这台机器配置成节点，并设置它回连哪个网关；如果当前机器同时承担网关，请优先使用桌面启动器托管本机节点。" : "这里复用同一套配对接口，适合网关已经保存完成后继续纳管、替换或修复其它节点。"}
                  </div>
                  <div className="form-grid">
                    <label><span>节点 ID</span><input value={workerSetup.node_id} onChange={(event) => updateWorkerSetup("node_id", event.target.value)} /></label>
                    <label><span>目标网关地址</span><input value={workerSetup.gateway_base_url} onChange={(event) => updateWorkerSetup("gateway_base_url", event.target.value)} placeholder="填写这台节点实际要连接的网关地址，例如 http://192.168.0.18:8300" /></label>
                    <label>
                      <span>配对密钥</span>
                      <div className="field-with-action">
                        <input type={workerPairingKeyVisible ? "text" : "password"} value={workerSetup.pairing_key} onChange={(event) => updateWorkerSetup("pairing_key", event.target.value)} placeholder="后续扫描配对时可直接复用这串密钥。" autoComplete="new-password" />
                        <button type="button" className="ghost-button" onClick={() => setWorkerPairingKeyVisible((current) => !current)}>{workerPairingKeyVisible ? "隐藏密钥" : "显示密钥"}</button>
                      </div>
                    </label>
                    <label><span>最大并发</span><input type="number" value={workerSetup.max_concurrency} onChange={(event) => updateWorkerSetup("max_concurrency", Number(event.target.value) || 1)} /></label>
                    <label><span>安装目录</span><input value={workerSetup.install_dir} onChange={(event) => updateWorkerSetup("install_dir", event.target.value)} /></label>
                    <label><span>Dify Base URL</span><input value={workerSetup.dify_base_url} onChange={(event) => updateWorkerSetup("dify_base_url", event.target.value)} /></label>
                    <label><span>Dify API Key</span><textarea value={workerSetup.dify_api_key} onChange={(event) => updateWorkerSetup("dify_api_key", event.target.value)} /></label>
                    <label><span>发现响应端口</span><input type="number" value={workerSetup.discovery_port} onChange={(event) => updateWorkerSetup("discovery_port", Number(event.target.value) || 9531)} /></label>
                    <label><span>启用局域网发现</span><input type="checkbox" checked={workerSetup.discovery_enabled} onChange={(event) => updateWorkerSetup("discovery_enabled", event.target.checked)} /></label>
                    <label><span>Bundle 路径（可选）</span><input value={workerSetup.bundle_path} onChange={(event) => updateWorkerSetup("bundle_path", event.target.value)} placeholder="留空则自动查找常见 bundle 位置，并在缺失时尝试现打包" /></label>
                  </div>
                  <div className="info-stack">
                    {workerCredentialRows.map((item) => <InfoRow key={`connection-${item.label}`} label={item.label} value={item.value} multiline />)}
                  </div>
                  <SnippetBlock label="当前 token 发放方式" content="节点安装阶段不会生成 token。只有网关发起配对时，才会自动签发并写入当前节点与网关配置。" />
                  <div className="inline-actions">
                    <button type="button" onClick={() => void runWorkerSetup({ showResultScreen: false })} disabled={busy !== null}>{busy === "setup-worker" ? "安装中..." : "安装当前机器节点"}</button>
                    {currentRoleIsWorker ? <button type="button" className="ghost-button" onClick={() => void probeWorkerGateway()} disabled={busy !== null}>{busy === "setup-gateway-probe" ? "检测中..." : "检测目标网关"}</button> : null}
                  </div>
                </section>
              </div>
              <div className="connection-action-column">
                {!currentRoleIsWorker ? (
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
                  </>
                ) : (
                  <section className="surface node-role-surface">
                    <div className="section-head"><div><div className="section-kicker">节点说明</div><h3>节点角色只配置当前机器，不纳管其它节点</h3></div></div>
                    <div className="inline-tip">
                      你当前选择的是节点角色，这里只保留当前机器的节点安装、回连、凭据和发现响应相关功能；扫描并纳管其它节点需要切换回网关角色。
                    </div>
                    <div className="info-stack">
                      <InfoRow label="目标网关地址" value={workerSetup.gateway_base_url || "未填写"} multiline />
                      <InfoRow label="网关连接状态" value={workerGatewayConnection.label} multiline />
                      <InfoRow label="连接详情" value={workerGatewayConnection.detail} multiline />
                      <InfoRow label="节点 ID" value={workerSetup.node_id || "未填写"} multiline />
                      <InfoRow label="配对密钥" value={workerSetup.pairing_key.trim() ? "已填写，可在左侧表单中显示/修改" : "未填写"} multiline />
                      {workerGatewayConnection.remoteNode ? <InfoRow label="网关侧节点记录" value={summarizeRemoteNode(workerGatewayConnection.remoteNode)} multiline /> : null}
                    </div>
                    <SnippetBlock label="节点连接日志" content={workerConnectionLog || "这里会显示当前节点被连接、探测、注册和心跳确认的详细日志。"} />
                  </section>
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
            <aside className="session-rail surface">
              <div className="rail-channel-card">
                <div className="rail-channel-top"><div><div className="section-kicker">微信通道</div><h3>默认 Agent 接入</h3></div><span className="count-badge">{sessions.length}</span></div>
                <div className="rail-channel-meta"><span>{wechatStatus?.running ? "运行中" : "未连接"}</span><span>{systemStatus?.active_nodes ?? 0} 节点</span></div>
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
                        <div className="stage-meta-row"><MetaPill label="Agent" value={selectedSession.agent_id} /><MetaPill label="节点" value={selectedSession.assigned_node_id || "未绑定"} /><MetaPill label="槽位" value={selectedSession.assigned_slot_id || "未占用"} /><MetaPill label="路由" value={selectedSession.routing_mode === "manual" ? "手动切换" : "自动分配"} /><MetaPill label="状态" value={getSessionBadgeLabel(selectedSession)} /><button type="button" className="ghost-button session-switch-trigger" onClick={() => void switchSessionNode(selectedSession.session_id)} disabled={busy !== null}>{busy === "session-switch-node" ? "切换中..." : "切换节点"}</button><button type="button" className="memory-inline-trigger" onClick={() => setInspectorOpen(true)}>会话记忆</button></div>
                      </div>
                      <div className="header-status-line"><span>上下文版本 v{selectedSession.context_version}</span><span>最后调度 {formatTimeLabel(selectedSession.last_dispatch_at || selectedSession.updated_at, true)}</span><span>{typingState || channelReleaseHint || "当前没有活跃任务"}</span></div>
                    </>
                  ) : <div className="empty-state empty-state-tall">选择一个会话，或先在微信里给机器人发一条消息。</div>}
                </div>

                <section className="surface transcript-surface">
                  <div className="section-head compact-head"><div><div className="section-kicker">Transcript</div><h3>聊天时间线</h3></div>{typingState ? <div className="typing-status-inline">{typingState}</div> : null}</div>
                  <div ref={messagesRef} className="message-stream">
                    {!selectedSession ? <div className="empty-state">选择一个会话后，这里会显示完整聊天内容。</div> : !messagesLoaded ? <div className="empty-state">正在加载聊天内容…</div> : !messages.length ? <div className="empty-state">当前会话还没有消息。</div> : messages.map((message, index) => (
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
) {
  setNodes(next.nodes);
  setNodeInventory(next.inventory);
  setNodeInventorySummary(next.summary);
  setSelectedNodeId((current) => current && next.nodes.some((item) => item.node_id === current) ? current : (next.nodes[0]?.node_id ?? null));
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
function nodeRoleLabel(nodeId: string) {
  return nodeId === "local-node" || nodeId.startsWith("claw-node-local") ? "本机节点" : "其它节点";
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
function summarizeRemoteNode(node: NodeInventoryRecord | NodeRecord) {
  return [
    `${node.hostname || node.node_id}（${nodeRoleLabel(node.node_id)}）`,
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
