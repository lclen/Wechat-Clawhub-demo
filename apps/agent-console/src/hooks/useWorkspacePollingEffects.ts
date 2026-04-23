import { useEffect } from "react";

const CONNECTION_SNAPSHOT_POLL_MS = 12000;
const LOGS_POLL_MS = 4000;

type UseWorkspacePollingEffectsOptions = {
  launcherAvailable: boolean;
  workspace: string;
  refreshLocalNodeSnapshot: () => Promise<unknown>;
  refreshRuntimeLogs: (options?: { silent?: boolean }) => Promise<void>;
  launcherStatusKey: string;
};

export function useWorkspacePollingEffects(options: UseWorkspacePollingEffectsOptions) {
  const {
    launcherAvailable,
    workspace,
    refreshLocalNodeSnapshot,
    refreshRuntimeLogs,
    launcherStatusKey,
  } = options;

  useEffect(() => {
    if (!launcherAvailable || workspace !== "connection") return;
    let cancelled = false;
    let timer = 0;
    const run = async () => {
      if (document.hidden) {
        if (!cancelled) {
          timer = window.setTimeout(() => void run(), CONNECTION_SNAPSHOT_POLL_MS);
        }
        return;
      }
      try {
        await refreshLocalNodeSnapshot();
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void run(), CONNECTION_SNAPSHOT_POLL_MS);
      }
    };
    void run();
    const onVisible = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [launcherAvailable, refreshLocalNodeSnapshot, workspace]);

  useEffect(() => {
    if (!launcherAvailable || workspace !== "logs") return;
    let cancelled = false;
    let timer = 0;
    const run = async () => {
      await refreshRuntimeLogs({ silent: true });
      if (!cancelled) {
        timer = window.setTimeout(() => void run(), LOGS_POLL_MS);
      }
    };
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [launcherAvailable, launcherStatusKey, refreshRuntimeLogs, workspace]);
}
