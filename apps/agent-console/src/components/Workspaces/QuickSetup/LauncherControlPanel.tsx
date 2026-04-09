import { InfoRow, SnippetBlock } from "../Connection/ConnectionUi";
import type { LauncherComponentStatus, LauncherEnvironmentCheck, LauncherState, LauncherStatusResponse } from "../../../types";

type LauncherControlPanelProps = {
  currentRoleIsWorker: boolean;
  launcherExpanded: boolean;
  envExpanded: boolean;
  launcherStatus: LauncherStatusResponse | null;
  launcherLogs: Record<string, string>;
  busyKey: string | null;
  dispatchModeEnabled: boolean;
  hostRedisFailed: boolean;
  gatewayFailed: boolean;
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
};

export function LauncherControlPanel({
  currentRoleIsWorker,
  launcherExpanded,
  envExpanded,
  launcherStatus,
  launcherLogs,
  busyKey,
  dispatchModeEnabled,
  hostRedisFailed,
  gatewayFailed,
  onRefreshLauncherStatus,
  onToggleLauncherExpanded,
  onReadLauncherLog,
  onStopComponent,
  onToggleEnvExpanded,
  onInstallHostRedis,
  onToggleDispatchMode,
  onToggleNodeCache,
  onInstallNodeCacheRedis,
  onStartLauncherStack,
  onStopLauncherStack,
  launcherMachineRoleLabel,
  launcherManagedComponentsLabel,
  launcherLocalNodePolicyLabel,
  launcherEnvironmentLabel,
  launcherComponentName,
  launcherStateLabel,
  launcherBadgeTone,
}: LauncherControlPanelProps) {
  const visibleComponents = (launcherStatus?.components || []).filter(
    (component) => component.name !== "local-node" && !(currentRoleIsWorker && (component.name === "host-redis" || component.name === "gateway")),
  );

  const nodeCacheDisabled = launcherStatus?.profile.node_cache_policy === "disabled";

  return (
    <section className="surface surface-subsection">
      <div className="section-head">
        <div><div className="section-kicker">桌面启动器</div><h3>{currentRoleIsWorker ? "本机节点托管环境" : "单机一体化运行"}</h3></div>
        <div className="inline-actions">
          <button type="button" className="ghost-button" onClick={onRefreshLauncherStatus}>刷新</button>
          <button type="button" className="ghost-button" onClick={onToggleLauncherExpanded}>{launcherExpanded ? "收起" : "展开详情"}</button>
        </div>
      </div>

      <div className="launcher-component-rows">
        {visibleComponents.map((component) => (
          <LauncherComponentRow
            key={component.name}
            component={component}
            busyKey={busyKey}
            launcherBadgeTone={launcherBadgeTone}
            launcherComponentName={launcherComponentName}
            launcherStateLabel={launcherStateLabel}
            onReadLauncherLog={onReadLauncherLog}
            onStopComponent={onStopComponent}
          />
        ))}
      </div>

      {hostRedisFailed || gatewayFailed ? (
        <div className="topbar-notice dispatch-warning" style={{ marginTop: 12 }}>
          当前桌面启动器检测到主机 Redis 或主网关启动失败。下方“当前连接状态”会优先按这里的运行结果显示，请先查看对应日志并重新拉起。
        </div>
      ) : null}

      {Object.entries(launcherLogs).map(([name, content]) => content ? (
        <div key={name} className="launcher-log-block">
          <div className="launcher-log-label">{launcherComponentName(name)} 日志</div>
          <SnippetBlock label="" content={content} />
        </div>
      ) : null)}

      {launcherExpanded ? (
        <>
          <div className="info-stack" style={{ marginTop: 14 }}>
            <InfoRow label="机器角色" value={launcherMachineRoleLabel(launcherStatus)} />
            <InfoRow label="托管组件" value={launcherManagedComponentsLabel(launcherStatus)} multiline />
            <InfoRow label="存储库目录" value={launcherStatus?.layout.root || "尚未选择"} multiline />
            <InfoRow label="节点缓存策略" value={nodeCacheDisabled ? "关闭" : "已启用"} />
            <InfoRow label="本机节点策略" value={launcherLocalNodePolicyLabel(launcherStatus)} multiline />
            {!currentRoleIsWorker ? <InfoRow label="分发模式" value={dispatchModeEnabled ? "已开启（主机只分发）" : "已关闭（本机节点可处理）"} /> : null}
          </div>

          <div className="launcher-env-head" onClick={onToggleEnvExpanded}>
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
                <LauncherEnvironmentRow key={item.name} item={item} launcherEnvironmentLabel={launcherEnvironmentLabel} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="inline-actions quick-setup-actions" style={{ marginTop: 14 }}>
        {!currentRoleIsWorker ? <button type="button" onClick={onInstallHostRedis} disabled={busyKey !== null}>{busyKey === "launcher-install-host" ? "下载中..." : launcherStatus?.host_redis.installed ? "重装主机 Redis" : "安装主机 Redis"}</button> : null}
        {!currentRoleIsWorker ? <button type="button" className="ghost-button" onClick={onToggleDispatchMode} disabled={busyKey !== null}>{busyKey === "dispatch-mode-toggle" ? "切换中..." : dispatchModeEnabled ? "关闭分发模式" : "开启分发模式"}</button> : null}
        <button type="button" className="ghost-button" onClick={onToggleNodeCache} disabled={busyKey !== null}>{nodeCacheDisabled ? "启用节点缓存" : "关闭节点缓存"}</button>
        {!nodeCacheDisabled ? <button type="button" className="ghost-button" onClick={onInstallNodeCacheRedis} disabled={busyKey !== null}>{busyKey === "launcher-install-node-cache" ? "下载中..." : launcherStatus?.node_cache_redis.installed ? "重装节点缓存 Redis" : "安装节点缓存 Redis"}</button> : null}
        <button type="button" onClick={onStartLauncherStack} disabled={busyKey !== null}>{busyKey === "launcher-start" ? "启动中..." : currentRoleIsWorker ? "启动节点服务" : hostRedisFailed || gatewayFailed ? "重新拉起" : "一键启动"}</button>
        <button type="button" className="ghost-button" onClick={onStopLauncherStack} disabled={busyKey !== null}>{busyKey === "launcher-stop" ? "停止中..." : "停止全部"}</button>
      </div>
    </section>
  );
}

type LauncherComponentRowProps = {
  component: LauncherComponentStatus;
  busyKey: string | null;
  launcherComponentName: (name: string) => string;
  launcherStateLabel: (state: LauncherState) => string;
  launcherBadgeTone: (state: LauncherState) => "human" | "typing" | "queued" | "idle";
  onReadLauncherLog: (name: string) => void;
  onStopComponent: (name: string) => void;
};

function LauncherComponentRow({
  component,
  busyKey,
  launcherComponentName,
  launcherStateLabel,
  launcherBadgeTone,
  onReadLauncherLog,
  onStopComponent,
}: LauncherComponentRowProps) {
  return (
    <div className="launcher-row">
      <div className="launcher-row-left">
        <span className={`launcher-dot launcher-dot-${launcherBadgeTone(component.state)}`} />
        <span className="launcher-row-name">{launcherComponentName(component.name)}</span>
        <span className="launcher-row-detail">{component.detail || "等待启动"}</span>
      </div>
      <div className="launcher-row-right">
        <span className={`session-badge session-badge-${launcherBadgeTone(component.state)}`}>{launcherStateLabel(component.state)}</span>
        <button type="button" className="ghost-button launcher-row-btn" onClick={() => onReadLauncherLog(component.name)}>日志</button>
        {component.name !== "launcher" && component.name !== "console" ? (
          <button type="button" className="ghost-button launcher-row-btn" onClick={() => onStopComponent(component.name)} disabled={busyKey !== null}>停止</button>
        ) : null}
      </div>
    </div>
  );
}

function LauncherEnvironmentRow({
  item,
  launcherEnvironmentLabel,
}: {
  item: LauncherEnvironmentCheck;
  launcherEnvironmentLabel: (name: string) => string;
}) {
  return <InfoRow label={launcherEnvironmentLabel(item.name)} value={`${item.ready ? "已就绪" : "缺失"} · ${item.detail}`} multiline />;
}
