import type { ConnectionHeroCardData, ConnectionPrepItem, ConnectionSignalCardData } from "../../../types";
import { ConnectionHeroCard, PrepStrip } from "./ConnectionUi";
import { CommandBar, InfoList, MetricCard, SectionHeader, SignalBadge, SurfaceCard } from "../../shared/ConsolePrimitives";

type OverviewPanelProps = {
  heroCards: ConnectionHeroCardData[];
  prepItems: ConnectionPrepItem[];
  signalCards: ConnectionSignalCardData[];
  canManageGateway: boolean;
  modelCheckText?: string | null;
  lastError?: string | null;
  dispatchWarning?: string | null;
  onRunModelCheck: () => void;
  onToggleDispatch: () => void;
  onRefreshAllStatus: () => void;
  runModelCheckLabel: string;
  toggleDispatchLabel: string;
  refreshAllLabel: string;
  busy: boolean;
};

export function OverviewPanel({
  heroCards,
  prepItems,
  signalCards,
  canManageGateway,
  modelCheckText,
  lastError,
  dispatchWarning,
  onRunModelCheck,
  onToggleDispatch,
  onRefreshAllStatus,
  runModelCheckLabel,
  toggleDispatchLabel,
  refreshAllLabel,
  busy,
}: OverviewPanelProps) {
  const supplementalItems = [
    modelCheckText ? { label: "模型检测", value: modelCheckText, multiline: true } : null,
    lastError ? { label: "最近错误", value: lastError, multiline: true } : null,
  ].filter((item): item is { label: string; value: string; multiline: boolean } => Boolean(item));

  return (
    <div className="connection-panel-stack">
      <SurfaceCard className="connection-overview-panel connection-command-hero" tone="accent">
        <div className="connection-overview-banner command-hero-banner">
          <div className="connection-overview-banner-copy">
            <SectionHeader
              kicker="服务概览与状态"
              title="先判断健康度，再进入配置与联调"
            />
          </div>
          <div className="connection-overview-chip-row command-hero-signals">
            <SignalBadge tone="info">运行态优先</SignalBadge>
            <SignalBadge tone="neutral">关键动作集中</SignalBadge>
            <SignalBadge tone="good">状态持续刷新</SignalBadge>
          </div>
        </div>
        <div className="connection-hero-grid connection-hero-grid-command">
          {heroCards.map((card) => (
            <ConnectionHeroCard key={`${card.eyebrow}-${card.title}`} {...card} />
          ))}
        </div>
      </SurfaceCard>

      <div className="connection-overview-secondary">
        <SurfaceCard className="surface-tight command-surface">
          <SectionHeader
            kicker="准备流程"
            title="接入状态"
            actions={
              canManageGateway ? (
                <div className="inline-actions">
                  <button type="button" className="ghost-button" onClick={onRefreshAllStatus} disabled={busy}>
                    {refreshAllLabel}
                  </button>
                  <button type="button" onClick={onRunModelCheck} disabled={busy}>
                    {runModelCheckLabel}
                  </button>
                </div>
              ) : null
            }
          />
          <div className="prep-strip-list prep-strip-list-command">
            {prepItems.map((item) => (
              <PrepStrip key={item.label} {...item} />
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard className="command-surface connection-ops-surface" tone="strong">
          <SectionHeader
            kicker="主命令与控制面"
            title="动作前判断"
          />
          <CommandBar
            label="主命令"
            detail={canManageGateway ? "切换分发模式前，先确认至少存在可用远端节点。" : "当前角色只读查看运行态，不执行接入或调度变更。"}
            className="command-bar-floating"
          >
            {canManageGateway ? (
              <button type="button" className="ghost-button" onClick={onToggleDispatch} disabled={busy}>
                {toggleDispatchLabel}
              </button>
            ) : (
              <SignalBadge tone="neutral">只读观察</SignalBadge>
            )}
          </CommandBar>
          <div className="connection-ops-grid">
            {signalCards.map((card) => (
              <MetricCard
                key={card.label}
                label={card.label}
                value={card.value}
                detail={card.meta}
                tone={card.tone === "good" ? "healthy" : "warning"}
                className="connection-ops-metric"
              />
            ))}
          </div>
          {supplementalItems.length ? <InfoList items={supplementalItems} className="connection-ops-info" /> : null}
          {dispatchWarning ? <div className="topbar-notice dispatch-warning">{dispatchWarning}</div> : null}
        </SurfaceCard>
      </div>
    </div>
  );
}
