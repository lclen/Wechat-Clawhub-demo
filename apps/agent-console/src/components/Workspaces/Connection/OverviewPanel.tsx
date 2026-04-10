import type { ConnectionHeroCardData, ConnectionPrepItem, ConnectionSignalCardData } from "../../../types";
import { ConnectionHeroCard, ConnectionSignalCard, InfoRow, PrepStrip } from "./ConnectionUi";
import { CommandBar, SectionHeader, SignalBadge, SurfaceCard } from "../../shared/ConsolePrimitives";

type OverviewPanelProps = {
  heroCards: ConnectionHeroCardData[];
  prepItems: ConnectionPrepItem[];
  signalCards: ConnectionSignalCardData[];
  canManageGateway: boolean;
  consoleTarget: string;
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
  consoleTarget,
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
  return (
    <div className="connection-panel-stack">
      <SurfaceCard className="connection-overview-panel connection-command-hero" tone="accent">
        <div className="connection-overview-banner command-hero-banner">
          <div className="connection-overview-banner-copy">
            <SectionHeader
              kicker="服务概览与状态"
              title="先判断健康度，再进入配置与联调"
              description="首屏只保留当前运行事实、接入结果和下一步动作，不让大表单与调试日志打断判断。"
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
            description="把需要频繁判断的联调事实收在同一块，不必反复扫完整页。"
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

        <SurfaceCard className="command-surface" tone="strong">
          <SectionHeader
            kicker="运行摘要"
            title="核心组件"
            description="把网关、微信、Redis、调度与通道池信号汇总到统一面板。"
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
          <div className="connection-signal-grid connection-signal-grid-command">
            {signalCards.map((card) => (
              <ConnectionSignalCard key={card.label} {...card} />
            ))}
          </div>
          <div className="connection-signal-note command-target-note">
            <span>当前控制台目标</span>
            <strong>{consoleTarget}</strong>
          </div>
          {modelCheckText ? (
            <div className="info-stack connection-inline-info">
              <InfoRow label="模型检测" value={modelCheckText} />
            </div>
          ) : null}
          {lastError ? (
            <div className="info-stack connection-inline-info">
              <InfoRow label="最近错误" value={lastError} multiline />
            </div>
          ) : null}
          {dispatchWarning ? <div className="topbar-notice dispatch-warning">{dispatchWarning}</div> : null}
        </SurfaceCard>
      </div>
    </div>
  );
}
