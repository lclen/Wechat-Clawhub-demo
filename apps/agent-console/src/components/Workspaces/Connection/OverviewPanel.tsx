import type { ConnectionHeroCardData, ConnectionPrepItem, ConnectionSignalCardData, LocalNodeStatusResponse } from "../../../types";
import { ConnectionHeroCard, PrepStrip } from "./ConnectionUi";
import { CommandBar, InfoList, MetricCard, SectionHeader, SignalBadge, SurfaceCard } from "../../shared/ConsolePrimitives";

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
  heroCards,
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
  const supplementalItems = [
    modelCheckText ? { label: "模型检测", value: modelCheckText, multiline: true } : null,
    lastError ? { label: "最近错误", value: lastError, multiline: true } : null,
  ].filter((item): item is { label: string; value: string; multiline: boolean } => Boolean(item));
  const assessment = localNodeStatus?.channel_assessment;
  const assessmentStatus = assessment?.status || "idle";
  const localNodeRunning = localNodeStatus?.state === "running";
  const localNodeControlLabel = localNodeRunning ? "运行中" : "已停止";
  const localNodeControlDetail = localNodeRunning
    ? "评估前建议先停止本机节点，避免服务占用干扰压测。"
    : "节点已空闲，可直接开始评估，或先启动恢复日常处理。";
  const configuredMaxRounds = Math.max(1, Math.min(MAX_CHANNEL_ASSESSMENT_ROUNDS, Number(assessmentMaxRounds) || 1));
  const canStartAssessment = Boolean(assessment?.can_start ?? true) && assessmentStatus !== "running";
  const canApplyRecommendation = assessmentStatus === "completed"
    && assessment?.recommended_channel_capacity !== null
    && assessment?.recommended_max_concurrency !== null;
  const balancedRecommendationAvailable = assessmentStatus === "completed"
    && assessment?.balanced_channel_capacity !== null
    && assessment?.balanced_max_concurrency !== null;
  const latestAssessmentTime = assessment?.finished_at || assessment?.started_at || null;
  const assessmentStartHint = assessment?.start_blocking_reason || "";
  const latestFailureRound = assessment?.rounds ? [...assessment.rounds].reverse().find((round) => !round.stable) ?? null : null;
  const assessmentInfoItems = [
    assessmentStartHint ? { label: "开始条件", value: assessmentStartHint, multiline: true } : null,
    assessment?.summary ? { label: "结果摘要", value: assessment.summary, multiline: true } : null,
    assessment?.blocking_reason ? { label: "阻止原因", value: assessment.blocking_reason, multiline: true } : null,
    assessment && (assessment.active_session_count > 0 || assessment.active_task_count > 0)
      ? { label: "当前占用", value: `活跃会话 ${assessment.active_session_count}，活跃任务 ${assessment.active_task_count}`, multiline: true }
      : null,
    latestFailureRound ? { label: "失败拐点", value: latestFailureRound.summary, multiline: true } : null,
    assessment?.last_error ? { label: "最近错误", value: assessment.last_error, multiline: true } : null,
  ].filter((item): item is { label: string; value: string; multiline: true } => Boolean(item));
  const recentRounds = assessment?.rounds?.slice(-3) ?? [];

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

        <div className="connection-overview-command-stack">
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

          <SurfaceCard className="command-surface connection-assessment-surface">
            <SectionHeader
              kicker="通道评估"
              title="本机节点容量建议"
              description="停止本机节点后执行压测，完成后可一键应用建议的通道数和并发。"
              actions={
                <div className="connection-assessment-toolbar">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={onRefreshChannelAssessment}
                    disabled={busy || !canManageGateway}
                  >
                    刷新结果
                  </button>
                </div>
              }
            />
            <div className="connection-assessment-control-strip">
              <div className="connection-assessment-config-row">
                <label className="connection-assessment-config-field">
                  <span>最大评估轮数</span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_CHANNEL_ASSESSMENT_ROUNDS}
                    step={1}
                    value={configuredMaxRounds}
                    onChange={(event) => onAssessmentMaxRoundsChange(Math.max(1, Math.min(MAX_CHANNEL_ASSESSMENT_ROUNDS, Number(event.target.value) || 1)))}
                    disabled={busy || assessmentBusy}
                  />
                </label>
                <div className="connection-assessment-config-note"></div>
              </div>
              <CommandBar
                label={`本机节点：${localNodeControlLabel}`}
                detail={localNodeControlDetail}
                className="connection-assessment-control-bar"
              >
                <div className="connection-assessment-action-group">
                  <button
                    type="button"
                    className="connection-assessment-start-node"
                    onClick={onStartLocalNodeService}
                    disabled={busy || assessmentBusy || !canManageGateway || localNodeRunning}
                  >
                    {startLocalNodeLabel}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={onStopLocalNodeService}
                    disabled={busy || assessmentBusy || !canManageGateway || !localNodeRunning}
                  >
                    {stopLocalNodeLabel}
                  </button>
                  <button
                    type="button"
                    className="connection-assessment-run"
                    onClick={onStartChannelAssessment}
                    disabled={busy || assessmentBusy || !canManageGateway || !canStartAssessment}
                  >
                    {assessmentStatus === "running" ? "评估中..." : "开始评估"}
                  </button>
                </div>
              </CommandBar>
            </div>
            <div className="connection-assessment-grid">
              <MetricCard
                label="当前通道数"
                value={String(assessment?.current_channel_capacity ?? 0)}
                detail={`当前并发 ${assessment?.current_max_concurrency ?? 0} · 最多 ${configuredMaxRounds} 轮`}
                tone="default"
              />
              <MetricCard
                label="最近评估"
                value={latestAssessmentTime ? formatAssessmentTimestamp(latestAssessmentTime) : "未执行"}
                detail={`状态 ${formatAssessmentStatus(assessmentStatus)}`}
                tone={assessmentStatus === "completed" ? "healthy" : assessmentStatus === "blocked" || assessmentStatus === "failed" ? "warning" : "accent"}
              />
              <MetricCard
                label="最高建议"
                value={
                  canApplyRecommendation
                    ? `${assessment?.recommended_channel_capacity} / ${assessment?.recommended_max_concurrency}`
                    : "待评估"
                }
                detail="通道数 / 最大并发"
                tone={assessmentStatus === "completed" ? "healthy" : assessmentStatus === "blocked" || assessmentStatus === "failed" ? "warning" : "accent"}
              />
              <MetricCard
                label="平衡方案"
                value={
                  balancedRecommendationAvailable
                    ? `${assessment?.balanced_channel_capacity} / ${assessment?.balanced_max_concurrency}`
                    : "待评估"
                }
                detail="更偏体验的通道数 / 最大并发"
                tone={assessmentStatus === "completed" ? "default" : assessmentStatus === "blocked" || assessmentStatus === "failed" ? "warning" : "accent"}
              />
            </div>
            <CommandBar
              label={`评估状态：${formatAssessmentStatus(assessmentStatus)}`}
              detail={assessmentStatus === "running" ? (assessment?.stage || "评估进行中。") : assessmentStartHint || assessment?.stage || "尚未执行通道评估。"}
              className="connection-assessment-command"
            >
              <select
                value={assessmentApplyStrategy}
                onChange={(event) => onAssessmentApplyStrategyChange(event.target.value as "balanced" | "peak")}
                disabled={busy || assessmentBusy || !canManageGateway || !canApplyRecommendation}
              >
                <option value="balanced">应用平衡方案</option>
                <option value="peak">应用最高建议</option>
              </select>
              <SignalBadge tone={assessmentStatus === "completed" ? "good" : assessmentStatus === "running" ? "info" : assessmentStatus === "blocked" || assessmentStatus === "failed" ? "warn" : "neutral"}>
                {formatAssessmentRisk(assessment?.risk_level || "unknown")}
              </SignalBadge>
              <button
                type="button"
                className="connection-assessment-apply"
                onClick={onApplyChannelAssessment}
                disabled={busy || assessmentBusy || !canManageGateway || !canApplyRecommendation}
              >
                {applyChannelAssessmentLabel}
              </button>
            </CommandBar>
            {recentRounds.length ? (
              <div className="connection-assessment-rounds">
                {recentRounds.map((round) => {
                  const appearance = getAssessmentRoundAppearance(round);
                  return (
                    <MetricCard
                      key={`assessment-round-${round.round_index}`}
                      label={`第 ${round.round_index} 轮`}
                      value={`${round.max_concurrency} / ${round.channel_capacity}`}
                      detail={(
                        <div className="connection-assessment-round-detail">
                          <span className={`connection-assessment-round-flag ${appearance.flagClassName}`}>
                            {appearance.flagLabel}
                          </span>
                          <span>{round.summary}</span>
                        </div>
                      )}
                      tone={appearance.tone}
                      className={`connection-ops-metric connection-assessment-round-card ${appearance.cardClassName}`}
                    />
                  );
                })}
              </div>
            ) : null}
            {assessmentInfoItems.length ? <InfoList items={assessmentInfoItems} className="connection-ops-info" /> : null}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}

