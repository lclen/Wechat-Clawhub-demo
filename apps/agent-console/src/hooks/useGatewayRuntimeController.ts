import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { applyGatewaySummaryToState, resolvePreferredGatewayBaseUrl } from "../appBootstrap";
import { resolveInitialWorkspace } from "../roleWorkspace";
import { launcherMachineRoleValue, launcherShouldRunGateway } from "../selectors/launcherSelectors";
import { resolveWorkerGatewayBaseUrl, resolveWorkerNodeId } from "../selectors/quickSetupSelectors";
import type {
  AppSummaryStateCache,
  AppUiStateCache,
  GatewaySummaryResponse,
  LauncherStatusResponse,
  ModelStatus,
  SetupProfileResponse,
  SetupMode,
  SetupTaskResult,
  SystemStatus,
  WeChatStatus,
  WorkerNodeSetupConfig,
  WorkspaceTab,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;
type RefreshGatewaySummaryOptions = {
  force?: boolean;
  minIntervalMs?: number;
};

const GATEWAY_SUMMARY_MIN_INTERVAL_MS = 8000;
const LOCAL_BOOTSTRAP_TIMEOUT_MS = 3500;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer));
  });
}

type UseGatewayRuntimeControllerOptions = {
  initialUiState: AppUiStateCache;
  initialSummaryState: AppSummaryStateCache;
  systemStatus: SystemStatus | null;
  currentRoleIsWorker: boolean;
  currentRoleIsConsole: boolean;
  localGatewayManaged: boolean | null;
  shouldUseRemoteGatewayApi: boolean;
  sessionRemoteGatewayBaseUrl: string;
  requestJson: RequestJson;
  syncSetupProfileState: (
    profile: SetupProfileResponse,
    preferredGatewayBaseUrl: string,
    options?: { syncLastTask?: boolean; system?: SystemStatus | null },
  ) => void;
  syncNodeStateView: (next: GatewaySummaryResponse["nodes"], options?: { selectNode?: boolean }) => void;
  setWorkspace: (next: WorkspaceTab) => void;
  setSetupProfile: (next: SetupProfileResponse | null) => void;
  setSetupMode: Dispatch<SetStateAction<SetupMode>>;
  setSetupTask: (next: SetupTaskResult | null) => void;
  setWorkerGatewayProbeTask: (next: SetupTaskResult | null) => void;
  setLauncherStatus: (next: LauncherStatusResponse | null) => void;
  setLauncherAvailable: (next: boolean) => void;
  setWorkerSetup: Dispatch<SetStateAction<WorkerNodeSetupConfig>>;
  setModelStatus: (next: ModelStatus | null) => void;
  setSystemStatus: (next: SystemStatus | null) => void;
  setWechatStatus: (next: WeChatStatus | null) => void;
  setWechatBaseUrl: (next: string) => void;
  setNotice: (next: string) => void;
  setupCompleted: boolean;
  retryPollMs: number;
};

