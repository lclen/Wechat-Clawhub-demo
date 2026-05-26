import { useRef, useState } from "react";
import { ChannelAssessmentCard } from "./ChannelAssessmentCard";
import { ConnectionHeroCard, PrepStrip, SetupStepPill, ToggleSecretInput } from "./ConnectionUi";
import { NodeInventoryPanel } from "./NodeInventoryPanel";
import { NodeModelConfigPanel } from "./NodeModelConfigPanel";
import { OverviewPanel } from "./OverviewPanel";
import { WeChatConfigCard } from "./WeChatConfigCard";
import { hasText, safeTrim } from "../../../stringUtils";
import type { ConnectionConsolePresentation } from "../../../roleCapabilities";
import {
  MetricCard,
  InfoList,
  SectionHeader,
  SignalBadge,
  SurfaceCard,
} from "../../shared/ConsolePrimitives";
import type {
  ConnectionHeroCardData,
  ConnectionPrepItem,
  ConnectionSignalCardData,
  DiscoveredNodeRecord,
  LocalNodeConversationTestRequest,
  LocalNodeConversationTestResponse,
  LocalNodeModelConfigRequest,
  LocalNodeStatusResponse,
  ManualPairDraft,
  NodeInventoryRecord,
  NodeKind,
  NodeRecord,
  PairingStatus,
  SetupRole,
  SystemStatus,
  WeChatStatus,
  WorkerGatewayConnectionState,
  WorkerNodeSetupConfig,
} from "../../../types";

type DiagnosticsRow = {
  label: string;
  value: string;
  multiline?: boolean;
};

type SelectedDiagnosticsView = {
  nodeId: string;
  kind: NodeKind | null;
  traceId: string | null;
  rows: DiagnosticsRow[];
  timelineText?: string | null;
  onClose: () => void;
};

type NodeInventoryCardView = {
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
  actions: Array<{
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }>;
};

type WorkerGatewayConnectionView = {
  label: string;
  detail: string;
  state: WorkerGatewayConnectionState;
  remoteNode?: NodeInventoryRecord | NodeRecord | null;
};

type ConnectionCapabilityGroup = "gateway" | "wechat" | "node" | "public";

type ConnectionCapabilityView = {
  id: string;
  group: ConnectionCapabilityGroup;
  title: string;
  owner: string;
  priority: "P0" | "P1";
  statusLabel: string;
  statusTone: "good" | "warn" | "info" | "neutral";
  summary: string;
  actionLabel: string;
  evidence: string[];
  onAction: () => void;
  disabled?: boolean;
};

type ConnectionPathStepView = {
  index: string;
  label: string;
  detail: string;
  capabilityId: string;
  active?: boolean;
  done?: boolean;
};

type ConnectionWorkspaceProps = {
  currentRoleIsWorker: boolean;
  roleTitle: string;
  roleDescription: string;
  heroTitle: string;
  heroDescription: string;
  roleSections: {
    showGatewayOverview: boolean;
    showWeChatAccess: boolean;
    showPublicEntryProfile: boolean;
    showRemoteNodeInventory: boolean;
    showLocalNodePanel: boolean;
  };
  roleActions: {
    canManageGateway: boolean;
    canManageWeChat: boolean;
    canManagePublicEntry: boolean;
    canManageNodes: boolean;
  };
  connectionConsolePresentation: ConnectionConsolePresentation;
  currentNodeLanIp: string;
  currentGatewayBaseUrl: string;
  setupCompletedRoles: Set<SetupRole>;
  setupProfileConsoleGatewayBaseUrl: string;
  gatewaySetupDispatchModeEnabled: boolean;
  workerSetup: WorkerNodeSetupConfig;
  displayedWorkerNodeId: string;
  displayedWorkerGatewayBaseUrl: string;
  manualPair: ManualPairDraft;
  discoveredNodes: DiscoveredNodeRecord[];
  pairingSecrets: Record<string, string>;
  pairingStatuses: Record<string, PairingStatus>;
  workerPairingKeyVisible: boolean;
  launcherAvailable: boolean;
  busyKey: string | null;
  availableDispatchNodes: number;
  launcherGatewayState: string;
  launcherGatewayManaged: boolean;
  localNodeStatus: LocalNodeStatusResponse | null;
  assessmentMaxRounds: number;
  assessmentApplyStrategy: "balanced" | "peak";
  localNodeModelDraft: LocalNodeModelConfigRequest;
  localNodeModelDirty: boolean;
  workerGatewayConnection: WorkerGatewayConnectionView;
  localNodeRuntimeSummary: { label: string; detail: string };
  connectionHeroCards: ConnectionHeroCardData[];
  connectionPrepItems: ConnectionPrepItem[];
  connectionSignalCards: ConnectionSignalCardData[];
  nodeInventoryHeadline: string;
  nodeInventoryCards: NodeInventoryCardView[];
  selectedNodeDiagnosticsView: SelectedDiagnosticsView | null;
  wechatStatusRows: Array<{ label: string; value: string; multiline?: boolean }>;
  qrImageSrc: string;
  pollStatus: string;
  wechatBaseUrl: string;
  manualToken: string;
  publicEntryProfile: {
    enabled: boolean;
    baseUrl: string;
    displayName: string;
    contactHint: string;
    notes: string;
    greetingMessage: string;
    accessUrl: string;
    accessQrImageSrc: string | null;
    stats: {
      pendingQr: number;
      waitingConfirm: number;
      bound: number;
      expired: number;
      failed: number;
      activeBindings: number;
    };
  };
  connectivityCheckText: string | null;
  wechatLastError: string | null;
  wechatStatus: WeChatStatus | null;
  systemStatus: SystemStatus | null;
  onRunConnectivityCheck: () => void;
  onToggleDispatch: () => void;
  onRefreshAllStatus: () => void;
  onWechatBaseUrlChange: (value: string) => void;
  onManualTokenChange: (value: string) => void;
  onUpdatePublicEntryProfile: (
    key:
      | "public_entry_enabled"
      | "public_entry_base_url"
      | "public_entry_display_name"
      | "public_entry_contact_hint"
      | "public_entry_notes"
      | "public_entry_greeting_message",
    value: boolean | string,
  ) => void;
  onSavePublicEntryProfile: () => void;
  onCopyPublicEntryUrl: () => void;
  onStartQrFlow: () => void;
  onPollQrStatus: () => void;
  onConnectManualToken: () => void;
  onDisconnectWeChat: () => void;
  onApplyPreferredGatewayBaseUrlToWorker: () => void;
  onUpdateWorkerSetup: <K extends keyof WorkerNodeSetupConfig>(key: K, value: WorkerNodeSetupConfig[K]) => void;
  onToggleWorkerPairingKeyVisible: () => void;
  onRunWorkerSetup: () => void;
  onRepairCurrentMachineNode: () => void;
  onProbeWorkerGateway: () => void;
  onUpdateManualPair: <K extends keyof ManualPairDraft>(key: K, value: ManualPairDraft[K]) => void;
  onManualPairNode: () => void;
  onScanLanNodes: () => void;
  onUpdatePairingSecret: (discoveryId: string, value: string) => void;
  onPairLanNode: (item: DiscoveredNodeRecord) => void;
  onUpdateLocalNodeModelDraft: <K extends keyof LocalNodeModelConfigRequest>(key: K, value: LocalNodeModelConfigRequest[K]) => void;
  onAssessmentMaxRoundsChange: (value: number) => void;
  onAssessmentApplyStrategyChange: (value: "balanced" | "peak") => void;
  onRefreshLocalNodeStatus: () => void;
  onRefreshLocalNodeDiagnostics: () => void;
  onStartLocalNodeService: () => void;
  onStopLocalNodeService: () => void;
  onRestartLocalNodeService: () => void;
  onSaveLocalNodeModelConfig: () => void;
  onExportLocalNodeDiagnostics: () => void;
  onResetLocalNodeCredentials: () => void;
  onRunLocalNodeConversationTest: (payload: LocalNodeConversationTestRequest) => Promise<LocalNodeConversationTestResponse>;
  onStartLocalNodeChannelAssessment: () => void;
  onApplyLocalNodeChannelAssessment: () => void;
  onRestartGatewayService: () => void;
};

