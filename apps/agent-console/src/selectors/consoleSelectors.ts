import type {
  MessageRecord,
  NodeInventoryRecord,
  NodeRecord,
  SessionFilter,
  SessionRecord,
} from "../types";
import { isRecent, matchesFilter } from "./sessionSelectors";

export function selectCurrentSession(
  sessions: SessionRecord[],
  selectedSessionId: string | null,
  activeSession: SessionRecord | null,
) {
  return sessions.find((session) => session.session_id === selectedSessionId) ?? activeSession;
}

export function selectCurrentNode(nodes: NodeRecord[], selectedNodeId: string | null) {
  return nodes.find((node) => node.node_id === selectedNodeId) ?? null;
}

export function buildSessionBindingOptions(
  nodes: NodeRecord[],
  dispatchModeEnabled: boolean,
  assignedNodeId: string | null | undefined,
) {
  const visibleNodes = nodes.filter((node) => !dispatchModeEnabled || node.node_id !== "local-node");
  const options = visibleNodes.map((node) => ({
    node_id: node.node_id,
    label: `${node.node_id}${node.hostname ? ` · ${node.hostname}` : ""}`,
  }));
  if (assignedNodeId && !options.some((item) => item.node_id === assignedNodeId)) {
    options.unshift({
      node_id: assignedNodeId,
      label: `${assignedNodeId} · 当前绑定（暂不可用）`,
    });
  }
  return options;
}

export function filterSessions(sessions: SessionRecord[], sessionFilter: SessionFilter, now: number) {
  return sessions.filter((session) => matchesFilter(session, sessionFilter, now));
}

export function buildSessionCounts(sessions: SessionRecord[], now: number) {
  return {
    all: sessions.length,
    processing: sessions.filter((item) => item.queue_status !== "none" || Boolean(item.active_task_id)).length,
    human: sessions.filter((item) => item.status === "human_active" || item.status === "handoff_pending").length,
    recent: sessions.filter((item) => isRecent(item, now)).length,
  };
}

export type SessionThreadGroup = {
  threadKey: string;
  channel: string;
  userId: string;
  displayUserId: string;
  sessions: SessionRecord[];
  latestSession: SessionRecord;
  totalMessageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
};

export function normalizeSessionUserId(userId: string) {
  return userId.trim().replace(/:part-\d+$/i, "");
}

export function getSessionThreadKey(session: SessionRecord) {
  return `${session.channel}:${normalizeSessionUserId(session.user_id)}`;
}

export function sortSessionsChronologically(sessions: SessionRecord[]) {
  return [...sessions].sort((a, b) => {
    const aCreatedAt = new Date(a.created_at || a.last_message_at).getTime();
    const bCreatedAt = new Date(b.created_at || b.last_message_at).getTime();
    if (Number.isFinite(aCreatedAt) && Number.isFinite(bCreatedAt) && aCreatedAt !== bCreatedAt) {
      return aCreatedAt - bCreatedAt;
    }
    return a.session_id.localeCompare(b.session_id);
  });
}

export function buildSessionThreadGroups(sessions: SessionRecord[]) {
  const grouped = new Map<string, SessionRecord[]>();
  for (const session of sessions) {
    const key = getSessionThreadKey(session);
    grouped.set(key, [...(grouped.get(key) ?? []), session]);
  }
  return Array.from(grouped.entries())
    .map(([threadKey, threadSessions]) => {
      const chronologicalSessions = sortSessionsChronologically(threadSessions);
      const latestSession = [...chronologicalSessions].sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())[0];
      return {
        threadKey,
        channel: latestSession.channel,
        userId: latestSession.user_id,
        displayUserId: normalizeSessionUserId(latestSession.user_id),
        sessions: chronologicalSessions,
        latestSession,
        totalMessageCount: chronologicalSessions.reduce((sum, session) => sum + Math.max(0, session.message_count), 0),
        firstMessageAt: chronologicalSessions[0]?.created_at ?? latestSession.created_at,
        lastMessageAt: latestSession.last_message_at,
      } satisfies SessionThreadGroup;
    })
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
}

export function filterSessionThreadGroups(groups: SessionThreadGroup[], sessionFilter: SessionFilter, now: number) {
  return groups.filter((group) => group.sessions.some((session) => matchesFilter(session, sessionFilter, now)));
}

export function buildSessionThreadCounts(groups: SessionThreadGroup[], now: number) {
  return {
    all: groups.length,
    processing: groups.filter((group) => group.sessions.some((session) => session.queue_status !== "none" || Boolean(session.active_task_id))).length,
    human: groups.filter((group) => group.sessions.some((session) => session.status === "human_active" || session.status === "handoff_pending")).length,
    recent: groups.filter((group) => group.sessions.some((session) => isRecent(session, now))).length,
  };
}

export function selectSessionThreadGroup(groups: SessionThreadGroup[], selectedSessionId: string | null) {
  if (!selectedSessionId) return null;
  return groups.find((group) => group.sessions.some((session) => session.session_id === selectedSessionId)) ?? null;
}

export function findLatestMessageByRole(messages: MessageRecord[], role: MessageRecord["role"]) {
  return [...messages].reverse().find((message) => message.role === role) ?? null;
}

export function countAvailableDispatchNodes(nodes: NodeRecord[], dispatchModeEnabled: boolean) {
  return nodes.filter((node) => !dispatchModeEnabled || node.node_id !== "local-node").length;
}

export function buildNodeChannelOverview(nodeInventory: NodeInventoryRecord[]) {
  return nodeInventory.reduce(
    (acc, node) => {
      const capacity = Math.max(node.channel_capacity ?? 0, 0);
      const inUse = Math.max(node.channel_in_use ?? 0, 0);
      const idle = Math.max(capacity - inUse, 0);
      acc.capacity += capacity;
      acc.inUse += inUse;
      acc.idle += idle;
      if (node.online) {
        acc.onlineCapacity += capacity;
        acc.onlineInUse += inUse;
        acc.onlineIdle += idle;
      }
      return acc;
    },
    {
      capacity: 0,
      inUse: 0,
      idle: 0,
      onlineCapacity: 0,
      onlineInUse: 0,
      onlineIdle: 0,
    },
  );
}
