import type { RefObject } from "react";
import { InfoRow, MetaPill } from "../Connection/ConnectionUi";
import { MessageContent } from "./MessageContent";
import { CommandBar, EmptyState, MetricStrip, SectionHeader, SignalBadge } from "../../shared/ConsolePrimitives";
import type { MessageRecord, SessionFilter, SessionRecord } from "../../../types";
import {
  formatDayLabel,
  formatSessionName,
  formatTimeAgo,
  formatTimeLabel,
  formatWechatIdentity,
  getSessionBadgeLabel,
  roleLabel,
  sessionBadgeTone,
  sessionPreview,
  showDateDivider,
  truncateText,
} from "./sessionUi";

type SessionsWorkspaceProps = {
  effectiveRole: string | null;
  title: string;
  description: string;
  heroTitle: string;
  heroDescription: string;
  systemStatus: { redis_ok: boolean; active_nodes: number } | null;
  currentGatewayBaseUrl: string;
  sessionsLoaded: boolean;
  sessions: SessionRecord[];
  filteredSessions: SessionRecord[];
  sessionFilter: SessionFilter;
  filters: { key: SessionFilter; label: string }[];
  counts: Record<SessionFilter | "all", number>;
  selectedSessionId: string | null;
  selectedSession: SessionRecord | null;
  sessionManualNodeId: string;
  sessionBindingOptions: Array<{ node_id: string; label: string }>;
  messages: MessageRecord[];
  messagesLoaded: boolean;
  typingState: string;
  channelReleaseHint: string;
  latestUserMessage: MessageRecord | null;
  latestBotMessage: MessageRecord | null;
  wechatRuntimeSummaryValue: string;
  now: number;
  inspectorOpen: boolean;
  busyKey: string | null;
  currentRoleIsWorker: boolean;
  canBindSessions: boolean;
  messagesRef: RefObject<HTMLDivElement | null>;
  onGoToQuickSetup: () => void;
  onChangeFilter: (filter: SessionFilter) => void;
  onSelectSession: (sessionId: string) => void;
  onMessageScroll: () => void;
  onOpenInspector: () => void;
  onCloseInspector: () => void;
  onChangeSessionManualNodeId: (nodeId: string) => void;
  onBindSessionNode: (sessionId: string) => void;
  onRestoreSessionAuto: (sessionId: string) => void;
};

