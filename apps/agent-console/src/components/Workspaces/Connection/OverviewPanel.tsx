import { useState } from "react";
import type {
  ConnectionHeroCardData,
  ConnectionPrepItem,
  ConnectionSignalCardData,
  LocalNodeStatusResponse,
} from "../../../types";
import { PrepStrip } from "./ConnectionUi";
import {
  CommandBar,
  InfoList,
  MetricCard,
  SectionHeader,
  SignalBadge,
  SurfaceCard,
} from "../../shared/ConsolePrimitives";

const MAX_CHANNEL_ASSESSMENT_ROUNDS = 999;

type OverviewPanelProps = {
  heroCards: ConnectionHeroCardData[];
  prepItems: ConnectionPrepItem[];
  signalCards: ConnectionSignalCardData[];
  canManageGateway: boolean;
  modelCheckText?: string | null;
  lastError?: string | null;
  dispatchWarning?: string | null;
  localNodeStatus: LocalNodeStatusResponse | null;
  assessmentMaxRounds: number;
  assessmentApplyStrategy: "balanced" | "peak";
  onRunModelCheck: () => void;
  onToggleDispatch: () => void;
  onRefreshAllStatus: () => void;
  onRefreshChannelAssessment: () => void;
  onAssessmentMaxRoundsChange: (value: number) => void;
  onAssessmentApplyStrategyChange: (value: "balanced" | "peak") => void;
  onStartLocalNodeService: () => void;
  onStopLocalNodeService: () => void;
  onStartChannelAssessment: () => void;
  onApplyChannelAssessment: () => void;
  startLocalNodeLabel: string;
  stopLocalNodeLabel: string;
  applyChannelAssessmentLabel: string;
  runModelCheckLabel: string;
  toggleDispatchLabel: string;
  refreshAllLabel: string;
  busy: boolean;
  assessmentBusy: boolean;
};

