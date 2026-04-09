import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PairingDebugEntry, SetupTaskResult } from "../types";

type UsePairingDebugOptions = {
  setupTask: SetupTaskResult | null;
  setPairingDebugEntries: Dispatch<SetStateAction<PairingDebugEntry[]>>;
  isPairingTaskKind: (kind: SetupTaskResult["kind"]) => boolean;
};

export function usePairingDebug(options: UsePairingDebugOptions) {
  const { setupTask, setPairingDebugEntries, isPairingTaskKind } = options;

  function pushPairingDebugEntry(entry: PairingDebugEntry) {
    setPairingDebugEntries((current) => {
      const next = [entry, ...current.filter((item) => item.id !== entry.id)];
      return next.slice(0, 12);
    });
  }

  function appendPairingClientError(title: string, target: string, error: Error) {
    pushPairingDebugEntry({
      id: `client-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      kind: "client_error",
      title,
      status: "failed",
      summary: error.message,
      logs: [`前端请求失败：${error.message}`],
      target,
      updated_at: new Date().toISOString(),
    });
  }

  useEffect(() => {
    if (!setupTask || (!isPairingTaskKind(setupTask.kind) && setupTask.kind !== "node_install")) return;
    let debugKind: PairingDebugEntry["kind"];
    switch (setupTask.kind) {
      case "node_install":
      case "gateway_probe":
      case "discovery_scan":
      case "discovery_pair":
      case "manual_pair":
        debugKind = setupTask.kind;
        break;
      default:
        return;
    }
    pushPairingDebugEntry({
      id: setupTask.task_id,
      kind: debugKind,
      title: setupTask.title,
      status: setupTask.status,
      summary: setupTask.summary,
      logs: setupTask.logs,
      target: setupTask.kind === "discovery_scan"
        ? `局域网广播${setupTask.metadata.discovery_port ? ` · UDP ${setupTask.metadata.discovery_port}` : ""}`
        : setupTask.kind === "node_install"
          ? (setupTask.metadata.install_dir || setupTask.metadata.node_id || "当前节点")
          : setupTask.kind === "gateway_probe"
            ? (setupTask.metadata.gateway_base_url || "目标网关")
            : (setupTask.metadata.lan_ip || setupTask.metadata.host || setupTask.metadata.node_id || "局域网配对"),
      updated_at: setupTask.updated_at,
    });
  }, [isPairingTaskKind, setupTask]);

  return {
    pushPairingDebugEntry,
    appendPairingClientError,
  };
}