export function SessionsWorkspace({
  effectiveRole,
  title,
  description,
  heroTitle,
  heroDescription,
  systemStatus,
  currentGatewayBaseUrl,
  sessionsLoaded,
  sessions,
  filteredSessions,
  sessionFilter,
  filters,
  counts,
  selectedSessionId,
  selectedSession,
  sessionManualNodeId,
  sessionBindingOptions,
  messages,
  messagesLoaded,
  typingState,
  channelReleaseHint,
  latestUserMessage,
  latestBotMessage,
  wechatRuntimeSummaryValue,
  now,
  inspectorOpen,
  busyKey,
  currentRoleIsWorker,
  canBindSessions,
  messagesRef,
  onGoToQuickSetup,
  onChangeFilter,
  onSelectSession,
  onMessageScroll,
  onOpenInspector,
  onCloseInspector,
  onChangeSessionManualNodeId,
  onBindSessionNode,
  onRestoreSessionAuto,
}: SessionsWorkspaceProps) {
  const selectedSessionMetrics = selectedSession
    ? [
        { label: "上下文版本", value: `v${selectedSession.context_version}` },
        { label: "最后调度", value: formatTimeLabel(selectedSession.last_dispatch_at || selectedSession.updated_at, true) },
        { label: "消息总量", value: `${selectedSession.message_count}` },
      ]
    : [];

  return (
    <section className="session-workspace-shell">
      <div className="workspace-heading workspace-heading-command">
        <div>
          <div className="section-kicker">Session Command</div>
          <h2>{title}</h2>
        </div>
        <div className="workspace-caption">{description}</div>
      </div>
      {effectiveRole === "console_only" ? (
        systemStatus !== null ? (
          <div className="console-gateway-banner">
            <span>网关：{currentGatewayBaseUrl}</span>
            <span>Redis：{systemStatus.redis_ok ? "在线" : "不可用"}</span>
            <span>在线节点：{systemStatus.active_nodes}</span>
          </div>
        ) : sessionsLoaded ? (
          <div className="console-gateway-banner-error">
            <span>目标网关不可达</span>
            <button type="button" className="ghost-button" onClick={onGoToQuickSetup}>前往快速配置</button>
          </div>
        ) : null
      ) : null}
      <div className="workspace-frame session-workspace">
        <aside className="session-rail surface session-rail-command">
          <div className="rail-channel-card rail-channel-card-command">
            <SectionHeader
              kicker="微信通道"
              title={heroTitle}
              description={heroDescription}
              actions={<span className="count-badge">{sessions.length}</span>}
            />
            <MetricStrip
              className="session-rail-metrics"
              items={[
                { label: "运行态", value: wechatRuntimeSummaryValue },
                { label: "在线节点", value: String(systemStatus?.active_nodes ?? 0) },
                { label: "筛选结果", value: String(filteredSessions.length) },
              ]}
            />
            </div>
          <div className="rail-heading">
            <div>
              <div className="section-kicker">筛选</div>
              <h3>会话列表</h3>
            </div>
            <SignalBadge tone={sessionsLoaded ? "good" : "neutral"}>{sessionsLoaded ? "实时" : "加载中"}</SignalBadge>
          </div>
          <div className="filter-row" role="tablist" aria-label="Session filters">
            {filters.map((item) => <button key={item.key} type="button" className={`filter-chip ${sessionFilter === item.key ? "filter-chip-active" : ""}`} onClick={() => onChangeFilter(item.key)}>{item.label} {counts[item.key]}</button>)}
          </div>
          <div className="session-list">
            {!sessionsLoaded ? <EmptyState title="正在读取会话列表…" /> : !filteredSessions.length ? <EmptyState title="当前筛选条件下还没有会话" /> : filteredSessions.map((session) => (
              <button key={session.session_id} type="button" className={`session-card ${session.session_id === selectedSessionId ? "session-card-active" : ""}`} onClick={() => onSelectSession(session.session_id)} title={`${session.user_id}\n${session.session_id}`}>
                <div className="session-card-top">
                  <div className="session-card-title-wrap">
                    <div className="session-card-title">{formatSessionName(session.user_id)}</div>
                    <div className="session-card-channel">{session.channel}</div>
                    <div className="session-card-id" title={session.user_id}>{formatWechatIdentity(session.user_id)}</div>
                  </div>
                  <span className={`session-badge session-badge-${sessionBadgeTone(session)}`}>{getSessionBadgeLabel(session)}</span>
                </div>
                <div className="session-card-preview">{sessionPreview(session)}</div>
                <div className="session-card-meta"><span>{formatTimeAgo(session.last_message_at, now)}</span><span>{session.assigned_node_id || "待分配节点"}</span></div>
                <div className="session-card-meta"><span>{session.message_count} 条消息</span><span className="truncate-inline">{truncateText(session.session_id, 12, 10)}</span></div>
              </button>
            ))}
          </div>
        </aside>

        <div className="chat-column">
          <div className="chat-column-shell">
            <div className="surface stage-header session-stage-command">
              {selectedSession ? (
                <>
                  <div className="stage-header-main session-stage-hero">
                    <div className="session-stage-copy">
                      <div className="section-kicker">当前会话</div>
                      <h2>{formatSessionName(selectedSession.user_id)}</h2>
                      <div className="subtitle-stack">
                        <span title={selectedSession.user_id}>{selectedSession.user_id}</span>
                        <span>{selectedSession.channel}</span>
                        <span title={selectedSession.session_id}>{selectedSession.session_id}</span>
                      </div>
                    </div>
                    <div className="stage-meta-row stage-meta-row-command">
                      <MetaPill label="Agent" value={selectedSession.agent_id} />
                      <MetaPill label="节点" value={selectedSession.assigned_node_id || "未绑定"} />
                      <MetaPill label="槽位" value={selectedSession.assigned_slot_id || "未占用"} />
                      <MetaPill label="路由" value={selectedSession.routing_mode === "manual" ? "手动绑定" : "自动分配"} />
                      <MetaPill label="状态" value={getSessionBadgeLabel(selectedSession)} />
                    </div>
                  </div>
                  <MetricStrip items={selectedSessionMetrics} className="session-stage-metrics" />
                  <CommandBar
                    className="session-command-bar"
                    label="会话动作"
                    detail={typingState || channelReleaseHint || "当前没有活跃任务"}
                  >
                    {canBindSessions && !currentRoleIsWorker ? (
                      <div className="session-switch-controls">
                        <select className="session-switch-select" value={sessionManualNodeId} onChange={(event) => onChangeSessionManualNodeId(event.target.value)} disabled={busyKey !== null || sessionBindingOptions.length === 0} aria-label="选择手动绑定节点">
                          {sessionBindingOptions.length ? sessionBindingOptions.map((option) => <option key={option.node_id} value={option.node_id}>{option.label}</option>) : <option value="">暂无可绑定节点</option>}
                        </select>
                        <button type="button" className="ghost-button session-switch-trigger" onClick={() => onBindSessionNode(selectedSession.session_id)} disabled={busyKey !== null || !sessionManualNodeId}>{busyKey === "session-switch-node" ? "处理中..." : "绑定节点"}</button>
                        <button type="button" className="ghost-button session-switch-trigger" onClick={() => onRestoreSessionAuto(selectedSession.session_id)} disabled={busyKey !== null}>{busyKey === "session-switch-node" ? "处理中..." : "恢复自动"}</button>
                      </div>
                    ) : null}
                    <button type="button" className="memory-inline-trigger" onClick={onOpenInspector}>会话记忆</button>
                  </CommandBar>
                  <div className="header-status-line header-status-line-command">
                    <SignalBadge tone={typingState ? "info" : channelReleaseHint ? "warn" : "neutral"}>
                      {typingState || channelReleaseHint || "当前没有活跃任务"}
                    </SignalBadge>
                  </div>
                </>
              ) : <EmptyState className="empty-state-tall" title="选择一个会话" detail="或先在微信里给机器人发一条消息。" />}
            </div>

            <section className="surface transcript-surface">

              <div ref={messagesRef as RefObject<HTMLDivElement>} className="message-stream" onScroll={onMessageScroll}>
                {!selectedSession ? <EmptyState title="选择一个会话后" detail="这里会显示完整聊天内容。" /> : !messagesLoaded ? <div className="empty-state"><span className="loading-spinner" />正在加载聊天内容…</div> : !messages.length ? <EmptyState title="当前会话还没有消息" /> : messages.map((message, index) => (
                  <div key={message.message_id}>
                    {showDateDivider(messages, index) ? <div className="date-divider">{formatDayLabel(message.created_at)}</div> : null}
                    <div className={`message-row message-row-${message.role === "user" ? "user" : "assistant"}`}>
                      <div className={`message-bubble message-bubble-${message.role}`}>
                        <div className="message-role-line"><span className="message-role">{roleLabel(message.role)}</span>{message.node_id || message.actor_id ? <span className="message-role-meta">{message.node_id || message.actor_id}</span> : null}<span>{formatTimeLabel(message.created_at, true)}</span></div>
                        <div className="message-content"><MessageContent content={message.content} /></div>
                      </div>
                    </div>
                  </div>
                ))}
                {typingState && selectedSession ? <div className="message-row message-row-assistant"><div className="message-bubble message-bubble-typing"><div className="typing-line"><span className="typing-dots" aria-hidden="true"><span /><span /><span /></span><span>{typingState}</span></div></div></div> : null}
              </div>
            </section>

            <div
              className={`drawer-overlay ${inspectorOpen ? "is-visible" : ""}`}
              onClick={onCloseInspector}
              aria-hidden={inspectorOpen ? "false" : "true"}
            />
            <aside className={`side-drawer ${inspectorOpen ? "is-visible" : ""}`} aria-hidden={inspectorOpen ? "false" : "true"}>
              <section className="drawer-panel">
                <div className="section-head compact-head">
                  <div>
                    <div className="section-kicker">右侧检查器</div>
                    <h3>会话记忆</h3>
                  </div>
                  <button type="button" className="drawer-close" onClick={onCloseInspector}>
                    收起
                  </button>
                </div>
                <div className="inspector-collapsed-note">
                  模型自动记录的会话记忆会在这里展示，不占用主聊天工作区宽度。
                </div>
                <div className="context-summary">
                  {selectedSession?.context_summary || "当前还没有摘要，首版先依赖会话上下文版本与最近消息维持跨节点一致性。"}
                </div>
                <div className="memory-meta-block">
                  <InfoRow label="当前用户" value={selectedSession ? formatWechatIdentity(selectedSession.user_id) : "未选中会话"} multiline />
                  <InfoRow label="会话 ID" value={selectedSession?.session_id || "-"} multiline />
                  <InfoRow label="上下文版本" value={selectedSession ? `v${selectedSession.context_version}` : "-"} />
                  <InfoRow label="当前节点" value={selectedSession?.assigned_node_id || "未绑定"} />
                  <InfoRow label="当前槽位" value={selectedSession?.assigned_slot_id || "未占用"} />
                  <InfoRow label="路由模式" value={selectedSession ? (selectedSession.routing_mode === "manual" ? "手动绑定" : "自动分配") : "-"} />
                  <InfoRow label="通道状态" value={channelReleaseHint || (selectedSession?.assigned_slot_id ? "通道租约有效" : "等待重新分配")} multiline />
                  <InfoRow label="最近用户消息" value={latestUserMessage?.content || "暂无"} multiline />
                  <InfoRow label="最近 Bot 回复" value={latestBotMessage?.content || "暂无"} multiline />
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
