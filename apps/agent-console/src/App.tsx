import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type ModelStatus = { configured: boolean; base_url: string; model: string };
type SystemStatus = { app_name: string; environment: string; version: string; redis_ok: boolean; dify_configured: boolean; wechat_configured: boolean; active_nodes: number; dispatch_mode_enabled: boolean; timestamp: string };
type ModelCheck = { ok: boolean; configured_model: string; available_models: string[]; configured_model_available: boolean };
type WeChatStatus = { configured: boolean; running: boolean; base_url: string; has_token: boolean; last_error: string | null; received_messages: number; sent_messages: number };
type SessionStatus = "bot_active" | "handoff_pending" | "human_active" | "closing";
type QueueStatus = "none" | "pending" | "inflight";
type RoutingMode = "auto" | "manual";
type SessionRecord = { session_id: string; channel: string; user_id: string; agent_id: string; status: SessionStatus; assigned_node_id: string | null; assigned_slot_id: string | null; active_task_id: string | null; queue_status: QueueStatus; context_summary: string; context_version: number; routing_mode: RoutingMode; slot_bound_at: string | null; slot_expires_at: string | null; reply_context_token: string | null; handoff_ticket_id: string | null; claimed_by: string | null; message_count: number; last_message_at: string; last_dispatch_at: string | null; created_at: string; updated_at: string; version: number };
type MessageRecord = { message_id: string; session_id: string; channel: string; user_id: string; role: "user" | "bot" | "human" | "system"; content: string; created_at: string; actor_id: string | null; node_id: string | null; metadata: Record<string, string> };
type NodeRecord = { node_id: string; base_url: string; advertised_address: string | null; lan_ip: string | null; max_concurrency: number; current_load: number; status: string; last_heartbeat_at: string; updated_at: string; last_error: string | null; load_ratio: number; node_version: string | null; platform: string | null; hostname: string | null; capabilities: string[]; channel_capacity: number; channel_in_use: number };
type NodeListResponse = { nodes: NodeRecord[] };
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
type PairingStatus = "pending" | "paired" | "auth_failed" | "already_paired" | "offline";
type DiscoveredNodeRecord = { discovery_id: string; node_id: string | null; pairing_label: string | null; hostname: string; lan_ip: string | null; platform: string | null; node_version: string | null; capabilities: string[]; advertised_address: string | null; pairing_required: boolean; already_paired: boolean; pairing_port: number; last_seen_at: string };
type SetupTaskResult = { task_id: string; kind: "gateway_save" | "gateway_console_setup" | "node_install" | "console_connect" | "discovery_scan" | "discovery_pair"; status: SetupTaskStatus; title: string; created_at: string; updated_at: string; summary: string; logs: string[]; metadata: Record<string, string> };
type SetupProfileResponse = { recommended_workspace: "quick_setup" | "connection" | "sessions"; setup_completed: boolean; completed_roles: SetupRole[]; available_roles: SetupRole[]; gateway: GatewaySetupConfig; console: ConsoleSetupConfig; last_task: SetupTaskResult | null };
type GatewaySetupSaveResponse = { task: SetupTaskResult; restart_required: boolean; applied_runtime: string[] };
type GatewayConsoleSetupRequest = { gateway: GatewaySetupConfig; console: ConsoleSetupConfig };
type SetupTaskEnvelope = { task: SetupTaskResult };
type DiscoveryScanResponse = { task: SetupTaskResult; nodes: DiscoveredNodeRecord[] };
type DiscoveryPairResponse = { task: SetupTaskResult; pairing_status: PairingStatus; node_id: string | null };
type LauncherState = "stopped" | "starting" | "running" | "degraded" | "failed";
type LauncherRedisSource = "github" | "mirror";
type LauncherNodeCachePolicy = "disabled" | "optional" | "enabled";
type LauncherComponentStatus = { name: string; state: LauncherState; pid: number | null; detail: string; started_at: string | null; log_path: string | null };
type LauncherProfile = { workdir: string; gateway_port: number; launcher_port: number; host_redis_port: number; node_cache_redis_port: number; enable_local_node: boolean; node_cache_policy: LauncherNodeCachePolicy; dispatch_mode_enabled: boolean; redis_source: LauncherRedisSource; node_cache_redis_source: LauncherRedisSource; bootstrap_completed: boolean };
type LauncherWorkdirLayout = { root: string; host_redis_dir: string; transcript_dir: string; identity_dir: string; memory_dir: string; log_dir: string; runtime_dir: string; config_dir: string; node_cache_dir: string };
type LauncherRedisInstallState = { installed: boolean; source: LauncherRedisSource; archive_path: string; executable_path: string; version: string; detail: string };
type LauncherStatusResponse = { profile: LauncherProfile; layout: LauncherWorkdirLayout; host_redis: LauncherRedisInstallState; node_cache_redis: LauncherRedisInstallState; components: LauncherComponentStatus[] };
type LauncherLogResponse = { component: string; log_path: string | null; content: string };
type SelectWorkdirResponse = { profile: LauncherProfile; layout: LauncherWorkdirLayout };
type WorkspaceTab = "quick_setup" | "sessions" | "connection";
type SessionFilter = "all" | "processing" | "human" | "recent";
type SetupMode = "status" | "role" | "config" | "preview" | "result";

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
  gateway_base_url: "http://127.0.0.1:8300",
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
  gateway_base_url: "http://127.0.0.1:8300",
};

