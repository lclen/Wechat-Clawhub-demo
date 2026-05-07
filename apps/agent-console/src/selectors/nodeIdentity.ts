import type { NodeInventoryRecord } from "../types";

export function isGatewayEmbeddedNode(node: Pick<NodeInventoryRecord, "node_kind" | "node_id">) {
  return node.node_kind === "local" && node.node_id === "local-node";
}