export function OverviewPanel({
  heroCards: _heroCards, // Taken out to top level in workspace
  prepItems,
  signalCards,
  canManageGateway,
  modelCheckText,
  lastError,
  dispatchWarning,
  localNodeStatus,
  assessmentMaxRounds,
  assessmentApplyStrategy,
  onRunModelCheck,
  onToggleDispatch,
  onRefreshAllStatus,
  onRefreshChannelAssessment,
  onAssessmentMaxRoundsChange,
  onAssessmentApplyStrategyChange,
  onStartLocalNodeService,
  onStopLocalNodeService,
  onStartChannelAssessment,
  onApplyChannelAssessment,
  startLocalNodeLabel,
  stopLocalNodeLabel,
  applyChannelAssessmentLabel,
  runModelCheckLabel,
  toggleDispatchLabel,
  refreshAllLabel,
  busy,
  assessmentBusy,
}: OverviewPanelProps) {
  const [roundsExpanded, setRoundsExpanded] = useState(false);

  const supplementalItems = [
    modelCheckText ? { label: "模型检测", value: modelCheckText, multiline: true } : null,
    lastError ? { label: "最近错误", value: lastError, multiline: true } : null,
  ].filter((item): item is { label: string; value: string; multiline: boolean } => Boolean(item));

  const assessment = localNodeStatus?.channel_assessment;
  const assessmentStatus = assessment?.status || "idle";
  const localNodeRunning = localNodeStatus?.state === "running";
  const localNodeControlLabel = localNodeRunning ? "运行中" : "已停止";
  const localNodeControlDetail = localNodeRunning
    ? "评估前建议先停止节点。"
    : "节点已空闲，可开始评估。";

  const configuredMaxRounds = Math.max(
    1,
    Math.min(MAX_CHANNEL_ASSESSMENT_ROUNDS, Number(assessmentMaxRounds) || 1)
  );
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
  const assessmentStartHint = assessment?.start_blocking_reason || "";
  const latestFailureRound = assessment?.rounds
    ? [...assessment.rounds].reverse().find((round) => !round.stable) ?? null
    : null;

  const appliedPlanLabel = assessmentApplyStrategy === "balanced" ? "平衡方案" : "最高建议";
  const appliedPlanValue =
    assessmentApplyStrategy === "balanced" && balancedRecommendationAvailable
      ? `${assessment?.balanced_channel_capacity} / ${assessment?.balanced_max_concurrency}`
      : canApplyRecommendation
      ? `${assessment?.recommended_channel_capacity} / ${assessment?.recommended_max_concurrency}`
      : "待评估";

  const roundsCount = assessment?.rounds?.length ?? 0;
  const assessmentInfoItems = [
    assessmentStartHint ? { label: "提示", value: assessmentStartHint, multiline: true } : null,
    assessment?.summary ? { label: "摘要", value: assessment.summary, multiline: true } : null,
    assessment?.blocking_reason ? { label: "限制", value: assessment.blocking_reason, multiline: true } : null,
    appliedPlanValue !== "待评估" ? { label: "建议", value: appliedPlanValue, multiline: true } : null,
  ].filter((item): item is { label: string; value: string; multiline: true } => Boolean(item));

  const recentRounds = roundsExpanded
    ? assessment?.rounds ?? []
    : assessment?.rounds?.slice(-2) ?? [];

  return (
    <div className="connection-panel-stack connection-sidebar-stack" style={{ gap: 16 }}>
      {/* 1. 接入准备度 (紧凑版) */}
      <SurfaceCard className="surface-tight command-surface">
        <SectionHeader
          kicker="流程核对"
          title="接入准备度"
          actions={
            canManageGateway ? (
              <div className="inline-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={onRefreshAllStatus}
                  disabled={busy}
                  style={{ height: 28, fontSize: 12 }}
                >
                  {refreshAllLabel}
                </button>
              </div>
            ) : null
          }
        />
        <div className="prep-strip-list" style={{ marginTop: 12 }}>
          {prepItems.map((item) => (
            <PrepStrip key={item.label} {...item} />
          ))}
        </div>
        {canManageGateway && (
          <button
            type="button"
            className="ghost-button"
            onClick={onRunModelCheck}
            disabled={busy}
            style={{ width: "100%", marginTop: 12, borderStyle: "dashed" }}
          >
            {runModelCheckLabel}
          </button>
        )}
      </SurfaceCard>

      {/* 2. 主控制面 */}
      <SurfaceCard className="command-surface connection-ops-surface" tone="strong">
        <SectionHeader kicker="控制面" title="网关调度动作" />
        <div className="connection-ops-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          {signalCards.map((card) => (
            <MetricCard
              key={card.label}
              label={card.label}
              value={card.value}
              tone={card.tone === "good" ? "healthy" : "warning"}
              style={{ padding: "12px 16px" }}
            />
          ))}
        </div>
        <CommandBar
          detail={canManageGateway ? "切换分发模式前请确认节点就绪。" : "只读观察模式。"}
          style={{ marginTop: 16 }}
        >
          {canManageGateway ? (
            <button
              type="button"
              className="ghost-button"
              onClick={onToggleDispatch}
              disabled={busy}
              style={{ width: "100%" }}
            >
              {toggleDispatchLabel}
            </button>
          ) : (
            <SignalBadge tone="neutral">只读</SignalBadge>
          )}
        </CommandBar>
        {supplementalItems.length ? (
          <InfoList items={supplementalItems} style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }} />
        ) : null}
      </SurfaceCard>

      {/* 3. 通道评估 (核心紧凑版) */}
      <SurfaceCard className="command-surface connection-assessment-surface">
        <SectionHeader
          kicker="压测工具"
          title="通道容量建议"
          actions={
            <button
              type="button"
              className="ghost-button"
              onClick={onRefreshChannelAssessment}
              disabled={busy || !canManageGateway}
              style={{ height: 26, fontSize: 11 }}
            >
              刷新
            </button>
          }
        />

        <div className="connection-assessment-sidebar-shell" style={{ marginTop: 12 }}>
          <div
            style={{
              backgroundColor: "rgba(0,0,0,0.03)",
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--line)"
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
                {formatAssessmentStatus(assessmentStatus)}
              </SignalBadge>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
              {assessmentStatus === "running" ? assessment?.stage : assessmentStartHint || "待执行压测"}
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
              value={canApplyRecommendation ? `${assessment?.recommended_channel_capacity}/${assessment?.recommended_max_concurrency}` : "-"}
              tone="healthy"
            />
            <MetricCard
              label="平衡方案"
              value={balancedRecommendationAvailable ? `${assessment?.balanced_channel_capacity}/${assessment?.balanced_max_concurrency}` : "-"}
              tone="accent"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <MetricCard
              label="最近执行"
              value={latestAssessmentTime ? formatAssessmentTimestamp(latestAssessmentTime) : "-"}
              tone="accent"
            />
            <MetricCard
              label="当前摘要"
              value={assessment?.summary || assessmentStartHint || "-"}
              tone="warning"
            />
          </div>

          <div className="assessment-controls" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="ghost-button"
                onClick={onStartLocalNodeService}
                disabled={busy || assessmentBusy || !canManageGateway || localNodeRunning}
                style={{ flex: 1 }}
              >
                启动
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={onStopLocalNodeService}
                disabled={busy || assessmentBusy || !canManageGateway || !localNodeRunning}
                style={{ flex: 1 }}
              >
                停止
              </button>
            </div>
            <button
              type="button"
              onClick={onStartChannelAssessment}
              disabled={busy || assessmentBusy || !canManageGateway || !canStartAssessment}
              style={{ width: "100%" }}
            >
              {assessmentStatus === "running" ? "正在评估..." : "开始压力测试"}
            </button>
          </div>

          {canApplyRecommendation && (
            <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <select
                value={assessmentApplyStrategy}
                onChange={(event) => onAssessmentApplyStrategyChange(event.target.value as "balanced" | "peak")}
                disabled={busy || assessmentBusy || !canManageGateway}
                style={{ width: "100%", marginBottom: 8 }}
              >
                <option value="balanced">方案：均衡稳定</option>
                <option value="peak">方案：极限容量</option>
              </select>
              <button
                type="button"
                className="connection-assessment-apply"
                onClick={onApplyChannelAssessment}
                disabled={busy || assessmentBusy || !canManageGateway}
                style={{ width: "100%" }}
              >
                {applyChannelAssessmentLabel}
              </button>
            </div>
          )}

          {recentRounds.length ? (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span className="section-kicker">压测详情</span>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ height: 20, fontSize: 10, padding: "0 6px" }}
                  onClick={() => setRoundsExpanded(!roundsExpanded)}
                >
                  {roundsExpanded ? "收起" : `展开全部 (${roundsCount})`}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recentRounds.map((round) => {
                  const appearance = getAssessmentRoundAppearance(round);
                  return (
                    <div
                      key={`round-${round.round_index}`}
                      style={{
                        padding: "8px 12px",
                        backgroundColor: "rgba(0,0,0,0.02)",
                        borderRadius: 6,
                        border: "1px solid var(--line)",
                        fontSize: 12
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
                        <span style={{ opacity: 0.5 }}>{round.summary}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </SurfaceCard>
    </div>
  );
}

function formatAssessmentStatus(status: string) {
  return status === "running" ? "进行中" : status === "completed" ? "已完成" : "未开始";
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
