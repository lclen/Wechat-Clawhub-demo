import type { FormEvent, RefObject } from "react";
import { InfoRow } from "../Connection/ConnectionUi";
import { MessageContent } from "./MessageContent";
import { EmptyState, MetricCard, SectionHeader, SignalBadge } from "../../shared/ConsolePrimitives";
import type { SessionThreadGroup } from "../../../selectors/consoleSelectors";
import type { MessageRecord, SessionFilter, SessionRecord } from "../../../types";
import {
  formatDayLabel,
  formatSessionName,
  formatTimeAgo,
  formatTimeLabel,
  formatWechatIdentity,
  getSessionBadgeLabel,
  getReplyDurationLabel,
  roleLabel,
  sessionBadgeTone,
  sessionPreview,
  showDateDivider,
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
  sessionThreads: SessionThreadGroup[];
  filteredSessionThreads: SessionThreadGroup[];
  sessionFilter: SessionFilter;
  filters: { key: SessionFilter; label: string }[];
  counts: Record<SessionFilter | "all", number>;
  selectedSessionId: string | null;
  selectedSession: SessionRecord | null;
  selectedSessionThread: SessionThreadGroup | null;
  sessionManualNodeId: string;
  sessionBindingOptions: Array<{ node_id: string; label: string }>;
  messages: MessageRecord[];
  messagesLoaded: boolean;
  humanReplyDraft: string;
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
  onChangeHumanReplyDraft: (content: string) => void;
  onSendHumanReply: (sessionId: string) => void;
  onReleaseSessionToAi: (sessionId: string) => void;
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
  sessionThreads,
  filteredSessionThreads,
  sessionFilter,
  filters,
  counts,
  selectedSessionId,
  selectedSession,
  selectedSessionThread,
  sessionManualNodeId,
  sessionBindingOptions,
  messages,
  messagesLoaded,
  humanReplyDraft,
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
  onChangeHumanReplyDraft,
  onSendHumanReply,
  onReleaseSessionToAi,
  onMessageScroll,
  onOpenInspector,
  onCloseInspector,
  onChangeSessionManualNodeId,
  onBindSessionNode,
  onRestoreSessionAuto,
}: SessionsWorkspaceProps) {
  const consoleStatusTone = !sessionsLoaded ? "neutral" : systemStatus ? "good" : "warn";
  const isConsoleOnlySessionView = effectiveRole === "console_only";
  const sessionScope = currentRoleIsWorker
    ? {
        kicker: "节点会话",
        listTitle: "本节点任务",
        metricLabel: "本节点线程",
        emptyTitle: "当前筛选条件下还没有本节点会话",
        defaultSummary: "节点端只显示分配到当前节点的会话，用于观察执行链路、回复耗时和通道状态。",
        permissionLabel: "接管权限",
        permissionValue: "只读",
        permissionDetail: "节点端不处理人工接管",
        baselineValue: systemStatus?.redis_ok ? "网关可达" : "待连接",
        baselineDetail: "仅看本节点任务流",
      }
    : isConsoleOnlySessionView
      ? {
          kicker: "控制台会话",
          listTitle: "微信用户",
          metricLabel: "用户线程",
          emptyTitle: "当前筛选条件下还没有用户线程",
          defaultSummary: "从左侧选择用户后，这里会串联历史会话，并展示聊天、路由和人工接管状态。",
          permissionLabel: "坐席接管",
          permissionValue: canBindSessions ? "可接管" : "只读",
          permissionDetail: canBindSessions ? "可处理待接管会话" : "仅观察会话状态",
          baselineValue: systemStatus?.redis_ok ? "网关在线" : "待连接",
          baselineDetail: wechatRuntimeSummaryValue,
        }
      : {
          kicker: "微信通道",
          listTitle: "微信用户",
          metricLabel: "用户线程",
          emptyTitle: "当前筛选条件下还没有用户线程",
          defaultSummary: "从左侧选择用户后，这里会串联历史会话，并展示聊天、路由、节点绑定与人工接管状态。",
          permissionLabel: "坐席接管",
          permissionValue: canBindSessions ? "可接管" : "只读",
          permissionDetail: canBindSessions ? "可绑定节点和接管会话" : "仅观察会话状态",
          baselineValue: systemStatus?.redis_ok ? "Redis 在线" : "待连接",
          baselineDetail: `${wechatRuntimeSummaryValue} · 节点 ${systemStatus?.active_nodes ?? 0}`,
        };
  const handoffConsoleVisible = canBindSessions && (
    selectedSession?.status === "handoff_pending" || selectedSession?.status === "human_active"
  );
  const humanReplyBusy = busyKey === "session-human-reply";
  const releaseBusy = busyKey === "session-release-human";
  const humanReplyDisabled = !selectedSession || humanReplyBusy || !humanReplyDraft.trim();
  const handoffRemainingLabel = formatHandoffRemaining(selectedSession, now);
  const selectedSessionStatusLabel = selectedSession
    ? typingState || channelReleaseHint || getSessionBadgeLabel(selectedSession, latestBotMessage?.created_at)
    : "未选中";
  const selectedThreadTotalMessages = selectedSessionThread?.totalMessageCount ?? selectedSession?.message_count ?? 0;
  const selectedThreadSegmentCount = selectedSessionThread?.sessions.length ?? 0;
  const selectedSegmentIndex = selectedSessionThread && selectedSession
    ? selectedSessionThread.sessions.findIndex((session) => session.session_id === selectedSession.session_id) + 1
    : 0;
  const selectedSessionSummary = selectedSession
    ? `${selectedSessionThread && selectedSessionThread.sessions.length > 1 ? `已串联 ${selectedSessionThread.sessions.length} 段历史 · ` : ""}${selectedSession.context_summary || sessionPreview(selectedSession, latestBotMessage?.created_at)}`
    : sessionScope.defaultSummary;
  const handleHumanReplySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSession || humanReplyDisabled) return;
    onSendHumanReply(selectedSession.session_id);
  };

  return (
    <section className="session-workspace-shell">
      <section className={`surface session-console-topbar ${effectiveRole === "console_only" && sessionsLoaded && systemStatus === null ? "is-warning" : ""}`}>
        <div className="session-console-topbar-copy">
          <div className="session-console-topbar-head">
            <div>
              <div className="section-kicker">{sessionScope.kicker}</div>
              <h3>{heroTitle}</h3>
            </div>
            <SignalBadge tone={consoleStatusTone}>
              {!sessionsLoaded ? "加载中" : systemStatus ? "运行正常" : "网关不可达"}
            </SignalBadge>
          </div>
        </div>
        <div className="session-console-topbar-metrics">
          <MetricCard label={sessionScope.metricLabel} value={String(counts.all)} detail={`${filteredSessionThreads.length} 个匹配当前筛选`} tone="accent" />
          <MetricCard label="处理中" value={String(counts.processing)} detail="排队或节点执行中" tone={counts.processing ? "warning" : "healthy"} />
          <MetricCard label={sessionScope.permissionLabel} value={currentRoleIsWorker ? sessionScope.permissionValue : String(counts.human)} detail={currentRoleIsWorker ? sessionScope.permissionDetail : (counts.human ? "需要坐席关注" : sessionScope.permissionDetail)} tone={!currentRoleIsWorker && counts.human ? "warning" : "healthy"} />
          <MetricCard label="运行基线" value={sessionScope.baselineValue} detail={sessionScope.baselineDetail} tone={systemStatus?.redis_ok ? "healthy" : "warning"} />
          {effectiveRole === "console_only" && sessionsLoaded && systemStatus === null ? (
            <button type="button" className="ghost-button session-topbar-config-button" onClick={onGoToQuickSetup}>快速配置</button>
          ) : null}
        </div>
      </section>
      <div className="workspace-frame session-workspace">
        <aside className="session-rail surface session-rail-command">
          <div className="rail-heading session-list-heading">
              <SectionHeader
                kicker="会话列表"
                title={sessionScope.listTitle}
                actions={<span className="count-badge session-list-count">{filteredSessionThreads.length}/{sessionThreads.length}</span>}
                className="session-list-section-header"
              />
          </div>
          <div className="filter-row" role="tablist" aria-label="Session filters">
            {filters.map((item) => <button key={item.key} type="button" className={`filter-chip ${sessionFilter === item.key ? "filter-chip-active" : ""}`} onClick={() => onChangeFilter(item.key)}>{item.label} {counts[item.key]}</button>)}
          </div>
          <div className="session-list">
            {!sessionsLoaded ? <EmptyState title="正在读取会话列表…" /> : !filteredSessionThreads.length ? <EmptyState title={sessionScope.emptyTitle} /> : filteredSessionThreads.map((thread) => {
              const session = thread.latestSession;
              const selected = selectedSessionThread?.threadKey === thread.threadKey;
              return (
              <button key={thread.threadKey} type="button" className={`session-card session-thread-card ${selected ? "session-card-active" : ""}`} onClick={() => onSelectSession(session.session_id)} title={`${thread.displayUserId}\n${thread.sessions.map((item) => item.session_id).join("\n")}`}>
                <div className="session-card-top">
                  <div className="session-card-title-wrap">
                    <div className="session-card-title">{formatSessionName(thread.displayUserId)}</div>
                    <div className="session-card-thread-id">{formatWechatIdentity(thread.displayUserId)}</div>
                  </div>
                  <span className={`session-badge session-badge-${sessionBadgeTone(session)}`}>{getSessionBadgeLabel(session)}</span>
                </div>
                <div className="session-card-preview">{sessionPreview(session)}</div>
                <div className="session-thread-meta">
                  <span>{formatTimeAgo(thread.lastMessageAt, now)}</span>
                  <span>{thread.totalMessageCount} 条</span>
                  <span>{thread.sessions.length} 段</span>
                </div>
                <div className="session-thread-segments" aria-label="历史会话片段">
                  {thread.sessions.slice(-4).map((segment, index) => (
                    <span key={segment.session_id} className={segment.session_id === session.session_id ? "is-current" : ""}>
                      {thread.sessions.length - Math.min(thread.sessions.length, 4) + index + 1}
                    </span>
                  ))}
                </div>
              </button>
            );})}
          </div>
        </aside>

        <div className="chat-column">
          <div className="chat-column-shell">
            <section className="surface transcript-surface">
              <header className="session-transcript-header">
                <div className="session-transcript-title">
                  <div className="section-kicker">Live Transcript</div>
                  <h3>{selectedSessionThread ? formatSessionName(selectedSessionThread.displayUserId) : "选择一个用户"}</h3>
                  <p>{selectedSessionSummary}</p>
                </div>
                <div className="session-transcript-actions">
                  <SignalBadge tone={getSessionSignalTone(selectedSession, latestBotMessage?.created_at)}>
                    {selectedSessionStatusLabel}
                  </SignalBadge>
                  <button type="button" className="ghost-button" onClick={onOpenInspector} disabled={!selectedSession}>
                    会话记忆
                  </button>
                </div>
                <div className="session-transcript-facts">
                  <div><span>连续消息</span><strong>{selectedSession ? selectedThreadTotalMessages : "-"}</strong></div>
                  <div><span>历史片段</span><strong>{selectedSession ? `${selectedSegmentIndex || 1}/${selectedThreadSegmentCount || 1}` : "-"}</strong></div>
                  <div><span>当前节点</span><strong>{selectedSession?.assigned_node_id || "未绑定"}</strong></div>
                  <div><span>路由模式</span><strong>{selectedSession ? (selectedSession.routing_mode === "manual" ? "手动绑定" : "自动分配") : "-"}</strong></div>
                </div>
              </header>

              <div ref={messagesRef as RefObject<HTMLDivElement>} className="message-stream" onScroll={onMessageScroll}>
                {!selectedSession ? <EmptyState title="选择一个用户后" detail="这里会按时间串联该用户所有历史会话。" /> : !messagesLoaded ? <div className="empty-state"><span className="loading-spinner" />正在加载该用户全部历史…</div> : !messages.length ? <EmptyState title="当前用户还没有消息" /> : messages.map((message, index) => {
                  const replyDurationLabel = getReplyDurationLabel(messages, index);
                  const rowTone = message.role === "user" ? "user" : message.role === "system" ? "system" : "assistant";
                  const systemNotice = getSystemNoticePresentation(message);
                  const showSegmentDivider = shouldShowSegmentDivider(messages, index, selectedSessionThread);
                  const segmentSession = selectedSessionThread?.sessions.find((session) => session.session_id === message.session_id) ?? null;
                  return (
                    <div key={message.message_id}>
                      {showSegmentDivider && segmentSession ? <SessionSegmentDivider thread={selectedSessionThread} session={segmentSession} now={now} /> : null}
                      {showDateDivider(messages, index) ? <div className="date-divider">{formatDayLabel(message.created_at)}</div> : null}
                      {systemNotice ? (
                        <div className={`message-row message-row-system message-row-system-notice ${systemNotice.tone === "warning" ? "is-warning" : ""}`}>
                          <div className="system-notice-card">
                            <div className="system-notice-rail" aria-hidden="true" />
                            <div className="system-notice-body">
                              <div className="system-notice-title-line">
                                <span className="system-notice-label">{systemNotice.label}</span>
                                <span className="system-notice-time">{formatTimeLabel(message.created_at, true)}</span>
                              </div>
                              <div className="system-notice-content"><MessageContent content={message.content} /></div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className={`message-row message-row-${rowTone}`}>
                          <div className={`message-bubble message-bubble-${message.role}`}>
                            <div className="message-role-line">
                              <span className="message-role">{roleLabel(message.role)}</span>
                              {message.node_id || message.actor_id ? <span className="message-role-meta">{message.node_id || message.actor_id}</span> : null}
                              {replyDurationLabel ? <span className="message-reply-duration">{replyDurationLabel}</span> : null}
                              <span>{formatTimeLabel(message.created_at, true)}</span>
                            </div>
                            <div className="message-content"><MessageContent content={message.content} /></div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {typingState && selectedSession ? <div className="message-row message-row-assistant"><div className="message-bubble message-bubble-typing"><div className="typing-line"><span className="typing-dots" aria-hidden="true"><span /><span /><span /></span><span>{typingState}</span></div></div></div> : null}
              </div>
              {handoffConsoleVisible && selectedSession ? (
                <form className="human-reply-console" onSubmit={handleHumanReplySubmit}>
                  <div className="human-reply-console-head">
                    <div>
                      <div className="section-kicker">人工接管</div>
                      <strong>
                        {selectedSession.status === "handoff_pending"
                          ? `待接管，发送即接管${handoffRemainingLabel ? ` · ${handoffRemainingLabel}` : ""}`
                          : `人工接管中${selectedSession.claimed_by ? ` · ${selectedSession.claimed_by}` : ""}`}
                      </strong>
                    </div>
                    {selectedSession.status === "human_active" ? (
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={releaseBusy}
                        onClick={() => onReleaseSessionToAi(selectedSession.session_id)}
                      >
                        {releaseBusy ? "释放中…" : "释放给 AI"}
                      </button>
                    ) : null}
                  </div>
                  <div className="human-reply-composer">
                    <textarea
                      value={humanReplyDraft}
                      onChange={(event) => onChangeHumanReplyDraft(event.target.value)}
                      placeholder="输入人工回复，发送后会直接回到用户微信。"
                      rows={3}
                    />
                    <button type="submit" className="primary-button" disabled={humanReplyDisabled}>
                      {humanReplyBusy ? "发送中…" : selectedSession.status === "handoff_pending" ? "发送并接管" : "发送人工回复"}
                    </button>
                  </div>
                </form>
              ) : null}
            </section>
          </div>
        </div>
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
              {selectedSession?.context_summary || "当前还没有摘要，先通过最近消息与当前绑定状态帮助你判断会话运行态。"}
            </div>
            <div className="memory-meta-block">
              <InfoRow label="当前用户" value={selectedSessionThread ? formatWechatIdentity(selectedSessionThread.displayUserId) : "未选中用户"} multiline />
              <InfoRow label="历史片段" value={selectedSessionThread ? `${selectedSessionThread.sessions.length} 段 · ${selectedSessionThread.totalMessageCount} 条消息` : "-"} multiline />
              <InfoRow label="当前会话 ID" value={selectedSession?.session_id || "-"} multiline />
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
    </section>
  );
}

function formatHandoffRemaining(session: SessionRecord | null, now: number) {
  if (!session?.handoff_expires_at) return "";
  const expiresAt = new Date(session.handoff_expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return "";
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return "已超时，等待系统恢复";
  const remainingMinutes = Math.ceil(remainingMs / 60000);
  return `剩余 ${remainingMinutes} 分钟`;
}

function getSessionSignalTone(session: SessionRecord | null, latestReplyAt?: string | null): "good" | "warn" | "info" | "neutral" {
  if (!session) return "neutral";
  const tone = sessionBadgeTone(session, latestReplyAt);
  if (tone === "typing") return "info";
  if (tone === "human" || tone === "queued") return "warn";
  return "good";
}

function getSystemNoticePresentation(message: MessageRecord) {
  if (message.role !== "system") return null;
  const eventType = message.metadata.event_type || "";
  if (eventType === "handoff_waiting_notice") {
    return { label: "接管通知", tone: "info" };
  }
  if (eventType === "handoff_timeout_notice") {
    return { label: "接管超时", tone: "warning" };
  }
  return { label: "系统通知", tone: "info" };
}

function shouldShowSegmentDivider(messages: MessageRecord[], index: number, thread: SessionThreadGroup | null) {
  if (!thread || thread.sessions.length <= 1) return false;
  if (!messages[index]) return false;
  return index === 0 || messages[index - 1]?.session_id !== messages[index].session_id;
}

function SessionSegmentDivider({ thread, session, now }: { thread: SessionThreadGroup | null; session: SessionRecord; now: number }) {
  const index = thread ? thread.sessions.findIndex((item) => item.session_id === session.session_id) : -1;
  const segmentNumber = index >= 0 ? index + 1 : 1;
  const segmentCount = thread?.sessions.length ?? 1;
  const reason = segmentNumber === 1
    ? "首次会话"
    : session.message_count >= 50
      ? "上一段达到 50 条后自动续接"
      : "用户 /new 或自动新开后续接";
  return (
    <div className="session-segment-divider">
      <span>会话片段 {segmentNumber}/{segmentCount}</span>
      <strong>{reason}</strong>
      <em>{formatTimeAgo(session.created_at, now)}</em>
    </div>
  );
}