export function useGatewayRuntimeController(options: UseGatewayRuntimeControllerOptions) {
  const {
    initialUiState,
    initialSummaryState,
    systemStatus,
    localGatewayManaged,
    shouldUseRemoteGatewayApi,
    sessionRemoteGatewayBaseUrl,
    requestJson,
    syncSetupProfileState,
    syncNodeStateView,
    setWorkspace,
    setSetupProfile,
    setSetupMode,
    setSetupTask,
    setWorkerGatewayProbeTask,
    setLauncherStatus,
    setLauncherAvailable,
    setWorkerSetup,
    setModelStatus,
    setSystemStatus,
    setWechatStatus,
    setWechatBaseUrl,
    setNotice,
    setupCompleted,
    retryPollMs,
  } = options;
  const gatewaySummaryRequestRef = useRef<Promise<GatewaySummaryResponse | null> | null>(null);
  const lastGatewaySummaryAtRef = useRef(0);
  const latestGatewaySummaryRef = useRef<GatewaySummaryResponse | null>(null);

  const refreshGatewaySummarySnapshot = useCallback(async (options?: RefreshGatewaySummaryOptions) => {
    const usesRemoteGateway = shouldUseRemoteGatewayApi;
    const remoteGateway = usesRemoteGateway ? sessionRemoteGatewayBaseUrl : "";
    const force = options?.force ?? false;
    const minIntervalMs = options?.minIntervalMs ?? GATEWAY_SUMMARY_MIN_INTERVAL_MS;

    if (!force) {
      if (gatewaySummaryRequestRef.current) {
        return gatewaySummaryRequestRef.current;
      }
      if (
        latestGatewaySummaryRef.current
        && Date.now() - lastGatewaySummaryAtRef.current < minIntervalMs
      ) {
        return latestGatewaySummaryRef.current;
      }
    }

    const request = (async () => {
      let summary: GatewaySummaryResponse | null = null;
      if (usesRemoteGateway) {
        if (!remoteGateway) return null;
        summary = await requestJson<GatewaySummaryResponse>(`${remoteGateway}/api/system/summary`);
      } else if (localGatewayManaged !== false) {
        summary = await requestJson<GatewaySummaryResponse>("/api/system/summary");
      }
      if (!summary) {
        return null;
      }
      lastGatewaySummaryAtRef.current = Date.now();
      latestGatewaySummaryRef.current = summary;
      applyGatewaySummaryToState(summary, {
        setSystemStatus: (next) => setSystemStatus(next),
        setWechatStatus: (next) => setWechatStatus(next),
        setWechatBaseUrl,
        syncNodeStateView,
      });
      return summary;
    })().finally(() => {
      gatewaySummaryRequestRef.current = null;
    });

    gatewaySummaryRequestRef.current = request;

    if (usesRemoteGateway) {
      return request;
    }
    if (localGatewayManaged === false) {
      return null;
    }
    return request;
  }, [
    localGatewayManaged,
    requestJson,
    sessionRemoteGatewayBaseUrl,
    setSystemStatus,
    setWechatBaseUrl,
    setWechatStatus,
    shouldUseRemoteGatewayApi,
    syncNodeStateView,
  ]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;
    const init = async () => {
      let launcherSt: LauncherStatusResponse | null = null;
      const applyLocalProfile = (localProfile: SetupProfileResponse, notice: string) => {
        setSetupProfile(localProfile);
        const initialWorkspace = localProfile.setup_completed
          ? (initialUiState.workspace ?? resolveInitialWorkspace(localProfile))
          : "quick_setup";
        setWorkspace(initialWorkspace);
        setSetupMode(localProfile.setup_completed ? "status" : "role");
        setLauncherAvailable(true);
        setNotice(notice);
      };
      try {
        try {
          launcherSt = await withTimeout(
            requestJson<LauncherStatusResponse>("/local/bootstrap/status"),
            LOCAL_BOOTSTRAP_TIMEOUT_MS,
            "local bootstrap status",
          );
        } catch {
          // launcher unavailable is allowed here
        }
        if (cancelled) return;

        if (!launcherSt) {
          try {
            const localProfile = await withTimeout(
              requestJson<SetupProfileResponse>("/local/setup/profile"),
              LOCAL_BOOTSTRAP_TIMEOUT_MS,
              "local setup profile",
            );
            if (!cancelled && (localProfile.setup_completed || localProfile.completed_roles.length)) {
              applyLocalProfile(localProfile, "已恢复本机角色配置，运行态状态正在后台同步。");
              return;
            }
          } catch {
            // fall back to gateway bootstrap below
          }
          if (cancelled) return;
        }

        if (launcherSt) {
          const launcherProfile = launcherSt.profile;
          setLauncherStatus(launcherSt);
          setLauncherAvailable(true);
          setWorkerSetup((current) => ({
            ...current,
            node_id: resolveWorkerNodeId(current.node_id, launcherProfile),
            gateway_base_url: launcherProfile.gateway_base_url?.trim() || current.gateway_base_url,
          }));
          const runtimeRole = launcherMachineRoleValue(launcherSt);
          const gatewayShouldRun = launcherShouldRunGateway(launcherSt);
          if (!gatewayShouldRun) {
            if (runtimeRole === "node") {
              try {
                const localProfile = await withTimeout(
                  requestJson<SetupProfileResponse>("/local/setup/profile"),
                  LOCAL_BOOTSTRAP_TIMEOUT_MS,
                  "local setup profile",
                );
                if (!cancelled) {
                  applyLocalProfile(localProfile, "当前为节点角色，网关运行在远端机器上。");
                }
              } catch {
                // ignore launcher-only setup bootstrap errors
              }
            } else {
              setWorkspace(initialUiState.workspace ?? "quick_setup");
              setSetupMode("role");
              setNotice(runtimeRole === "console" ? "当前为控制台角色，本机不托管网关；请选择并连接目标网关。" : "当前机器未托管本地网关，请先选择角色并完成连接。");
            }
            return;
          }
        }

        const summaryPromise = refreshGatewaySummarySnapshot({ force: true, minIntervalMs: 0 }).catch(() => null);
        const profile = await requestJson<SetupProfileResponse>("/api/setup/profile");
        if (cancelled) return;

        const bootstrapSystem = initialSummaryState.system_status ?? systemStatus;
        const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, bootstrapSystem);
        setSetupProfile(profile);
        const initialWorkspace = profile.setup_completed
          ? (initialUiState.workspace ?? resolveInitialWorkspace(profile))
          : "quick_setup";
        setWorkspace(initialWorkspace);
        setSetupTask(profile.last_task);
        setWorkerGatewayProbeTask(profile.last_task?.kind === "gateway_probe" ? profile.last_task : null);
        setSetupMode(profile.setup_completed ? "status" : "role");
        syncSetupProfileState(profile, preferredGatewayBaseUrl, {
          syncLastTask: true,
          system: bootstrapSystem,
        });
        setNotice(
          profile.recommended_workspace === "quick_setup"
            ? "检测到这是首次启动，先完成快速配置。"
            : bootstrapSystem
              ? (bootstrapSystem.redis_ok
                  ? "已从缓存恢复主网关摘要，正在同步最新状态。"
                  : "已恢复上次主网关摘要，正在重新校验当前状态。")
              : "正在同步主网关最新状态…",
        );

        const summary = await summaryPromise;
        if (!cancelled && summary) {
          setWorkerSetup((current) => ({
            ...current,
            gateway_base_url: resolveWorkerGatewayBaseUrl(current.gateway_base_url, profile, summary.system),
          }));
          setNotice(
            profile.recommended_workspace === "quick_setup"
              ? "检测到这是首次启动，先完成快速配置。"
              : summary.system.redis_ok
                ? "主网关在线。微信、节点和会话概览会通过实时流持续更新。"
                : "主网关已启动，但 Redis 当前不可用。",
          );
        }

        void requestJson<ModelStatus>("/api/models/builtin/status").then((model) => {
          if (!cancelled) {
            setModelStatus(model);
          }
        });
      } catch {
        if (!cancelled) {
          const runtimeRole = launcherMachineRoleValue(launcherSt);
          const localManaged = launcherShouldRunGateway(launcherSt);
          const isRemoteGatewayRole = runtimeRole === "node" || runtimeRole === "console" || localManaged === false;
          setNotice(isRemoteGatewayRole ? (runtimeRole === "console" ? "当前为控制台角色，本机不托管网关。" : "当前为节点角色，网关运行在远端机器上。") : "正在等待主网关启动…");
          if (!isRemoteGatewayRole) {
            retryTimer = window.setTimeout(() => void init(), retryPollMs);
          }
        }
      }
    };

    void init();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (!setupCompleted) return;
    setSetupMode((current) => (current === "config" || current === "preview" ? current : "status"));
  }, [setupCompleted, setSetupMode]);

  return {
    refreshGatewaySummarySnapshot,
  };
}
