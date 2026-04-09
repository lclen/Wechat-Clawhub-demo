import type { SessionFilter, SessionRecord } from "../types";

export function matchesFilter(session: SessionRecord, filter: SessionFilter, now: number) {
  return filter === "processing" ? session.queue_status !== "none" || Boolean(session.active_task_id) : filter === "human" ? session.status === "human_active" || session.status === "handoff_pending" : filter === "recent" ? isRecent(session, now) : true;
}

export function isRecent(session: SessionRecord, now: number) {
  const updatedAt = new Date(session.updated_at).getTime();
  return !Number.isNaN(updatedAt) && now - updatedAt <= 30 * 60 * 1000;
}

export function shouldUseFastPolling(session: SessionRecord | null) {
  return !!session && (session.queue_status === "pending" || session.queue_status === "inflight" || Boolean(session.active_task_id));
}

export function formatTimeLabel(value: string, withSeconds = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined });
}
