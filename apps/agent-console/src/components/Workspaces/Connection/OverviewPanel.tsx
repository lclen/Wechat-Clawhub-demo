import type { ConnectionSignalCardData } from "../../../types";
import {
  CommandBar,
  InfoList,
  MetricCard,
  SectionHeader,
  SignalBadge,
  SurfaceCard,
} from "../../shared/ConsolePrimitives";

type OverviewPanelProps = {
  signalCards: ConnectionSignalCardData[];
  canManageGateway: boolean;
  localConsoleHint?: {
    label: string;
    detail: string;
    onFocus: () => void;
  } | null;
  connectivityCheckText?: string | null;
  lastError?: string | null;
  dispatchWarning?: string | null;
  onRunConnectivityCheck: () => void;
  onToggleDispatch: () => void;
  onRefreshAllStatus: () => void;
  runConnectivityCheckLabel: string;
  toggleDispatchLabel: string;
  refreshAllLabel: string;
  busy: boolean;
};

export function OverviewPanel({
  signalCards,
  canManageGateway,
  localConsoleHint,
  connectivityCheckText,
  lastError,
  dispatchWarning,
  onRunConnectivityCheck,
  onToggleDispatch,
  onRefreshAllStatus,
  runConnectivityCheckLabel,
  toggleDispatchLabel,
  refreshAllLabel,
  busy,
}: OverviewPanelProps) {
  const supplementalItems = [
    connectivityCheckText ? { label: "完整检测", value: connectivityCheckText, multiline: true } : null,
    dispatchWarning ? { label: "分发提醒", value: dispatchWarning, multiline: true } : null,
    lastError ? { label: "最近错误", value: lastError, multiline: true } : null,
  ].filter((item): item is { label: string; value: string; multiline: boolean } => Boolean(item));

  return (
    <SurfaceCard className="command-surface connection-runtime-panel" tone="strong">
      <SectionHeader
        kicker="Gateway Runtime"
        title="主网关运行态"
        description="只保留接入前置条件、完整检测和分发开关，避免和顶部状态区重复铺陈。"
        actions={
          canManageGateway ? (
            <div className="inline-actions">
              <button type="button" className="ghost-button" onClick={onRefreshAllStatus} disabled={busy}>
                {refreshAllLabel}
              </button>
              <button type="button" onClick={onRunConnectivityCheck} disabled={busy}>
                {runConnectivityCheckLabel}
              </button>
            </div>
          ) : (
            <SignalBadge tone="neutral">只读</SignalBadge>
          )
        }
      />

      <div className="connection-runtime-grid">
        {signalCards.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            tone={card.tone === "good" ? "healthy" : "warning"}
          />
        ))}
      </div>

      <CommandBar
        label="分发策略"
        detail={canManageGateway ? "切换前请确认远端节点已就绪；本机处理适合单机部署。" : "当前为只读观察模式。"}
        className="connection-runtime-command"
      >
        {canManageGateway ? (
          <button type="button" className="ghost-button" onClick={onToggleDispatch} disabled={busy}>
            {toggleDispatchLabel}
          </button>
        ) : (
          <SignalBadge tone="neutral">不可操作</SignalBadge>
        )}
      </CommandBar>

      {localConsoleHint ? (
        <CommandBar
          label={localConsoleHint.label}
          detail={localConsoleHint.detail}
          className="connection-runtime-command"
        >
          <button type="button" className="ghost-button" onClick={localConsoleHint.onFocus}>
            定位到节点控制台
          </button>
        </CommandBar>
      ) : null}

      {supplementalItems.length ? (
        <InfoList items={supplementalItems} className="connection-runtime-info" />
      ) : null}
    </SurfaceCard>
  );
}