export function ConnectionWorkspace(props: ConnectionWorkspaceProps) {
  const [selectedCapabilityId, setSelectedCapabilityId] = useState("gateway-runtime");
  const showOverview = props.roleSections.showGatewayOverview;
  const showWeChat = props.roleSections.showWeChatAccess;
  const showPublicEntryProfile = props.roleSections.showPublicEntryProfile;
  const showInventory = props.roleSections.showRemoteNodeInventory;
  const showLocalNodePanel = props.roleSections.showLocalNodePanel;
  const showNodeOnboarding = props.roleActions.canManageNodes;
  const showGatewayControls = props.roleActions.canManageGateway;
  const canManagePublicEntry = props.roleActions.canManagePublicEntry;
  const hasSidebarContent = true;
  const wechatPanelRef = useRef<HTMLDivElement | null>(null);
  const inventoryPanelRef = useRef<HTMLDivElement | null>(null);
  const localNodePanelRef = useRef<HTMLDivElement | null>(null);
  const localNodeConsoleRef = useRef<HTMLDivElement | null>(null);
  const focusPanel = (target: HTMLDivElement | null) => {
    if (!target) return;
    const scrollContainer = target.closest(".console-main-content");
    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTo({
        top: Math.max(0, target.offsetTop - 18),
        behavior: "smooth",
      });
    }
    target.focus({ preventScroll: true });
  };
  const localConsoleHint = showLocalNodePanel
    ? {
        label: props.connectionConsolePresentation.recommendedActionLabel,
        detail: props.connectionConsolePresentation.recommendedActionDetail,
        onFocus: () => {
          setSelectedCapabilityId("node-inventory");
          window.setTimeout(() => focusPanel(localNodeConsoleRef.current), 0);
        },
      }
    : null;
  const connectionPathSteps: ConnectionPathStepView[] = [
    {
      index: "01",
      label: "确认网关",
      capabilityId: "gateway-runtime",
      detail: props.currentGatewayBaseUrl || "使用当前页面地址",
      active: selectedCapabilityId === "gateway-runtime" || (!showOverview && selectedCapabilityId === "gateway-runtime"),
      done: props.setupCompletedRoles.has("gateway_host") || props.setupCompletedRoles.has("gateway_host_console"),
    },
    {
      index: "02",
      label: "接入微信",
      capabilityId: "wechat-onboarding",
      detail: props.wechatStatus?.running ? "运行中，可继续拉取二维码或手动 token" : "等待二维码或手动 token",
      active: selectedCapabilityId === "wechat-onboarding",
      done: Boolean(props.wechatStatus?.running),
    },
    {
      index: "03",
      label: "纳管节点",
      capabilityId: "node-inventory",
      detail: props.availableDispatchNodes ? `${props.availableDispatchNodes} 个可调度节点` : props.nodeInventoryHeadline,
      active: selectedCapabilityId === "node-inventory",
      done: props.availableDispatchNodes > 0,
    },
    {
      index: "04",
      label: "开放入口",
      capabilityId: "public-entry",
      detail: props.publicEntryProfile.enabled ? `${props.publicEntryProfile.stats.activeBindings} 个绑定用户` : "按需开启公共二维码入口",
      active: selectedCapabilityId === "public-entry",
      done: props.publicEntryProfile.enabled,
    },
  ];
  const capabilities: ConnectionCapabilityView[] = [
    {
      id: "gateway-runtime",
      group: "gateway",
      title: "主网关运行态",
      owner: props.roleTitle,
      priority: "P0",
      statusLabel: props.launcherGatewayManaged ? props.launcherGatewayState || "可管理" : "需确认",
      statusTone: props.launcherGatewayManaged ? "good" : "warn",
      summary: "把网关地址、运行态刷新、完整检测和分发模式收在首屏，先解决接入前置条件。",
      actionLabel: props.busyKey === "connectivity-check" ? "检测中..." : "完整检测",
      evidence: [
        props.currentGatewayBaseUrl || "当前页面地址",
        props.gatewaySetupDispatchModeEnabled ? "分发模式已开启" : "分发模式未开启",
        props.connectivityCheckText || "等待完整检测",
      ],
      onAction: props.onRunConnectivityCheck,
      disabled: props.busyKey !== null,
    },
    {
      id: "wechat-onboarding",
      group: "wechat",
      title: "微信接入",
      owner: showWeChat ? "gateway_host" : "只读状态",
      priority: "P0",
      statusLabel: props.wechatStatus?.running ? "运行中" : "待接入",
      statusTone: props.wechatStatus?.running ? "good" : "warn",
      summary: "二维码、手动 token、Base URL 和断开重连仍使用原业务面板，但入口合并到一个决策卡。",
      actionLabel: showWeChat ? "打开微信面板" : "查看接入状态",
      evidence: [
        props.wechatBaseUrl || "未填写 Base URL",
        props.pollStatus || "轮询状态待刷新",
        props.wechatLastError || "暂无微信错误",
      ],
      onAction: () => focusPanel(wechatPanelRef.current),
    },
    {
      id: "node-inventory",
      group: "node",
      title: "节点纳管",
      owner: showNodeOnboarding ? "gateway_host_console" : "节点观察",
      priority: "P0",
      statusLabel: props.availableDispatchNodes > 0 ? `${props.availableDispatchNodes} 个可调度` : "待纳管",
      statusTone: props.availableDispatchNodes > 0 ? "good" : "warn",
      summary: "远程节点列表、局域网扫描、手动配对和诊断入口按同一条纳管任务线展示。",
      actionLabel: showInventory ? "查看节点列表" : "扫描局域网节点",
      evidence: [
        props.nodeInventoryHeadline,
        props.discoveredNodes.length ? `${props.discoveredNodes.length} 个局域网发现结果` : "暂无局域网发现结果",
        props.displayedWorkerNodeId || "节点 ID 待确认",
      ],
      onAction: showInventory ? () => focusPanel(inventoryPanelRef.current) : props.onScanLanNodes,
      disabled: props.busyKey !== null && !showInventory,
    },
    {
      id: "public-entry",
      group: "public",
      title: "公共入口",
      owner: canManagePublicEntry ? "gateway_host" : "只读状态",
      priority: "P1",
      statusLabel: props.publicEntryProfile.enabled ? "已开启" : "按需开启",
      statusTone: props.publicEntryProfile.enabled ? "good" : "neutral",
      summary: "把对外二维码入口放在网关、微信和节点之后，避免新手一开始就进入低频配置。",
      actionLabel: showPublicEntryProfile ? "打开入口配置" : "刷新入口状态",
      evidence: [
        props.publicEntryProfile.accessUrl || "未生成入口页",
        `${props.publicEntryProfile.stats.activeBindings} 个活跃绑定`,
        props.publicEntryProfile.displayName || "展示名待填写",
      ],
      onAction: showPublicEntryProfile ? () => focusPanel(wechatPanelRef.current) : props.onRefreshAllStatus,
      disabled: props.busyKey !== null && !showPublicEntryProfile,
    },
  ];
  const availableCapabilities = capabilities.filter((item) => {
    if (item.id === "gateway-runtime") return showOverview;
    if (item.id === "wechat-onboarding") return showWeChat;
    if (item.id === "node-inventory") return showInventory || showNodeOnboarding || showLocalNodePanel;
    if (item.id === "public-entry") return showPublicEntryProfile;
    return true;
  });
  const selectedCapability = availableCapabilities.find((item) => item.id === selectedCapabilityId) ?? availableCapabilities[0] ?? capabilities[0];
  const activeCapabilityId = selectedCapability.id;
  const availableConnectionPathSteps = connectionPathSteps.filter((step) =>
    availableCapabilities.some((capability) => capability.id === step.capabilityId),
  );
  const workerTokenState = resolveTokenDisplayState(props.workerSetup.node_token);
  const workerGatewayConnected = props.workerGatewayConnection.state === "gateway_reachable_node_connected";
  const workerNodeRunning = props.localNodeStatus?.state === "running";
  const workerAssessment = props.localNodeStatus?.channel_assessment;
  const workerAssessmentCompleted = workerAssessment?.status === "completed";
  const workerAssessmentRunning = workerAssessment?.status === "running";
  const workerRepairRequired = Boolean(props.localNodeStatus?.repair_required);
  const workerPathSteps: ConnectionPathStepView[] = [
    {
      index: "01",
      label: "目标网关",
      capabilityId: "worker-gateway-link",
      detail: workerGatewayConnected ? "已连接并注册" : props.displayedWorkerGatewayBaseUrl || "等待填写网关地址",
      active: selectedCapabilityId === "worker-gateway-link",
      done: workerGatewayConnected,
    },
    {
      index: "02",
      label: "本机节点",
      capabilityId: "worker-node-runtime",
      detail: workerNodeRunning ? "服务运行中" : props.localNodeStatus?.state || "等待启动",
      active: selectedCapabilityId === "worker-node-runtime",
      done: workerNodeRunning && props.localNodeStatus?.runtime_state === "connected",
    },
    {
      index: "03",
      label: "通道评估",
      capabilityId: "worker-channel-assessment",
      detail: workerAssessmentCompleted
        ? `${workerAssessment?.current_channel_capacity ?? "-"} 通道 / ${workerAssessment?.current_max_concurrency ?? "-"} 并发`
        : workerAssessmentRunning
          ? workerAssessment?.stage || "评估中"
          : "按需压测容量",
      active: selectedCapabilityId === "worker-channel-assessment",
      done: workerAssessmentCompleted,
    },
    {
      index: "04",
      label: "安装升级",
      capabilityId: "worker-install-repair",
      detail: workerRepairRequired ? "需要重装升级" : props.setupCompletedRoles.has("worker_node") ? "安装状态正常" : "等待安装",
      active: selectedCapabilityId === "worker-install-repair",
      done: props.setupCompletedRoles.has("worker_node") && !workerRepairRequired,
    },
  ];
  const workerCapabilities: ConnectionCapabilityView[] = [
    {
      id: "worker-gateway-link",
      group: "gateway",
      title: "目标网关连接",
      owner: "worker_node",
      priority: "P0",
      statusLabel: props.workerGatewayConnection.label,
      statusTone: workerGatewayConnected ? "good" : "warn",
      summary: "确认当前节点回连的主网关地址、配对状态和网关侧节点记录，先把接入链路打通。",
      actionLabel: props.busyKey === "setup-gateway-probe" ? "检测中..." : "检测目标网关",
      evidence: [
        props.displayedWorkerGatewayBaseUrl || "未填写目标网关地址",
        props.workerGatewayConnection.detail,
        props.workerGatewayConnection.remoteNode ? summarizeRemoteNode(props.workerGatewayConnection.remoteNode) : "网关侧暂无节点记录",
      ],
      onAction: props.onProbeWorkerGateway,
      disabled: props.busyKey !== null,
    },
    {
      id: "worker-node-runtime",
      group: "node",
      title: "本机节点控制台",
      owner: props.displayedWorkerNodeId || "当前机器",
      priority: "P0",
      statusLabel: props.localNodeStatus?.runtime_state || props.localNodeStatus?.state || "待检测",
      statusTone: workerNodeRunning && props.localNodeStatus?.runtime_state === "connected" ? "good" : "warn",
      summary: "启动、停止、重启、模型配置、对话测试和诊断导出都放在本机节点控制台里处理。",
      actionLabel: workerNodeRunning ? "重启节点服务" : "启动节点服务",
      evidence: [
        props.localNodeRuntimeSummary.label,
        props.localNodeRuntimeSummary.detail,
        props.localNodeStatus?.inference_detail || "推理后端状态待刷新",
      ],
      onAction: workerNodeRunning ? props.onRestartLocalNodeService : props.onStartLocalNodeService,
      disabled: props.busyKey !== null,
    },
    {
      id: "worker-channel-assessment",
      group: "node",
      title: "通道容量评估",
      owner: "local-node",
      priority: "P1",
      statusLabel: workerAssessmentCompleted ? "已完成" : workerAssessmentRunning ? "进行中" : "未评估",
      statusTone: workerAssessmentCompleted ? "good" : workerAssessmentRunning ? "info" : "neutral",
      summary: "和网关侧一样用卡片化压测结果展示当前通道、并发和推荐方案，方便判断节点容量。",
      actionLabel: workerAssessmentRunning ? "查看评估进度" : "开始压力测试",
      evidence: [
        workerAssessment?.summary || "暂无评估摘要",
        `当前通道 ${workerAssessment?.current_channel_capacity ?? "-"} / 并发 ${workerAssessment?.current_max_concurrency ?? "-"}`,
        props.localNodeStatus?.task_stream?.connection_mode
          ? `任务链路 ${props.localNodeStatus.task_stream.connection_mode}`
          : "任务链路未上报",
      ],
      onAction: workerAssessmentRunning ? () => setSelectedCapabilityId("worker-channel-assessment") : props.onStartLocalNodeChannelAssessment,
      disabled: props.busyKey !== null || workerAssessmentRunning,
    },
    {
      id: "worker-install-repair",
      group: "node",
      title: "安装与升级",
      owner: "windows-service",
      priority: workerRepairRequired ? "P0" : "P1",
      statusLabel: workerRepairRequired ? "需要升级" : props.setupCompletedRoles.has("worker_node") ? "已安装" : "待安装",
      statusTone: workerRepairRequired ? "warn" : props.setupCompletedRoles.has("worker_node") ? "good" : "neutral",
      summary: "只处理当前机器节点的安装、重装升级、配对密钥和发现响应，不混入网关端模型配置。",
      actionLabel: props.busyKey === "setup-worker" || props.busyKey === "local-node-reinstall"
        ? "处理中..."
        : props.setupCompletedRoles.has("worker_node")
          ? "重装并升级"
          : "安装当前机器节点",
      evidence: [
        props.workerSetup.install_dir || "未填写安装目录",
        props.workerSetup.discovery_enabled ? `发现响应 UDP ${props.workerSetup.discovery_port}` : "发现响应已关闭",
        hasText(props.workerSetup.pairing_key) ? "配对密钥已填写" : "配对密钥未填写",
      ],
      onAction: props.setupCompletedRoles.has("worker_node") ? props.onRepairCurrentMachineNode : props.onRunWorkerSetup,
      disabled: props.busyKey !== null,
    },
  ];
  const selectedWorkerCapability =
    workerCapabilities.find((item) => item.id === selectedCapabilityId) ?? workerCapabilities[0];
  const activeWorkerCapabilityId = selectedWorkerCapability.id;

  return (
    <section className="workspace-frame connection-workspace">
      <div className="workspace-heading">
        <div>
          <div className="section-kicker">{props.currentRoleIsWorker ? "节点工作台" : "接入中心"}</div>
          <h2>{props.roleTitle}</h2>
        </div>
        <div className="workspace-caption">{props.roleDescription}</div>
      </div>

      {!props.currentRoleIsWorker ? (
        <div className="connection-dashboard-stack">
          <div className="connection-command-strip">
            <div className="connection-command-copy">
              <div className="section-kicker">接入中心工作台</div>
              <h3>{props.heroTitle}</h3>
              <p>{props.heroDescription}</p>
            </div>
            <div className="connection-command-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={props.onRunConnectivityCheck}
                disabled={props.busyKey !== null}
              >
                {props.busyKey === "connectivity-check" ? "检测中..." : "完整检测"}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={props.onRefreshAllStatus}
                disabled={props.busyKey !== null}
              >
                {props.busyKey === "connection-refresh-all" ? "刷新中..." : "刷新状态"}
              </button>
              {showGatewayControls ? (
                <button
                  type="button"
                  onClick={props.onToggleDispatch}
                  disabled={props.busyKey !== null}
                >
                  {props.busyKey === "dispatch-mode-toggle" ? "切换中..." : props.gatewaySetupDispatchModeEnabled ? "关闭分发" : "开启分发"}
                </button>
              ) : null}
            </div>
            <div className="connection-command-metrics">
              {props.connectionHeroCards.map((card) => (
                <ConnectionHeroCard key={`${card.eyebrow}-${card.title}`} {...card} />
              ))}
            </div>
          </div>

          <div className="connection-workbench-layout">
            <aside className="connection-flow-rail" aria-label="接入流程">
              <div className="connection-flow-head">
                <span className="section-kicker">Flow</span>
                <strong>推荐路径</strong>
              </div>
              <div className="connection-flow-steps">
                {availableConnectionPathSteps.map((step) => (
                  <button
                    key={step.index}
                    type="button"
                    className="connection-flow-step-button"
                    onClick={() => setSelectedCapabilityId(step.capabilityId)}
                  >
                    <SetupStepPill {...step} active={activeCapabilityId === step.capabilityId} />
                  </button>
                ))}
              </div>
              <div className="connection-flow-note">
                先把网关、微信和节点链路收敛到可运行状态，再开放公共入口给外部用户接入。
              </div>
            </aside>

            <div className={`connection-dashboard-grid ${hasSidebarContent ? "" : "connection-dashboard-grid-single"}`}>
            {/* Main Operational Pillar (Left) */}
            <div className="connection-main-column">
              <SurfaceCard className="connection-capability-surface">
                <SectionHeader
                  kicker="Access Matrix"
                  title="接入能力"
                  description="按真实接入任务组织能力，而不是把所有低频配置入口平铺给用户。"
                  actions={<SignalBadge tone="info">按角色展示</SignalBadge>}
                />
                <div className="connection-capability-grid">
                  {availableCapabilities.map((capability) => (
                    <button
                      key={capability.id}
                      type="button"
                      className={`connection-capability-card ${selectedCapability.id === capability.id ? "connection-capability-card-selected" : ""}`}
                      onClick={() => setSelectedCapabilityId(capability.id)}
                    >
                      <div className="connection-capability-top">
                        <span className="connection-capability-priority">{capability.priority}</span>
                        <SignalBadge tone={capability.statusTone}>{capability.statusLabel}</SignalBadge>
                      </div>
                      <div>
                        <span className="connection-capability-owner">{capability.owner}</span>
                        <strong>{capability.title}</strong>
                      </div>
                      <p>{capability.summary}</p>
                      <span className="connection-capability-action">选择并查看执行摘要</span>
                    </button>
                  ))}
                </div>
              </SurfaceCard>

              {activeCapabilityId === "gateway-runtime" && showOverview ? (
                <OverviewPanel
                  signalCards={props.connectionSignalCards}
                  canManageGateway={showGatewayControls}
                  localConsoleHint={localConsoleHint}
                  connectivityCheckText={props.connectivityCheckText}
                  lastError={props.wechatLastError}
                  dispatchWarning={props.gatewaySetupDispatchModeEnabled && props.availableDispatchNodes === 0 ? "已开启分发模式，但暂无远程节点。" : null}
                  onRunConnectivityCheck={props.onRunConnectivityCheck}
                  onToggleDispatch={props.onToggleDispatch}
                  onRefreshAllStatus={props.onRefreshAllStatus}
                  runConnectivityCheckLabel={props.busyKey === "connectivity-check" ? "检测中..." : "完整检测"}
                  toggleDispatchLabel={props.busyKey === "dispatch-mode-toggle" ? "切换中..." : props.gatewaySetupDispatchModeEnabled ? "关闭分发模式" : "开启分发模式"}
                  refreshAllLabel={props.busyKey === "connection-refresh-all" ? "刷新中..." : "刷新状态"}
                  busy={props.busyKey !== null}
                />
              ) : null}

              {activeCapabilityId === "wechat-onboarding" && showWeChat ? (
                <div ref={wechatPanelRef} tabIndex={-1}>
                  <WeChatConfigCard
                    showLoginSection
                    showPublicEntrySection={false}
                    canManagePublicEntry={canManagePublicEntry}
                    statusRows={props.wechatStatusRows}
                    qrImageSrc={props.qrImageSrc}
                    pollStatus={props.pollStatus}
                    wechatBaseUrl={props.wechatBaseUrl}
                    manualToken={props.manualToken}
                    publicEntryProfile={props.publicEntryProfile}
                    busyKey={props.busyKey}
                    onWechatBaseUrlChange={props.onWechatBaseUrlChange}
                    onManualTokenChange={props.onManualTokenChange}
                    onUpdatePublicEntryProfile={props.onUpdatePublicEntryProfile}
                    onSavePublicEntryProfile={props.onSavePublicEntryProfile}
                    onCopyPublicEntryUrl={props.onCopyPublicEntryUrl}
                    onStartQrFlow={props.onStartQrFlow}
                    onPollQrStatus={props.onPollQrStatus}
                    onConnectManualToken={props.onConnectManualToken}
                    onDisconnectWeChat={props.onDisconnectWeChat}
                  />
                </div>
              ) : null}

              {activeCapabilityId === "node-inventory" ? (
                <div className="connection-node-focus-panel">
                  <div className="connection-node-focus-grid">
                    {showInventory ? (
                      <div ref={inventoryPanelRef} tabIndex={-1}>
                        <NodeInventoryPanel
                          headline={props.nodeInventoryHeadline}
                          cards={props.nodeInventoryCards}
                          selectedDiagnostics={props.selectedNodeDiagnosticsView}
                          layout="stacked"
                        />
                      </div>
                    ) : null}

                    {showNodeOnboarding ? (
                      <section className="surface connection-node-onboarding-panel">
                        <SectionHeader
                          kicker="新节点"
                          title="纳管远程工作节点"
                          description="手动配对、局域网扫描和本机安装入口集中在这里，不再挤在窄侧栏里。"
                        />
                        <div className="connection-node-pair-grid">
                          <label>
                            <span>IP / 主机名</span>
                            <input value={props.manualPair.host} onChange={(event) => props.onUpdateManualPair("host", event.target.value)} placeholder="例如 192.168.0.23" />
                          </label>
                          <label>
                            <span>配对密钥</span>
                            <ToggleSecretInput value={props.manualPair.pairing_key} onChange={(event) => props.onUpdateManualPair("pairing_key", event.target.value)} placeholder="与目标节点密钥一致" autoComplete="new-password" />
                          </label>
                          <button type="button" onClick={props.onManualPairNode} disabled={props.busyKey !== null}>
                            {props.busyKey === "setup-manual-pair" ? "连接中..." : "建立连接"}
                          </button>
                        </div>
                        <div className="connection-node-discovery-head">
                          <button type="button" className="ghost-button" onClick={props.onScanLanNodes} disabled={props.busyKey !== null}>
                            {props.busyKey === "setup-discovery-scan" ? "扫描中..." : "局域网扫描"}
                          </button>
                          <button type="button" className="ghost-button" onClick={props.onRunWorkerSetup} disabled={props.busyKey !== null}>
                            在本机安装新节点
                          </button>
                        </div>
                        {!props.discoveredNodes.length ? (
                          <div className="empty-state connection-node-discovery-empty">
                            扫描结果会显示在这里。已纳管节点也会列出，方便确认局域网发现链路是否正常。
                          </div>
                        ) : (
                          <div className="discovery-list connection-node-discovery-list">
                            {props.discoveredNodes.map((item) => {
                              const status = props.pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending");
                              return (
                                <div key={item.discovery_id} className="discovery-card">
                                  <div className="discovery-card-top">
                                    <div>
                                      <div className="node-card-title">{item.pairing_label || item.hostname}</div>
                                      <div className="node-card-subtitle">{[item.lan_ip || "-", item.platform || "-", item.node_version || "-"].join(" · ")}</div>
                                    </div>
                                    <span className={`session-badge session-badge-${pairingStatusTone(status)}`}>{pairingStatusLabel(status)}</span>
                                  </div>
                                  <div className="node-card-grid">
                                    <div><div className="node-card-label">局域网 IP</div><div className="node-card-value">{item.lan_ip || "未上报"}</div></div>
                                    <div><div className="node-card-label">配对端口</div><div className="node-card-value">{item.pairing_port}</div></div>
                                    <div><div className="node-card-label">能力</div><div className="node-card-value">{item.capabilities.join(", ") || "未声明"}</div></div>
                                    <div><div className="node-card-label">节点 ID</div><div className="node-card-value">{item.node_id || "配对时生成"}</div></div>
                                  </div>
                                  <div className="discovery-actions">
                                    <input
                                      value={props.pairingSecrets[item.discovery_id] || ""}
                                      onChange={(event) => props.onUpdatePairingSecret(item.discovery_id, event.target.value)}
                                      placeholder="输入该机器的配对密钥"
                                    />
                                    <button type="button" onClick={() => props.onPairLanNode(item)} disabled={props.busyKey !== null}>
                                      {props.busyKey === "setup-discovery-pair" ? "连接中..." : status === "already_paired" ? "重新确认连接" : "输入密钥并连接"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    ) : null}
                  </div>

                  {showLocalNodePanel ? (
                    <div ref={(node) => {
                      localNodeConsoleRef.current = node;
                      localNodePanelRef.current = node;
                    }} tabIndex={-1}>
                      <details className="connection-local-node-details">
                        <summary>
                          <div>
                            <span className="section-kicker">Local Node</span>
                            <strong>本机节点与推理后端</strong>
                            <small>展开后管理启停、模型密钥、安装修复和底层诊断。</small>
                          </div>
                          <SignalBadge tone={props.localNodeStatus?.state === "running" ? "good" : "neutral"}>
                            {props.localNodeStatus?.state || "待检测"}
                          </SignalBadge>
                        </summary>
                        <NodeModelConfigPanel
                          launcherAvailable={props.launcherAvailable}
                          busyKey={props.busyKey}
                          dirty={props.localNodeModelDirty}
                          status={props.localNodeStatus}
                          runtimeSummary={props.localNodeRuntimeSummary}
                          consolePresentation={props.connectionConsolePresentation}
                          gatewayControl={{
                            managed: props.launcherGatewayManaged,
                            state: props.launcherGatewayState,
                            onRestart: props.onRestartGatewayService,
                            disabled: props.busyKey !== null || !props.launcherAvailable || !props.launcherGatewayManaged || !showGatewayControls,
                            busy: props.busyKey === "launcher-gateway-restart",
                          }}
                          eventPreview=""
                          draft={props.localNodeModelDraft}
                          onChange={props.onUpdateLocalNodeModelDraft}
                          onRefresh={props.onRefreshLocalNodeDiagnostics}
                          onStart={props.onStartLocalNodeService}
                          onStop={props.onStopLocalNodeService}
                          onRestart={props.onRestartLocalNodeService}
                          onSave={props.onSaveLocalNodeModelConfig}
                          onExport={props.onExportLocalNodeDiagnostics}
                          onRepair={props.onRepairCurrentMachineNode}
                          onReset={props.onResetLocalNodeCredentials}
                          onRunConversationTest={props.onRunLocalNodeConversationTest}
                        />
                      </details>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeCapabilityId === "public-entry" && showPublicEntryProfile ? (
                <div ref={wechatPanelRef} tabIndex={-1}>
                  <WeChatConfigCard
                    showLoginSection={false}
                    showPublicEntrySection
                    canManagePublicEntry={canManagePublicEntry}
                    statusRows={props.wechatStatusRows}
                    qrImageSrc={props.qrImageSrc}
                    pollStatus={props.pollStatus}
                    wechatBaseUrl={props.wechatBaseUrl}
                    manualToken={props.manualToken}
                    publicEntryProfile={props.publicEntryProfile}
                    busyKey={props.busyKey}
                    onWechatBaseUrlChange={props.onWechatBaseUrlChange}
                    onManualTokenChange={props.onManualTokenChange}
                    onUpdatePublicEntryProfile={props.onUpdatePublicEntryProfile}
                    onSavePublicEntryProfile={props.onSavePublicEntryProfile}
                    onCopyPublicEntryUrl={props.onCopyPublicEntryUrl}
                    onStartQrFlow={props.onStartQrFlow}
                    onPollQrStatus={props.onPollQrStatus}
                    onConnectManualToken={props.onConnectManualToken}
                    onDisconnectWeChat={props.onDisconnectWeChat}
                  />
                </div>
              ) : null}
            </div>

            {/* Sidebar Column (Right) */}
            {hasSidebarContent ? (
            <div className="connection-sidebar-column">
              <SurfaceCard className="connection-summary-panel">
                <SectionHeader
                  kicker="Selected"
                  title="执行摘要"
                  description="先看当前模块为什么重要，再进入对应业务面板执行。"
                  actions={<SignalBadge tone={selectedCapability.statusTone}>{selectedCapability.statusLabel}</SignalBadge>}
                />
                <div className="connection-summary-selected">
                  <span className="connection-capability-priority">{selectedCapability.priority}</span>
                  <strong>{selectedCapability.title}</strong>
                  <p>{selectedCapability.summary}</p>
                </div>
                <InfoList
                  items={selectedCapability.evidence.map((value, index) => ({
                    label: index === 0 ? "当前依据" : index === 1 ? "运行线索" : "排障提示",
                    value,
                    multiline: true,
                  }))}
                  className="connection-summary-evidence"
                />
                <div className="connection-summary-actions">
                  <button type="button" onClick={selectedCapability.onAction} disabled={selectedCapability.disabled}>
                    {selectedCapability.actionLabel}
                  </button>
                  {selectedCapability.id === "node-inventory" && showLocalNodePanel ? (
                    <button type="button" className="ghost-button" onClick={() => focusPanel(localNodePanelRef.current)}>
                      本机节点控制台
                    </button>
                  ) : null}
                </div>
              </SurfaceCard>

              {showLocalNodePanel ? (
                <ChannelAssessmentCard
                  localNodeStatus={props.localNodeStatus}
                  assessmentMaxRounds={props.assessmentMaxRounds}
                  assessmentApplyStrategy={props.assessmentApplyStrategy}
                  busy={props.busyKey !== null}
                  assessmentBusy={
                    props.busyKey === "local-node-channel-assessment-start" ||
                    props.busyKey === "local-node-channel-assessment-apply"
                  }
                  canManage={showGatewayControls}
                  onRefresh={props.onRefreshLocalNodeStatus}
                  onAssessmentMaxRoundsChange={props.onAssessmentMaxRoundsChange}
                  onAssessmentApplyStrategyChange={props.onAssessmentApplyStrategyChange}
                  onStartAssessment={props.onStartLocalNodeChannelAssessment}
                  onApplyAssessment={props.onApplyLocalNodeChannelAssessment}
                  applyAssessmentLabel={props.busyKey === "local-node-channel-assessment-apply" ? "应用中..." : "应用评估建议"}
                />
              ) : null}
            </div>
            ) : null}
            </div>
          </div>
        </div>

      ) : (
        <div className="connection-dashboard-stack worker-connection-stack">
          <div className="connection-command-strip worker-command-strip">
            <div className="connection-command-copy">
              <div className="section-kicker">节点接入工作台</div>
              <h3>{props.heroTitle}</h3>
              <p>{props.heroDescription}</p>
            </div>
            <div className="connection-command-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={props.onRunConnectivityCheck}
                disabled={props.busyKey !== null}
              >
                {props.busyKey === "connectivity-check" ? "检测中..." : "完整检测"}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={props.onRefreshAllStatus}
                disabled={props.busyKey !== null}
              >
                {props.busyKey === "connection-refresh-all" ? "刷新中..." : "刷新状态"}
              </button>
              <button
                type="button"
                onClick={workerNodeRunning ? props.onStopLocalNodeService : props.onStartLocalNodeService}
                disabled={props.busyKey !== null}
              >
                {workerNodeRunning ? "停止节点" : "启动节点"}
              </button>
            </div>
            <div className="connection-command-metrics">
              {props.connectionHeroCards.map((card) => (
                <ConnectionHeroCard key={`${card.eyebrow}-${card.title}`} {...card} />
              ))}
            </div>
          </div>

          <div className="connection-workbench-layout worker-workbench-layout">
            <aside className="connection-flow-rail worker-flow-rail" aria-label="节点接入流程">
              <div className="connection-flow-head">
                <span className="section-kicker">Flow</span>
                <strong>节点接入路径</strong>
              </div>
              <div className="connection-flow-steps">
                {workerPathSteps.map((step) => (
                  <button
                    key={step.index}
                    type="button"
                    className="connection-flow-step-button"
                    onClick={() => setSelectedCapabilityId(step.capabilityId)}
                  >
                    <SetupStepPill {...step} active={activeWorkerCapabilityId === step.capabilityId} />
                  </button>
                ))}
              </div>
              <div className="connection-flow-note">
                节点端只关注“连上目标网关、跑稳本机服务、评估容量、必要时升级”四件事。
              </div>
            </aside>

            <div className="connection-dashboard-grid worker-connection-grid">
            <div className="connection-main-column">
              <SurfaceCard className="connection-capability-surface worker-capability-surface">
                <SectionHeader
                  kicker="Node Matrix"
                  title="节点接入能力"
                  description="按节点端真实操作链路组织入口，保持和网关接入中心一致的卡片化选择体验。"
                  actions={<SignalBadge tone={workerGatewayConnected ? "good" : "warn"}>{props.workerGatewayConnection.label}</SignalBadge>}
                />
                <div className="connection-capability-grid worker-capability-grid">
                  {workerCapabilities.map((capability) => (
                    <button
                      key={capability.id}
                      type="button"
                      className={`connection-capability-card worker-capability-card ${
                        activeWorkerCapabilityId === capability.id ? "connection-capability-card-selected" : ""
                      }`}
                      onClick={() => setSelectedCapabilityId(capability.id)}
                    >
                      <div className="connection-capability-top">
                        <span className="connection-capability-priority">{capability.priority}</span>
                        <SignalBadge tone={capability.statusTone}>{capability.statusLabel}</SignalBadge>
                      </div>
                      <div>
                        <span className="connection-capability-owner">{capability.owner}</span>
                        <strong>{capability.title}</strong>
                      </div>
                      <p>{capability.summary}</p>
                      <span className="connection-capability-action">选择并查看节点执行摘要</span>
                    </button>
                  ))}
                </div>
              </SurfaceCard>

              <div className="worker-capability-detail-stack">
                {activeWorkerCapabilityId === "worker-gateway-link" ? (
                  <section className="surface worker-node-summary-card worker-capability-detail">
                    <SectionHeader
                      kicker="本机链路"
                      title={props.heroTitle}
                      description="把当前机器的发现地址、网关连接和节点身份收在同一块，切换或排障时不需要再来回找信息。"
                      actions={(
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={props.onRunConnectivityCheck}
                          disabled={props.busyKey !== null}
                          style={{ height: 30, fontSize: 12, borderStyle: "dashed" }}
                        >
                          {props.busyKey === "connectivity-check" ? "检测中..." : "完整检测"}
                        </button>
                      )}
                    />
                    <div className="worker-wizard-identity worker-node-address-card">
                      <div className="worker-wizard-identity-ip">
                        {props.workerGatewayConnection.remoteNode?.lan_ip || String(props.localNodeStatus?.diagnostics?.lan_ip || props.currentNodeLanIp || "检测中…")}
                      </div>
                      <div className="worker-node-address-meta">
                        发现端口 {props.workerSetup.discovery_port} · 当前机器节点地址
                      </div>
                    </div>
                    <div className="worker-node-summary-metrics">
                      <MetricCard
                        label="连接状态"
                        value={props.workerGatewayConnection.label}
                        detail={props.localNodeStatus?.service_status || props.localNodeStatus?.state || "待检测"}
                        tone={workerGatewayConnected ? "healthy" : "warning"}
                      />
                      <MetricCard
                        label="节点 ID"
                        value={props.displayedWorkerNodeId || "未填写"}
                        detail={props.localNodeStatus?.node_kind === "local" ? "网关内置节点" : "远端工作节点"}
                        tone="accent"
                      />
                    </div>
                    <div className="prep-strip-list worker-node-prep-list">
                      <PrepStrip label="节点配置" detail={props.setupCompletedRoles.has("worker_node") ? "当前机器节点已完成配置" : "尚未完成节点配置"} tone={props.setupCompletedRoles.has("worker_node") ? "good" : "warn"} />
                      <PrepStrip label="目标网关地址" detail={props.displayedWorkerGatewayBaseUrl || "未填写局域网网关地址"} tone={props.displayedWorkerGatewayBaseUrl ? "good" : "warn"} />
                      <PrepStrip label="发现响应" detail={props.workerSetup.discovery_enabled ? `已启用 UDP ${props.workerSetup.discovery_port}` : "当前已关闭"} tone={props.workerSetup.discovery_enabled ? "good" : "warn"} />
                      <PrepStrip
                        label="Token 状态"
                        detail={workerGatewayConnected ? "已配对" : workerTokenState.status === "waiting" ? "等待网关下发 token" : "已配对"}
                        tone={workerGatewayConnected || workerTokenState.status === "paired" ? "good" : "warn"}
                      />
                    </div>
                    <InfoList
                      className="worker-node-summary-info"
                      items={[
                        { label: "连接详情", value: props.workerGatewayConnection.detail, multiline: true },
                        { label: "配对密钥", value: hasText(props.workerSetup.pairing_key) ? "已填写，可在安装修复区显示或修改" : "未填写", multiline: true },
                        ...(props.connectivityCheckText
                          ? [{ label: "完整检测", value: props.connectivityCheckText, multiline: true }]
                          : []),
                        ...(props.workerGatewayConnection.remoteNode
                          ? [{ label: "网关侧节点记录", value: summarizeRemoteNode(props.workerGatewayConnection.remoteNode), multiline: true }]
                          : []),
                      ]}
                    />
                  </section>
                ) : null}

                {activeWorkerCapabilityId === "worker-node-runtime" ? (
                  <div ref={localNodeConsoleRef}>
                    <details className="connection-local-node-details worker-local-node-details worker-capability-detail" open>
                      <summary>
                        <div>
                          <span className="section-kicker">Node Runtime</span>
                          <strong>本机节点运行控制</strong>
                          <small>节点端优先展示连接摘要；模型、密钥、诊断和危险操作收进可展开面板。</small>
                        </div>
                        <SignalBadge tone={workerNodeRunning ? "good" : "neutral"}>
                          {props.localNodeStatus?.state || "待检测"}
                        </SignalBadge>
                      </summary>
                      <NodeModelConfigPanel
                        launcherAvailable={props.launcherAvailable}
                        busyKey={props.busyKey}
                        dirty={props.localNodeModelDirty}
                        status={props.localNodeStatus}
                        runtimeSummary={props.localNodeRuntimeSummary}
                        consolePresentation={props.connectionConsolePresentation}
                        gatewayControl={null}
                        eventPreview=""
                        draft={props.localNodeModelDraft}
                        onChange={props.onUpdateLocalNodeModelDraft}
                        onRefresh={props.onRefreshLocalNodeDiagnostics}
                        onStart={props.onStartLocalNodeService}
                        onStop={props.onStopLocalNodeService}
                        onRestart={props.onRestartLocalNodeService}
                        onSave={props.onSaveLocalNodeModelConfig}
                        onExport={props.onExportLocalNodeDiagnostics}
                        onReset={props.onResetLocalNodeCredentials}
                        onRepair={props.onRepairCurrentMachineNode}
                        onRunConversationTest={props.onRunLocalNodeConversationTest}
                      />
                    </details>
                  </div>
                ) : null}

                {activeWorkerCapabilityId === "worker-channel-assessment" ? (
                  <div className="worker-capability-detail">
                    <ChannelAssessmentCard
                      localNodeStatus={props.localNodeStatus}
                      assessmentMaxRounds={props.assessmentMaxRounds}
                      assessmentApplyStrategy={props.assessmentApplyStrategy}
                      busy={props.busyKey !== null}
                      assessmentBusy={
                        props.busyKey === "local-node-channel-assessment-start" ||
                        props.busyKey === "local-node-channel-assessment-apply"
                      }
                      canManage
                      onRefresh={props.onRefreshLocalNodeStatus}
                      onAssessmentMaxRoundsChange={props.onAssessmentMaxRoundsChange}
                      onAssessmentApplyStrategyChange={props.onAssessmentApplyStrategyChange}
                      onStartAssessment={props.onStartLocalNodeChannelAssessment}
                      onApplyAssessment={props.onApplyLocalNodeChannelAssessment}
                      applyAssessmentLabel={props.busyKey === "local-node-channel-assessment-apply" ? "应用中..." : "应用评估建议"}
                      serviceControls={{
                        localNodeRunning: workerNodeRunning,
                        onStartNode: props.onStartLocalNodeService,
                        onStopNode: props.onStopLocalNodeService,
                        startDisabled: props.busyKey !== null || props.busyKey === "local-node-channel-assessment-start" || workerNodeRunning,
                        stopDisabled: props.busyKey !== null || props.busyKey === "local-node-channel-assessment-start" || !workerNodeRunning,
                      }}
                    />
                  </div>
                ) : null}

                {activeWorkerCapabilityId === "worker-install-repair" ? (
                  <section className="surface worker-node-install-card worker-capability-detail">
                    <SectionHeader
                      kicker="安装修复"
                      title="安装或重装并升级当前机器节点"
                      description="这一块只负责安装层和配对入口，不和上面的运行控制混用。"
                    />
                    <div className="connection-form-grid worker-node-install-grid">
                      <label><span>节点 ID</span><input value={props.workerSetup.node_id} onChange={(event) => props.onUpdateWorkerSetup("node_id", event.target.value)} /></label>
                      <label><span>目标网关地址</span><input value={props.workerSetup.gateway_base_url} onChange={(event) => props.onUpdateWorkerSetup("gateway_base_url", event.target.value)} placeholder="http://192.168.0.18:8300" /></label>
                      <label>
                        <span>配对密钥</span>
                        <div className="field-with-action">
                          <input type={props.workerPairingKeyVisible ? "text" : "password"} value={props.workerSetup.pairing_key} onChange={(event) => props.onUpdateWorkerSetup("pairing_key", event.target.value)} placeholder="节点与网关保持一致" autoComplete="new-password" />
                          <button type="button" className="ghost-button" onClick={props.onToggleWorkerPairingKeyVisible}>
                            {props.workerPairingKeyVisible ? "隐藏" : "显示"}
                          </button>
                        </div>
                      </label>
                      <label><span>安装目录</span><input value={props.workerSetup.install_dir} onChange={(event) => props.onUpdateWorkerSetup("install_dir", event.target.value)} /></label>
                    </div>
                    <details className="form-advanced-details connection-fold-card">
                      <summary>
                        <span className="section-kicker">高级选项</span>
                        <span className="connection-fold-hint">发现响应、并发与 bundle 路径</span>
                      </summary>
                      <div className="connection-form-grid">
                        <label><span>Dify Base URL</span><input value={props.workerSetup.dify_base_url} onChange={(event) => props.onUpdateWorkerSetup("dify_base_url", event.target.value)} /></label>
                        <label><span>Dify API Key</span><textarea value={props.workerSetup.dify_api_key} onChange={(event) => props.onUpdateWorkerSetup("dify_api_key", event.target.value)} /></label>
                        <label><span>最大并发</span><input type="number" value={props.workerSetup.max_concurrency} onChange={(event) => props.onUpdateWorkerSetup("max_concurrency", Number(event.target.value) || 1)} /></label>
                        <label><span>发现响应端口</span><input type="number" value={props.workerSetup.discovery_port} onChange={(event) => props.onUpdateWorkerSetup("discovery_port", Number(event.target.value) || 9531)} /></label>
                        <label className="checkbox-row"><input type="checkbox" checked={props.workerSetup.discovery_enabled} onChange={(event) => props.onUpdateWorkerSetup("discovery_enabled", event.target.checked)} /><span>启用局域网发现</span></label>
                        <label><span>Bundle 路径（可选）</span><input value={props.workerSetup.bundle_path} onChange={(event) => props.onUpdateWorkerSetup("bundle_path", event.target.value)} placeholder="留空则自动查找" /></label>
                      </div>
                    </details>
                    <div className="inline-actions worker-node-install-actions">
                      <button
                        type="button"
                        onClick={props.setupCompletedRoles.has("worker_node") ? props.onRepairCurrentMachineNode : props.onRunWorkerSetup}
                        disabled={props.busyKey !== null}
                      >
                        {props.busyKey === "setup-worker" || props.busyKey === "local-node-reinstall"
                          ? "重装升级中..."
                          : props.setupCompletedRoles.has("worker_node")
                            ? "重装并升级当前机器节点"
                            : "安装当前机器节点"}
                      </button>
                      <button type="button" className="ghost-button" onClick={props.onProbeWorkerGateway} disabled={props.busyKey !== null}>
                        {props.busyKey === "setup-gateway-probe" ? "检测中..." : "检测目标网关"}
                      </button>
                    </div>
                  </section>
                ) : null}
              </div>
            </div>

            <div className="connection-sidebar-column worker-sidebar-column">
              <SurfaceCard className="connection-summary-panel worker-summary-panel">
                <SectionHeader
                  kicker="Selected"
                  title="节点执行摘要"
                  description="和网关端一致：先选能力卡，再看依据和下一步动作。"
                  actions={<SignalBadge tone={selectedWorkerCapability.statusTone}>{selectedWorkerCapability.statusLabel}</SignalBadge>}
                />
                <div className="connection-summary-selected">
                  <span className="connection-capability-priority">{selectedWorkerCapability.priority}</span>
                  <strong>{selectedWorkerCapability.title}</strong>
                  <p>{selectedWorkerCapability.summary}</p>
                </div>
                <InfoList
                  items={selectedWorkerCapability.evidence.map((value, index) => ({
                    label: index === 0 ? "当前依据" : index === 1 ? "运行线索" : "排障提示",
                    value,
                    multiline: true,
                  }))}
                  className="connection-summary-evidence"
                />
                <div className="connection-summary-actions">
                  <button type="button" onClick={selectedWorkerCapability.onAction} disabled={selectedWorkerCapability.disabled}>
                    {selectedWorkerCapability.actionLabel}
                  </button>
                </div>
              </SurfaceCard>

            </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function pairingStatusLabel(status: PairingStatus) {
  return status === "paired"
    ? "已确认连接"
    : status === "paired_pending_confirm"
      ? "已下发，待注册"
      : status === "register_failed"
        ? "注册失败"
        : status === "auth_failed"
          ? "鉴权失败"
          : status === "already_paired"
            ? "已纳管"
            : status === "offline"
              ? "节点离线"
              : "待输入密钥";
}

function pairingStatusTone(status: PairingStatus) {
  return status === "paired"
    ? "human"
    : status === "paired_pending_confirm"
      ? "typing"
      : status === "register_failed" || status === "auth_failed" || status === "offline"
        ? "queued"
        : status === "already_paired"
          ? "human"
          : "idle";
}

function resolveTokenDisplayState(token: string | null | undefined) {
  const trimmed = safeTrim(token);
  if (!trimmed) return { status: "waiting" as const };
  if (trimmed.startsWith("pending:")) return { status: "waiting" as const };
  return { status: "paired" as const };
}

function summarizeRemoteNode(node: NodeInventoryRecord | NodeRecord) {
  const kindLabel = "node_kind" in node ? (node.node_kind === "local" ? "网关内置节点" : "远端工作节点") : "远端工作节点";
  return [
    `${node.hostname || node.node_id}（${kindLabel}）`,
    node.lan_ip || "未上报 IP",
    node.last_error || node.status || "未上报状态",
    node.last_heartbeat_at ? formatTimeLabel(node.last_heartbeat_at, true) : "暂无心跳",
  ].join(" · ");
}

function formatTimeLabel(value: string, withSeconds = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: withSeconds ? "2-digit" : undefined,
      });
}
