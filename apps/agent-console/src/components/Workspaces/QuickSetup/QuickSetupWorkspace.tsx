import { InfoRow, SetupStepPill } from "../Connection/ConnectionUi";
import { LauncherControlPanel } from "./LauncherControlPanel";
import { QuickSetupConfigStage } from "./QuickSetupConfigStage";
import { QuickSetupExecutionStage } from "./QuickSetupExecutionStage";
import { QuickSetupRolePanel } from "./QuickSetupRolePanel";
import { QuickSetupStatusPanel } from "./QuickSetupStatusPanel";
import { DEFAULT_BUILTIN_MODEL_LABEL, DEFAULT_SETUP_ROLES } from "../../../quickSetupDefaults";
import { roleAction, roleDescription, roleName } from "../../../selectors/quickSetupSelectors";
import { hasText } from "../../../stringUtils";
import type {
  ConsoleSetupConfig,
  DiscoveredNodeRecord,
  GatewaySetupConfig,
  LauncherState,
  LauncherStatusResponse,
  ManualPairDraft,
  PairingStatus,
  SetupMode,
  SetupProfileResponse,
  SetupRole,
  SetupTaskResult,
  WorkerGatewayConnectionState,
  WorkerNodeSetupConfig,
} from "../../../types";

type QuickSetupWorkspaceProps = {
  currentRoleIsWorker: boolean;
  currentRoleIsConsole: boolean;
  currentRoleDisplay: string;
  effectiveRole: SetupRole | null;
  setupMode: SetupMode;
  setupRole: SetupRole | null;
  setupProfile: SetupProfileResponse | null;
  setupTask: SetupTaskResult | null;
  launcherAvailable: boolean;
  launcherExpanded: boolean;
  envExpanded: boolean;
  launcherStatus: LauncherStatusResponse | null;
  launcherLogs: Record<string, string>;
  busyKey: string | null;
  gatewaySetup: GatewaySetupConfig;
  workerSetup: WorkerNodeSetupConfig;
  consoleSetup: ConsoleSetupConfig;
  currentNodeLanIp: string;
  discoveredNodes: DiscoveredNodeRecord[];
  pairingStatuses: Record<string, PairingStatus>;
  pairingSecrets: Record<string, string>;
  manualPair: ManualPairDraft;
  workerGatewayProbeTask: SetupTaskResult | null;
  workerGatewayConnection: {
    label: string;
    detail: string;
    state: WorkerGatewayConnectionState;
  };
  workerPairingKeyVisible: boolean;
  workerModelExpanded: boolean;
  launcherHostRedisFailed: boolean;
  launcherGatewayFailed: boolean;
  latestSetupSummary: string;
  quickSetupStatusRows: Array<{ title: string; value: string; tone: "good" | "warn"; detail: string }>;
  workerCredentialRows: Array<{ label: string; value: string }>;
  reconfigureWarnings: string[];
  wechatRunning: boolean;
  wechatBaseUrl: string;
  gatewayRuntimeText: string;
  nodeSummaryText: string;
  completedRoles: Set<SetupRole>;
  installProgressSummary: string;
  onRefreshLauncherStatus: () => void;
  onToggleLauncherExpanded: () => void;
  onReadLauncherLog: (name: string) => void;
  onStopComponent: (name: string) => void;
  onToggleEnvExpanded: () => void;
  onInstallHostRedis: () => void;
  onToggleDispatchMode: () => void;
  onToggleNodeCache: () => void;
  onInstallNodeCacheRedis: () => void;
  onStartLauncherStack: () => void;
  onStopLauncherStack: () => void;
  launcherMachineRoleLabel: (launcherStatus: LauncherStatusResponse | null) => string;
  launcherManagedComponentsLabel: (launcherStatus: LauncherStatusResponse | null) => string;
  launcherLocalNodePolicyLabel: (launcherStatus: LauncherStatusResponse | null) => string;
  launcherEnvironmentLabel: (name: string) => string;
  launcherComponentName: (name: string) => string;
  launcherStateLabel: (state: LauncherState) => string;
  launcherBadgeTone: (state: LauncherState) => "human" | "typing" | "queued" | "idle";
  reconfigureConfirmOpen: boolean;
  onRefreshStatus: () => void;
  onToggleReconfigureConfirm: () => void;
  onConfirmReconfigure: () => void;
  onCancelReconfigure: () => void;
  onSelectRole: (role: SetupRole) => void;
  onClearAndReselectRole: () => void;
  onReturnToSetupStatus: () => void;
  onResetCurrentSetupDraft: () => void;
  onUpdateGatewaySetup: <K extends keyof GatewaySetupConfig>(key: K, value: GatewaySetupConfig[K]) => void;
  onUpdateWorkerSetup: <K extends keyof WorkerNodeSetupConfig>(key: K, value: WorkerNodeSetupConfig[K]) => void;
  onUpdateConsoleSetup: (key: "gateway_base_url", value: string) => void;
  onUpdatePairingSecret: (discoveryId: string, value: string) => void;
  onScanLanNodes: () => void;
  onPairLanNode: (item: DiscoveredNodeRecord) => void;
  onApplyPreferredGatewayBaseUrlToWorker: () => void;
  onProbeWorkerGateway: () => void;
  onToggleWorkerPairingKeyVisible: () => void;
  onToggleWorkerModelExpanded: () => void;
  onUpdateManualPair: <K extends keyof ManualPairDraft>(key: K, value: ManualPairDraft[K]) => void;
  pairingStatusLabel: (status: PairingStatus) => string;
  pairingStatusTone: (status: PairingStatus) => string;
  validateWorkerGatewayUrl: (value: string) => boolean;
  resolveTokenWaiting: (token: string) => boolean;
  previewContent: (role: SetupRole) => string;
  previewOutcome: (role: SetupRole) => string;
  onSubmitSetupRole: () => void;
  onBackToConfig: () => void;
  onRefreshProfile: () => void;
  onGoToConnection: () => void;
  onAdvanceToPreview: () => void;
};

