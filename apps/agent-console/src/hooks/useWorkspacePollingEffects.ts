import { useEffect } from "react";

type UseWorkspacePollingEffectsOptions = {
  launcherAvailable: boolean;
  workspace: string;
  refreshLocalNodeSnapshot: () => Promise<void>;
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
      try {
        await refreshLocalNodeSnapshot();
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void run(), 4000);
      }
    };
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [launcherAvailable, refreshLocalNodeSnapshot, workspace]);

  useEffect(() => {
    if (!launcherAvailable || workspace !== "logs") return;
    let cancelled = false;
    let timer = 0;
    const run = async () => {
      await refreshRuntimeLogs({ silent: true });
      if (!cancelled) {
        timer = window.setTimeout(() => void run(), 4000);
      }
    };
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [launcherAvailable, launcherStatusKey, refreshRuntimeLogs, workspace]);
}
