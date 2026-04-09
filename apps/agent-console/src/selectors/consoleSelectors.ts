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
