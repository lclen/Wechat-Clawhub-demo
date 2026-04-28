import type { RefObject } from "react";
import { InfoRow } from "../Connection/ConnectionUi";
import { MessageContent } from "./MessageContent";
import { EmptyState, SectionHeader, SignalBadge } from "../../shared/ConsolePrimitives";
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
  const consoleStatusTone = !sessionsLoaded ? "neutral" : systemStatus ? "good" : "warn";

  return (
    <section className="session-workspace-shell">
      <section className={`surface session-console-topbar ${effectiveRole === "console_only" && sessionsLoaded && systemStatus === null ? "is-warning" : ""}`}>
        <div className="session-console-topbar-copy">
          <div className="session-console-topbar-head">
            <div>
              <div className="section-kicker">微信通道</div>
              <h3>{heroTitle}</h3>
            </div>
            <SignalBadge tone={consoleStatusTone}>
              {!sessionsLoaded ? "加载中" : systemStatus ? "运行正常" : "网关不可达"}
            </SignalBadge>
          </div>
        </div>
        <div className="session-console-topbar-meta">
          <span>{wechatRuntimeSummaryValue}</span>
          <span>节点 {systemStatus?.active_nodes ?? 0}</span>
          <span>会话 {sessions.length}</span>
          <span>筛选 {filteredSessions.length}</span>
          <span>Redis {systemStatus ? (systemStatus.redis_ok ? "在线" : "不可用") : "待连接"}</span>
          {effectiveRole === "console_only" && sessionsLoaded && systemStatus === null ? (
            <button type="button" className="ghost-button" onClick={onGoToQuickSetup}>快速配置</button>
          ) : null}
        </div>
      </section>
      <div className="workspace-frame session-workspace">
        <aside className="session-rail surface session-rail-command">
          <div className="rail-heading session-list-heading">
            <SectionHeader
              kicker="会话列表"
              title="微信会话"
              actions={<span className="count-badge session-list-count">{filteredSessions.length}/{sessions.length}</span>}
              className="session-list-section-header"
            />
          </div>
          <div className="filter-row" role="tablist" aria-label="Session filters">
            {filters.map((item) => <button key={item.key} type="button" className={`filter-chip ${sessionFilter === item.key ? "filter-chip-active" : ""}`} onClick={() => onChangeFilter(item.key)}>{item.label} {counts[item.key]}</button>)}
          </div>
          {selectedSession ? (
            <div className="session-rail-context">
              <div className="session-rail-context-top">
                <span className={`session-badge session-badge-${sessionBadgeTone(selectedSession)}`}>
                  {typingState || channelReleaseHint || getSessionBadgeLabel(selectedSession, latestBotMessage?.created_at)}
                </span>
                <button type="button" className="memory-inline-trigger" onClick={onOpenInspector}>记忆</button>
              </div>
              <div className="session-rail-context-title">{formatSessionName(selectedSession.user_id)}</div>
              <div className="session-rail-context-meta">{selectedSession.message_count} 条 · {formatTimeAgo(selectedSession.last_message_at, now)}</div>
            </div>
          ) : null}
          <div className="session-list">
            {!sessionsLoaded ? <EmptyState title="正在读取会话列表…" /> : !filteredSessions.length ? <EmptyState title="当前筛选条件下还没有会话" /> : filteredSessions.map((session) => (
              <button key={session.session_id} type="button" className={`session-card ${session.session_id === selectedSessionId ? "session-card-active" : ""}`} onClick={() => onSelectSession(session.session_id)} title={`${session.user_id}\n${session.session_id}`}>
                <div className="session-card-top">
                  <div className="session-card-title-wrap">
                    <div className="session-card-title">{formatSessionName(session.user_id)}</div>
                  </div>
                  <span className={`session-badge session-badge-${sessionBadgeTone(session)}`}>{getSessionBadgeLabel(session)}</span>
                </div>
                <div className="session-card-preview">{sessionPreview(session)}</div>
                <div className="session-card-meta"><span>{formatTimeAgo(session.last_message_at, now)}</span><span>{session.message_count} 条</span></div>
              </button>
            ))}
          </div>
        </aside>

        <div className="chat-column">
          <div className="chat-column-shell">
            <section className="surface transcript-surface">

              <div ref={messagesRef as RefObject<HTMLDivElement>} className="message-stream" onScroll={onMessageScroll}>
                {!selectedSession ? <EmptyState title="选择一个会话后" detail="这里会显示完整聊天内容。" /> : !messagesLoaded ? <div className="empty-state"><span className="loading-spinner" />正在加载聊天内容…</div> : !messages.length ? <EmptyState title="当前会话还没有消息" /> : messages.map((message, index) => {
                  const replyDurationLabel = getReplyDurationLabel(messages, index);
                  const rowTone = message.role === "user" ? "user" : message.role === "system" ? "system" : "assistant";
                  return (
                    <div key={message.message_id}>
                      {showDateDivider(messages, index) ? <div className="date-divider">{formatDayLabel(message.created_at)}</div> : null}
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
                    </div>
                  );
                })}
                {typingState && selectedSession ? <div className="message-row message-row-assistant"><div className="message-bubble message-bubble-typing"><div className="typing-line"><span className="typing-dots" aria-hidden="true"><span /><span /><span /></span><span>{typingState}</span></div></div></div> : null}
              </div>
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
              <InfoRow label="当前用户" value={selectedSession ? formatWechatIdentity(selectedSession.user_id) : "未选中会话"} multiline />
              <InfoRow label="会话 ID" value={selectedSession?.session_id || "-"} multiline />
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
