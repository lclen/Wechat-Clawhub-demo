import { useState } from "react";
import type { LocalNodeStatusResponse } from "../../../types";
import {
  MetricCard,
  SectionHeader,
  SignalBadge,
  SurfaceCard,
} from "../../shared/ConsolePrimitives";

const MAX_CHANNEL_ASSESSMENT_ROUNDS = 999;

type ChannelAssessmentCardProps = {
  localNodeStatus: LocalNodeStatusResponse | null;
  assessmentMaxRounds: number;
  assessmentApplyStrategy: "balanced" | "peak";
  busy: boolean;
  assessmentBusy: boolean;
  canManage: boolean;
  onRefresh: () => void;
  onAssessmentMaxRoundsChange: (value: number) => void;
  onAssessmentApplyStrategyChange: (value: "balanced" | "peak") => void;
  onStartAssessment: () => void;
  onApplyAssessment: () => void;
  applyAssessmentLabel: string;
  serviceControls?: {
    localNodeRunning: boolean;
    onStartNode: () => void;
    onStopNode: () => void;
    startDisabled: boolean;
    stopDisabled: boolean;
  };
};

export function ChannelAssessmentCard({
  localNodeStatus,
  assessmentMaxRounds,
  assessmentApplyStrategy,
  busy,
  assessmentBusy,
  canManage,
  onRefresh,
  onAssessmentMaxRoundsChange,
  onAssessmentApplyStrategyChange,
  onStartAssessment,
  onApplyAssessment,
  applyAssessmentLabel,
  serviceControls,
}: ChannelAssessmentCardProps) {
  const [roundsExpanded, setRoundsExpanded] = useState(false);
  const assessment = localNodeStatus?.channel_assessment;
  const taskStream = localNodeStatus?.task_stream;
  const assessmentStatus = assessment?.status || "idle";
  const configuredMaxRounds = Math.max(1, Math.min(MAX_CHANNEL_ASSESSMENT_ROUNDS, Number(assessmentMaxRounds) || 1));
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
  const assessmentFailureDetail =
    latestFailureRound?.first_error ||
    latestFailureRound?.failure_details?.[0] ||
    assessment?.last_error ||
    "";
  const recentRounds = roundsExpanded
    ? assessment?.rounds ?? []
    : assessment?.rounds?.slice(-2) ?? [];

  return (
    <SurfaceCard className="command-surface connection-assessment-surface">
      <SectionHeader
        kicker="压测工具"
        title="通道容量建议"
        description="先停用节点再压测，系统会根据稳定轮次给出通道和并发建议。"
        actions={
          <button
            type="button"
            className="ghost-button"
            onClick={onRefresh}
            disabled={busy}
          >
            刷新
          </button>
        }
      />

      <div className="channel-assessment-card">
        <div className={`channel-assessment-link ${taskStream?.upgrade_required ? "channel-assessment-link-warn" : taskStream?.connection_mode === "ws" ? "channel-assessment-link-good" : "channel-assessment-link-idle"}`}>
          <div>
            <span>链路健康</span>
            <strong>协议 {taskStream?.protocol_version || "未上报"}</strong>
          </div>
          <SignalBadge
            tone={
              taskStream?.upgrade_required
                ? "warn"
                : taskStream?.connection_mode === "ws"
                  ? "good"
                  : "info"
            }
          >
            {taskStream?.upgrade_required ? "需要升级" : taskStream?.connection_mode || "disconnected"}
          </SignalBadge>
          <p>
            {taskStream?.last_disconnect_at
              ? `最近断流 ${formatAssessmentTimestamp(taskStream.last_disconnect_at)} · code ${taskStream.last_disconnect_code ?? "-"}`
              : "最近没有记录到断流。"}
            <br />
            {`累计重连 ${taskStream?.reconnect_count ?? 0} 次 · fallback ${taskStream?.fallback_poll_count ?? 0} 次`}
          </p>
        </div>

        <div className={`channel-assessment-status channel-assessment-status-${assessmentStatus}`}>
          <div>
            <span>评估状态</span>
            <strong>{assessmentStatus === "running" ? assessment?.stage : assessmentStartHint || "待执行压测"}</strong>
          </div>
          <SignalBadge tone={assessmentStatus === "completed" ? "good" : assessmentStatus === "running" ? "info" : "neutral"}>
            {formatAssessmentStatus(assessmentStatus)}
          </SignalBadge>
          {assessmentStatus === "running" ? <i aria-hidden="true" /> : null}
        </div>

        <div className="channel-assessment-metrics">
          <MetricCard label="当前通道" value={String(assessment?.current_channel_capacity ?? "-")} tone="accent" />
          <MetricCard label="当前并发" value={String(assessment?.current_max_concurrency ?? "-")} tone="accent" />
          <MetricCard
            label="峰值建议"
            value={canApplyRecommendation ? `${assessment?.recommended_channel_capacity}/${assessment?.recommended_max_concurrency}` : "-"}
            tone="healthy"
          />
          <MetricCard
            label="稳定方案"
            value={balancedRecommendationAvailable ? `${assessment?.balanced_channel_capacity}/${assessment?.balanced_max_concurrency}` : "-"}
            detail="平均延迟 <= 5000ms"
            tone="accent"
          />
          <MetricCard
            label="最近执行"
            value={latestAssessmentTime ? formatAssessmentTimestamp(latestAssessmentTime) : "-"}
            tone="accent"
          />
          <MetricCard
            label="当前摘要"
            value={assessmentFailureDetail || assessment?.summary || assessmentStartHint || "-"}
            tone="warning"
          />
        </div>

        <label className="channel-assessment-rounds">
          <span>最大轮数</span>
          <input
            type="number"
            min={1}
            max={MAX_CHANNEL_ASSESSMENT_ROUNDS}
            step={1}
            value={configuredMaxRounds}
            onChange={(event) => onAssessmentMaxRoundsChange(Number(event.target.value) || 1)}
            disabled={busy || assessmentBusy || !canManage}
          />
          <small>支持 1 - {MAX_CHANNEL_ASSESSMENT_ROUNDS} 轮，达到失败、超时或延迟阈值时会提前停止。</small>
        </label>

        <div className="channel-assessment-actions">
          {serviceControls ? (
            <div className="channel-assessment-service-actions">
              <button type="button" className="ghost-button" onClick={serviceControls.onStartNode} disabled={serviceControls.startDisabled}>
                启动节点
              </button>
              <button type="button" className="ghost-button" onClick={serviceControls.onStopNode} disabled={serviceControls.stopDisabled}>
                停止节点
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onStartAssessment}
            disabled={busy || assessmentBusy || !canManage || !canStartAssessment}
          >
            {assessmentStatus === "running" ? "正在评估..." : "开始压力测试"}
          </button>
          {canApplyRecommendation ? (
            <div className="channel-assessment-apply-row">
              <select
                value={assessmentApplyStrategy}
                onChange={(event) => onAssessmentApplyStrategyChange(event.target.value as "balanced" | "peak")}
                disabled={busy || assessmentBusy || !canManage}
              >
                <option value="balanced">方案：优先选择平均延迟 &lt;= 5000ms 的最后稳定轮次</option>
                <option value="peak">方案：极限容量</option>
              </select>
              <button
                type="button"
                className="connection-assessment-apply"
                onClick={onApplyAssessment}
                disabled={busy || assessmentBusy || !canManage}
              >
                {applyAssessmentLabel}
              </button>
            </div>
          ) : null}
        </div>

        {recentRounds.length ? (
          <div className="channel-assessment-round-list">
            <div className="channel-assessment-round-head">
              <span className="section-kicker">压测详情</span>
              <button type="button" className="ghost-button" onClick={() => setRoundsExpanded(!roundsExpanded)}>
                {roundsExpanded ? "收起" : `展开全部 (${assessment?.rounds?.length ?? 0})`}
              </button>
            </div>
            {recentRounds.map((round) => {
              const appearance = getAssessmentRoundAppearance(round);
              return (
                <div key={`round-${round.round_index}`} className="channel-assessment-round">
                  <div>
                    <strong>第 {round.round_index} 轮</strong>
                    <span>{round.max_concurrency} 并发 / {round.channel_capacity} 通道</span>
                  </div>
                  <p>
                    <SignalBadge tone={appearance.tone}>{appearance.flagLabel}</SignalBadge>
                    <span>{round.summary}</span>
                  </p>
                  {round.first_error ? <small>{round.first_error}</small> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </SurfaceCard>
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
