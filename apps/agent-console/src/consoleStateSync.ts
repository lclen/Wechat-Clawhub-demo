import type { Dispatch, SetStateAction } from "react";
import type { NodeInventoryRecord, NodeInventorySummary, NodeListResponse, NodeRecord, SessionRecord } from "./types";

export function syncSessions(
  next: SessionRecord[],
  setSessions: Dispatch<SetStateAction<SessionRecord[]>>,
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>,
  setActiveSession: Dispatch<SetStateAction<SessionRecord | null>>,
) {
  setSessions(next);
  setSelectedSessionId((current) => current && next.some((item) => item.session_id === current) ? current : (next[0]?.session_id ?? null));
  setActiveSession((current) => current ? (next.find((item) => item.session_id === current.session_id) ?? next[0] ?? null) : (next[0] ?? null));
}

export function syncNodeState(
  next: NodeListResponse,
  setNodes: Dispatch<SetStateAction<NodeRecord[]>>,
  setNodeInventory: Dispatch<SetStateAction<NodeInventoryRecord[]>>,
  setNodeInventorySummary: Dispatch<SetStateAction<NodeInventorySummary>>,
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>,
  options?: { selectNode?: boolean },
) {
  setNodes(next.nodes);
  setNodeInventory(next.inventory);
  setNodeInventorySummary(next.summary);
  if (options?.selectNode === false) {
    setSelectedNodeId(null);
    return;
  }
  setSelectedNodeId((current) =>
    current && next.inventory.some((item) => item.node_id === current)
      ? current
      : null,
  );
}
