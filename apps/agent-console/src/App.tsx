import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  persistWorkspace,
  resolveRoleBadge,
  validateWorkerGatewayUrl,
  resolveTokenDisplayState,
} from "./roleWorkspace";
import { DiagnosticsConsole } from "./components/Workspaces/Connection/DiagnosticsConsole";
import { ConnectivityCheckModal } from "./components/Workspaces/Connection/ConnectivityCheckModal";
import { InfoRow, MetaPill, Metric, SnippetBlock, StatusChip } from "./components/Workspaces/Connection/ConnectionUi";
import { ConnectionWorkspace } from "./components/Workspaces/Connection/ConnectionWorkspace";
import { ConversationTestWorkspace } from "./components/Workspaces/ConversationTest/ConversationTestWorkspace";
import { PairingStatusModal } from "./components/Workspaces/Connection/PairingStatusModal";
import { RuntimeLogsPanel } from "./components/Workspaces/Connection/RuntimeLogsPanel";
import { LogsWorkspace } from "./components/Workspaces/Logs/LogsWorkspace";
import { QuickSetupWorkspace } from "./components/Workspaces/QuickSetup/QuickSetupWorkspace";
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
import { applyGatewaySummaryToState, resolvePreferredGatewayBaseUrl } from "./appBootstrap";
import { clearQuickSetupCache, loadSetupDraft, loadSummaryStateCache, loadUiStateCache, saveUiStateCache } from "./appStorage";
import { syncNodeState } from "./consoleStateSync";
import {
  buildWechatAdminConnectivityItem,
  buildWechatStatusRows,
} from "./presenters/wechatStatusPresenter";
import {
  buildRoleCapabilities,
  connectionConsolePresentation,
  resolveVisibleWorkspaces,
  roleVariantDescription,
  roleVariantLabel,
  workspacePresentation,
} from "./roleCapabilities";
import {
  DEFAULT_BUILTIN_MODEL_LABEL,
  DEFAULT_CONSOLE_SETUP,
  DEFAULT_GATEWAY_SETUP,
  DEFAULT_LOCAL_NODE_MODEL_CONFIG,
  DEFAULT_MANUAL_PAIR,
  DEFAULT_WORKER_SETUP,
  FILTERS,
  GATEWAY_NODE_TOKEN_LOCATION,
  SETUP_DRAFT_KEY,
  SUMMARY_STATE_CACHE_KEY,
} from "./quickSetupDefaults";
import { formatModelProviderLabel, hasText, safeTrim } from "./stringUtils";
import {
  buildLauncherStartPayload,
  findLauncherComponent,
  launcherBadgeTone,
  launcherComponentName,
  launcherEnvironmentLabel,
  launcherLocalNodePolicyLabel,
  launcherMachineRoleLabel,
  launcherMachineRoleValue,
  launcherManagedComponentsLabel,
  runningLauncherComponents,
  launcherShouldRunGateway,
  launcherShouldRunLocalNode,
  launcherStateLabel,
  summarizeGatewayRuntime,
  summarizeLocalNodeRuntime,
  summarizeWechatRuntime,
} from "./selectors/launcherSelectors";
import {
  buildNodeChannelOverview,
  buildSessionBindingOptions,
  buildSessionCounts,
  countAvailableDispatchNodes,
  filterSessions,
  findLatestMessageByRole,
  selectCurrentNode,
  selectCurrentSession,
} from "./selectors/consoleSelectors";
import {
  describeTaskStreamHealth,
  getInventoryNodeAddress,
  getNodeAddress,
  normalizeInventoryRuntimeMetrics,
  nodeInventoryBadgeLabel,
  nodeInventoryBadgeTone,
  nodeRoleLabel,
  resolveInventoryNodePresentation,
  summarizeRemoteNode,
} from "./selectors/nodeSelectors";
import { isGatewayEmbeddedNode } from "./selectors/nodeIdentity";
import {
  isGatewayRole,
  isConsoleRole,
  isPairingTaskKind,
  isWorkerRole,
  previewContent,
  previewOutcome,
  resolveEffectiveRole,
  resolveWorkerGatewayBaseUrl,
  resolveWorkerNodeId,
  roleAction,
  roleDescription,
  roleName,
  setupRoleToLauncherMachineRole,
  workerEnvLocations,
} from "./selectors/quickSetupSelectors";
import { formatTimeLabel } from "./selectors/sessionSelectors";
import { useGatewaySummaryEffects } from "./hooks/useGatewaySummaryEffects";
import { useGatewayRuntimeController } from "./hooks/useGatewayRuntimeController";
import { useLocalNodeController } from "./hooks/useLocalNodeController";
import { useLauncherController } from "./hooks/useLauncherController";
import { useNodeDiagnosticsEffects } from "./hooks/useNodeDiagnosticsEffects";
import { usePairingDebug } from "./hooks/usePairingDebug";
import { usePairingOperations } from "./hooks/usePairingOperations";
import { useQuickSetupController } from "./hooks/useQuickSetupController";
import { useQuickSetupOperations } from "./hooks/useQuickSetupOperations";
import { useSessionConsoleController } from "./hooks/useSessionConsoleController";
import { useSessionWorkspaceEffects } from "./hooks/useSessionWorkspaceEffects";
import { useSetupTaskEffects } from "./hooks/useSetupTaskEffects";
import { useWechatOnboarding } from "./hooks/useWechatOnboarding";
import { useWorkspacePollingEffects } from "./hooks/useWorkspacePollingEffects";
import type {
  AppSummaryStateCache,
  ConsoleSetupConfig,
  GatewaySetupConfig,
  GatewaySummaryResponse,
  LauncherComponentName,
  LauncherComponentStatus,
  LauncherEnvironmentStatus,
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
  LocalNodeConfigApplyState,
  LocalNodeConversationTestRequest,
  LocalNodeConversationTestResponse,
  LocalNodeLogsResponse,
  LocalNodeModelConfig,
  LocalNodeModelConfigRequest,
  LocalNodeStatusResponse,
  MessageRecord,
  ConnectivityCheckReport,
  ModelCheck,
  ModelStatus,
  NodeCredentialResetRequest,
  NodeDiagnosticsRecord,
  NodeInventoryConnectionState,
  NodeInventoryRecord,
  NodeInventorySummary,
  NodeKind,
  NodeListResponse,
  NodeRecord,
  PairingStatus,
  PollResponse,
  PublicEntryProfileResponse,
  PairingDebugEntry,
  QrStart,
  SessionFilter,
  SessionMessageCacheEntry,
  SessionRecord,
  SetupMode,
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
const RETRY_POLL_MS = 1000; // backend unreachable — retry quickly
const WS_RECONNECT_BASE_MS = 1500;
const WS_RECONNECT_MAX_MS = 15000;
const PUBLIC_ENTRY_PROFILE_MIN_INTERVAL_MS = 10000;

type RefreshPublicEntryProfileOptions = {
  force?: boolean;
  minIntervalMs?: number;
};

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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function diagnosticString(status: LocalNodeStatusResponse | null, key: string) {
  const value = status?.diagnostics?.[key];
  return typeof value === "string" ? safeTrim(value) : "";
}

function nodeIdFromLocalNodeStatus(status: LocalNodeStatusResponse | null) {
  const diagnosticNodeId = diagnosticString(status, "node_id");
  if (diagnosticNodeId) return diagnosticNodeId;
  const serviceName = safeTrim(status?.service_name);
  return serviceName.startsWith("wechat-claw-node-") ? serviceName.slice("wechat-claw-node-".length) : "";
}

export function App() {
  const initialDraft = loadSetupDraft();
  const initialUiState = useMemo(() => loadUiStateCache(), []);
  const initialSummaryState = useMemo(() => loadSummaryStateCache(), []);
  const [workspace, setWorkspace] = useState<WorkspaceTab>(initialUiState.workspace ?? "quick_setup");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [inspectorOpen, setInspectorOpen] = useState(false);
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
  const [assessmentMaxRounds, setAssessmentMaxRounds] = useState(20);
  const [assessmentApplyStrategy, setAssessmentApplyStrategy] = useState<"balanced" | "peak">("balanced");
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [modelCheck, setModelCheck] = useState<ModelCheck | null>(null);
  const [connectivityCheckText, setConnectivityCheckText] = useState<string | null>(null);
  const [connectivityCheckReport, setConnectivityCheckReport] = useState<ConnectivityCheckReport | null>(null);
  const [connectivityCheckModalOpen, setConnectivityCheckModalOpen] = useState(false);
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
  const [humanReplyDraft, setHumanReplyDraft] = useState("");
  const [gatewaySummaryStreamActive, setGatewaySummaryStreamActive] = useState(false);
  const [qr, setQr] = useState<QrStart | null>(null);
  const [qrImageSrc, setQrImageSrc] = useState("");
  const [publicEntryProfileState, setPublicEntryProfileState] = useState<PublicEntryProfileResponse | null>(null);
  const [publicEntryQrImageSrc, setPublicEntryQrImageSrc] = useState<string | null>(null);
  const [pollState, setPollState] = useState<PollResponse | null>(null);
  const [wechatBaseUrl, setWechatBaseUrl] = useState(initialSummaryState.wechat_status?.base_url || "https://ilinkai.weixin.qq.com");
  const [manualToken, setManualToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("正在读取主网关状态。");
  const [now, setNow] = useState(Date.now());
  const quickSetup = useQuickSetupController({
    initialDraft,
    systemStatus,
    launcherStatus,
    onRoleSelected: handleQuickSetupRoleSelected,
    onDraftReset: () => {
      workerGatewayAutoProbeKeyRef.current = "";
      setNotice("已重置当前填写内容。");
    },
  });
  const {
    setupProfile,
    setupRole,
    setupMode,
    gatewaySetup,
    workerSetup,
    consoleSetup,
    setupTask,
    discoveredNodes,
    pairingSecrets,
    pairingStatuses,
    manualPair,
    pairingDebugEntries,
    pairingModalTaskId,
    pairingModalTask,
    pairingModalStartedAt,
    reconfigureConfirmOpen,
    workerGatewayProbeTask,
    workerPairingKeyVisible,
    workerModelExpanded,
    pairingModalTimerRef,
  } = quickSetup.state;
  const {
    setSetupProfile,
    setSetupRole,
    setSetupMode,
    setGatewaySetup,
    setWorkerSetup,
    setConsoleSetup,
    setSetupTask,
    setDiscoveredNodes,
    setPairingSecrets,
    setPairingStatuses,
    setManualPair,
    setPairingDebugEntries,
    setPairingModalTaskId,
    setPairingModalTask,
    setPairingModalStartedAt,
    setReconfigureConfirmOpen,
    setWorkerGatewayProbeTask,
    setWorkerPairingKeyVisible,
    setWorkerModelExpanded,
    toggleReconfigureConfirm,
    toggleWorkerPairingKeyVisible,
    toggleWorkerModelExpanded,
    backToConfig,
    advanceToPreview,
    clearPairingDebugEntries,
    selectSetupRole,
    returnToSetupStatus,
    resetCurrentSetupDraft,
    syncSetupProfileState,
    updateGatewaySetup,
    updateWorkerSetup,
    updateConsoleSetup,
    updateManualPair,
    updatePairingSecret,
    clearAndReselectRole,
  } = quickSetup.actions;
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const workerGatewayAutoProbeKeyRef = useRef("");
  const shouldAutoFollowMessagesRef = useRef(true);
  const previousMessageSessionIdRef = useRef<string | null>(null);
  const pendingHistoryRestoreRef = useRef<{ sessionId: string; scrollHeight: number; scrollTop: number } | null>(null);
  const sessionMessageCacheRef = useRef<Map<string, SessionMessageCacheEntry>>(new Map());
  const restoredSessionScrollRef = useRef(initialUiState.session_scroll);
  const nodeDiagnosticsCacheRef = useRef<Map<string, NodeDiagnosticsRecord>>(new Map());
  const conversationTestAutoRefreshKeyRef = useRef("");
  const publicEntryProfileRequestRef = useRef<Promise<PublicEntryProfileResponse | null> | null>(null);
  const publicEntryProfileEndpointRef = useRef("");
  const publicEntryProfileLastLoadedAtRef = useRef(0);
  const runtimeMachineRole = launcherMachineRoleValue(launcherStatus);
  const effectiveRole = resolveEffectiveRole(setupRole, setupProfile?.completed_roles ?? [], runtimeMachineRole);
  const roleCapabilities = useMemo(() => buildRoleCapabilities(effectiveRole), [effectiveRole]);
  const visibleWorkspaces = useMemo(() => resolveVisibleWorkspaces(roleCapabilities), [roleCapabilities]);
  const currentRoleIsWorker = isWorkerRole(effectiveRole);
  const currentRoleIsConsole = isConsoleRole(effectiveRole);
  const activeWorkspacePresentation = useMemo(
    () => workspacePresentation(roleCapabilities, workspace),
    [roleCapabilities, workspace],
  );
  const connectionWorkspacePresentation = useMemo(
    () => workspacePresentation(roleCapabilities, "connection"),
    [roleCapabilities],
  );
  const connectionConsoleView = useMemo(
    () => connectionConsolePresentation(roleCapabilities),
    [roleCapabilities],
  );
  const sessionWorkspacePresentation = useMemo(
    () => workspacePresentation(roleCapabilities, "sessions"),
    [roleCapabilities],
  );
  const conversationWorkspacePresentation = useMemo(
    () => workspacePresentation(roleCapabilities, "conversation_test"),
    [roleCapabilities],
  );
  const quickSetupPresentation = useMemo(
    () => workspacePresentation(roleCapabilities, "quick_setup"),
    [roleCapabilities],
  );
  const activeRoleLabel = useMemo(() => roleVariantLabel(roleCapabilities), [roleCapabilities]);
  const activeRoleDescription = useMemo(() => roleVariantDescription(roleCapabilities), [roleCapabilities]);
  const topbarNotice = useMemo(() => normalizeTopbarNotice(notice), [notice]);
  const localGatewayManaged = launcherAvailable ? launcherShouldRunGateway(launcherStatus) : null;
  const authoritativeWorkerNodeId = currentRoleIsWorker
    ? (
        nodeIdFromLocalNodeStatus(localNodeStatus)
        || safeTrim(launcherStatus?.profile.local_node_id)
        || safeTrim(workerSetup.node_id)
      )
    : "";
  const authoritativeWorkerGatewayBaseUrl = currentRoleIsWorker
    ? (
        diagnosticString(localNodeStatus, "gateway_base_url")
        || safeTrim(launcherStatus?.profile.gateway_base_url)
        || safeTrim(workerSetup.gateway_base_url)
      )
    : "";
  const sessionRemoteGatewayBaseUrl = currentRoleIsWorker
    ? authoritativeWorkerGatewayBaseUrl
    : currentRoleIsConsole
      ? (safeTrim(consoleSetup.gateway_base_url) || setupProfile?.console.gateway_base_url || "")
      : (systemStatus?.preferred_gateway_base_url || setupProfile?.preferred_gateway_base_url || "");
  const localOrigin = safeTrim(window.location.origin);
  const consoleUsesExplicitRemoteGateway = currentRoleIsConsole
    && Boolean(sessionRemoteGatewayBaseUrl)
    && sessionRemoteGatewayBaseUrl !== localOrigin;
  const shouldUseLocalGatewayApi = consoleUsesExplicitRemoteGateway
    ? false
    : shouldUseOriginLocalGateway(launcherAvailable, localGatewayManaged);
  const shouldUseRemoteGatewayApi = currentRoleIsWorker || (currentRoleIsConsole && (consoleUsesExplicitRemoteGateway || localGatewayManaged === false));
  const shouldUseLocalInventoryRuntime = localGatewayManaged === true && !shouldUseRemoteGatewayApi;
  const localInventoryRuntimeStatus = shouldUseLocalInventoryRuntime ? localNodeStatus : null;
  const shouldUseWorkerLocalApi = currentRoleIsWorker && localGatewayManaged === false;
  const sessionRemoteNodeId = currentRoleIsWorker ? authoritativeWorkerNodeId : "";
  const displayedWorkerNodeId = authoritativeWorkerNodeId || safeTrim(workerSetup.node_id);
  const displayedWorkerGatewayBaseUrl = authoritativeWorkerGatewayBaseUrl || safeTrim(workerSetup.gateway_base_url);
  const currentNodeLanIp = launcherStatus?.local_lan_ip || setupTask?.metadata.lan_ip || "";
  const currentGatewayBaseUrl = consoleSetup.gateway_base_url || window.location.origin;

  useEffect(() => {
    if (!currentRoleIsWorker) return;
    const runtimeNodeId = authoritativeWorkerNodeId;
    const runtimeGatewayBaseUrl =
      authoritativeWorkerGatewayBaseUrl
      || safeTrim(setupProfile?.preferred_gateway_base_url)
      || safeTrim(setupProfile?.console.gateway_base_url);
    const runtimeInstallDir = safeTrim(localNodeStatus?.install_dir);
    setWorkerSetup((current) => {
      const next = {
        ...current,
        node_id: runtimeNodeId || current.node_id,
        gateway_base_url: runtimeGatewayBaseUrl || current.gateway_base_url,
        install_dir: runtimeInstallDir || current.install_dir,
        node_token: "",
      };
      return (
        next.node_id === current.node_id
        && next.gateway_base_url === current.gateway_base_url
        && next.install_dir === current.install_dir
        && next.node_token === current.node_token
      )
        ? current
        : next;
    });
  }, [
    authoritativeWorkerGatewayBaseUrl,
    authoritativeWorkerNodeId,
    currentRoleIsWorker,
    localNodeStatus?.install_dir,
    setWorkerSetup,
    setupProfile?.console.gateway_base_url,
    setupProfile?.preferred_gateway_base_url,
  ]);

  useEffect(() => {
    if (!currentRoleIsWorker) return;
    setWorkerGatewayProbeTask((current) => {
      if (!current || current.kind !== "gateway_probe") return current;
      const taskGatewayBaseUrl = safeTrim(current.metadata.gateway_base_url);
      const taskNodeId = safeTrim(current.metadata.node_id);
      if (displayedWorkerGatewayBaseUrl && taskGatewayBaseUrl && taskGatewayBaseUrl !== displayedWorkerGatewayBaseUrl) {
        return null;
      }
      if (displayedWorkerNodeId && taskNodeId && taskNodeId !== displayedWorkerNodeId) {
        return null;
      }
      return current;
    });
  }, [
    currentRoleIsWorker,
    displayedWorkerGatewayBaseUrl,
    displayedWorkerNodeId,
    setWorkerGatewayProbeTask,
  ]);

  useEffect(() => {
    if (!roleCapabilities.workspace[workspace]?.visible) {
      setWorkspace(roleCapabilities.primaryWorkspace);
    }
  }, [roleCapabilities, workspace]);

  const syncNodeStateView = useCallback((next: NodeListResponse, options?: { selectNode?: boolean }) => {
    syncNodeState(
      next,
      setNodes,
      setNodeInventory,
      setNodeInventorySummary,
      setSelectedNodeId,
      { selectNode: options?.selectNode ?? workspace === "connection" },
    );
  }, [workspace]);

  const applyGatewaySummary = useCallback((summary: GatewaySummaryResponse) => {
    applyGatewaySummaryToState(summary, {
      setSystemStatus,
      setWechatStatus,
      setWechatBaseUrl,
      syncNodeStateView,
    });
  }, [syncNodeStateView]);

  const { refreshGatewaySummarySnapshot } = useGatewayRuntimeController({
    initialUiState,
    initialSummaryState,
    systemStatus,
    currentRoleIsWorker,
    currentRoleIsConsole,
    localGatewayManaged,
    shouldUseRemoteGatewayApi,
    sessionRemoteGatewayBaseUrl,
    requestJson,
    syncSetupProfileState,
    syncNodeStateView,
    setWorkspace,
    setSetupProfile,
    setSetupMode,
    setSetupTask,
    setWorkerGatewayProbeTask,
    setLauncherStatus,
    setLauncherAvailable,
    setWorkerSetup,
    setModelStatus,
    setSystemStatus,
    setWechatStatus,
    setWechatBaseUrl,
    setNotice,
    setupCompleted: Boolean(setupProfile?.setup_completed && workspace === "quick_setup"),
    retryPollMs: RETRY_POLL_MS,
  });
  useGatewaySummaryEffects({
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
    refreshGatewaySummarySnapshot,
    setWorkerGatewayProbeTask,
    applyGatewaySummary,
  });
  const {
    refreshLocalNodeStatus,
    refreshLocalNodeDiagnostics,
    refreshRuntimeLogs,
    updateLocalNodeModelDraft,
    saveLocalNodeModelConfig,
    startLocalNodeService,
    restartLocalNodeService,
    reinstallLocalNodeService,
    stopLocalNodeService,
    exportLocalNodeDiagnostics,
    resetLocalNodeCredentials,
    runLocalNodeConversationTest,
    startLocalNodeChannelAssessment,
    applyLocalNodeChannelAssessment,
  } = useLocalNodeController({
    requestJson,
    withBusy,
    launcherAvailable,
    launcherStatus,
    localNodeStatus,
    assessmentMaxRounds,
    assessmentApplyStrategy,
    localNodeModelDirty,
    localNodeModelDraft,
    setLocalNodeStatus,
    setLocalNodeLogs,
    setLauncherLogs,
    setRuntimeLogsRefreshing,
    setLocalNodeModelDraft,
    setLocalNodeModelDirty,
    setNotice,
    refreshLauncherStatus: () => refreshLauncherStatus(),
  });
  const {
    refreshLauncherStatus,
    waitForGatewayReady,
    ensureLauncherRuntimeForQuickSetup,
    applyLauncherPolicyForRole,
    installLauncherRedis,
    startLauncherStack,
    stopLauncherStack,
    toggleLauncherNodeCache,
    readLauncherLog,
    restartGatewayService,
  } = useLauncherController({
    requestJson,
    withBusy,
    launcherAvailable,
    launcherStatus,
    gatewayDispatchModeEnabled: gatewaySetup.dispatch_mode_enabled,
    workerNodeId: displayedWorkerNodeId,
    effectiveRole,
    setNotice,
    setLauncherStatus,
    setLauncherAvailable,
    setWorkerSetup,
    setLauncherLogs,
    refreshGatewaySummarySnapshot,
    refreshLocalNodeDiagnostics,
    roleName,
  });

  function handleQuickSetupRoleSelected(role: SetupRole) {
    void ensureLauncherRuntimeForQuickSetup(role);
  }
  useWorkspacePollingEffects({
    launcherAvailable,
    workspace,
    refreshLocalNodeSnapshot: refreshLocalNodeStatus,
    refreshRuntimeLogs,
    launcherStatusKey: JSON.stringify(launcherStatus?.components ?? []),
  });

  useEffect(() => {
    if (workspace !== "conversation_test" || !launcherAvailable) {
      conversationTestAutoRefreshKeyRef.current = "";
      return;
    }
    if (localNodeStatus) {
      return;
    }
    const autoRefreshKey = `${runtimeMachineRole}:${launcherStatus?.profile.launcher_port ?? "unknown"}`;
    if (conversationTestAutoRefreshKeyRef.current === autoRefreshKey) {
      return;
    }
    conversationTestAutoRefreshKeyRef.current = autoRefreshKey;
    void refreshLocalNodeDiagnostics({ minIntervalMs: 0 });
  }, [
    launcherAvailable,
    launcherStatus?.profile.launcher_port,
    localNodeStatus,
    refreshLocalNodeDiagnostics,
    runtimeMachineRole,
    workspace,
  ]);

  useEffect(() => {
    saveUiStateCache(
      selectedSessionId
        ? {
            workspace,
            selected_session_id: selectedSessionId,
            selected_node_id: null,
          }
        : {
            workspace,
            selected_session_id: null,
            selected_node_id: null,
            session_scroll: null,
          },
    );
    persistWorkspace(workspace);
  }, [selectedSessionId, workspace]);

  const getPersistedSessionScroll = useCallback((sessionId: string | null) => {
    const persistedScroll = loadUiStateCache().session_scroll;
    if (!sessionId || !persistedScroll || persistedScroll.session_id !== sessionId) {
      return null;
    }
    return persistedScroll;
  }, []);

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
    let cancelled = false;
    const run = async () => {
      const accessUrl = safeTrim(publicEntryProfileState?.access_url);
      if (!accessUrl) {
        setPublicEntryQrImageSrc(null);
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(accessUrl, {
          margin: 1,
          width: 360,
          color: { dark: "#10233a", light: "#f8fbff" },
        });
        if (!cancelled) setPublicEntryQrImageSrc(dataUrl);
      } catch {
        if (!cancelled) setPublicEntryQrImageSrc(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [publicEntryProfileState?.access_url]);

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

  const getNodeDiagnosticsCache = useCallback((nodeId: string | null) => {
    if (!nodeId) return null;
    return nodeDiagnosticsCacheRef.current.get(nodeId) ?? null;
  }, []);

  const syncNodeDiagnosticsCache = useCallback((nodeId: string, diagnostics: NodeDiagnosticsRecord) => {
    nodeDiagnosticsCacheRef.current.set(nodeId, diagnostics);
    return diagnostics;
  }, []);

  const applyNodeDiagnosticsEntry = useCallback((nodeId: string, diagnostics: NodeDiagnosticsRecord | null) => {
    if (selectedNodeId !== nodeId) return;
    setSelectedNodeDiagnostics(diagnostics);
  }, [selectedNodeId]);

  const clearNodeDiagnosticsCache = useCallback((nodeId?: string | null) => {
    if (!nodeId) {
      nodeDiagnosticsCacheRef.current.clear();
      return;
    }
    nodeDiagnosticsCacheRef.current.delete(nodeId);
  }, []);

  function presentConnectivityCheckReport(report: ConnectivityCheckReport) {
    const failedChecks = report.items.filter((item) => item.status !== "passed");
    setConnectivityCheckReport(report);
    setConnectivityCheckModalOpen(true);
    setConnectivityCheckText(report.summary);
    setNotice(
      failedChecks.length
        ? `完整检测发现 ${failedChecks.length} 项需处理：${report.summary}`
        : `完整检测通过：${report.summary}`
    );
  }

  async function withBusy<T>(name: string, fn: () => Promise<T>) { setBusy(name); try { return await fn(); } finally { setBusy(null); } }
  async function runConnectivityCheck() {
    try {
      await withBusy("connectivity-check", async () => {
        if (launcherAvailable) {
          try {
            const report = await requestJson<ConnectivityCheckReport>("/local/node/connectivity-check");
            presentConnectivityCheckReport(report);
            return;
          } catch (launcherError) {
            console.warn("local connectivity check fallback", launcherError);
          }
        }

        const [summaryResult, modelStatusResult, modelCheckResult, launcherResult, localNodeResult, publicEntryResult] = await Promise.allSettled([
          refreshGatewaySummarySnapshot({ force: true, minIntervalMs: 0 }),
          requestJson<ModelStatus>("/api/models/builtin/status"),
          requestJson<ModelCheck>("/api/models/builtin/check", { method: "POST" }),
          launcherAvailable ? refreshLauncherStatus() : Promise.resolve(null),
          launcherAvailable ? requestJson<LocalNodeStatusResponse>("/local/node/status") : Promise.resolve(null),
          refreshPublicEntryProfile({ force: true, minIntervalMs: 0 }),
        ]);

        const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
        if (summary) {
          applyGatewaySummary(summary);
        }
        if (modelStatusResult.status === "fulfilled") {
          setModelStatus(modelStatusResult.value);
        }
        if (modelCheckResult.status === "fulfilled") {
          setModelCheck(modelCheckResult.value);
        }
        if (launcherResult.status === "fulfilled" && launcherResult.value) {
          setLauncherStatus(launcherResult.value);
        }
        if (localNodeResult.status === "fulfilled" && localNodeResult.value) {
          setLocalNodeStatus(localNodeResult.value);
        }

        const effectiveSystem = summary?.system ?? systemStatus;
        const effectiveWechat = summary?.wechat ?? wechatStatus;
        const effectiveNodeSummary = summary?.nodes.summary ?? nodeInventorySummary;
        const effectiveLocalNode = localNodeResult.status === "fulfilled" ? localNodeResult.value : localNodeStatus;
        const effectiveModel = modelCheckResult.status === "fulfilled" ? modelCheckResult.value : modelCheck;
        const effectivePublicEntry = publicEntryResult.status === "fulfilled" ? publicEntryResult.value : publicEntryProfileState;
        const gatewayOk = Boolean(summary);
        const redisOk = Boolean(effectiveSystem?.redis_ok);
        const adminWechatItem = buildWechatAdminConnectivityItem(effectiveWechat ?? null, {
          gatewayManaged: launcherShouldRunGateway(launcherStatus),
          baseUrlConfigured: Boolean(gatewaySetup.wechat_base_url || effectiveWechat?.base_url),
          nowMs: now,
        });
        const publicEntryEnabled = Boolean(effectivePublicEntry?.enabled);
        const publicEntryActiveCount = (effectivePublicEntry?.stats.pending_qr ?? 0) + (effectivePublicEntry?.stats.waiting_confirm ?? 0);
        const publicEntryOk = Boolean(publicEntryEnabled && effectivePublicEntry?.access_url);
        const publicEntryStatus: "passed" | "failed" | "warning" = !effectivePublicEntry
          ? "failed"
          : publicEntryOk
            ? "passed"
            : publicEntryEnabled
              ? "failed"
              : "warning";
        const nodeOk = (effectiveNodeSummary?.online_total ?? 0) > 0 || effectiveLocalNode?.runtime_state === "connected";
        const modelOk = Boolean(effectiveModel?.configured_model_available || effectiveLocalNode?.inference_ready);
        const items: ConnectivityCheckReport["items"] = [
          {
            key: "gateway",
            label: "网关",
            status: gatewayOk ? "passed" : "failed",
            summary: gatewayOk ? (gatewayRuntimeSummary.value || "可达") : "不可达",
            detail: gatewayOk
              ? (summary?.system.preferred_gateway_base_url || gatewayRuntimeSummary.detail || "主网关摘要读取成功。")
              : "未能拉取主网关摘要，请先确认 gateway 进程与 8300 端口。",
          },
          {
            key: "redis",
            label: "Redis",
            status: redisOk ? "passed" : "failed",
            summary: redisOk ? "状态存储正常" : "状态存储异常",
            detail: redisOk
              ? "会话、微信运行态与节点调度都可以持续写入。"
              : "Redis 不可用时，运行态恢复与调度状态都会受影响。",
          },
          adminWechatItem,
          {
            key: "wechat-public-entry",
            label: "公共入口扫码",
            status: publicEntryStatus,
            summary: publicEntryOk
              ? "入口已启用"
              : effectivePublicEntry
                ? "入口未启用"
                : "入口读取失败",
            detail: publicEntryOk
              ? `入口地址 ${effectivePublicEntry?.access_url}。当前已绑定 ${effectivePublicEntry?.stats.active_bindings ?? 0} 个用户，正在接入 ${publicEntryActiveCount} 个。`
              : effectivePublicEntry
                ? "公共入口资料已读取，但入口当前未启用；外部用户暂时无法通过公共二维码接入。"
                : "未能读取公共入口资料，请检查 /api/setup/public-entry 与 /entry 路由是否可达。",
          },
          {
            key: "node",
            label: "节点",
            status: nodeOk ? "passed" : "failed",
            summary: nodeOk ? "在线" : "离线",
            detail: nodeOk
              ? effectiveLocalNode?.detail || `当前可见 ${effectiveNodeSummary?.online_total ?? 0} 个在线节点。`
              : effectiveLocalNode?.last_register_error || "没有可接单节点在线，消息可能只能接入无法完成回复。",
          },
          {
            key: "model",
            label: "模型",
            status: modelOk ? "passed" : "failed",
            summary: modelOk ? "可用" : "未通过",
            detail: modelOk
              ? effectiveLocalNode?.inference_detail || (effectiveModel?.configured_model
                ? `已检测 ${effectiveModel.configured_model}。`
                : "模型检测已通过。")
              : effectiveModel?.configured_model
                ? `${effectiveModel.configured_model} 未通过模型检测，请检查配置与密钥。`
                : effectiveLocalNode?.inference_detail || "当前没有可用的推理后端。",
          },
        ];
        const parts = items.map((item) => `${item.label}${item.summary}`);
        const detail = parts.join(" · ");
        const report: ConnectivityCheckReport = {
          checked_at: new Date().toISOString(),
          summary: detail,
          passed_count: items.filter((item) => item.status === "passed").length,
          failed_count: items.filter((item) => item.status === "failed").length,
          warning_count: items.filter((item) => item.status === "warning").length,
          items,
        };
        presentConnectivityCheckReport(report);
      });
    } catch (error) {
      setConnectivityCheckText(`检测失败：${(error as Error).message}`);
      setConnectivityCheckReport({
        checked_at: new Date().toISOString(),
        summary: `检测失败：${(error as Error).message}`,
        passed_count: 0,
        failed_count: 1,
        warning_count: 0,
        items: [
          {
            key: "gateway",
            label: "完整检测",
            status: "failed",
            summary: "执行失败",
            detail: (error as Error).message,
          },
        ],
      });
      setConnectivityCheckModalOpen(true);
      setNotice(`完整检测失败：${(error as Error).message}`);
    }
  }
  function updateNodeState(next: NodeListResponse) {
    syncNodeStateView(next);
  }
  const { pushPairingDebugEntry, appendPairingClientError } = usePairingDebug({
    setupTask,
    setPairingDebugEntries,
    isPairingTaskKind,
  });
  const {
    startQrFlow,
    pollQrStatus,
    connectManualToken,
    disconnectWeChat,
  } = useWechatOnboarding({
    requestJson,
    withBusy,
    qr,
    pollState,
    wechatBaseUrl,
    manualToken,
    launcherStatus,
    setQr,
    setPollState,
    setWechatStatus,
    setManualToken,
    setWechatBaseUrl,
    setNotice,
  });
  const {
    refreshSetupProfile,
    refreshQuickSetupStatus,
    runGatewaySetup,
    runWorkerSetup,
    runConsoleSetup,
    runGatewayConsoleSetup,
    applyDispatchMode,
    submitSetupRole,
  } = useQuickSetupOperations({
    requestJson,
    withBusy,
    shouldUseLocalGatewayApi,
    sessionRemoteGatewayBaseUrl,
    currentRoleIsWorker,
    launcherAvailable,
    runtimeMachineRole,
    systemStatus,
    gatewaySetup,
    workerSetup,
    consoleSetup,
    setupRole,
    setupMode,
    refreshGatewaySummarySnapshot,
    refreshLauncherStatus,
    syncSetupProfileState,
    setSetupTask,
    setSetupMode,
    setWechatBaseUrl,
    setManualToken,
    setWorkerSetup,
    setModelStatus,
    setSystemStatus,
    setWechatStatus,
    syncNodeStateView,
    setNotice,
    applyLauncherPolicyForRole,
    validateWorkerGatewayUrl,
    onWorkerInstallStarted: () => {
      workerGatewayAutoProbeKeyRef.current = "";
    },
  });
  const refreshPublicEntryProfile = useCallback(async (options?: RefreshPublicEntryProfileOptions) => {
    if (currentRoleIsWorker) {
      setPublicEntryProfileState(null);
      publicEntryProfileEndpointRef.current = "";
      return null;
    }
    const remoteGateway = safeTrim(sessionRemoteGatewayBaseUrl);
    const endpoint = shouldUseLocalGatewayApi
      ? "/api/setup/public-entry"
      : remoteGateway
        ? `${remoteGateway}/api/setup/public-entry`
        : "";
    if (!endpoint) {
      setPublicEntryProfileState(null);
      publicEntryProfileEndpointRef.current = "";
      return null;
    }
    const force = options?.force ?? false;
    const minIntervalMs = options?.minIntervalMs ?? PUBLIC_ENTRY_PROFILE_MIN_INTERVAL_MS;
    const now = Date.now();
    if (!force) {
      if (publicEntryProfileRequestRef.current && publicEntryProfileEndpointRef.current === endpoint) {
        return publicEntryProfileRequestRef.current;
      }
      if (
        publicEntryProfileState
        && publicEntryProfileEndpointRef.current === endpoint
        && now - publicEntryProfileLastLoadedAtRef.current < minIntervalMs
      ) {
        return publicEntryProfileState;
      }
    }
    publicEntryProfileEndpointRef.current = endpoint;
    const request = (async () => {
      try {
        const profile = await requestJson<PublicEntryProfileResponse>(endpoint);
        publicEntryProfileLastLoadedAtRef.current = Date.now();
        setPublicEntryProfileState(profile);
        return profile;
      } catch {
        setPublicEntryProfileState(null);
        return null;
      } finally {
        publicEntryProfileRequestRef.current = null;
      }
    })();
    publicEntryProfileRequestRef.current = request;
    try {
      return await request;
    } catch {
      return null;
    }
  }, [currentRoleIsWorker, publicEntryProfileState, requestJson, sessionRemoteGatewayBaseUrl, shouldUseLocalGatewayApi]);
  useEffect(() => {
    void refreshPublicEntryProfile();
  }, [refreshPublicEntryProfile]);
  const savePublicEntryProfile = useCallback(() => {
    void (async () => {
      await runGatewaySetup({
        showResultScreen: false,
        successNotice: "公共入口资料已保存。",
      });
      await refreshPublicEntryProfile();
    })();
  }, [refreshPublicEntryProfile, runGatewaySetup]);
  const copyPublicEntryUrl = useCallback(() => {
    const accessUrl = safeTrim(publicEntryProfileState?.access_url);
    if (!accessUrl) {
      setNotice("当前还没有可复制的公共入口链接。");
      return;
    }
    void navigator.clipboard.writeText(accessUrl)
      .then(() => setNotice("公共入口链接已复制。"))
      .catch(() => setNotice("复制入口链接失败，请手动复制。"));
  }, [publicEntryProfileState?.access_url, setNotice]);
  const repairCurrentMachineNode = useCallback(() => {
    void reinstallLocalNodeService();
  }, [reinstallLocalNodeService]);
  const refreshAllConnectionStatus = useCallback(async () => {
    try {
      await withBusy("connection-refresh-all", async () => {
        await refreshQuickSetupStatus({ silent: true });
        await refreshLocalNodeDiagnostics({ force: true });
      });
      setNotice("已刷新网关、节点、微信和模型状态。");
    } catch (error) {
      setNotice(`刷新全部状态失败：${(error as Error).message}`);
    }
  }, [refreshLocalNodeDiagnostics, refreshQuickSetupStatus]);
  const {
    scanLanNodes,
    probeWorkerGateway,
    closePairingModal,
    pairLanNode,
    manualPairNode,
    deletePairedNode,
    disconnectPairedNode,
  } = usePairingOperations({
    requestJson,
    withBusy,
    canManageNodes: roleCapabilities.actions.canManageNodes,
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
    onWorkerGatewayProbeUpdated: (key) => {
      workerGatewayAutoProbeKeyRef.current = key;
    },
    pushPairingDebugEntry,
    appendPairingClientError,
  });
  const {
    scrollMessagesToBottom,
    handleMessageStreamScroll,
    fetchSessionMessages,
    isIncrementalSessionMessagesEmpty,
    getSessionMessageCache,
    syncSessionMessageCache,
    applySessionMessageEntry,
    loadOlderSessionMessages,
    upsertSessionInView,
    refreshSessionDetail,
    switchSessionNode,
    sendHumanReply,
    releaseSessionToAi,
    persistSessionScrollState,
  } = useSessionConsoleController({
    requestJson,
    withBusy,
    messagesRef,
    shouldAutoFollowMessagesRef,
    pendingHistoryRestoreRef,
    sessionMessageCacheRef,
    selectedSessionId,
    messageHistoryLoading,
    messageHasMoreBefore,
    messageHistoryStart,
    shouldUseLocalGatewayApi,
    shouldUseRemoteGatewayApi,
    sessionRemoteGatewayBaseUrl,
    setSessions,
    setSelectedSessionId,
    setActiveSession,
    setMessages,
    setMessageCursor,
    setMessageHistoryStart,
    setMessageHasMoreBefore,
    setMessagesLoaded,
    setMessageHistoryLoading,
    setNotice,
    refreshGatewaySummarySnapshot,
    saveUiStateCache,
  });
  useEffect(() => {
    setHumanReplyDraft("");
  }, [selectedSessionId]);
  useSessionWorkspaceEffects({
    requestJson,
    workspace,
    sessionsLoaded,
    setSessionsLoaded,
    currentRoleIsWorker,
    currentRoleIsConsole,
    localGatewayManaged,
    sessionRemoteGatewayBaseUrl,
    sessionRemoteNodeId,
    shouldUseLocalGatewayApi,
    shouldUseRemoteGatewayApi,
    launcherStatus,
    selectedSessionId,
    sessions,
    messagesLength: messages.length,
    messagesLoaded,
    activeTaskId: activeSession?.active_task_id,
    queueStatus: activeSession?.queue_status,
    previousMessageSessionIdRef,
    shouldAutoFollowMessagesRef,
    pendingHistoryRestoreRef,
    restoredSessionScrollRef,
    messagesRef,
    getPersistedSessionScroll,
    getSessionMessageCache,
    applySessionMessageEntry,
    fetchSessionMessages,
    isIncrementalSessionMessagesEmpty,
    syncSessionMessageCache,
    scrollMessagesToBottom,
    setSessions,
    setSelectedSessionId,
    setActiveSession,
    setMessages,
    setMessageCursor,
    setMessageHistoryStart,
    setMessageHasMoreBefore,
    setMessagesLoaded,
    setNotice,
    persistSessionScrollState,
  });
  useNodeDiagnosticsEffects({
    requestJson,
    workspace,
    selectedNodeId,
    currentRoleIsConsole,
    launcherStatus,
    sessionRemoteGatewayBaseUrl,
    shouldUseLocalGatewayApi,
    shouldUseRemoteGatewayApi,
    getNodeDiagnosticsCache,
    syncNodeDiagnosticsCache,
    applyNodeDiagnosticsEntry,
    setSelectedNodeDiagnostics,
  });
  useSetupTaskEffects({
    requestJson,
    launcherStatus,
    setupRole,
    setupTask,
    setSetupTask,
    setSetupProfile,
    setWorkspace,
    setNotice,
    applyLauncherPolicyForRole,
  });
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
      if ((setupCompletedRoles.has("worker_node") || hasText(displayedWorkerNodeId)) && hasText(workerSetup.install_dir)) {
        const resetUrl = launcherMachineRoleValue(launcherStatus) === "node" ? "/local/node/reset-credentials" : "/api/setup/node/reset-credentials";
        const result = await withBusy(
          "reconfigure-reset-worker-token",
          () => requestJson<SetupTaskEnvelope>(resetUrl, {
            method: "POST",
            body: JSON.stringify({
              node_id: displayedWorkerNodeId,
              install_dir: safeTrim(workerSetup.install_dir),
            } satisfies NodeCredentialResetRequest),
          }),
        );
        setSetupTask(result.task);
        setWorkerSetup((current) => ({ ...current, node_token: "" }));
        clearNodeDiagnosticsCache(displayedWorkerNodeId);
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
  function applyPreferredGatewayBaseUrlToWorker() {
    const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(setupProfile, systemStatus);
    updateWorkerSetup("gateway_base_url", preferredGatewayBaseUrl);
    setNotice(`已填入当前默认网关地址：${preferredGatewayBaseUrl}`);
  }

  const selectedSession = useMemo(() => selectCurrentSession(sessions, selectedSessionId, activeSession), [sessions, selectedSessionId, activeSession]);
  const selectedNode = useMemo(() => selectCurrentNode(nodes, selectedNodeId), [nodes, selectedNodeId]);
  const sessionBindingOptions = useMemo(
    () => buildSessionBindingOptions(nodes, gatewaySetup.dispatch_mode_enabled, selectedSession?.assigned_node_id),
    [gatewaySetup.dispatch_mode_enabled, nodes, selectedSession?.assigned_node_id],
  );
  const filteredSessions = useMemo(() => filterSessions(sessions, sessionFilter, now), [sessions, sessionFilter, now]);
  const counts = useMemo(() => buildSessionCounts(sessions, now), [sessions, now]);
  const latestUserMessage = useMemo(() => findLatestMessageByRole(messages, "user"), [messages]);
  const latestBotMessage = useMemo(() => findLatestMessageByRole(messages, "bot"), [messages]);
  const typingState = getTypingState(selectedSession, now, latestBotMessage?.created_at);
  const channelReleaseHint = getChannelReleaseHint(selectedSession, now);
  const availableDispatchNodes = useMemo(() => countAvailableDispatchNodes(nodes, gatewaySetup.dispatch_mode_enabled), [nodes, gatewaySetup.dispatch_mode_enabled]);
  const setupCompletedRoles = useMemo(
    () => new Set((setupProfile?.completed_roles?.length ? setupProfile.completed_roles : (effectiveRole ? [effectiveRole] : []))),
    [effectiveRole, setupProfile],
  );
  const currentRoleDisplay = useMemo(
    () => setupRole
      ? roleName(setupRole)
      : effectiveRole
        ? roleName(effectiveRole)
        : (setupProfile?.completed_roles.length
            ? setupProfile.completed_roles.map(roleName).join(" / ")
            : "未选择"),
    [effectiveRole, setupProfile?.completed_roles, setupRole],
  );
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
    const gatewayBaseUrl = authoritativeWorkerGatewayBaseUrl || safeTrim(workerSetup.gateway_base_url);
    const nodeId = authoritativeWorkerNodeId || safeTrim(workerSetup.node_id);
    if (!gatewayBaseUrl || !nodeId) {
      return {
        state: "idle" as WorkerGatewayConnectionState,
        label: "未检测",
        detail: "请先填写目标网关地址和节点 ID。",
        remoteNode: null as NodeInventoryRecord | NodeRecord | null,
      };
    }
    const localStatusNodeId = nodeIdFromLocalNodeStatus(localNodeStatus);
    if (
      currentRoleIsWorker
      && localNodeStatus?.runtime_state === "connected"
      && (!localStatusNodeId || localStatusNodeId === nodeId)
    ) {
      const inventoryNode = nodeInventory.find((item) => item.node_id === nodeId) ?? null;
      const onlineNode = nodes.find((item) => item.node_id === nodeId) ?? null;
      return {
        state: "gateway_reachable_node_connected" as WorkerGatewayConnectionState,
        label: "网关可达，节点已连接",
        detail: localNodeStatus.detail || `节点 ${nodeId} 已注册到目标网关。`,
        remoteNode: inventoryNode ?? onlineNode,
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
    const lastError = safeTrim(task.metadata.node_last_error) || safeTrim(task.metadata.local_node_last_error) || "";
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
  }, [
    authoritativeWorkerGatewayBaseUrl,
    authoritativeWorkerNodeId,
    currentRoleIsWorker,
    localNodeStatus,
    nodeInventory,
    nodes,
    workerGatewayProbeTask,
    workerSetup.gateway_base_url,
    workerSetup.node_id,
  ]);
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
    () =>
      summarizeLocalNodeRuntime(
        localNodeStatus,
        launcherStatus,
        nodeInventory.find((item) => item.node_id === "local-node") ?? null,
      ),
    [launcherStatus, localNodeStatus, nodeInventory],
  );
  const quickSetupStatusRows = useMemo<Array<{ title: string; value: string; tone: "good" | "warn"; detail: string }>>(() => {
    if (currentRoleIsWorker) {
      return [
        {
          title: "节点配置",
          value: setupCompletedRoles.has("worker_node") ? "已完成" : "待配置",
          tone: setupCompletedRoles.has("worker_node") ? "good" : "warn",
          detail: displayedWorkerNodeId || "尚未填写节点 ID",
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
          tone: hasText(workerSetup.pairing_key) ? "good" : "warn",
          detail: hasText(workerSetup.pairing_key) ? "安装阶段不会生成 token；配对时会由网关自动下发。" : "请先填写配对密钥，后续由网关自动下发 token。",
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
  }, [currentNodeLanIp, currentRoleIsWorker, displayedWorkerNodeId, gatewayRuntimeSummary.detail, gatewayRuntimeSummary.tone, gatewayRuntimeSummary.value, latestSetupSummary, localNodeRuntimeSummary.detail, localNodeRuntimeSummary.label, localNodeRuntimeSummary.tone, nodeInventorySummary.online_total, setupCompletedRoles, setupProfile?.console.gateway_base_url, wechatRuntimeSummary.detail, wechatRuntimeSummary.tone, wechatRuntimeSummary.value, workerGatewayConnection.detail, workerGatewayConnection.label, workerGatewayConnection.state, workerSetup.discovery_enabled, workerSetup.discovery_port, workerSetup.pairing_key]);
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
    { label: "节点 ID", value: displayedWorkerNodeId || "未填写" },
    {
      label: "节点 Token 状态",
      value: "安装阶段不会生成 token；只有配对成功后，网关才会自动签发并写入节点。",
    },
    {
      label: "配对密钥状态",
      value: hasText(workerSetup.pairing_key) ? "当前草稿已填写，可通过“显示密钥”临时查看。" : "当前草稿未填写；若已安装节点，请到节点本机 .env 查看或重新设置。",
    },
    { label: "网关侧查看位置", value: `配对成功后可在 ${GATEWAY_NODE_TOKEN_LOCATION} 查看` },
    { label: "节点侧查看位置", value: `配对成功后可在 ${workerEnvLocations(workerSetup.install_dir)} 查看` },
  ]), [displayedWorkerNodeId, setupCompletedRoles, workerSetup.install_dir, workerSetup.pairing_key]);
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
      `当前节点 ID：${displayedWorkerNodeId || "未填写"}`,
      `目标网关：${displayedWorkerGatewayBaseUrl || "未填写"}`,
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
  }, [currentRoleIsWorker, displayedWorkerGatewayBaseUrl, displayedWorkerNodeId, setupTask, workerGatewayConnection.detail, workerGatewayConnection.label, workerGatewayConnection.remoteNode, workerGatewayProbeTask]);
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
      .map((item) => {
        const metadataText = Object.entries(item.metadata || {})
          .filter(([, value]) => value)
          .slice(0, 6)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ");
        return `[${formatTimeLabel(item.timestamp, true)}] ${item.category}/${item.result} ${item.trace_id ? `trace=${item.trace_id} ` : ""}${item.message}${metadataText ? ` | ${metadataText}` : ""}`;
      })
      .join("\n");
  }, [selectedNodeDiagnostics]);
  const displayNodeInventory = useMemo(
    () => nodeInventory.map((node) => normalizeInventoryRuntimeMetrics(node, localInventoryRuntimeStatus)),
    [localInventoryRuntimeStatus, nodeInventory],
  );
  const nodeChannelOverview = useMemo(() => buildNodeChannelOverview(displayNodeInventory), [displayNodeInventory]);
  const nodeInventoryHeadline = useMemo(
    () =>
      `已配对 ${nodeInventorySummary.paired_total} / 在线 ${nodeInventorySummary.online_total} / 空闲 ${nodeChannelOverview.onlineIdle} / 占用 ${nodeChannelOverview.onlineInUse}`,
    [nodeChannelOverview.onlineIdle, nodeChannelOverview.onlineInUse, nodeInventorySummary.online_total, nodeInventorySummary.paired_total],
  );
  const builtinModelStatusDetail = useMemo(() => {
    if (!modelStatus?.configured) {
      return modelStatus?.base_url || "先完成模型检测和配置保存，再开始接入联调。";
    }
    const flags: string[] = [
      modelStatus.enable_thinking ? "Thinking 开" : "Thinking 关",
      `Temp ${modelStatus.temperature}`,
      modelStatus.multimodal_enabled ? "多模态开" : "多模态关",
    ];
    if (modelStatus.top_p < 1) flags.push(`TopP ${modelStatus.top_p}`);
    if (modelStatus.max_tokens > 0) flags.push(`MaxTok ${modelStatus.max_tokens}`);
    if (modelStatus.enable_search) {
      flags.push(`搜索 ${modelStatus.search_strategy}`);
      if (modelStatus.search_forced) flags.push("强制");
      if (modelStatus.enable_search_extension) flags.push("扩展");
    }
    return [modelStatus.base_url, flags.join(" · ")].filter(Boolean).join(" | ");
  }, [
    modelStatus?.base_url,
    modelStatus?.configured,
    modelStatus?.enable_search,
    modelStatus?.enable_search_extension,
    modelStatus?.enable_thinking,
    modelStatus?.max_tokens,
    modelStatus?.multimodal_enabled,
    modelStatus?.search_forced,
    modelStatus?.search_strategy,
    modelStatus?.temperature,
    modelStatus?.top_p,
  ]);
  const builtinModelStatusMeta = useMemo(() => {
    if (!modelStatus?.configured) return modelStatus?.model || "未配置模型";
    const parts: string[] = [modelStatus.model];
    if (modelStatus.api_key_configured) parts.push("Key 已保存");
    if (modelStatus.thinking_budget > 0) parts.push(`Budget ${modelStatus.thinking_budget}`);
    if (hasText(modelStatus.stop)) parts.push("Stop 已配置");
    return parts.join(" · ");
  }, [
    modelStatus?.api_key_configured,
    modelStatus?.configured,
    modelStatus?.model,
    modelStatus?.stop,
    modelStatus?.thinking_budget,
  ]);
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
          title: displayedWorkerGatewayBaseUrl || "未填写局域网网关地址",
          detail: currentNodeLanIp ? `当前节点局域网 IP：${currentNodeLanIp}` : "当前节点还没有检测到可用的局域网地址。",
          tone: displayedWorkerGatewayBaseUrl ? "good" : "warn",
        },
        {
          eyebrow: "发现响应",
          title: workerSetup.discovery_enabled ? `UDP ${workerSetup.discovery_port}` : "已关闭",
          detail: workerSetup.discovery_enabled ? "局域网内主机会通过广播搜索并尝试配对当前节点。" : "关闭后需要从网关端按地址直连配对当前节点。",
          tone: workerSetup.discovery_enabled ? "good" : "warn",
        },
      ];
    }
    const overviewCards: Array<{ eyebrow: string; title: string; detail: string; tone: "good" | "warn" }> = [
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
    ];
    if (currentRoleIsConsole) {
      return overviewCards;
    }
    return [
      ...overviewCards,
      {
        eyebrow: "模型基线",
        title: modelStatus?.model || "未配置",
        detail: builtinModelStatusDetail,
        tone: modelStatus?.configured ? "good" : "warn",
      },
    ];
  }, [
    availableDispatchNodes,
    currentNodeLanIp,
    currentRoleIsConsole,
    currentRoleIsWorker,
    displayedWorkerGatewayBaseUrl,
    gatewayRuntimeSummary.detail,
    gatewayRuntimeSummary.tone,
    gatewayRuntimeSummary.value,
    gatewaySetup.dispatch_mode_enabled,
    builtinModelStatusDetail,
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
    () => {
      const localNodeOnline = localNodeStatus?.runtime_state === "connected" || localNodeStatus?.service_state === "running";
      const activeNodeCount = Math.max(systemStatus?.active_nodes ?? 0, localNodeOnline ? 1 : 0);
      return [
        {
          label: "网关可达",
          detail: gatewayRuntimeSummary.value,
          tone: gatewayRuntimeSummary.tone,
        },
        {
          label: "模型可用",
          detail: modelStatus?.configured ? builtinModelStatusMeta : "尚未检测",
          tone: modelStatus?.configured ? "good" : "warn",
        },
        {
          label: "微信已连接",
          detail: wechatRuntimeSummary.value,
          tone: wechatRuntimeSummary.tone,
        },
        {
          label: "节点在线",
          detail: `${activeNodeCount} 个节点`,
          tone: activeNodeCount > 0 ? "good" : "warn",
        },
      ];
    },
    [
      builtinModelStatusMeta,
      gatewayRuntimeSummary.tone,
      gatewayRuntimeSummary.value,
      localNodeStatus?.runtime_state,
      localNodeStatus?.service_state,
      modelStatus?.configured,
      systemStatus?.active_nodes,
      wechatRuntimeSummary.tone,
      wechatRuntimeSummary.value,
    ],
  );
  const connectionSignalCards = useMemo<Array<{ label: string; value: string; meta: string; tone: "good" | "warn" }>>(
    () => [
      {
        label: "分发策略",
        value: systemStatus?.dispatch_mode_enabled ? "分发模式" : "本机处理",
        meta: systemStatus?.dispatch_mode_enabled
          ? availableDispatchNodes > 0
            ? `${availableDispatchNodes} 个远端节点可接单，切换后会优先把回复分发出去。`
            : "已开启分发，但当前没有可接单的远端节点，切换前需要先恢复节点在线。"
          : "当前请求默认由本机网关或内置节点处理，适合单机联调与回归。",
        tone: systemStatus?.dispatch_mode_enabled && availableDispatchNodes === 0 ? "warn" : "good",
      },
      {
        label: "控制台目标",
        value: setupProfile?.console.gateway_base_url || currentGatewayBaseUrl || "当前页",
        meta: setupProfile?.console.gateway_base_url
          ? "二维码接入、节点纳管和状态刷新都会围绕这个主网关目标展开。"
          : "当前还没有保存默认观察目标；刷新和联调会以当前页所在主机为准。",
        tone: setupProfile?.console.gateway_base_url ? "good" : "warn",
      },
      {
        label: "Redis 基线",
        value: systemStatus?.redis_ok ? "正常" : "未就绪",
        meta: systemStatus?.redis_ok ? "主状态存储可用，微信状态、会话和节点调度可持续写入。" : "主状态存储异常，先恢复它再继续接入和排障。",
        tone: systemStatus?.redis_ok ? "good" : "warn",
      },
      {
        label: "通道余量",
        value: nodeChannelOverview.onlineCapacity > 0 ? `${nodeChannelOverview.onlineIdle} / ${nodeChannelOverview.onlineCapacity}` : "待上报",
        meta:
          nodeChannelOverview.onlineCapacity > 0
            ? `${nodeChannelOverview.onlineInUse} 条正在占用，当前空闲通道决定还能否继续扩容和抢单。`
            : "在线节点尚未上报通道容量，先检查节点版本或心跳诊断。",
        tone: nodeChannelOverview.onlineIdle > 0 || nodeChannelOverview.onlineCapacity === 0 ? "good" : "warn",
      },
    ],
    [
      availableDispatchNodes,
      builtinModelStatusMeta,
      currentGatewayBaseUrl,
      nodeChannelOverview.onlineCapacity,
      nodeChannelOverview.onlineIdle,
      nodeChannelOverview.onlineInUse,
      setupProfile?.console.gateway_base_url,
      systemStatus?.active_nodes,
      systemStatus?.dispatch_mode_enabled,
      systemStatus?.redis_ok,
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
    taskStreamLabel: string;
    taskStreamDetail: string;
    taskStreamTone: "human" | "typing" | "queued";
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
      displayNodeInventory.map((node) => {
        const presentation = resolveInventoryNodePresentation(node, localInventoryRuntimeStatus, launcherStatus);
        const localNodeUnmanaged = isGatewayEmbeddedNode(node)
          && shouldUseLocalInventoryRuntime
          && launcherShouldRunGateway(launcherStatus)
          && !launcherShouldRunLocalNode(launcherStatus);
        const taskStream = localNodeUnmanaged
          ? {
              label: "未托管",
              detail: "当前角色不会在本机建立 claw-node 任务流连接。",
              tone: "queued" as const,
            }
          : describeTaskStreamHealth(node.task_stream);
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
          taskStreamLabel: taskStream.label,
          taskStreamDetail: taskStream.detail,
          taskStreamTone: taskStream.tone,
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
            ...(roleCapabilities.actions.canManageNodes && node.node_kind === "remote" && node.paired
              ? [
                  {
                    label: busy === `delete-node-${node.node_id}` ? "处理中..." : "删除节点",
                    onClick: () => void deletePairedNode(node),
                    disabled: busy !== null,
                  },
                ]
              : []),
            ...(roleCapabilities.actions.canManageNodes && node.node_kind === "remote" && node.online
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
    [busy, deletePairedNode, disconnectPairedNode, displayNodeInventory, launcherStatus, localInventoryRuntimeStatus, roleCapabilities.actions.canManageNodes, selectedNodeId, shouldUseLocalInventoryRuntime],
  );
  const selectedNodeDiagnosticsView = useMemo(() => {
    if (!selectedNodeId || !selectedNodeDiagnostics) return null;
    const taskStream = selectedNodeDiagnostics.task_stream;
    const localNodeUnmanaged = isGatewayEmbeddedNode(selectedNodeDiagnostics)
      && shouldUseLocalInventoryRuntime
      && launcherShouldRunGateway(launcherStatus)
      && !launcherShouldRunLocalNode(launcherStatus);
    const rows: Array<{ label: string; value: string; multiline?: boolean }> = [
      { label: "连接状态", value: selectedNodeDiagnostics.connection_state || "未记录" },
      {
        label: "任务流模式",
        value: localNodeUnmanaged
          ? "未托管 · 当前角色不会在本机托管 claw-node"
          : taskStream.upgrade_required
            ? `需要升级 · ${taskStream.protocol_version || "unknown"}`
            : `${taskStream.connection_mode || "disconnected"} · ${taskStream.protocol_version || "未上报"}`,
      },
      {
        label: "最近链路事件",
        value: localNodeUnmanaged
          ? "不适用"
          : taskStream.last_event_at
            ? formatTimeLabel(taskStream.last_event_at, true)
            : taskStream.last_disconnect_at
              ? `最近断流 ${formatTimeLabel(taskStream.last_disconnect_at, true)}`
              : "暂无",
      },
      {
        label: "断流摘要",
        value: localNodeUnmanaged
          ? "不适用"
          : taskStream.last_disconnect_at
            ? `code ${taskStream.last_disconnect_code ?? "-"} · ${taskStream.last_disconnect_reason || "unknown"}`
            : "暂无",
      },
      {
        label: "重连 / 降级",
        value: localNodeUnmanaged
          ? "不适用"
          : `${taskStream.reconnect_count} 次重连 · ${taskStream.fallback_poll_count} 次 fallback`,
      },
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
    if (selectedNodeDiagnostics.latest_task?.task_id) {
      rows.push({ label: "最近任务", value: selectedNodeDiagnostics.latest_task.task_id });
      if (selectedNodeDiagnostics.latest_task.status || selectedNodeDiagnostics.latest_task.stage) {
        rows.push({
          label: "任务状态",
          value: [selectedNodeDiagnostics.latest_task.status, selectedNodeDiagnostics.latest_task.stage].filter(Boolean).join(" / ") || "未知",
        });
      }
      if (selectedNodeDiagnostics.latest_task.started_at) {
        rows.push({ label: "任务开始", value: formatTimeLabel(selectedNodeDiagnostics.latest_task.started_at, true) });
      }
      if (selectedNodeDiagnostics.latest_task.finished_at) {
        rows.push({ label: "任务结束", value: formatTimeLabel(selectedNodeDiagnostics.latest_task.finished_at, true) });
      }
      const timingParts = [
        selectedNodeDiagnostics.latest_task.total_ms != null ? `总耗时 ${selectedNodeDiagnostics.latest_task.total_ms} ms` : "",
        selectedNodeDiagnostics.latest_task.inference_ms != null ? `推理 ${selectedNodeDiagnostics.latest_task.inference_ms} ms` : "",
        selectedNodeDiagnostics.latest_task.submit_ms != null ? `提交 ${selectedNodeDiagnostics.latest_task.submit_ms} ms` : "",
        selectedNodeDiagnostics.latest_task.model_latency_ms != null ? `模型 ${selectedNodeDiagnostics.latest_task.model_latency_ms} ms` : "",
      ].filter(Boolean);
      if (timingParts.length) {
        rows.push({ label: "耗时拆分", value: timingParts.join(" · ") });
      }
      const tokenParts = [
        selectedNodeDiagnostics.latest_task.prompt_tokens != null ? `prompt ${selectedNodeDiagnostics.latest_task.prompt_tokens}` : "",
        selectedNodeDiagnostics.latest_task.completion_tokens != null ? `completion ${selectedNodeDiagnostics.latest_task.completion_tokens}` : "",
        selectedNodeDiagnostics.latest_task.total_tokens != null ? `total ${selectedNodeDiagnostics.latest_task.total_tokens}` : "",
      ].filter(Boolean);
      if (tokenParts.length) {
        rows.push({ label: "Token", value: tokenParts.join(" · ") });
      }
      if (selectedNodeDiagnostics.latest_task.query_preview) {
        rows.push({ label: "问题预览", value: selectedNodeDiagnostics.latest_task.query_preview, multiline: true });
      }
      if (selectedNodeDiagnostics.latest_task.error) {
        rows.push({ label: "任务错误", value: selectedNodeDiagnostics.latest_task.error, multiline: true });
      }
    }
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
  }, [launcherStatus, selectedNodeDiagnostics, selectedNodeId, selectedNodeTimelineText, shouldUseLocalInventoryRuntime]);
  const wechatStatusRows = useMemo(
    () => buildWechatStatusRows(wechatStatus, wechatRuntimeSummary, now),
    [
      wechatRuntimeSummary,
      wechatStatus?.has_token,
      wechatStatus?.last_error,
      wechatStatus?.running,
      wechatStatus?.session_pause_reason,
      wechatStatus?.session_paused,
      wechatStatus?.session_paused_until,
      now,
    ],
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
  const sidebarWorkspaceItems = useMemo(
    () =>
      visibleWorkspaces.map((item) => ({
        key: item,
        ...workspacePresentation(roleCapabilities, item),
      })),
    [roleCapabilities, visibleWorkspaces],
  );
  const roleBadge = resolveRoleBadge(effectiveRole);
  const sidebarStatusSummary = currentRoleIsWorker
    ? `${workerGatewayConnection.label} · ${formatModelProviderLabel(localNodeStatus?.active_model_provider || localNodeStatus?.configured_model_provider) || "未配置"}`
    : `${gatewayRuntimeSummary.value} · ${wechatRuntimeSummary.value} · ${nodeInventorySummary.online_total} 节点在线`;
  const topbarHighlights: Array<{ label: string; value: string; tone: "good" | "warn" }> = currentRoleIsWorker
    ? [
        {
          label: "目标网关",
          value:
            workerGatewayConnection.state === "gateway_reachable_node_connected"
              ? "已连接"
              : displayedWorkerGatewayBaseUrl
                ? "可达"
                : "未填写",
          tone: workerGatewayConnection.state === "gateway_reachable_node_connected" ? "good" : "warn",
        },
        {
          label: "节点",
          value: displayedWorkerNodeId || "未配置",
          tone: displayedWorkerNodeId ? "good" : "warn",
        },
        {
          label: "注册状态",
          value:
            workerGatewayConnection.state === "gateway_reachable_node_connected"
              ? "已注册"
              : workerGatewayConnection.state === "idle"
                ? "未检测"
                : workerGatewayConnection.label,
          tone: workerGatewayConnection.state === "gateway_reachable_node_connected" ? "good" : "warn",
        },
        {
          label: "模型",
          value: formatModelProviderLabel(localNodeStatus?.active_model_provider || localNodeStatus?.configured_model_provider) || "未配置",
          tone: localNodeStatus?.inference_ready ? "good" : "warn",
        },
      ]
    : currentRoleIsConsole
      ? [
          { label: "网关", value: gatewayRuntimeSummary.value, tone: gatewayRuntimeSummary.tone },
          { label: "微信", value: wechatRuntimeSummary.value, tone: wechatRuntimeSummary.tone },
          { label: "节点", value: `${nodeInventorySummary.online_total} 在线`, tone: nodeInventorySummary.online_total > 0 ? "good" : "warn" },
        ]
      : [
          { label: "网关", value: gatewayRuntimeSummary.value, tone: gatewayRuntimeSummary.tone },
          { label: "微信", value: wechatRuntimeSummary.value, tone: wechatRuntimeSummary.tone },
          { label: "节点", value: `${nodeInventorySummary.online_total} 在线`, tone: nodeInventorySummary.online_total > 0 ? "good" : "warn" },
          { label: "模型", value: modelStatus?.model || "未配置", tone: modelStatus?.configured ? "good" : "warn" },
        ];

  return (
    <div className="console-app-desktop">
      <aside className="console-sidebar">
        <div className="sidebar-brand sidebar-brand-command">
          <div className="sidebar-logo"></div>
          <div className="sidebar-brand-copy">
            <span className="sidebar-overline">Wechat Hub</span>
            <h2>运维指挥台</h2>
            <p>{activeRoleDescription}</p>
          </div>
        </div>
        <div className="sidebar-role-panel">
          <div className="sidebar-role-topline">
            <span className="sidebar-role-label">{activeRoleLabel}</span>
            {roleBadge ? <span className={`role-badge role-badge-${roleBadge.variant}`}>{roleBadge.label}</span> : null}
          </div>
          <div className="sidebar-role-summary">{sidebarStatusSummary}</div>
        </div>
        <nav className="workspace-tabs-vertical" role="tablist" aria-label="Primary workspaces">
          {sidebarWorkspaceItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`workspace-tab workspace-tab-rich ${workspace === item.key ? "workspace-tab-active" : ""}`}
              onClick={() => setWorkspace(item.key)}
            >
              <span className="workspace-tab-copy">
                <span className="workspace-tab-title-row">
                  <span>{item.label}</span>
                  {roleBadge?.tab === item.key ? <span className={`role-badge role-badge-${roleBadge.variant}`}>{roleBadge.label}</span> : null}
                </span>
                <span className="workspace-tab-detail">{item.description}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer-note">
          <span>PRIMARY</span>
          <strong>{activeWorkspacePresentation.label}</strong>
        </div>
      </aside>

      <div className="console-main-content">
        <header className="console-topbar">
          <div className="topbar-main">
            <div className="topbar-kicker">{activeWorkspacePresentation.kicker}</div>
            <div className="topbar-title">{activeWorkspacePresentation.label}</div>
            {activeWorkspacePresentation.description ? <div className="topbar-copy">{activeWorkspacePresentation.description}</div> : null}
          </div>
          <div className="topbar-side">
            <div className="topbar-role-card">
              <span>当前角色</span>
              <strong>{activeRoleLabel}</strong>
            </div>
            <div className="topbar-status-row">
              {topbarHighlights.map((item) => (
                <StatusChip key={item.label} label={item.label} value={item.value} tone={item.tone} />
              ))}
            </div>
          </div>
          {topbarNotice ? <div className="topbar-notice">{topbarNotice}</div> : null}
        </header>

        {workspace === "quick_setup" ? (
          <QuickSetupWorkspace
            currentRoleIsWorker={currentRoleIsWorker}
            currentRoleIsConsole={currentRoleIsConsole}
            currentRoleDisplay={currentRoleDisplay || quickSetupPresentation.label}
            effectiveRole={effectiveRole}
            setupMode={setupMode}
            setupRole={setupRole}
            setupProfile={setupProfile}
            setupTask={setupTask}
            launcherAvailable={launcherAvailable}
            launcherExpanded={launcherExpanded}
            envExpanded={envExpanded}
            launcherStatus={launcherStatus}
            launcherLogs={launcherLogs}
            busyKey={busy}
            gatewaySetup={gatewaySetup}
            workerSetup={workerSetup}
            consoleSetup={consoleSetup}
            currentNodeLanIp={currentNodeLanIp}
            discoveredNodes={discoveredNodes}
            pairingStatuses={pairingStatuses}
            pairingSecrets={pairingSecrets}
            manualPair={manualPair}
            workerGatewayProbeTask={workerGatewayProbeTask}
            workerGatewayConnection={workerGatewayConnection}
            workerPairingKeyVisible={workerPairingKeyVisible}
            workerModelExpanded={workerModelExpanded}
            launcherHostRedisFailed={launcherHostRedis?.state === "failed"}
            launcherGatewayFailed={launcherGateway?.state === "failed"}
            latestSetupSummary={latestSetupSummary}
            quickSetupStatusRows={quickSetupStatusRows}
            workerCredentialRows={workerCredentialRows}
            reconfigureWarnings={reconfigureWarnings}
            wechatRunning={Boolean(wechatStatus?.running)}
            wechatBaseUrl={wechatStatus?.base_url || gatewaySetup.wechat_base_url || "-"}
            gatewayRuntimeText={`${gatewayRuntimeSummary.value} · ${gatewayRuntimeSummary.detail}`}
            nodeSummaryText={nodeInventorySummary.online_total ? `${nodeInventorySummary.online_total} 个在线` : "暂无在线节点"}
            completedRoles={setupCompletedRoles}
            installProgressSummary={installProgressSummary}
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
            reconfigureConfirmOpen={reconfigureConfirmOpen}
            onRefreshStatus={refreshQuickSetupStatus}
            onToggleReconfigureConfirm={toggleReconfigureConfirm}
            onConfirmReconfigure={() => void confirmReconfigure()}
            onCancelReconfigure={() => setReconfigureConfirmOpen(false)}
            onSelectRole={selectSetupRole}
            onClearAndReselectRole={clearAndReselectRole}
            onReturnToSetupStatus={returnToSetupStatus}
            onResetCurrentSetupDraft={resetCurrentSetupDraft}
            onUpdateGatewaySetup={updateGatewaySetup}
            onUpdateWorkerSetup={updateWorkerSetup}
            onUpdateConsoleSetup={updateConsoleSetup}
            onUpdatePairingSecret={updatePairingSecret}
            onScanLanNodes={() => void scanLanNodes()}
            onPairLanNode={(item) => void pairLanNode(item)}
            onApplyPreferredGatewayBaseUrlToWorker={applyPreferredGatewayBaseUrlToWorker}
            onProbeWorkerGateway={() => void probeWorkerGateway({ reason: "manual" })}
            onToggleWorkerPairingKeyVisible={toggleWorkerPairingKeyVisible}
            onToggleWorkerModelExpanded={toggleWorkerModelExpanded}
            onUpdateManualPair={updateManualPair}
            pairingStatusLabel={pairingStatusLabel}
            pairingStatusTone={pairingStatusTone}
            validateWorkerGatewayUrl={validateWorkerGatewayUrl}
            resolveTokenWaiting={(token) => resolveTokenDisplayState(token).status === "waiting"}
            previewContent={(role) => previewContent(role, gatewaySetup, workerSetup, consoleSetup)}
            previewOutcome={previewOutcome}
            onSubmitSetupRole={submitSetupRole}
            onBackToConfig={backToConfig}
            onRefreshProfile={refreshSetupProfile}
            onGoToConnection={() => setWorkspace("connection")}
            onAdvanceToPreview={advanceToPreview}
          />
        ) : workspace === "connection" ? (
          <ConnectionWorkspace
            currentRoleIsWorker={currentRoleIsWorker}
            roleTitle={connectionWorkspacePresentation.heroTitle}
            roleDescription={connectionWorkspacePresentation.heroDescription}
            heroTitle={connectionWorkspacePresentation.heroTitle}
            heroDescription={connectionWorkspacePresentation.heroDescription}
            roleSections={{
              showGatewayOverview: roleCapabilities.sections.showGatewayOverview,
              showWeChatAccess: roleCapabilities.sections.showWeChatAccess,
              showPublicEntryProfile: roleCapabilities.sections.showPublicEntryProfile,
              showRemoteNodeInventory: roleCapabilities.sections.showRemoteNodeInventory,
              showLocalNodePanel: roleCapabilities.sections.showLocalNodePanel,
            }}
            roleActions={{
              canManageGateway: roleCapabilities.actions.canManageGateway,
              canManageWeChat: roleCapabilities.actions.canManageWeChat,
              canManagePublicEntry: roleCapabilities.actions.canManagePublicEntry,
              canManageNodes: roleCapabilities.actions.canManageNodes,
            }}
            connectionConsolePresentation={connectionConsoleView}
            currentNodeLanIp={currentNodeLanIp}
            currentGatewayBaseUrl={currentGatewayBaseUrl}
            setupCompletedRoles={setupCompletedRoles}
            setupProfileConsoleGatewayBaseUrl={setupProfile?.console.gateway_base_url || ""}
            gatewaySetupDispatchModeEnabled={gatewaySetup.dispatch_mode_enabled}
            workerSetup={workerSetup}
            displayedWorkerNodeId={displayedWorkerNodeId}
            displayedWorkerGatewayBaseUrl={displayedWorkerGatewayBaseUrl}
            manualPair={manualPair}
            discoveredNodes={discoveredNodes}
            pairingSecrets={pairingSecrets}
            pairingStatuses={pairingStatuses}
            workerPairingKeyVisible={workerPairingKeyVisible}
            launcherAvailable={launcherAvailable}
            busyKey={busy}
            availableDispatchNodes={availableDispatchNodes}
            launcherGatewayState={launcherStatus?.components.find((item) => item.name === "gateway")?.state || "未读取"}
            launcherGatewayManaged={launcherShouldRunGateway(launcherStatus)}
            localNodeStatus={localNodeStatus}
            assessmentMaxRounds={assessmentMaxRounds}
            assessmentApplyStrategy={assessmentApplyStrategy}
            localNodeModelDraft={localNodeModelDraft}
            localNodeModelDirty={localNodeModelDirty}
            workerGatewayConnection={workerGatewayConnection}
            localNodeRuntimeSummary={localNodeRuntimeSummary}
            connectionHeroCards={connectionHeroCards}
            connectionPrepItems={connectionPrepItems}
            connectionSignalCards={connectionSignalCards}
            nodeInventoryHeadline={nodeInventoryHeadline}
            nodeInventoryCards={nodeInventoryCards}
            selectedNodeDiagnosticsView={selectedNodeDiagnosticsView}
            wechatStatusRows={wechatStatusRows}
            qrImageSrc={qrImageSrc}
            pollStatus={pollState?.status ?? "未开始"}
            wechatBaseUrl={wechatBaseUrl}
            manualToken={manualToken}
            publicEntryProfile={{
              enabled: gatewaySetup.public_entry_enabled,
              baseUrl: gatewaySetup.public_entry_base_url,
              displayName: gatewaySetup.public_entry_display_name,
              contactHint: gatewaySetup.public_entry_contact_hint,
              notes: gatewaySetup.public_entry_notes,
              greetingMessage: gatewaySetup.public_entry_greeting_message,
              accessUrl: publicEntryProfileState?.access_url || "",
              accessQrImageSrc: publicEntryQrImageSrc,
              stats: {
                pendingQr: publicEntryProfileState?.stats.pending_qr || 0,
                waitingConfirm: publicEntryProfileState?.stats.waiting_confirm || 0,
                bound: publicEntryProfileState?.stats.bound || 0,
                expired: publicEntryProfileState?.stats.expired || 0,
                failed: publicEntryProfileState?.stats.failed || 0,
                activeBindings: publicEntryProfileState?.stats.active_bindings || 0,
              },
            }}
            connectivityCheckText={connectivityCheckText}
            wechatLastError={wechatStatus?.last_error || null}
            wechatStatus={wechatStatus}
            systemStatus={systemStatus}
            onRunConnectivityCheck={() => void runConnectivityCheck()}
            onToggleDispatch={() => void applyDispatchMode(!gatewaySetup.dispatch_mode_enabled)}
            onRefreshAllStatus={() => void refreshAllConnectionStatus()}
            onWechatBaseUrlChange={setWechatBaseUrl}
            onManualTokenChange={setManualToken}
            onUpdatePublicEntryProfile={(key, value) => {
              updateGatewaySetup(key, value as never);
            }}
            onSavePublicEntryProfile={savePublicEntryProfile}
            onCopyPublicEntryUrl={copyPublicEntryUrl}
            onStartQrFlow={() => void startQrFlow()}
            onPollQrStatus={() => void pollQrStatus()}
            onConnectManualToken={() => void connectManualToken()}
            onDisconnectWeChat={() => void disconnectWeChat()}
            onApplyPreferredGatewayBaseUrlToWorker={applyPreferredGatewayBaseUrlToWorker}
            onUpdateWorkerSetup={updateWorkerSetup}
            onToggleWorkerPairingKeyVisible={toggleWorkerPairingKeyVisible}
            onRunWorkerSetup={() => void runWorkerSetup({ showResultScreen: false })}
            onRepairCurrentMachineNode={repairCurrentMachineNode}
            onProbeWorkerGateway={() => void probeWorkerGateway({ reason: "manual" })}
            onUpdateManualPair={updateManualPair}
            onManualPairNode={() => void manualPairNode()}
            onScanLanNodes={() => void scanLanNodes()}
            onUpdatePairingSecret={updatePairingSecret}
            onPairLanNode={(item) => void pairLanNode(item)}
            onUpdateLocalNodeModelDraft={updateLocalNodeModelDraft}
            onAssessmentMaxRoundsChange={setAssessmentMaxRounds}
            onAssessmentApplyStrategyChange={setAssessmentApplyStrategy}
            onRefreshLocalNodeStatus={() => void refreshLocalNodeStatus({ force: true })}
            onRefreshLocalNodeDiagnostics={() => void refreshLocalNodeDiagnostics({ force: true })}
            onStartLocalNodeService={() => void startLocalNodeService()}
            onStopLocalNodeService={() => void stopLocalNodeService()}
            onRestartLocalNodeService={() => void restartLocalNodeService()}
            onSaveLocalNodeModelConfig={() => void saveLocalNodeModelConfig()}
            onExportLocalNodeDiagnostics={() => void exportLocalNodeDiagnostics()}
            onResetLocalNodeCredentials={() => void resetLocalNodeCredentials()}
            onRunLocalNodeConversationTest={(payload: LocalNodeConversationTestRequest): Promise<LocalNodeConversationTestResponse> => runLocalNodeConversationTest(payload)}
            onStartLocalNodeChannelAssessment={() => void startLocalNodeChannelAssessment()}
            onApplyLocalNodeChannelAssessment={() => void applyLocalNodeChannelAssessment()}
            onRestartGatewayService={() => void restartGatewayService()}
          />
        ) : workspace === "conversation_test" ? (
          <ConversationTestWorkspace
            currentRoleIsWorker={currentRoleIsWorker}
            title={conversationWorkspacePresentation.label}
            description={conversationWorkspacePresentation.description}
            heroTitle={conversationWorkspacePresentation.heroTitle}
            heroDescription={conversationWorkspacePresentation.heroDescription}
            launcherAvailable={launcherAvailable}
            busyKey={busy}
            localNodeStatus={localNodeStatus}
            localNodeModelDirty={localNodeModelDirty}
            onSaveLocalNodeModelConfig={() => void saveLocalNodeModelConfig()}
            onRefreshLocalNodeDiagnostics={() => void refreshLocalNodeDiagnostics({ force: true })}
            onRunLocalNodeConversationTest={(payload: LocalNodeConversationTestRequest): Promise<LocalNodeConversationTestResponse> => runLocalNodeConversationTest(payload)}
          />
        ) : workspace === "logs" ? (
          <LogsWorkspace
            currentRoleIsWorker={currentRoleIsWorker}
            workerConnectionLog={workerConnectionLog}
            runtimeLogEntries={runtimeLogEntries}
            runtimeLogsRefreshing={runtimeLogsRefreshing}
            pairingDebugViewEntries={pairingDebugViewEntries}
            onRefreshRuntimeLogs={() => void refreshRuntimeLogs()}
            onClearPairingDebugEntries={clearPairingDebugEntries}
          />
        ) : (
          <SessionsWorkspace
            effectiveRole={effectiveRole}
            title={sessionWorkspacePresentation.label}
            description={sessionWorkspacePresentation.description}
            heroTitle={sessionWorkspacePresentation.heroTitle}
            heroDescription={sessionWorkspacePresentation.heroDescription}
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
            humanReplyDraft={humanReplyDraft}
            typingState={typingState}
            channelReleaseHint={channelReleaseHint}
            latestUserMessage={latestUserMessage}
            latestBotMessage={latestBotMessage}
            wechatRuntimeSummaryValue={wechatRuntimeSummary.value}
            now={now}
            inspectorOpen={inspectorOpen}
            busyKey={busy}
            currentRoleIsWorker={currentRoleIsWorker}
            canBindSessions={roleCapabilities.actions.canBindSessions}
            messagesRef={messagesRef}
            onGoToQuickSetup={() => setWorkspace("quick_setup")}
            onChangeFilter={setSessionFilter}
            onSelectSession={setSelectedSessionId}
            onChangeHumanReplyDraft={setHumanReplyDraft}
            onSendHumanReply={(sessionId) => {
              void sendHumanReply(sessionId, humanReplyDraft).then((result) => {
                if (result?.ok) setHumanReplyDraft("");
              });
            }}
            onReleaseSessionToAi={(sessionId) => void releaseSessionToAi(sessionId)}
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
      <ConnectivityCheckModal
        open={connectivityCheckModalOpen}
        report={connectivityCheckReport}
        onClose={() => setConnectivityCheckModalOpen(false)}
      />
    </div>
  );
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
function looksLikeGatewayAuthFailure(detail: string) {
  const normalized = detail.toLowerCase();
  return ["401 unauthorized", "unauthorized", "invalid node token", "node token is not configured"].some((marker) => normalized.includes(marker));
}
function gatewayTokenMismatchHint(nodeId: string) {
  return `请核对目标网关 ${GATEWAY_NODE_TOKEN_LOCATION} 中 ${nodeId} 对应的 token，是否与当前节点保存的一致。`;
}
function pairingDebugStatusLabel(status: PairingDebugEntry["status"]) { return status === "succeeded" ? "成功" : status === "running" ? "进行中" : status === "pending" ? "等待中" : "失败"; }

function normalizeTopbarNotice(value: string | null): string | null {
  const trimmed = safeTrim(value);
  if (!trimmed) return null;
  if (trimmed === "正在读取主网关状态。") return null;
  if (trimmed === "主网关在线。微信、节点和会话概览会通过实时流持续更新。") return null;
  return trimmed;
}