export function QuickSetupWorkspace(props: QuickSetupWorkspaceProps) {
  const headingCaption = props.currentRoleIsWorker
    ? "按节点视角推进。"
    : props.currentRoleIsConsole
      ? "按控制台视角推进。"
      : "按当前角色推进配置。";
  const stepCaption = props.setupMode === "status" ? "当前连接状态" : props.setupMode === "role" ? "选择角色" : props.setupMode === "config" ? "填写参数" : props.setupMode === "preview" ? "执行前确认" : "查看结果";

  return (
    <section className="workspace-frame quick-setup-workspace">
      <div className="workspace-heading">
        <div><div className="section-kicker">首次启动向导</div><h2>先选角色，再用最短路径把本机跑起来</h2></div>
        <div className="workspace-caption">{headingCaption}</div>
      </div>
      <div className="quick-setup-layout">
        <section className="surface">
          <div className="section-head">
            <div><div className="section-kicker">步骤导航</div><h3>配置流程</h3></div>
            <span className="small-note">{stepCaption}</span>
          </div>
          <div className="quick-setup-steps">
            <SetupStepPill label="0. 当前连接" active={props.setupMode === "status"} done={props.setupMode !== "status"} />
            <SetupStepPill label="1. 选择角色" active={props.setupMode === "role"} done={props.setupMode === "config" || props.setupMode === "preview" || props.setupMode === "result"} />
            <SetupStepPill label="2. 基础参数" active={props.setupMode === "config"} done={props.setupMode === "preview" || props.setupMode === "result"} />
            <SetupStepPill label="3. 执行确认" active={props.setupMode === "preview"} done={props.setupMode === "result"} />
            <SetupStepPill label="4. 执行结果" active={props.setupMode === "result"} done={Boolean(props.setupTask && props.setupTask.status === "succeeded")} />
          </div>
          <div className="info-stack">
            <InfoRow label="推荐入口" value={props.setupProfile?.recommended_workspace === "quick_setup" ? "当前仍建议先完成快速配置" : "已可直接进入联调或会话观察"} multiline />
            <InfoRow label="当前角色" value={props.currentRoleDisplay} multiline />
            <InfoRow label="已完成角色" value={props.setupProfile?.completed_roles.length ? props.setupProfile.completed_roles.map(roleName).join(" / ") : "暂无"} multiline />
            <InfoRow label="最近任务" value={props.setupTask?.title || props.setupProfile?.last_task?.title || "暂无"} multiline />
          </div>
        </section>

        <div className="quick-setup-main">
          {props.launcherAvailable && props.effectiveRole ? (
            <LauncherControlPanel
              currentRoleIsWorker={props.currentRoleIsWorker}
              launcherExpanded={props.launcherExpanded}
              envExpanded={props.envExpanded}
              launcherStatus={props.launcherStatus}
              launcherLogs={props.launcherLogs}
              busyKey={props.busyKey}
              dispatchModeEnabled={props.gatewaySetup.dispatch_mode_enabled}
              hostRedisFailed={props.launcherHostRedisFailed}
              gatewayFailed={props.launcherGatewayFailed}
              onRefreshLauncherStatus={props.onRefreshLauncherStatus}
              onToggleLauncherExpanded={props.onToggleLauncherExpanded}
              onReadLauncherLog={props.onReadLauncherLog}
              onStopComponent={props.onStopComponent}
              onToggleEnvExpanded={props.onToggleEnvExpanded}
              onInstallHostRedis={props.onInstallHostRedis}
              onToggleDispatchMode={props.onToggleDispatchMode}
              onToggleNodeCache={props.onToggleNodeCache}
              onInstallNodeCacheRedis={props.onInstallNodeCacheRedis}
              onStartLauncherStack={props.onStartLauncherStack}
              onStopLauncherStack={props.onStopLauncherStack}
              launcherMachineRoleLabel={props.launcherMachineRoleLabel}
              launcherManagedComponentsLabel={props.launcherManagedComponentsLabel}
              launcherLocalNodePolicyLabel={props.launcherLocalNodePolicyLabel}
              launcherEnvironmentLabel={props.launcherEnvironmentLabel}
              launcherComponentName={props.launcherComponentName}
              launcherStateLabel={props.launcherStateLabel}
              launcherBadgeTone={props.launcherBadgeTone}
            />
          ) : null}

          {props.setupMode === "status" ? (
            <QuickSetupStatusPanel
              busyKey={props.busyKey}
              reconfigureConfirmOpen={props.reconfigureConfirmOpen}
              currentRoleDisplay={props.currentRoleDisplay}
              currentRoleIsWorker={props.currentRoleIsWorker}
              workerGatewayBaseUrl={props.workerSetup.gateway_base_url}
              workerGatewayConnectionLabel={props.workerGatewayConnection.label}
              workerInstallDir={props.workerSetup.install_dir}
              latestSetupSummary={props.latestSetupSummary}
              wechatBaseUrl={props.wechatBaseUrl}
              consoleGatewayBaseUrl={props.setupProfile?.console.gateway_base_url || "-"}
              gatewayRuntimeText={props.gatewayRuntimeText}
              nodeSummaryText={props.nodeSummaryText}
              pairingKeyFilled={hasText(props.workerSetup.pairing_key)}
              envExpanded={props.envExpanded}
              statusRows={props.quickSetupStatusRows}
              workerCredentialRows={props.workerCredentialRows}
              reconfigureWarnings={props.reconfigureWarnings}
              wechatRunning={props.wechatRunning}
              onRefreshStatus={props.onRefreshStatus}
              onToggleReconfigureConfirm={props.onToggleReconfigureConfirm}
              onToggleCredentialExpanded={props.onToggleEnvExpanded}
              onConfirmReconfigure={props.onConfirmReconfigure}
              onCancelReconfigure={props.onCancelReconfigure}
            />
          ) : null}

          {props.setupMode === "role" ? (
            <QuickSetupRolePanel
              availableRoles={props.setupProfile?.available_roles ?? DEFAULT_SETUP_ROLES}
              selectedRole={props.setupRole}
              completedRoles={props.completedRoles}
              onSelectRole={props.onSelectRole}
              roleName={roleName}
              roleDescription={roleDescription}
              roleAction={roleAction}
            />
          ) : null}

          {props.setupMode !== "status" && props.setupMode !== "role" && props.setupRole ? (
            <section className="surface">
              <div className="section-head">
                <div><div className="section-kicker">当前角色</div><h3>{roleName(props.setupRole)}</h3></div>
                <div className="inline-actions">
                  <button type="button" className="ghost-button" onClick={props.onClearAndReselectRole}>重新选角色</button>
                  {props.setupProfile?.setup_completed ? <button type="button" className="ghost-button" onClick={props.onReturnToSetupStatus}>返回状态总览</button> : null}
                  <button type="button" className="ghost-button" onClick={props.onResetCurrentSetupDraft}>重置当前填写内容</button>
                </div>
              </div>
              {props.setupMode === "config" ? (
                <QuickSetupConfigStage
                  setupRole={props.setupRole}
                  busyKey={props.busyKey}
                  gatewaySetup={props.gatewaySetup}
                  workerSetup={props.workerSetup}
                  consoleSetup={props.consoleSetup}
                  currentNodeLanIp={props.currentNodeLanIp}
                  discoveredNodes={props.discoveredNodes}
                  pairingStatuses={props.pairingStatuses}
                  pairingSecrets={props.pairingSecrets}
                  manualPair={props.manualPair}
                  workerGatewayProbeTask={props.workerGatewayProbeTask}
                  workerGatewayConnectionLabel={props.workerGatewayConnection.label}
                  workerGatewayConnectionState={props.workerGatewayConnection.state}
                  workerPairingKeyVisible={props.workerPairingKeyVisible}
                  workerModelExpanded={props.workerModelExpanded}
                  builtinModelLabel={DEFAULT_BUILTIN_MODEL_LABEL}
                  onUpdateGatewaySetup={props.onUpdateGatewaySetup}
                  onUpdateWorkerSetup={props.onUpdateWorkerSetup}
                  onUpdateConsoleSetup={props.onUpdateConsoleSetup}
                  onUpdatePairingSecret={props.onUpdatePairingSecret}
                  onScanLanNodes={props.onScanLanNodes}
                  onPairLanNode={props.onPairLanNode}
                  onApplyPreferredGatewayBaseUrlToWorker={props.onApplyPreferredGatewayBaseUrlToWorker}
                  onProbeWorkerGateway={props.onProbeWorkerGateway}
                  onToggleWorkerPairingKeyVisible={props.onToggleWorkerPairingKeyVisible}
                  onToggleWorkerModelExpanded={props.onToggleWorkerModelExpanded}
                  onUpdateManualPair={props.onUpdateManualPair}
                  pairingStatusLabel={props.pairingStatusLabel}
                  pairingStatusTone={props.pairingStatusTone}
                  validateWorkerGatewayUrl={props.validateWorkerGatewayUrl}
                  resolveTokenWaiting={props.resolveTokenWaiting}
                />
              ) : (
                <QuickSetupExecutionStage
                  setupMode={props.setupMode}
                  setupRole={props.setupRole}
                  setupTask={props.setupTask}
                  installProgressSummary={props.installProgressSummary}
                  busyKey={props.busyKey}
                  previewContent={props.previewContent}
                  previewOutcome={props.previewOutcome}
                  onSubmit={props.onSubmitSetupRole}
                  onBackToConfig={props.onBackToConfig}
                  onRefreshProfile={props.onRefreshProfile}
                  onGoToConnection={props.onGoToConnection}
                />
              )}
              {props.setupMode === "config" ? <div className="inline-actions quick-setup-actions"><button type="button" onClick={props.onAdvanceToPreview}>下一步：确认执行</button></div> : null}
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
