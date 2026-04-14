import { ConnectionHeroCard, InfoRow, PrepStrip, ToggleSecretInput } from "./ConnectionUi";
import { NodeInventoryPanel } from "./NodeInventoryPanel";
import { NodeModelConfigPanel } from "./NodeModelConfigPanel";
import { OverviewPanel } from "./OverviewPanel";
import { WeChatConfigCard } from "./WeChatConfigCard";
import { hasText, safeTrim } from "../../../stringUtils";
import {
  MetricCard,
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
    showRemoteNodeInventory: boolean;
    showLocalNodePanel: boolean;
  };
  roleActions: {
    canManageGateway: boolean;
    canManageWeChat: boolean;
    canManageNodes: boolean;
  };
  currentNodeLanIp: string;
  currentGatewayBaseUrl: string;
  setupCompletedRoles: Set<SetupRole>;
  setupProfileConsoleGatewayBaseUrl: string;
  gatewaySetupDispatchModeEnabled: boolean;
  workerSetup: WorkerNodeSetupConfig;
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
  modelCheckText: string | null;
  wechatLastError: string | null;
  wechatStatus: WeChatStatus | null;
  systemStatus: SystemStatus | null;
  onRunModelCheck: () => void;
  onToggleDispatch: () => void;
  onRefreshAllStatus: () => void;
  onWechatBaseUrlChange: (value: string) => void;
  onManualTokenChange: (value: string) => void;
  onStartQrFlow: () => void;
  onPollQrStatus: () => void;
  onConnectManualToken: () => void;
  onDisconnectWeChat: () => void;
  onApplyPreferredGatewayBaseUrlToWorker: () => void;
  onUpdateWorkerSetup: <K extends keyof WorkerNodeSetupConfig>(key: K, value: WorkerNodeSetupConfig[K]) => void;
  onToggleWorkerPairingKeyVisible: () => void;
  onRunWorkerSetup: () => void;
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
  const showInventory = props.roleSections.showRemoteNodeInventory;
  const showLocalNodePanel = props.roleSections.showLocalNodePanel;
  const showNodeOnboarding = props.roleActions.canManageNodes;
  const showGatewayControls = props.roleActions.canManageGateway;

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

              {showWeChat ? (
                <WeChatConfigCard
                  statusRows={props.wechatStatusRows}
                  qrImageSrc={props.qrImageSrc}
                  pollStatus={props.pollStatus}
                  wechatBaseUrl={props.wechatBaseUrl}
                  manualToken={props.manualToken}
                  busyKey={props.busyKey}
                  onWechatBaseUrlChange={props.onWechatBaseUrlChange}
                  onManualTokenChange={props.onManualTokenChange}
                  onStartQrFlow={props.onStartQrFlow}
                  onPollQrStatus={props.onPollQrStatus}
                  onConnectManualToken={props.onConnectManualToken}
                  onDisconnectWeChat={props.onDisconnectWeChat}
                />
              ) : null}

              {showLocalNodePanel ? (
                <NodeModelConfigPanel
                  launcherAvailable={props.launcherAvailable}
                  busyKey={props.busyKey}
                  dirty={props.localNodeModelDirty}
                  status={props.localNodeStatus}
                  runtimeSummary={props.localNodeRuntimeSummary}
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
                  onRunConversationTest={props.onRunLocalNodeConversationTest}
                />
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
                  onStartLocalNodeService={props.onStartLocalNodeService}
                  onStopLocalNodeService={props.onStopLocalNodeService}
                  onStartChannelAssessment={props.onStartLocalNodeChannelAssessment}
                  onApplyChannelAssessment={props.onApplyLocalNodeChannelAssessment}
                  startLocalNodeLabel={props.busyKey === "local-node-start" ? "启动中..." : "启动本机节点"}
                  stopLocalNodeLabel={props.busyKey === "local-node-stop" ? "停止中..." : "停止本机节点"}
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
              <NodeModelConfigPanel
                launcherAvailable={props.launcherAvailable}
                busyKey={props.busyKey}
                dirty={props.localNodeModelDirty}
                status={props.localNodeStatus}
                runtimeSummary={props.localNodeRuntimeSummary}
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
                onRepair={props.onRunWorkerSetup}
                onRunConversationTest={props.onRunLocalNodeConversationTest}
              />
            </div>

            <div className="connection-sidebar-column worker-sidebar-column">
              <section className="surface worker-node-summary-card">
                <div className="section-head compact-head">
                  <div>
                    <div className="section-kicker">本机链路</div>
                    <h3>{props.heroTitle}</h3>
                  </div>
                </div>
                <div className="worker-wizard-identity worker-node-address-card">
                  <div className="worker-wizard-identity-ip">
                    {props.workerGatewayConnection.remoteNode?.lan_ip || String(props.localNodeStatus?.diagnostics?.lan_ip || props.currentNodeLanIp || "检测中…")}
                  </div>
                  <div className="worker-node-address-meta">
                    发现端口 {props.workerSetup.discovery_port} · 当前机器节点地址
                  </div>
                </div>
                <div className="prep-strip-list worker-node-prep-list">
                  <PrepStrip label="节点配置" detail={props.setupCompletedRoles.has("worker_node") ? "当前机器节点已完成配置" : "尚未完成节点配置"} tone={props.setupCompletedRoles.has("worker_node") ? "good" : "warn"} />
                  <PrepStrip label="目标网关地址" detail={props.workerSetup.gateway_base_url || "未填写局域网网关地址"} tone={props.workerSetup.gateway_base_url ? "good" : "warn"} />
                  <PrepStrip label="发现响应" detail={props.workerSetup.discovery_enabled ? `已启用 UDP ${props.workerSetup.discovery_port}` : "当前已关闭"} tone={props.workerSetup.discovery_enabled ? "good" : "warn"} />
                  <PrepStrip
                    label="Token 状态"
                    detail={props.workerGatewayConnection.state === "gateway_reachable_node_connected" ? "已配对" : resolveTokenDisplayState(props.workerSetup.node_token).status === "waiting" ? "等待网关下发 token" : "已配对"}
                    tone={props.workerGatewayConnection.state === "gateway_reachable_node_connected" || resolveTokenDisplayState(props.workerSetup.node_token).status === "paired" ? "good" : "warn"}
                  />
                </div>
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
                          label="平衡方案"
                          value={
                            balancedRecommendationAvailable
                              ? `${assessment?.balanced_channel_capacity}/${assessment?.balanced_max_concurrency}`
                              : "-"
                          }
                          tone="accent"
                        />
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>压测轮数</div>
                        <select
                          value={configuredMaxRounds}
                          onChange={(event) => props.onAssessmentMaxRoundsChange(Number(event.target.value) || 1)}
                          disabled={props.busyKey !== null || assessmentStatus === "running"}
                          style={{ width: "100%" }}
                        >
                          {[5, 10, 20, 30, 50, 100].map((value) => (
                            <option key={`worker-assessment-rounds-${value}`} value={value}>
                              {value} 轮
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                        <MetricCard
                          label="最近执行"
                          value={latestAssessmentTime ? formatAssessmentTimestamp(latestAssessmentTime) : "-"}
                          tone="accent"
                        />
                        <MetricCard
                          label="当前摘要"
                          value={assessment?.summary || assessment?.start_blocking_reason || "待执行压测"}
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
                <div className="section-head compact-head">
                  <div>
                    <div className="section-kicker">节点安装</div>
                    <h3>安装或重装当前机器节点</h3>
                  </div>
                </div>
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
                  <button type="button" onClick={props.onRunWorkerSetup} disabled={props.busyKey !== null}>
                    {props.busyKey === "setup-worker" ? "安装中..." : "安装当前机器节点"}
                  </button>
                  <button type="button" className="ghost-button" onClick={props.onProbeWorkerGateway} disabled={props.busyKey !== null}>
                    {props.busyKey === "setup-gateway-probe" ? "检测中..." : "检测目标网关"}
                  </button>
                </div>
              </section>

              <section className="surface node-role-surface worker-node-role-card">
                <div className="section-head compact-head">
                  <div>
                    <div className="section-kicker">节点说明</div>
                    <h3>{props.heroDescription}</h3>
                  </div>
                </div>
                <div className="inline-tip">
                  当前角色只管理本机节点。
                </div>
                <div className="info-stack">
                  <InfoRow label="节点身份" value="远端工作节点（当前机器）" multiline />
                  <InfoRow label="目标网关地址" value={props.workerSetup.gateway_base_url || "未填写"} multiline />
                  <InfoRow label="网关连接状态" value={props.workerGatewayConnection.label} multiline />
                  <InfoRow label="连接详情" value={props.workerGatewayConnection.detail} multiline />
                  <InfoRow label="节点 ID" value={props.workerSetup.node_id || "未填写"} multiline />
                  <InfoRow label="配对密钥" value={hasText(props.workerSetup.pairing_key) ? "已填写，可在上方显示/修改" : "未填写"} multiline />
                  {props.workerGatewayConnection.remoteNode ? <InfoRow label="网关侧节点记录" value={summarizeRemoteNode(props.workerGatewayConnection.remoteNode)} multiline /> : null}
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