function formatAssessmentStatus(status: string) {
  return status === "running"
    ? "进行中"
    : status === "completed"
      ? "已完成"
      : status === "blocked"
        ? "已阻止"
        : status === "failed"
          ? "失败"
          : "未开始";
}

function formatAssessmentRisk(riskLevel: string) {
  return riskLevel === "low"
    ? "低风险"
    : riskLevel === "medium"
      ? "中风险"
      : riskLevel === "high"
        ? "高风险"
        : "待评估";
}

function formatAssessmentTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function getAssessmentRoundAppearance(
  round: NonNullable<LocalNodeStatusResponse["channel_assessment"]>["rounds"][number],
): {
  tone: "default" | "accent" | "healthy" | "warning";
  flagLabel: string;
  flagClassName: string;
  cardClassName: string;
} {
  if (round.stable) {
    return {
      tone: "healthy",
      flagLabel: "稳定通过",
      flagClassName: "is-stable",
      cardClassName: "is-stable",
    };
  }

  if (round.timeout_count > 0) {
    return {
      tone: "warning",
      flagLabel: "超时终止",
      flagClassName: "is-timeout",
      cardClassName: "is-timeout",
    };
  }

  if (round.failure_count > 0) {
    return {
      tone: "warning",
      flagLabel: "失败终止",
      flagClassName: "is-failure",
      cardClassName: "is-failure",
    };
  }

  if (round.stop_reason.includes("延迟")) {
    return {
      tone: "accent",
      flagLabel: "延迟过高",
      flagClassName: "is-latency",
      cardClassName: "is-latency",
    };
  }

  return {
    tone: "warning",
    flagLabel: "异常终止",
    flagClassName: "is-anomaly",
    cardClassName: "is-anomaly",
  };
}
