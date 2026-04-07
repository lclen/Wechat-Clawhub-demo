import type { ConnectionHeroCardData, ConnectionPrepItem, ConnectionSignalCardData } from "../../../types";
import { ConnectionHeroCard, ConnectionSignalCard, InfoRow, PrepStrip } from "./ConnectionUi";

type OverviewPanelProps = {
  heroCards: ConnectionHeroCardData[];
  prepItems: ConnectionPrepItem[];
  signalCards: ConnectionSignalCardData[];
  consoleTarget: string;
  modelCheckText?: string | null;
  lastError?: string | null;
  dispatchWarning?: string | null;
  onRunModelCheck: () => void;
  onToggleDispatch: () => void;
  runModelCheckLabel: string;
  toggleDispatchLabel: string;
  busy: boolean;
};

export function OverviewPanel({
  heroCards,
  prepItems,
  signalCards,
  consoleTarget,
  modelCheckText,
  lastError,
  dispatchWarning,
  onRunModelCheck,
  onToggleDispatch,
  runModelCheckLabel,
  toggleDispatchLabel,
  busy,
}: OverviewPanelProps) {
  return (
    <div className="connection-panel-stack">
      <section className="surface connection-overview-panel">
        <div className="connection-overview-banner">
          <div className="connection-overview-banner-copy">
            <div className="section-kicker">服务概览与状态</div>
            <h3>先判断健康度，再进入配置与联调</h3>
            <p className="connection-overview-summary">
              首屏只保留当前运行事实、接入结果和下一步操作，不让大表单与调试日志打断判断。
            </p>
          </div>
          <div className="connection-overview-chip-row">
            <span className="connection-overview-chip">先看状态</span>
            <span className="connection-overview-chip">再改配置</span>
            <span className="connection-overview-chip">日志默认收起</span>
          </div>
        </div>
        <div className="connection-hero-grid">
          {heroCards.map((card) => (
            <ConnectionHeroCard key={`${card.eyebrow}-${card.title}`} {...card} />
          ))}
        </div>
      </section>

      <div className="connection-overview-secondary">
        <section className="surface surface-tight">
          <div className="section-head compact-head">
            <div>
              <div className="section-kicker">准备流程</div>
              <h3>接入状态</h3>
            </div>
            <button type="button" onClick={onRunModelCheck} disabled={busy}>
              {runModelCheckLabel}
            </button>
          </div>
          <div className="prep-strip-list">
            {prepItems.map((item) => (
              <PrepStrip key={item.label} {...item} />
            ))}
          </div>
        </section>

        <section className="surface">
          <div className="section-head compact-head">
            <div>
              <div className="section-kicker">运行摘要</div>
              <h3>核心组件</h3>
            </div>
            <button type="button" className="ghost-button" onClick={onToggleDispatch} disabled={busy}>
              {toggleDispatchLabel}
            </button>
          </div>
          <div className="connection-signal-grid">
            {signalCards.map((card) => (
              <ConnectionSignalCard key={card.label} {...card} />
            ))}
          </div>
          <div className="connection-signal-note">当前控制台目标：{consoleTarget}</div>
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
        </section>
      </div>
    </div>
  );
}
