import { InfoRow, PrepStrip, SnippetBlock } from "../Connection/ConnectionUi";

type StatusRow = {
  title: string;
  value: string;
  detail: string;
  tone: "good" | "warn";
};

type QuickSetupStatusPanelProps = {
  busyKey: string | null;
  reconfigureConfirmOpen: boolean;
  currentRoleDisplay: string;
  currentRoleIsWorker: boolean;
  workerGatewayBaseUrl: string;
  workerGatewayConnectionLabel: string;
  workerInstallDir: string;
  latestSetupSummary: string;
  wechatBaseUrl: string;
  consoleGatewayBaseUrl: string;
  gatewayRuntimeText: string;
  nodeSummaryText: string;
  pairingKeyFilled: boolean;
  envExpanded: boolean;
  statusRows: StatusRow[];
  workerCredentialRows: Array<{ label: string; value: string }>;
  reconfigureWarnings: string[];
  wechatRunning: boolean;
  onRefreshStatus: () => void;
  onToggleReconfigureConfirm: () => void;
  onToggleCredentialExpanded: () => void;
  onConfirmReconfigure: () => void;
  onCancelReconfigure: () => void;
};

export function QuickSetupStatusPanel({
  busyKey,
  reconfigureConfirmOpen,
  currentRoleDisplay,
  currentRoleIsWorker,
  workerGatewayBaseUrl,
  workerGatewayConnectionLabel,
  workerInstallDir,
  latestSetupSummary,
  wechatBaseUrl,
  consoleGatewayBaseUrl,
  gatewayRuntimeText,
  nodeSummaryText,
  pairingKeyFilled,
  envExpanded,
  statusRows,
  workerCredentialRows,
  reconfigureWarnings,
  wechatRunning,
  onRefreshStatus,
  onToggleReconfigureConfirm,
  onToggleCredentialExpanded,
  onConfirmReconfigure,
  onCancelReconfigure,
}: QuickSetupStatusPanelProps) {
  const healthyCount = statusRows.filter((item) => item.tone === "good").length;
  const warnCount = statusRows.length - healthyCount;

  return (
    <section className="surface quick-setup-status-command">
      <div className="section-head">
        <div><div className="section-kicker">当前连接状态</div><h3>先确认当前主机和连接状态</h3></div>
        <div className="inline-actions">
          <button type="button" className="ghost-button" onClick={onRefreshStatus} disabled={busyKey !== null}>{busyKey === "reconfigure-disconnect-wechat" ? "处理中..." : "刷新状态"}</button>
          <button type="button" onClick={onToggleReconfigureConfirm} disabled={busyKey !== null}>{reconfigureConfirmOpen ? "收起确认" : "重新配置"}</button>
        </div>
      </div>
      <div className="quick-setup-status-overview">
        <div>
          <span>健康度</span>
          <strong>{healthyCount}/{statusRows.length || 0}</strong>
        </div>
        <p>{warnCount > 0 ? `${warnCount} 项仍需要确认，建议先处理黄色状态后再继续。` : "关键连接与配置状态正常，可以继续下一步。"}</p>
      </div>
      <div className="status-grid">
        {statusRows.map((item) => (
          <PrepStrip key={item.title} label={item.title} detail={`${item.value} · ${item.detail}`} tone={item.tone} />
        ))}
      </div>
      <div className="info-stack">
        <InfoRow label="当前角色" value={currentRoleDisplay} multiline />
        {currentRoleIsWorker ? (
          <>
            <InfoRow label="目标网关" value={workerGatewayBaseUrl || "-"} multiline />
            <InfoRow label="连接状态" value={workerGatewayConnectionLabel} multiline />
            <InfoRow label="安装目录" value={workerInstallDir || "-"} multiline />
            <InfoRow label="最近任务" value={latestSetupSummary} multiline />
          </>
        ) : (
          <>
            <InfoRow label="微信 Base URL" value={wechatBaseUrl || "-"} multiline />
            <InfoRow label="控制台目标网关" value={consoleGatewayBaseUrl || "-"} multiline />
            <InfoRow label="网关运行状态" value={gatewayRuntimeText} multiline />
            <InfoRow label="节点" value={nodeSummaryText} multiline />
          </>
        )}
      </div>
      <div className="launcher-env-head" onClick={onToggleCredentialExpanded} style={{ marginTop: 14 }}>
        <span className="section-kicker">节点凭据</span>
        <span className="launcher-env-status good" style={{ marginLeft: 8 }}>
          {pairingKeyFilled ? "密钥已填写" : "待填写"}
        </span>
        <span className="launcher-env-toggle">{envExpanded ? "▲" : "▼"}</span>
      </div>
      {envExpanded ? (
        <div className="info-stack" style={{ marginTop: 8 }}>
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
            <SnippetBlock label="支持直接断开的连接" content={wechatRunning ? "微信连接：继续后将先调用断开接口，再进入角色选择。" : "当前没有处于运行中的微信连接。"} />
          </div>
          <div className="inline-actions quick-setup-actions">
            <button type="button" onClick={onConfirmReconfigure} disabled={busyKey !== null}>{busyKey === "reconfigure-disconnect-wechat" ? "断开中..." : wechatRunning ? "断开微信并继续" : "确认并继续"}</button>
            <button type="button" className="ghost-button" onClick={onCancelReconfigure} disabled={busyKey !== null}>取消</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
