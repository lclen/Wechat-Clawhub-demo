import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { persistWorkspace, resolveWorkspaceOnTaskComplete } from "../roleWorkspace";
import { launcherShouldRunGateway } from "../selectors/launcherSelectors";
import type {
  LauncherStatusResponse,
  SetupProfileResponse,
  SetupRole,
  SetupTaskEnvelope,
  SetupTaskResult,
  WorkspaceTab,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;

type UseSetupTaskEffectsOptions = {
  requestJson: RequestJson;
  launcherStatus: LauncherStatusResponse | null;
  setupRole: SetupRole | null;
  setupTask: SetupTaskResult | null;
  setSetupTask: (next: SetupTaskResult | null) => void;
  setSetupProfile: (next: SetupProfileResponse | null) => void;
  setWorkspace: Dispatch<SetStateAction<WorkspaceTab>>;
  setNotice: (next: string) => void;
  applyLauncherPolicyForRole: (role: SetupRole) => Promise<void>;
};

export function useSetupTaskEffects(options: UseSetupTaskEffectsOptions) {
  const {
    requestJson,
    launcherStatus,
    setupRole,
    setupTask,
    setSetupTask,
    setSetupProfile,
    setWorkspace,
    setNotice,
    applyLauncherPolicyForRole,
  } = options;

  useEffect(() => {
    if (!setupTask || (setupTask.status !== "pending" && setupTask.status !== "running")) return;
    if (!launcherShouldRunGateway(launcherStatus)) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await requestJson<SetupTaskEnvelope>(`/api/setup/tasks/${encodeURIComponent(setupTask.task_id)}`);
        if (cancelled) return;
        setSetupTask(result.task);
        if (result.task.status === "succeeded") {
          if (setupRole === "worker_node") {
            await applyLauncherPolicyForRole("worker_node");
          }
          setNotice(result.task.summary || "快速配置执行完成。");
          const profile = await requestJson<SetupProfileResponse>("/api/setup/profile");
          if (!cancelled) {
            setSetupProfile(profile);
            if (setupRole) {
              setWorkspace((current) => {
                const next = resolveWorkspaceOnTaskComplete("succeeded", setupRole, current);
                persistWorkspace(next);
                return next;
              });
            }
          }
        } else if (result.task.status === "failed") {
          setNotice(result.task.summary || "快速配置执行失败，请检查日志。");
        }
      } catch (error) {
        if (!cancelled) setNotice(`读取配置任务失败：${(error as Error).message}`);
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyLauncherPolicyForRole, launcherStatus, requestJson, setNotice, setSetupProfile, setSetupTask, setWorkspace, setupRole, setupTask]);
}
