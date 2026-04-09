import { ConnectionHeroCard, InfoRow, PrepStrip, ToggleSecretInput } from "./ConnectionUi";
import { NodeInventoryPanel } from "./NodeInventoryPanel";
import { NodeModelConfigPanel } from "./NodeModelConfigPanel";
import { OverviewPanel } from "./OverviewPanel";
import { WeChatConfigCard } from "./WeChatConfigCard";
import type {
  ConnectionHeroCardData,
  ConnectionPrepItem,
  ConnectionSignalCardData,
  DiscoveredNodeRecord,
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
  currentRoleIsConsole: boolean;
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
  onRefreshLocalNodeDiagnostics: () => void;
  onRestartLocalNodeService: () => void;
  onSaveLocalNodeModelConfig: () => void;
  onExportLocalNodeDiagnostics: () => void;
  onRestartGatewayService: () => void;
};

export function ConnectionWorkspace(props: ConnectionWorkspaceProps) {
  return (
    <section className="workspace-frame connection-workspace">
      <div className="workspace-heading">
        <div>
          <div className="section-kicker">{props.currentRoleIsWorker ? "节点工作台" : "接入中心"}</div>
          <h2>{props.currentRoleIsWorker ? "聚焦本机节点安装、回连与发现响应" : "先确认网关、微信、节点和模型都处于可用状态"}</h2>
        </div>
        <div className="workspace-caption">
          {props.currentRoleIsWorker
            ? "当前角色不会展示网关纳管、微信接入和分发模式操作。"
            : "摘要优先，细节折叠，常规联调不再需要一路向下翻整页表单。"}
        </div>
      </div>

      {!props.currentRoleIsWorker ? (
        <div className="connection-layout-stack">
          <OverviewPanel
            heroCards={props.connectionHeroCards}
            prepItems={props.connectionPrepItems}
            signalCards={props.connectionSignalCards}
            consoleTarget={props.setupProfileConsoleGatewayBaseUrl || props.currentGatewayBaseUrl}
            modelCheckText={props.modelCheckText}
            lastError={props.wechatLastError}
            dispatchWarning={props.gatewaySetupDispatchModeEnabled && props.availableDispatchNodes === 0 ? "已开启分发模式，但暂无可用远端节点；网关无法完成实际回复。" : null}
            onRunModelCheck={props.onRunModelCheck}
            onToggleDispatch={props.onToggleDispatch}
            onRefreshAllStatus={props.onRefreshAllStatus}
            runModelCheckLabel={props.busyKey === "model-check" ? "检测中..." : "检测模型"}
            toggleDispatchLabel={props.busyKey === "dispatch-mode-toggle" ? "切换中..." : props.gatewaySetupDispatchModeEnabled ? "关闭分发模式" : "开启分发模式"}
            refreshAllLabel={props.busyKey === "connection-refresh-all" ? "刷新中..." : "刷新全部状态"}
            busy={props.busyKey !== null}
          />

          <div className="connection-section-grid">
            <NodeInventoryPanel headline={props.nodeInventoryHeadline} cards={props.nodeInventoryCards} selectedDiagnostics={props.selectedNodeDiagnosticsView} />
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
          </div>

          <div className="connection-section-grid">
            <div className="connection-panel-stack">
              <section className="surface">
                <div className="section-head">
                  <div><div className="section-kicker">节点与模型参数</div><h3>添加或修复远端工作节点</h3></div>
                  <button type="button" className="ghost-button" onClick={props.onApplyPreferredGatewayBaseUrlToWorker}>
                    填入当前网关地址
                  </button>
                </div>
                <div className="inline-tip">
                  基础安装信息直接展示，按地址直连和局域网扫描收纳到折叠区，降低首次配置时的认知负担。
                </div>
                <div className="connection-form-grid">
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
                <div className="inline-actions" style={{ marginTop: 14 }}>
                  <button type="button" onClick={props.onRunWorkerSetup} disabled={props.busyKey !== null}>
                    {props.busyKey === "setup-worker" ? "安装中..." : "安装当前机器节点"}
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
                    <label><span>目标 IP / 主机名</span><input value={props.manualPair.host} onChange={(event) => props.onUpdateManualPair("host", event.target.value)} placeholder="例如 192.168.0.23" /></label>
                    <label><span>配对端口</span><input type="number" value={props.manualPair.pairing_port} onChange={(event) => props.onUpdateManualPair("pairing_port", Number(event.target.value) || 9532)} /></label>
                    <label><span>配对密钥</span><ToggleSecretInput value={props.manualPair.pairing_key} onChange={(event) => props.onUpdateManualPair("pairing_key", event.target.value)} placeholder="与目标节点上的 CLAW_PAIRING_KEY 一致" autoComplete="new-password" /></label>
                    <label><span>指定节点 ID（可选）</span><input value={props.manualPair.node_id} onChange={(event) => props.onUpdateManualPair("node_id", event.target.value)} placeholder="留空则自动生成或沿用远端值" /></label>
                  </div>
                  <div className="inline-actions">
                    <button type="button" onClick={props.onManualPairNode} disabled={props.busyKey !== null}>
                      {props.busyKey === "setup-manual-pair" ? "连接中..." : "按地址配对"}
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
                    <button type="button" onClick={props.onScanLanNodes} disabled={props.busyKey !== null}>
                      {props.busyKey === "setup-discovery-scan" ? "搜索中..." : "搜索局域网节点"}
                    </button>
                  </div>
                  <div className="inline-tip">
                    当前网关回连地址：{props.currentGatewayBaseUrl}。扫描后可以直接输入密钥配对，适合调试和节点替换。
                  </div>
                  {!props.discoveredNodes.length ? (
                    <div className="empty-state">还没有扫描结果。先确认目标机器已运行 `claw-node` 并开启发现响应，然后点击“搜索局域网节点”。</div>
                  ) : (
                    <div className="discovery-list">
                      {props.discoveredNodes.map((item) => (
                        <div key={item.discovery_id} className="discovery-card">
                          <div className="discovery-card-top">
                            <div>
                              <div className="node-card-title">{item.pairing_label || item.hostname}</div>
                              <div className="node-card-subtitle">{[item.lan_ip || "-", item.platform || "-", item.node_version || "-"].join(" · ")}</div>
                            </div>
                            <span className={`session-badge session-badge-${pairingStatusTone(props.pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending"))}`}>
                              {pairingStatusLabel(props.pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending"))}
                            </span>
                          </div>
                          <div className="node-card-grid">
                            <div><div className="node-card-label">局域网 IP</div><div className="node-card-value">{item.lan_ip || "未上报"}</div></div>
                            <div><div className="node-card-label">配对端口</div><div className="node-card-value">{item.pairing_port}</div></div>
                            <div><div className="node-card-label">能力</div><div className="node-card-value">{item.capabilities.join(", ") || "未声明"}</div></div>
                            <div><div className="node-card-label">正式节点 ID</div><div className="node-card-value">{item.node_id || "配对时自动生成"}</div></div>
                          </div>
                          <div className="discovery-actions">
                            <input value={props.pairingSecrets[item.discovery_id] || ""} onChange={(event) => props.onUpdatePairingSecret(item.discovery_id, event.target.value)} placeholder="输入该机器的配对密钥" />
                            <button type="button" onClick={() => props.onPairLanNode(item)} disabled={props.busyKey !== null}>
                              {props.busyKey === "setup-discovery-pair" ? "连接中..." : "输入密钥并连接"}
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
              launcherAvailable={props.launcherAvailable}
              busyKey={props.busyKey}
              dirty={props.localNodeModelDirty}
              status={props.localNodeStatus}
              runtimeSummary={props.localNodeRuntimeSummary}
              gatewayControl={{
                managed: props.launcherGatewayManaged,
                state: props.launcherGatewayState,
                onRestart: props.onRestartGatewayService,
                disabled: props.busyKey !== null || !props.launcherAvailable || !props.launcherGatewayManaged,
                busy: props.busyKey === "launcher-gateway-restart",
              }}
              eventPreview=""
              draft={props.localNodeModelDraft}
              onChange={props.onUpdateLocalNodeModelDraft}
              onRefresh={props.onRefreshLocalNodeDiagnostics}
              onRestart={props.onRestartLocalNodeService}
              onSave={props.onSaveLocalNodeModelConfig}
              onExport={props.onExportLocalNodeDiagnostics}
            />
          </div>
        </div>
      ) : (
        <div className="connection-layout-stack">
          <section className="surface connection-overview" style={{ padding: "16px", background: "transparent", boxShadow: "none" }}>
            <div className="connection-hero-grid">
              {props.connectionHeroCards.map((card) => (
                <ConnectionHeroCard key={`${card.eyebrow}-${card.title}`} eyebrow={card.eyebrow} title={card.title} detail={card.detail} tone={card.tone} />
              ))}
            </div>
          </section>

          <div className="connection-grid">
            <div className="connection-status-column">
              <div className="worker-wizard-identity" style={{ marginBottom: 12 }}>
                <div className="worker-wizard-identity-ip">
                  {props.workerGatewayConnection.remoteNode?.lan_ip || String(props.localNodeStatus?.diagnostics?.lan_ip || props.currentNodeLanIp || "检测中…")}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                  端口：{props.workerSetup.discovery_port} &nbsp;&middot;&nbsp; 当前机器节点地址，网关管理员可使用该地址配对
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

              <section className="surface">
                <div className="section-head">
                  <div>
                    <div className="section-kicker">节点安装</div>
                    <h3>安装或重装当前机器节点</h3>
                  </div>
                </div>
                <div className="form-grid">
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
                <div className="inline-actions" style={{ marginTop: 14 }}>
                  <button type="button" onClick={props.onRunWorkerSetup} disabled={props.busyKey !== null}>
                    {props.busyKey === "setup-worker" ? "安装中..." : "安装当前机器节点"}
                  </button>
                  <button type="button" className="ghost-button" onClick={props.onProbeWorkerGateway} disabled={props.busyKey !== null}>
                    {props.busyKey === "setup-gateway-probe" ? "检测中..." : "检测目标网关"}
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
                  <InfoRow label="目标网关地址" value={props.workerSetup.gateway_base_url || "未填写"} multiline />
                  <InfoRow label="网关连接状态" value={props.workerGatewayConnection.label} multiline />
                  <InfoRow label="连接详情" value={props.workerGatewayConnection.detail} multiline />
                  <InfoRow label="节点 ID" value={props.workerSetup.node_id || "未填写"} multiline />
                  <InfoRow label="配对密钥" value={props.workerSetup.pairing_key.trim() ? "已填写，可在上方显示/修改" : "未填写"} multiline />
                  {props.workerGatewayConnection.remoteNode ? <InfoRow label="网关侧节点记录" value={summarizeRemoteNode(props.workerGatewayConnection.remoteNode)} multiline /> : null}
                </div>
              </section>
            </div>

            <div className="connection-action-column">
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
                onRestart={props.onRestartLocalNodeService}
                onSave={props.onSaveLocalNodeModelConfig}
                onExport={props.onExportLocalNodeDiagnostics}
              />
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

function resolveTokenDisplayState(token: string) {
  const trimmed = token.trim();
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
