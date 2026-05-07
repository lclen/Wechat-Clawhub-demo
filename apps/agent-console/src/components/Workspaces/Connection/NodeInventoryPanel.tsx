import type { NodeKind } from "../../../types";
import { InfoRow, SnippetBlock } from "./ConnectionUi";
import { EmptyState, SectionHeader, SignalBadge, SurfaceCard } from "../../shared/ConsolePrimitives";

type InventoryAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type InventoryCardView = {
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
  actions: InventoryAction[];
};

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

type NodeInventoryPanelProps = {
  headline: string;
  cards: InventoryCardView[];
  selectedDiagnostics: SelectedDiagnosticsView | null;
  layout?: "compact" | "stacked";
};

export function NodeInventoryPanel({ headline, cards, selectedDiagnostics, layout = "compact" }: NodeInventoryPanelProps) {
  return (
    <div className="connection-panel-stack">
      <SurfaceCard className="inventory-command-surface">
        <SectionHeader
          kicker="节点清单"
          title="已接入节点总览"
          description="统一查看本机内置节点与远端工作节点，优先突出在线状态、空闲通道和角色来源。"
          actions={<SignalBadge tone="info">{headline}</SignalBadge>}
        />
        {!cards.length ? (
          <EmptyState title="当前还没有已接入节点" detail="本机内置节点和远端工作节点会在这里统一显示，但会明确区分角色来源。" />
        ) : (
          <div className={`connection-node-grid ${layout === "stacked" ? "connection-node-grid-stacked" : "connection-node-grid-compact"}`}>
            {cards.map((card) => (
              <article key={card.nodeId} className={`connection-node-card ${card.selected ? "connection-node-card-active" : ""}`}>
                <div className="connection-node-card-top">
                  <div className="connection-node-card-head">
                    <div className="connection-node-card-title-row">
                      <div className="node-card-title">{card.title}</div>
                      <span className={`node-kind-tag node-kind-tag-${card.kind}`}>{card.kind === "local" ? "网关内置" : "远端工作节点"}</span>
                      {card.authFailed ? <span className="auth-failed-badge" title="节点 token 不匹配，请重新配对或重置凭据">鉴权失败</span> : null}
                    </div>
                    <div className="node-card-subtitle">{card.subtitle}</div>
                  </div>
                  <span className={`session-badge session-badge-${card.badgeTone}`}>{card.badge}</span>
                </div>
                <div className="connection-node-address">{card.address}</div>
                <div className="connection-node-detail">{card.detail}</div>
                <div className="connection-node-detail" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ opacity: 0.65 }}>链路</span>
                  <span className={`session-badge session-badge-${card.taskStreamTone}`}>{card.taskStreamLabel}</span>
                  <span>{card.taskStreamDetail}</span>
                </div>
                <div className="connection-node-channel-band">
                  <div className="connection-node-channel-band-top">
                    <div>
                      <span className="connection-node-channel-label">空闲通道</span>
                      <strong>{card.channelIdle}</strong>
                    </div>
                    <span className={`connection-node-channel-pill connection-node-channel-pill-${card.channelPressureTone}`}>
                      {card.channelPressureLabel}
                    </span>
                  </div>
                  <div className="connection-node-channel-meter" aria-hidden="true">
                    <div className="connection-node-channel-meter-fill" style={{ width: `${card.channelUsagePercent}%` }} />
                  </div>
                  <div className="connection-node-channel-meta">
                    <span>占用 {card.channelBusy}</span>
                    <span>总量 {card.channelCapacity}</span>
                    <span>使用率 {card.channelUsagePercent}% </span>
                  </div>
                </div>
                <div className="connection-node-stats">
                  <div className="connection-node-stat">
                    <span>平台</span>
                    <strong>{card.platform}</strong>
                  </div>
                  <div className="connection-node-stat">
                    <span>版本</span>
                    <strong>{card.version}</strong>
                  </div>
                  <div className="connection-node-stat">
                    <span>并发</span>
                    <strong>{card.concurrency}</strong>
                  </div>
                  <div className="connection-node-stat">
                    <span>通道</span>
                    <strong>{card.channels}</strong>
                  </div>
                </div>
                <div className="connection-node-card-actions">
                  {card.actions.map((action) => (
                    <button key={action.label} type="button" className="ghost-button launcher-row-btn" onClick={action.onClick} disabled={action.disabled}>
                      {action.label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </SurfaceCard>

      {selectedDiagnostics ? (
        <SurfaceCard className="inventory-diagnostics-surface" tone="strong">
          <SectionHeader
            kicker="节点诊断"
            title={selectedDiagnostics.nodeId}
            actions={
              <div className="inline-actions">
                {selectedDiagnostics.kind ? (
                  <span className={`node-kind-tag node-kind-tag-${selectedDiagnostics.kind}`}>
                    {selectedDiagnostics.kind === "local" ? "网关内置" : "远端工作节点"}
                  </span>
                ) : null}
                {selectedDiagnostics.traceId ? <span className="small-note connection-trace-note">trace: {selectedDiagnostics.traceId.slice(0, 16)}…</span> : null}
                <button type="button" className="ghost-button launcher-row-btn" onClick={selectedDiagnostics.onClose}>
                  关闭
                </button>
              </div>
            }
          />
          <div className="info-stack">
            {selectedDiagnostics.rows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} multiline={row.multiline} />
            ))}
          </div>
          {selectedDiagnostics.timelineText ? <SnippetBlock label="诊断时间线" content={selectedDiagnostics.timelineText} /> : null}
        </SurfaceCard>
      ) : null}
    </div>
  );
}
