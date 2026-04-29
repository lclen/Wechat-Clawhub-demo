import { useRef } from "react";
import { ConnectionHeroCard, PrepStrip, ToggleSecretInput } from "./ConnectionUi";
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
  modelCheckText: string | null;
  wechatLastError: string | null;
  wechatStatus: WeChatStatus | null;
  systemStatus: SystemStatus | null;
  onRunModelCheck: () => void;
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
  const showOverview = props.roleSections.showGatewayOverview;
  const showWeChat = props.roleSections.showWeChatAccess;
  const showPublicEntryProfile = props.roleSections.showPublicEntryProfile;
  const showInventory = props.roleSections.showRemoteNodeInventory;
  const showLocalNodePanel = props.roleSections.showLocalNodePanel;
  const showNodeOnboarding = props.roleActions.canManageNodes;
  const showGatewayControls = props.roleActions.canManageGateway;
  const canManagePublicEntry = props.roleActions.canManagePublicEntry;
  const localNodeConsoleRef = useRef<HTMLDivElement | null>(null);
  const localConsoleHint = showLocalNodePanel
    ? {
        label: props.connectionConsolePresentation.recommendedActionLabel,
        detail: props.connectionConsolePresentation.recommendedActionDetail,
        onFocus: () => {
          localNodeConsoleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      }
    : null;

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
          {/* Top Level Hero Metrics */}
          <div className="workspace-hero-strip">
            {props.connectionHeroCards.map((card) => (
              <ConnectionHeroCard key={`${card.eyebrow}-${card.title}`} {...card} />
            ))}
          </div>

          <div className="connection-dashboard-grid">
            {/* Main Operational Pillar (Left) */}
            <div className="connection-main-column">
              {showInventory ? (
                <NodeInventoryPanel
                  headline={props.nodeInventoryHeadline}
                  cards={props.nodeInventoryCards}
                  selectedDiagnostics={props.selectedNodeDiagnosticsView}
                />
              ) : null}

              {showWeChat || showPublicEntryProfile ? (
                <WeChatConfigCard
                  showLoginSection={showWeChat}
                  showPublicEntrySection={showPublicEntryProfile}
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
              ) : null}

              {showLocalNodePanel ? (
                <div ref={localNodeConsoleRef}>
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
                </div>
              ) : null}
            </div>

            {/* Sidebar Column (Right) */}
            <div className="connection-sidebar-column">
              {showNodeOnboarding ? (
                <div className="connection-onboarding-sidebar">
                  <section className="surface surface-narrow" style={{ padding: "16px 20px" }}>
                    <div className="section-head compact-head">
                      <div><div className="section-kicker">新节点</div><h3>纳管远程工作节点</h3></div>
                    </div>
                    <div className="connection-form-stack" style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.6 }}>IP / 主机名</span>
                        <input value={props.manualPair.host} onChange={(event) => props.onUpdateManualPair("host", event.target.value)} placeholder="例如 192.168.0.23" />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.6 }}>配对密钥</span>
                        <ToggleSecretInput value={props.manualPair.pairing_key} onChange={(event) => props.onUpdateManualPair("pairing_key", event.target.value)} placeholder="与目标节点密钥一致" autoComplete="new-password" />
                      </label>
                      <button type="button" onClick={props.onManualPairNode} disabled={props.busyKey !== null} style={{ width: "100%", marginTop: 6 }}>
                        {props.busyKey === "setup-manual-pair" ? "连接中..." : "建立连接"}
                      </button>
                    </div>

                    <details className="sidebar-advanced-details" style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                      <summary style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, cursor: "pointer" }}>局域网扫描/安装工具</summary>
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                        <button type="button" className="ghost-button" style={{ width: "100%", fontSize: 12 }} onClick={props.onScanLanNodes} disabled={props.busyKey !== null}>
                          局域网扫描
                        </button>
                        {!props.discoveredNodes.length ? (
                          <div className="empty-state" style={{ margin: 0, padding: "14px 12px", fontSize: 12 }}>
                            扫描结果会显示在这里。已纳管节点也会列出，方便确认局域网发现链路是否正常。
                          </div>
                        ) : (
                          <div className="discovery-list" style={{ gap: 8 }}>
                            {props.discoveredNodes.map((item) => {
                              const status = props.pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending");
                              return (
                                <div key={item.discovery_id} className="discovery-card" style={{ padding: 12 }}>
                                  <div className="discovery-card-top" style={{ gap: 8 }}>
                                    <div>
                                      <div className="node-card-title">{item.pairing_label || item.hostname}</div>
                                      <div className="node-card-subtitle">{[item.lan_ip || "-", item.platform || "-", item.node_version || "-"].join(" · ")}</div>
                                    </div>
                                    <span className={`session-badge session-badge-${pairingStatusTone(status)}`}>{pairingStatusLabel(status)}</span>
                                  </div>
                                  <div className="node-card-grid" style={{ marginTop: 10 }}>
                                    <div><div className="node-card-label">局域网 IP</div><div className="node-card-value">{item.lan_ip || "未上报"}</div></div>
                                    <div><div className="node-card-label">配对端口</div><div className="node-card-value">{item.pairing_port}</div></div>
                                    <div><div className="node-card-label">能力</div><div className="node-card-value">{item.capabilities.join(", ") || "未声明"}</div></div>
                                    <div><div className="node-card-label">节点 ID</div><div className="node-card-value">{item.node_id || "配对时生成"}</div></div>
                                  </div>
                                  <div className="discovery-actions" style={{ marginTop: 10 }}>
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
                        <button type="button" className="ghost-button" style={{ width: "100%", fontSize: 12, borderStyle: "dashed" }} onClick={props.onRunWorkerSetup} disabled={props.busyKey !== null}>
                          在本机安装新节点
                        </button>
                      </div>
                    </details>
                  </section>
                </div>
              ) : null}

              {showOverview ? (
                <OverviewPanel
                  heroCards={props.connectionHeroCards}
                  prepItems={props.connectionPrepItems}
                  signalCards={props.connectionSignalCards}
                  canManageGateway={showGatewayControls}
                  localConsoleHint={localConsoleHint}
                  modelCheckText={props.modelCheckText}
                  lastError={props.wechatLastError}
                  dispatchWarning={props.gatewaySetupDispatchModeEnabled && props.availableDispatchNodes === 0 ? "已开启分发模式，但暂无远程节点。" : null}
                  localNodeStatus={props.localNodeStatus}
                  assessmentMaxRounds={props.assessmentMaxRounds}
                  assessmentApplyStrategy={props.assessmentApplyStrategy}
                  onRunModelCheck={props.onRunModelCheck}
                  onToggleDispatch={props.onToggleDispatch}
                  onRefreshAllStatus={props.onRefreshAllStatus}
                  onRefreshChannelAssessment={props.onRefreshLocalNodeStatus}
                  onAssessmentMaxRoundsChange={props.onAssessmentMaxRoundsChange}
                  onAssessmentApplyStrategyChange={props.onAssessmentApplyStrategyChange}
                  onStartChannelAssessment={props.onStartLocalNodeChannelAssessment}
                  onApplyChannelAssessment={props.onApplyLocalNodeChannelAssessment}
                  applyChannelAssessmentLabel={props.busyKey === "local-node-channel-assessment-apply" ? "应用中..." : "应用评估建议"}
                  runModelCheckLabel={props.busyKey === "model-check" ? "检测中..." : "检测模型"}
                  toggleDispatchLabel={props.busyKey === "dispatch-mode-toggle" ? "切换中..." : props.gatewaySetupDispatchModeEnabled ? "关闭分发模式" : "开启分发模式"}
                  refreshAllLabel={props.busyKey === "connection-refresh-all" ? "刷新中..." : "刷新状态"}
                  busy={props.busyKey !== null}
                  assessmentBusy={
                    props.busyKey === "local-node-channel-assessment-start" ||
                    props.busyKey === "local-node-channel-assessment-apply"
                  }
                />
              ) : null}
            </div>
          </div>
        </div>

      ) : (
        <div className="connection-dashboard-stack worker-connection-stack">
          <div className="workspace-hero-strip">
            {props.connectionHeroCards.map((card) => (
              <ConnectionHeroCard key={`${card.eyebrow}-${card.title}`} {...card} />
            ))}
          </div>

          <div className="connection-dashboard-grid worker-connection-grid">
            <div className="connection-main-column">
              <div ref={localNodeConsoleRef}>
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
              </div>
            </div>

            <div className="connection-sidebar-column worker-sidebar-column">
              <section className="surface worker-node-summary-card">
                <SectionHeader
                  kicker="本机链路"
                  title={props.heroTitle}
                  description="把当前机器的发现地址、网关连接和节点身份收在同一块，切换或排障时不需要再来回找信息。"
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
                    tone={props.workerGatewayConnection.state === "gateway_reachable_node_connected" ? "healthy" : "warning"}
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
                    detail={props.workerGatewayConnection.state === "gateway_reachable_node_connected" ? "已配对" : resolveTokenDisplayState(props.workerSetup.node_token).status === "waiting" ? "等待网关下发 token" : "已配对"}
                    tone={props.workerGatewayConnection.state === "gateway_reachable_node_connected" || resolveTokenDisplayState(props.workerSetup.node_token).status === "paired" ? "good" : "warn"}
                  />
                </div>
                <InfoList
                  className="worker-node-summary-info"
                  items={[
                    { label: "连接详情", value: props.workerGatewayConnection.detail, multiline: true },
                    { label: "配对密钥", value: hasText(props.workerSetup.pairing_key) ? "已填写，可在安装修复区显示或修改" : "未填写", multiline: true },
                    ...(props.workerGatewayConnection.remoteNode
                      ? [{ label: "网关侧节点记录", value: summarizeRemoteNode(props.workerGatewayConnection.remoteNode), multiline: true }]
                      : []),
                  ]}
                />
              </section>

              <SurfaceCard className="command-surface connection-assessment-surface">
                <SectionHeader
                  kicker="压测工具"
                  title="通道容量建议"
                  actions={
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={props.onRefreshLocalNodeStatus}
                      disabled={props.busyKey !== null}
                      style={{ height: 26, fontSize: 11 }}
                    >
                      刷新
                    </button>
                  }
                />
                {(() => {
                  const assessment = props.localNodeStatus?.channel_assessment;
                  const assessmentStatus = assessment?.status || "idle";
                  const localNodeRunning = props.localNodeStatus?.state === "running";
                  const configuredMaxRounds = Math.max(1, Math.min(999, Number(props.assessmentMaxRounds) || 1));
                  const canStartAssessment = Boolean(assessment?.can_start ?? true) && assessmentStatus !== "running";
                  const canApplyRecommendation =
                    assessmentStatus === "completed" &&
                    assessment?.recommended_channel_capacity !== null &&
                    assessment?.recommended_max_concurrency !== null;
                  const balancedRecommendationAvailable =
                    assessmentStatus === "completed" &&
                    assessment?.balanced_channel_capacity !== null &&
                    assessment?.balanced_max_concurrency !== null;
                  const latestAssessmentTime = assessment?.finished_at || assessment?.started_at || null;
                  const latestFailureRound =
                    assessment?.rounds ? [...assessment.rounds].reverse().find((round) => !round.stable) ?? null : null;
                  const assessmentFailureDetail =
                    latestFailureRound?.first_error ||
                    latestFailureRound?.failure_details?.[0] ||
                    assessment?.last_error ||
                    "";
                  const recentRounds = assessment?.rounds?.slice(-2) ?? [];
                  return (
                    <div className="connection-assessment-sidebar-shell" style={{ marginTop: 12 }}>
                      <div
                        style={{
                          backgroundColor: "rgba(0,0,0,0.03)",
                          padding: 12,
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 12, opacity: 0.6 }}>评估状态</span>
                          <SignalBadge
                            tone={
                              assessmentStatus === "completed"
                                ? "good"
                                : assessmentStatus === "running"
                                ? "info"
                                : "neutral"
                            }
                          >
                            {assessmentStatus === "running" ? "进行中" : assessmentStatus === "completed" ? "已完成" : "未开始"}
                          </SignalBadge>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
                          {assessmentStatus === "running"
                            ? assessment?.stage
                            : assessment?.start_blocking_reason || "待执行压测"}
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                        <MetricCard
                          label="当前通道"
                          value={String(assessment?.current_channel_capacity ?? "-")}
                          tone="accent"
                        />
                        <MetricCard
                          label="当前并发"
                          value={String(assessment?.current_max_concurrency ?? "-")}
                          tone="accent"
                        />
                        <MetricCard
                          label="峰值建议"
                          value={
                            canApplyRecommendation
                              ? `${assessment?.recommended_channel_capacity}/${assessment?.recommended_max_concurrency}`
                              : "-"
                          }
                          tone="healthy"
                        />
                        <MetricCard
                          label="稳定轮次"
                          value={
                            balancedRecommendationAvailable
                              ? `${assessment?.balanced_channel_capacity}/${assessment?.balanced_max_concurrency}`
                              : "-"
                          }
                          detail="优先选择平均延迟 <= 5000ms 的最后稳定轮次"
                          tone="accent"
                        />
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>最大轮数</div>
                        <input
                          type="number"
                          min={1}
                          max={999}
                          step={1}
                          value={configuredMaxRounds}
                          onChange={(event) => props.onAssessmentMaxRoundsChange(Number(event.target.value) || 1)}
                          disabled={props.busyKey !== null || assessmentStatus === "running"}
                          style={{ width: "100%" }}
                        />
                        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>
                          当前支持 1 - 999 轮，命中失败、超时或延迟阈值时会自动提前停止。
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                        <MetricCard
                          label="最近执行"
                          value={latestAssessmentTime ? formatAssessmentTimestamp(latestAssessmentTime) : "-"}
                          tone="accent"
                        />
                        <MetricCard
                          label="当前摘要"
                          value={assessmentFailureDetail || assessment?.summary || assessment?.start_blocking_reason || "待执行压测"}
                          tone="warning"
                        />
                      </div>

                      <div className="assessment-controls" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={props.onStartLocalNodeService}
                            disabled={props.busyKey !== null || props.busyKey === "local-node-channel-assessment-start" || localNodeRunning}
                            style={{ flex: 1 }}
                          >
                            启动
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={props.onStopLocalNodeService}
                            disabled={props.busyKey !== null || props.busyKey === "local-node-channel-assessment-start" || !localNodeRunning}
                            style={{ flex: 1 }}
                          >
                            停止
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={props.onStartLocalNodeChannelAssessment}
                          disabled={props.busyKey !== null || props.busyKey === "local-node-channel-assessment-start" || !canStartAssessment}
                          style={{ width: "100%" }}
                        >
                          {assessmentStatus === "running" ? "正在评估..." : "开始压力测试"}
                        </button>
                      </div>

                      {canApplyRecommendation ? (
                        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                          <select
                            value={props.assessmentApplyStrategy}
                            onChange={(event) => props.onAssessmentApplyStrategyChange(event.target.value as "balanced" | "peak")}
                            disabled={props.busyKey !== null || props.busyKey === "local-node-channel-assessment-apply"}
                            style={{ width: "100%", marginBottom: 8 }}
                          >
                            <option value="balanced">方案：均衡稳定</option>
                            <option value="peak">方案：极限容量</option>
                          </select>
                          <button
                            type="button"
                            className="connection-assessment-apply"
                            onClick={props.onApplyLocalNodeChannelAssessment}
                            disabled={props.busyKey !== null || props.busyKey === "local-node-channel-assessment-apply"}
                            style={{ width: "100%" }}
                          >
                            {props.busyKey === "local-node-channel-assessment-apply" ? "应用中..." : "应用评估建议"}
                          </button>
                        </div>
                      ) : null}

                      {recentRounds.length ? (
                        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 6 }}>
                          <span className="section-kicker">最近两轮压测</span>
                          {recentRounds.map((round) => {
                            const appearance = getAssessmentRoundAppearance(round);
                            return (
                              <div
                                key={`worker-round-${round.round_index}`}
                                style={{
                                  padding: "8px 12px",
                                  backgroundColor: "rgba(0,0,0,0.02)",
                                  borderRadius: 6,
                                  border: "1px solid var(--line)",
                                  fontSize: 12,
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <strong>第 {round.round_index} 轮</strong>
                                  <span style={{ opacity: 0.6 }}>{round.max_concurrency} 并发 / {round.channel_capacity} 通道</span>
                                </div>
                                <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
                                  <SignalBadge tone={appearance.tone} style={{ fontSize: 10, padding: "1px 4px" }}>
                                    {appearance.flagLabel}
                                  </SignalBadge>
                                  <span style={{ opacity: 0.7 }}>{round.summary}</span>
                                </div>
                                {round.first_error ? (
                                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-secondary, rgba(15, 23, 42, 0.72))" }}>
                                    {round.first_error}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </SurfaceCard>

              <section className="surface worker-node-install-card">
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

function formatAssessmentTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function getAssessmentRoundAppearance(
  round: NonNullable<LocalNodeStatusResponse["channel_assessment"]>["rounds"][number]
): {
  tone: "good" | "warn" | "info" | "neutral";
  flagLabel: string;
} {
  if (round.stable) return { tone: "good", flagLabel: "稳定" };
  if (round.timeout_count > 0) return { tone: "warn", flagLabel: "超时" };
  if (round.failure_count > 0) return { tone: "warn", flagLabel: "失败" };
  if (round.stop_reason.includes("延迟")) return { tone: "info", flagLabel: "延迟" };
  return { tone: "warn", flagLabel: "终止" };
}