const DEFAULT_BUILTIN_MODEL_LABEL = "DashScope OpenAI Compatible（默认 qwen3.5-plus）";

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) throw new Error((await response.text()) || `Request failed: ${response.status}`);
  return (await response.json()) as T;
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceTab>("quick_setup");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [setupProfile, setSetupProfile] = useState<SetupProfileResponse | null>(null);
  const [setupRole, setSetupRole] = useState<SetupRole | null>(null);
  const [setupMode, setSetupMode] = useState<SetupMode>("role");
  const [gatewaySetup, setGatewaySetup] = useState<GatewaySetupConfig>(DEFAULT_GATEWAY_SETUP);
  const [workerSetup, setWorkerSetup] = useState<WorkerNodeSetupConfig>(DEFAULT_WORKER_SETUP);
  const [consoleSetup, setConsoleSetup] = useState<ConsoleSetupConfig>(DEFAULT_CONSOLE_SETUP);
  const [setupTask, setSetupTask] = useState<SetupTaskResult | null>(null);
  const [discoveredNodes, setDiscoveredNodes] = useState<DiscoveredNodeRecord[]>([]);
  const [pairingSecrets, setPairingSecrets] = useState<Record<string, string>>({});
  const [pairingStatuses, setPairingStatuses] = useState<Record<string, PairingStatus>>({});
  const [reconfigureConfirmOpen, setReconfigureConfirmOpen] = useState(false);
  const [launcherStatus, setLauncherStatus] = useState<LauncherStatusResponse | null>(null);
  const [launcherAvailable, setLauncherAvailable] = useState(false);
  const [launcherLogs, setLauncherLogs] = useState<Record<string, string>>({});
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [modelCheck, setModelCheck] = useState<ModelCheck | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [wechatStatus, setWechatStatus] = useState<WeChatStatus | null>(null);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
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
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETUP_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        role?: SetupRole;
        gateway?: GatewaySetupConfig;
        worker?: WorkerNodeSetupConfig;
        console?: ConsoleSetupConfig;
      };
      if (parsed.role) {
        setSetupRole(parsed.role);
        setSetupMode("config");
      }
      if (parsed.gateway) setGatewaySetup((current) => ({ ...current, ...parsed.gateway }));
      if (parsed.worker) setWorkerSetup((current) => ({ ...current, ...parsed.worker }));
      if (parsed.console) setConsoleSetup((current) => ({ ...current, ...parsed.console }));
    } catch {
      // ignore invalid local draft
    }
  }, []);

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
        setSetupProfile(profile);
        setWorkspace(profile.recommended_workspace);
        setSetupTask(profile.last_task);
        setSetupMode(profile.setup_completed ? "status" : "role");
        setGatewaySetup(profile.gateway);
        setConsoleSetup(profile.console);
        setWorkerSetup((current) => ({
          ...current,
          gateway_base_url: profile.console.gateway_base_url || current.gateway_base_url,
          dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
          dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
        }));
        setSystemStatus(system);
        setModelStatus(model);
        if (wechat.base_url) setWechatBaseUrl(wechat.base_url);
        setWechatStatus(wechat);
        syncNodes(nodeList.nodes, setNodes, setSelectedNodeId);
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
        syncNodes(nodeList.nodes, setNodes, setSelectedNodeId);
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
  }, [setupTask]);

  async function withBusy<T>(name: string, fn: () => Promise<T>) { setBusy(name); try { return await fn(); } finally { setBusy(null); } }
  async function runModelCheck() { try { const result = await withBusy("model-check", () => requestJson<ModelCheck>("/api/models/builtin/check", { method: "POST" })); setModelCheck(result); setNotice(result.configured_model_available ? `内置模型 ${result.configured_model} 可用。` : `内置模型 ${result.configured_model} 未出现在模型列表中，请检查配置。`); } catch (error) { setNotice(`模型检测失败：${(error as Error).message}`); } }
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
  function selectSetupRole(role: SetupRole) {
    setSetupRole(role);
    setSetupMode("config");
    setSetupTask(null);
    setReconfigureConfirmOpen(false);
  }
  function returnToSetupStatus() {
    setSetupRole(null);
    setSetupTask(null);
    setReconfigureConfirmOpen(false);
    setSetupMode(setupProfile?.setup_completed ? "status" : "role");
  }
  function resetCurrentSetupDraft() {
    setGatewaySetup(setupProfile?.gateway ?? DEFAULT_GATEWAY_SETUP);
    setConsoleSetup(setupProfile?.console ?? DEFAULT_CONSOLE_SETUP);
    setWorkerSetup((current) => ({
      ...DEFAULT_WORKER_SETUP,
      ...current,
      gateway_base_url: setupProfile?.console.gateway_base_url || DEFAULT_WORKER_SETUP.gateway_base_url,
      dify_base_url: setupProfile?.gateway.dify_base_url || DEFAULT_WORKER_SETUP.dify_base_url,
      dify_api_key: setupProfile?.gateway.dify_api_key || DEFAULT_WORKER_SETUP.dify_api_key,
    }));
    setDiscoveredNodes([]);
    setPairingSecrets({});
    setPairingStatuses({});
    setSetupTask(null);
    setNotice("已重置当前填写内容。");
  }
  async function refreshSetupProfile() {
    const profile = await requestJson<SetupProfileResponse>("/api/setup/profile");
    setSetupProfile(profile);
    setGatewaySetup(profile.gateway);
    setConsoleSetup(profile.console);
    setWorkerSetup((current) => ({
      ...current,
      gateway_base_url: profile.console.gateway_base_url || current.gateway_base_url,
      dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
      dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
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
      setSetupProfile(profile);
      setSetupTask(profile.last_task);
      setGatewaySetup(profile.gateway);
      setConsoleSetup(profile.console);
      setWorkerSetup((current) => ({
        ...current,
        gateway_base_url: profile.console.gateway_base_url || current.gateway_base_url,
        dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
        dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
      }));
      setSystemStatus(system);
      setModelStatus(model);
      setWechatStatus(wechat);
      if (wechat.base_url) setWechatBaseUrl(wechat.base_url);
      syncNodes(nodeList.nodes, setNodes, setSelectedNodeId);
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
      const result = await withBusy(
        "setup-gateway",
        () => requestJson<GatewaySetupSaveResponse>("/api/setup/gateway/save", { method: "POST", body: JSON.stringify({ config: gatewaySetup }) }),
      );
      setSetupTask(result.task);
      setSetupMode("result");
      if (gatewaySetup.wechat_base_url) setWechatBaseUrl(gatewaySetup.wechat_base_url);
      if (gatewaySetup.wechat_token) setManualToken(gatewaySetup.wechat_token);
      await refreshSetupProfile();
      setNotice(result.task.summary);
    } catch (error) {
      setNotice(`保存网关配置失败：${(error as Error).message}`);
    }
  }
  async function runWorkerSetup() {
    try {
      const result = await withBusy(
        "setup-worker",
        () => requestJson<SetupTaskEnvelope>("/api/setup/node/install", { method: "POST", body: JSON.stringify({ config: workerSetup }) }),
      );
      setSetupTask(result.task);
      setSetupMode("result");
      setNotice("工作节点安装任务已启动，正在读取执行日志。");
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
      setNotice(result.task.summary);
    } catch (error) {
      setNotice(`执行网关主机+控制台配置失败：${(error as Error).message}`);
    }
  }
  async function scanLanNodes() {
    try {
      const result = await withBusy(
        "setup-discovery-scan",
        () => requestJson<DiscoveryScanResponse>("/api/setup/discovery/scan", { method: "POST", body: JSON.stringify({ timeout_ms: 1500 }) }),
      );
      setSetupTask(result.task);
      setDiscoveredNodes(result.nodes);
      setPairingStatuses(Object.fromEntries(result.nodes.map((item) => [item.discovery_id, item.already_paired ? "already_paired" : "pending"])));
      setNotice(result.task.summary || `已发现 ${result.nodes.length} 台局域网候选机器。`);
    } catch (error) {
      setNotice(`搜索局域网节点失败：${(error as Error).message}`);
    }
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
          syncNodes(nodeList.nodes, setNodes, setSelectedNodeId);
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
    setPairingStatuses((current) => ({ ...current, [discovered.discovery_id]: "pending" }));
    try {
      const result = await withBusy(
        "setup-discovery-pair",
        () => requestJson<DiscoveryPairResponse>("/api/setup/discovery/pair", {
          method: "POST",
          body: JSON.stringify({
            discovery_id: discovered.discovery_id,
            pairing_key: pairingKey,
            gateway_base_url: consoleSetup.gateway_base_url || window.location.origin,
            node_id: discovered.node_id || undefined,
          }),
        }),
      );
      setSetupTask(result.task);
      setPairingStatuses((current) => ({ ...current, [discovered.discovery_id]: result.pairing_status }));
      setNotice(result.task.summary || `节点 ${discovered.hostname} 配对结果：${result.pairing_status}`);
      const refreshedNodes = await requestJson<NodeListResponse>("/api/nodes");
      syncNodes(refreshedNodes.nodes, setNodes, setSelectedNodeId);
    } catch (error) {
      setPairingStatuses((current) => ({ ...current, [discovered.discovery_id]: "offline" }));
      setNotice(`配对节点失败：${(error as Error).message}`);
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
      if (wechatStatus?.running) {
        const status = await withBusy("reconfigure-disconnect-wechat", () =>
          requestJson<WeChatStatus>("/api/wechat/onboard/disconnect", { method: "POST" }),
        );
        setWechatStatus(status);
      }
      setReconfigureConfirmOpen(false);
      setSetupRole(null);
      setSetupTask(null);
      setSetupMode("role");
      setNotice(wechatStatus?.running ? "已断开微信连接，进入重新配置。" : "已进入重新配置流程。");
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
  const latestSetupSummary = useMemo(
    () => setupTask?.summary || setupProfile?.last_task?.summary || (nodes.length ? `当前有 ${nodes.length} 个在线节点处于纳管范围。` : "暂无最近配置或纳管记录。"),
    [nodes.length, setupProfile?.last_task?.summary, setupTask?.summary],
  );
  const quickSetupStatusRows = useMemo<Array<{ title: string; value: string; tone: "good" | "warn"; detail: string }>>(() => ([
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
  ]), [gatewaySetup.wechat_base_url, latestSetupSummary, modelStatus?.configured, modelStatus?.model, nodes.length, setupProfile?.console.gateway_base_url, systemStatus?.redis_ok, wechatStatus?.base_url, wechatStatus?.has_token, wechatStatus?.running]);
  const reconfigureWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (wechatStatus?.running) warnings.push("微信当前处于轮询中；继续后会先断开微信连接，再进入重新配置。");
    if (setupProfile?.console.gateway_base_url) warnings.push(`当前控制台目标为 ${setupProfile.console.gateway_base_url}；继续后新的配置会覆盖该地址，但不会执行解绑。`);
    if (setupCompletedRoles.has("gateway_host") || setupCompletedRoles.has("gateway_host_console")) warnings.push("主机网关基础配置仍会保留，继续后仅覆盖配置项，不会回滚或清空历史配置。");
    if (nodes.length) warnings.push(`当前有 ${nodes.length} 个在线节点；继续后不会自动解绑已纳管节点，节点仍可能继续使用原配置。`);
    if (!warnings.length) warnings.push("当前没有需要先断开的活动连接，确认后将直接进入重新配置。");
    return warnings;
  }, [nodes.length, setupCompletedRoles, setupProfile?.console.gateway_base_url, wechatStatus?.running]);

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
              <div className="workspace-caption">首版支持当前这台机器上的受控执行：保存网关配置、组合完成“网关主机+控制台”、单独校验控制台目标，以及调用现有工作节点安装脚本。</div>
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
                  <InfoRow label="已完成角色" value={setupProfile?.completed_roles.length ? setupProfile.completed_roles.map(roleName).join(" / ") : "暂无"} multiline />
                  <InfoRow label="最近任务" value={setupTask?.title || setupProfile?.last_task?.title || "暂无"} multiline />
                </div>
              </section>

              <div className="quick-setup-main">
                {launcherAvailable ? (
                  <section className="surface surface-subsection">
                    <div className="section-head">
                      <div><div className="section-kicker">桌面启动器</div><h3>单机一体化运行与存储库目录</h3></div>
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
                      <InfoRow label="分发模式" value={gatewaySetup.dispatch_mode_enabled ? "已开启（主机只分发）" : "已关闭（本机节点可处理）"} />
                    </div>
                    <div className="inline-actions quick-setup-actions">
                      <button type="button" onClick={() => installLauncherRedis("host", launcherStatus?.profile.redis_source || "mirror")} disabled={busy !== null}>{busy === "launcher-install-host" ? "下载中..." : "安装主机 Redis"}</button>
                      <button type="button" className="ghost-button" onClick={() => startLauncherStack({ enableLocalNode: !(launcherStatus?.profile.enable_local_node ?? true) })} disabled={busy !== null}>{launcherStatus?.profile.enable_local_node ? "关闭本机 Claw 节点" : "启用本机 Claw 节点"}</button>
                      <button type="button" className="ghost-button" onClick={() => applyDispatchMode(!gatewaySetup.dispatch_mode_enabled)} disabled={busy !== null}>{busy === "dispatch-mode-toggle" ? "切换中..." : gatewaySetup.dispatch_mode_enabled ? "关闭分发模式" : "开启分发模式"}</button>
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
                      <InfoRow label="微信 Base URL" value={wechatStatus?.base_url || gatewaySetup.wechat_base_url || "-"} multiline />
                      <InfoRow label="控制台目标网关" value={setupProfile?.console.gateway_base_url || "-"} multiline />
                      <InfoRow label="模型配置" value={modelStatus?.configured ? `${modelStatus.model || "-"} / ${modelStatus.base_url || "-"}` : DEFAULT_BUILTIN_MODEL_LABEL} multiline />
                      <InfoRow label="节点状态" value={nodes.length ? `${nodes.length} 个在线节点，最近任务：${latestSetupSummary}` : latestSetupSummary} multiline />
                    </div>
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
                                        <span className={`session-badge session-badge-${pairingStatuses[item.discovery_id] === "paired" ? "human" : pairingStatuses[item.discovery_id] === "auth_failed" ? "queued" : item.already_paired ? "typing" : "idle"}`}>{pairingStatusLabel(pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending"))}</span>
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
                          <div className="form-grid">
                            <label><span>节点 ID</span><input value={workerSetup.node_id} onChange={(event) => updateWorkerSetup("node_id", event.target.value)} /></label>
                            <label><span>主网关地址</span><input value={workerSetup.gateway_base_url} onChange={(event) => updateWorkerSetup("gateway_base_url", event.target.value)} /></label>
                            <label><span>节点 Token</span><textarea value={workerSetup.node_token} onChange={(event) => updateWorkerSetup("node_token", event.target.value)} /></label>
                            <label><span>配对密钥</span><textarea value={workerSetup.pairing_key} onChange={(event) => updateWorkerSetup("pairing_key", event.target.value)} placeholder="给局域网自动连接使用，和 node token 分开。" /></label>
                            <label><span>Dify Base URL</span><input value={workerSetup.dify_base_url} onChange={(event) => updateWorkerSetup("dify_base_url", event.target.value)} /></label>
                            <label><span>Dify API Key</span><textarea value={workerSetup.dify_api_key} onChange={(event) => updateWorkerSetup("dify_api_key", event.target.value)} /></label>
                            <label><span>最大并发</span><input type="number" value={workerSetup.max_concurrency} onChange={(event) => updateWorkerSetup("max_concurrency", Number(event.target.value) || 1)} /></label>
                            <label><span>安装目录</span><input value={workerSetup.install_dir} onChange={(event) => updateWorkerSetup("install_dir", event.target.value)} /></label>
                            <label><span>发现响应端口</span><input type="number" value={workerSetup.discovery_port} onChange={(event) => updateWorkerSetup("discovery_port", Number(event.target.value) || 9531)} /></label>
                            <label><span>启用局域网发现</span><input type="checkbox" checked={workerSetup.discovery_enabled} onChange={(event) => updateWorkerSetup("discovery_enabled", event.target.checked)} /></label>
                            <label><span>Bundle 路径（可选）</span><input value={workerSetup.bundle_path} onChange={(event) => updateWorkerSetup("bundle_path", event.target.value)} placeholder="留空则使用默认 dist/claw-node-bundle.zip" /></label>
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
              <div><div className="section-kicker">接入中心</div><h2>连接前先确认模型、微信和节点都已就绪</h2></div>
              <div className="workspace-caption">保留原有 API，不改协议，只重组桌面工作流。</div>
            </div>
            <div className="connection-grid">
              <div className="connection-status-column">
                <section className="surface surface-tight">
                  <div className="section-head"><div><div className="section-kicker">准备流程</div><h3>接入状态</h3></div><button onClick={runModelCheck} disabled={busy !== null}>{busy === "model-check" ? "检测中..." : "检测模型"}</button></div>
                  <div className="prep-strip-list">
                    <PrepStrip label="模型可用" detail={modelStatus?.configured ? modelStatus.model : "尚未检测"} tone={modelStatus?.configured ? "good" : "warn"} />
                    <PrepStrip label="微信已连接" detail={wechatStatus?.running ? "轮询中" : "未连接"} tone={wechatStatus?.running ? "good" : "warn"} />
                    <PrepStrip label="节点在线" detail={`${systemStatus?.active_nodes ?? 0} 个节点`} tone={(systemStatus?.active_nodes ?? 0) > 0 ? "good" : "warn"} />
                  </div>
                </section>
                <section className="surface">
                  <div className="section-head"><div><div className="section-kicker">运行摘要</div><h3>系统状态</h3></div><button type="button" className="ghost-button" onClick={() => void applyDispatchMode(!gatewaySetup.dispatch_mode_enabled)} disabled={busy !== null}>{busy === "dispatch-mode-toggle" ? "切换中..." : gatewaySetup.dispatch_mode_enabled ? "关闭分发模式" : "开启分发模式"}</button></div>
                  <div className="status-grid">
                    <Metric title="环境" value={systemStatus?.environment || "-"} />
                    <Metric title="模型" value={modelStatus?.model || "-"} />
                    <Metric title="微信接入" value={wechatStatus?.running ? "已连接" : "未连接"} />
                    <Metric title="在线节点" value={`${systemStatus?.active_nodes ?? 0}`} />
                    <Metric title="分发模式" value={systemStatus?.dispatch_mode_enabled ? "主机只分发" : "本机可处理"} />
                  </div>
                  {gatewaySetup.dispatch_mode_enabled && availableDispatchNodes === 0 ? <div className="topbar-notice dispatch-warning">当前已开启分发模式，但还没有可用的远端处理节点；网关会继续接收微信消息，但无法完成实际回复。</div> : null}
                </section>
                <section className="surface">
                  <div className="section-head"><div><div className="section-kicker">检测回显</div><h3>模型与网关</h3></div></div>
                  <div className="info-stack">
                    <InfoRow label="主网关 Redis" value={systemStatus?.redis_ok ? "正常" : "未就绪"} />
                    <InfoRow label="模型 Base URL" value={modelStatus?.base_url || "-"} />
                    <InfoRow label="微信 Token" value={wechatStatus?.has_token ? "已存在" : "未配置"} />
                    <InfoRow label="模型检测" value={modelCheck ? (modelCheck.configured_model_available ? "可用" : "未命中模型列表") : "尚未检测"} />
                    <InfoRow label="最近错误" value={wechatStatus?.last_error || "无"} multiline />
                  </div>
                </section>

                <section className="surface">
                  <div className="section-head">
                    <div><div className="section-kicker">节点清单</div><h3>已接入节点</h3></div>
                    <span className="small-note">{nodes.length} 个节点</span>
                  </div>
                  {!nodes.length ? (
                    <div className="empty-state">当前还没有已接入节点。</div>
                  ) : (
                    <div className="node-cards">
                      {nodes.map((node) => (
                        <div key={node.node_id} className="node-card">
                          <div className="node-card-top">
                            <div>
                              <div className="node-card-title">{node.hostname || node.node_id}</div>
                              <div className="node-card-subtitle">{node.node_id}</div>
                            </div>
                            <span className={`session-badge session-badge-${node.status === "healthy" ? "typing" : node.status === "degraded" ? "queued" : "idle"}`}>
                              {node.status}
                            </span>
                          </div>
                          <div className="node-card-grid">
                            <div>
                              <div className="node-card-label">局域网地址</div>
                              <div className="node-card-value">{node.lan_ip || "未上报"}</div>
                            </div>
                            <div>
                              <div className="node-card-label">上报地址</div>
                              <div className="node-card-value">{getNodeAddress(node)}</div>
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
                              <div className="node-card-label">负载</div>
                              <div className="node-card-value">{`${node.current_load}/${node.max_concurrency}`}</div>
                            </div>
                            <div>
                              <div className="node-card-label">通道槽位</div>
                              <div className="node-card-value">{`${node.channel_in_use}/${node.channel_capacity}`}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
              <div className="connection-action-column">
                <section className="surface surface-feature">
                  <div className="section-head"><div><div className="section-kicker">扫码接入</div><h3>连接微信 Bot</h3></div><div className="inline-actions"><button onClick={startQrFlow} disabled={busy !== null}>{busy === "wechat-qr" ? "生成中..." : "生成二维码"}</button><button onClick={pollQrStatus} disabled={!qr || busy !== null}>{busy === "wechat-poll" ? "轮询中..." : "轮询状态"}</button></div></div>
                  <div className="qr-stage">
                    <div className="qr-frame">{qrImageSrc ? <img className="qr-image" src={qrImageSrc} alt="WeChat QR code" /> : <div className="qr-placeholder">点击“生成二维码”后，这里会显示扫码图。</div>}</div>
                    <div className="qr-meta"><div className="qr-status-line"><span>当前状态</span><strong>{pollState?.status ?? "未开始"}</strong></div><div className="small-note">支持扫码自动接入，也支持复制 token 做手动连接测试。</div></div>
                  </div>
                </section>
                <section className="surface">
                  <div className="section-head"><div><div className="section-kicker">手动模式</div><h3>Token 连接</h3></div></div>
                  <div className="form-grid">
                    <label><span>WeChat Base URL</span><input value={wechatBaseUrl} onChange={(event) => setWechatBaseUrl(event.target.value)} placeholder="https://ilinkai.weixin.qq.com" /></label>
                    <label><span>手动 Token</span><textarea value={manualToken} onChange={(event) => setManualToken(event.target.value)} placeholder="也可以先扫码，扫码确认后会自动填入并接入。" /></label>
                  </div>
                  <div className="inline-actions"><button onClick={connectManualToken} disabled={busy !== null}>{busy === "wechat-connect" ? "连接中..." : "使用当前 Token 连接"}</button><button onClick={disconnectWeChat} disabled={busy !== null}>断开连接</button></div>
                </section>
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
function syncNodes(next: NodeRecord[], setNodes: React.Dispatch<React.SetStateAction<NodeRecord[]>>, setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>) {
  setNodes(next);
  setSelectedNodeId((current) => current && next.some((item) => item.node_id === current) ? current : (next[0]?.node_id ?? null));
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
function roleName(role: SetupRole) {
  if (role === "gateway_host") return "网关主机";
  if (role === "gateway_host_console") return "网关主机+控制台";
  if (role === "worker_node") return "工作节点";
  return "控制台";
}
function roleDescription(role: SetupRole) {
  if (role === "gateway_host") return "保存网关基础配置，并主动搜索局域网里已经运行的可配对节点。";
  if (role === "gateway_host_console") return "一次完成网关配置保存与控制台目标校验，适合本机同时承担主网关和运维控制台。";
  if (role === "worker_node") return "复用现有 PowerShell 安装脚本，把这台机器部署成可接单且可被自动发现的 Claw 节点。";
  return "校验控制台要连接的主网关地址，适合纯观察和接管机器。";
}
function roleAction(role: SetupRole) {
  if (role === "gateway_host") return "会写入网关 .env、刷新微信运行配置，并通过 UDP 广播搜索候选节点。";
  if (role === "gateway_host_console") return "会先写入网关配置，再串行校验控制台目标网关地址，并把该地址保存为后续默认值。";
  if (role === "worker_node") return "会调用 install-claw-node.ps1，并把配对密钥/发现端口写入本机配置。";
  return "会验证目标主网关健康状态，不会安装任何服务。";
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
    `调用节点安装脚本，节点 ID=${worker.node_id}`,
    `主网关地址=${worker.gateway_base_url}`,
    `安装目录=${worker.install_dir}`,
    `最大并发=${worker.max_concurrency}`,
    `配对密钥=${worker.pairing_key ? "已填写" : "未填写"}`,
    `自动发现=${worker.discovery_enabled ? `开启（UDP ${worker.discovery_port}）` : "关闭"}`,
    `Bundle=${worker.bundle_path || "使用默认路径"}`,
  ].join("\n");
  return [
    `校验控制台目标网关=${consoleConfig.gateway_base_url}`,
    "成功后会把这个地址作为后续重配默认值保存。",
  ].join("\n");
}
function previewOutcome(role: SetupRole) {
  if (role === "gateway_host") return "保存后的配置会体现在快速配置档案中；部分运行时配置会即时应用，仍建议重启网关确认最终状态。";
  if (role === "gateway_host_console") return "成功后会同时记录网关配置和控制台默认网关地址；若控制台校验失败，会保留已保存的网关配置并在结果页提示失败原因。";
  if (role === "worker_node") return "成功后会返回服务安装日志、节点 ID、安装目录等结果；失败时保留错误摘要，便于重试。";
  return "成功后会记录控制台默认网关地址，并可继续进入接入中心或会话观察台。";
}
function pairingStatusLabel(status: PairingStatus) { return status === "paired" ? "已配对" : status === "auth_failed" ? "密钥错误" : status === "already_paired" ? "已纳管" : status === "offline" ? "离线" : "待连接"; }
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
