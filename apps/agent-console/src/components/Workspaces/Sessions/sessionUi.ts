import type { MessageRecord, SessionRecord } from "../../../types";

export function truncateText(value: string, start = 6, end = 6) {
  return value.length <= start + end + 3 ? value : `${value.slice(0, start)}...${value.slice(-end)}`;
}

export function formatSessionName(userId: string) {
  return truncateText(userId.replace(/^wechat:/, ""), 10, 8);
}

export function formatWechatIdentity(userId: string) {
  return userId.startsWith("wechat:") ? userId : `微信ID ${userId}`;
}

export function formatTimeLabel(value: string, withSeconds = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined });
}

export function formatDayLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
}

export function formatTimeAgo(value: string, now: number) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "-";
  const diff = Math.max(0, now - time);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时前` : formatDayLabel(value);
}

export function showDateDivider(messages: MessageRecord[], index: number) {
  if (!index) return true;
  return new Date(messages[index].created_at).toDateString() !== new Date(messages[index - 1].created_at).toDateString();
}

export function sessionPreview(session: SessionRecord, latestReplyAt?: string | null) {
  const hasReplyAfterDispatch = hasCompletedReplyAfterDispatch(session, latestReplyAt);
  return session.status === "human_active"
    ? `人工已接管${session.claimed_by ? ` · ${session.claimed_by}` : ""}`
    : session.status === "handoff_pending"
      ? "用户请求转人工，等待坐席认领"
      : session.queue_status === "pending"
        ? "消息已入队，等待节点领取"
        : (session.queue_status === "inflight" || session.active_task_id) && !hasReplyAfterDispatch
          ? `${session.assigned_node_id || "节点"} 正在处理`
          : (session.context_summary || "当前没有新的处理事件");
}

export function sessionBadgeTone(session: SessionRecord, latestReplyAt?: string | null) {
  const hasReplyAfterDispatch = hasCompletedReplyAfterDispatch(session, latestReplyAt);
  return session.status === "human_active" || session.status === "handoff_pending"
    ? "human"
    : session.queue_status === "pending"
      ? "queued"
      : (session.queue_status === "inflight" || session.active_task_id) && !hasReplyAfterDispatch
        ? "typing"
        : "idle";
}

export function getSessionBadgeLabel(session: SessionRecord, latestReplyAt?: string | null) {
  return (session.queue_status === "inflight" || session.active_task_id) && !hasCompletedReplyAfterDispatch(session, latestReplyAt)
    ? "处理中"
    : session.queue_status === "pending"
      ? "排队中"
      : session.status === "human_active"
        ? "人工中"
        : session.status === "handoff_pending"
          ? "待接管"
          : "空闲";
}

export function getTypingState(session: SessionRecord | null, now: number, latestReplyAt?: string | null) {
  if (!session) return "";
  if (session.queue_status === "pending") return `消息已入队，等待 ${session.assigned_node_id || "可用节点"} 领取任务`;
  if ((session.queue_status === "inflight" || session.active_task_id) && !hasCompletedReplyAfterDispatch(session, latestReplyAt)) {
    const elapsed = session.last_dispatch_at ? Math.max(1, Math.floor((now - new Date(session.last_dispatch_at).getTime()) / 1000)) : null;
    return `${session.assigned_node_id || "Agent"} 正在输入${elapsed ? `，已处理 ${elapsed}s` : ""}`;
  }
  return "";
}

function hasCompletedReplyAfterDispatch(session: SessionRecord, latestReplyAt?: string | null) {
  const dispatchAt = session.last_dispatch_at ? new Date(session.last_dispatch_at).getTime() : Number.NaN;
  if (Number.isNaN(dispatchAt)) return false;

  const latestSessionMessageAt = session.last_message_at ? new Date(session.last_message_at).getTime() : Number.NaN;
  if (Number.isFinite(latestSessionMessageAt) && latestSessionMessageAt > dispatchAt) {
    return true;
  }

  const latestReplyTime = latestReplyAt ? new Date(latestReplyAt).getTime() : Number.NaN;
  return Number.isFinite(latestReplyTime) && latestReplyTime > dispatchAt;
}

export function getChannelReleaseHint(session: SessionRecord | null, now: number) {
  if (!session?.assigned_slot_id || !session.slot_expires_at) return "";
  const expiresAt = new Date(session.slot_expires_at).getTime();
  if (Number.isNaN(expiresAt)) return "";
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return "通道租约已到期，等待释放";
  const remainingMinutes = Math.ceil(remainingMs / 60000);
  return `通道预计 ${remainingMinutes} 分钟后释放`;
}

export function roleLabel(role: MessageRecord["role"]) {
  return role === "user" ? "微信用户" : role === "bot" ? "Agent 回复" : role === "human" ? "人工坐席" : "系统事件";
}

function parseDurationMs(metadata: MessageRecord["metadata"]) {
  const msKeys = ["total_ms", "latency_ms", "model_latency_ms", "inference_ms", "submit_ms"];
  for (const key of msKeys) {
    const rawValue = metadata[key];
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const latencySeconds = Number(metadata.latency);
  if (Number.isFinite(latencySeconds) && latencySeconds > 0) {
    return latencySeconds * 1000;
  }

  return null;
}

function formatDurationLabel(durationMs: number) {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.round((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function getReplyDurationLabel(messages: MessageRecord[], index: number) {
  const message = messages[index];
  if (!message || (message.role !== "bot" && message.role !== "human")) return "";

  const explicitDuration = parseDurationMs(message.metadata);
  if (explicitDuration !== null) {
    return `耗时 ${formatDurationLabel(explicitDuration)}`;
  }

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previousMessage = messages[cursor];
    if (previousMessage.role !== "user") continue;
    const durationMs = new Date(message.created_at).getTime() - new Date(previousMessage.created_at).getTime();
    if (Number.isFinite(durationMs) && durationMs > 0 && durationMs < 30 * 60 * 1000) {
      return `响应 ${formatDurationLabel(durationMs)}`;
    }
    break;
  }

  return "";
}
