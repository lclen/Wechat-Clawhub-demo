import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { applyGatewaySummaryToState, resolvePreferredGatewayBaseUrl } from "../appBootstrap";
import { hasText, safeTrim } from "../stringUtils";
import type {
  ConsoleSetupConfig,
  GatewayConsoleSetupRequest,
  GatewaySetupConfig,
  GatewaySetupSaveRequest,
  GatewaySetupSaveResponse,
  GatewaySummaryResponse,
  LauncherStatusResponse,
  ModelStatus,
  SetupProfileResponse,
  SetupRole,
  SetupTaskEnvelope,
  SystemStatus,
  WorkerNodeSetupConfig,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;
type WithBusy = <T>(key: string, task: () => Promise<T>) => Promise<T>;

type UseQuickSetupOperationsOptions = {
  requestJson: RequestJson;
  withBusy: WithBusy;
  shouldUseLocalGatewayApi: boolean;
  sessionRemoteGatewayBaseUrl: string;
  currentRoleIsWorker: boolean;
  launcherAvailable: boolean;
  runtimeMachineRole: string | null;
  systemStatus: SystemStatus | null;
  gatewaySetup: GatewaySetupConfig;
  workerSetup: WorkerNodeSetupConfig;
  consoleSetup: ConsoleSetupConfig;
  setupRole: SetupRole | null;
  setupMode: "status" | "role" | "config" | "preview" | "result";
  refreshGatewaySummarySnapshot: () => Promise<GatewaySummaryResponse | null>;
  refreshLauncherStatus: () => Promise<LauncherStatusResponse | null>;
  syncSetupProfileState: (
    profile: SetupProfileResponse,
    preferredGatewayBaseUrl: string,
    options?: { syncLastTask?: boolean; system?: SystemStatus | null },
  ) => void;
  setSetupTask: (next: SetupTaskEnvelope["task"] | null) => void;
  setSetupMode: (next: "status" | "role" | "config" | "preview" | "result") => void;
  setWechatBaseUrl: (next: string) => void;
  setManualToken: (next: string) => void;
  setWorkerSetup: Dispatch<SetStateAction<WorkerNodeSetupConfig>>;
  setModelStatus: (next: ModelStatus | null) => void;
  setSystemStatus: (next: SystemStatus | null) => void;
  setWechatStatus: (next: GatewaySummaryResponse["wechat"] | null) => void;
  syncNodeStateView: (next: GatewaySummaryResponse["nodes"], options?: { selectNode?: boolean }) => void;
  setNotice: (next: string) => void;
  applyLauncherPolicyForRole: (role: SetupRole) => Promise<void>;
  validateWorkerGatewayUrl: (value: string) => boolean;
  onWorkerInstallStarted?: () => void;
  onRefreshSystemStatus?: (next: SystemStatus | null) => void;
};

export function useQuickSetupOperations(options: UseQuickSetupOperationsOptions) {
  const {
    requestJson,
    withBusy,
    shouldUseLocalGatewayApi,
    sessionRemoteGatewayBaseUrl,
    currentRoleIsWorker,
    launcherAvailable,
    runtimeMachineRole,
    systemStatus,
    gatewaySetup,
    workerSetup,
    consoleSetup,
    setupRole,
    setupMode,
    refreshGatewaySummarySnapshot,
    refreshLauncherStatus,
    syncSetupProfileState,
    setSetupTask,
    setSetupMode,
    setWechatBaseUrl,
    setManualToken,
    setWorkerSetup,
    setModelStatus,
    setSystemStatus,
    setWechatStatus,
    syncNodeStateView,
    setNotice,
    applyLauncherPolicyForRole,
    validateWorkerGatewayUrl,
    onWorkerInstallStarted,
    onRefreshSystemStatus,
  } = options;

  const refreshSetupProfile = useCallback(async () => {
    const profile = shouldUseLocalGatewayApi
      ? await requestJson<SetupProfileResponse>("/api/setup/profile")
      : await requestJson<SetupProfileResponse>("/local/setup/profile");
    const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, systemStatus);
    syncSetupProfileState(profile, preferredGatewayBaseUrl, { system: systemStatus });
  }, [requestJson, shouldUseLocalGatewayApi, syncSetupProfileState, systemStatus]);

  const refreshQuickSetupStatus = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!shouldUseLocalGatewayApi) {
        const remoteGateway = safeTrim(sessionRemoteGatewayBaseUrl);
        const [profile, remoteSummary] = await Promise.all([
          requestJson<SetupProfileResponse>("/local/setup/profile"),
          remoteGateway
            ? requestJson<GatewaySummaryResponse>(`${remoteGateway}/api/system/summary`).catch(() => null)
            : Promise.resolve(null),
        ]);
        const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, remoteSummary?.system ?? systemStatus);
        syncSetupProfileState(profile, preferredGatewayBaseUrl, {
          syncLastTask: true,
          system: remoteSummary?.system ?? systemStatus,
        });
        if (remoteSummary) {
          applyGatewaySummaryToState(remoteSummary, {
            setSystemStatus: (next) => setSystemStatus(next),
            setWechatStatus: (next) => setWechatStatus(next),
            setWechatBaseUrl,
            syncNodeStateView,
          });
        }
        if (launcherAvailable) {
          await refreshLauncherStatus();
        }
        if (!options?.silent) {
          setNotice(
            remoteGateway
              ? currentRoleIsWorker
                ? "已刷新当前节点状态与远端网关连接信息。"
                : "已刷新当前连接状态。"
              : "已刷新当前本机状态。",
          );
        }
        return;
      }
      const [profile, summary, model] = await Promise.all([
        requestJson<SetupProfileResponse>("/api/setup/profile"),
        refreshGatewaySummarySnapshot(),
        requestJson<ModelStatus>("/api/models/builtin/status"),
      ]);
      const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(profile, summary?.system ?? systemStatus);
      syncSetupProfileState(profile, preferredGatewayBaseUrl, {
        syncLastTask: true,
        system: summary?.system ?? systemStatus,
      });
      setModelStatus(model);
      if (launcherAvailable) {
        await refreshLauncherStatus();
      }
      if (!options?.silent) {
        setNotice("已刷新当前连接状态。");
      }
    } catch (error) {
      setNotice(`刷新快速配置状态失败：${(error as Error).message}`);
    }
  }, [
    currentRoleIsWorker,
    launcherAvailable,
    refreshGatewaySummarySnapshot,
    refreshLauncherStatus,
    requestJson,
    sessionRemoteGatewayBaseUrl,
    setManualToken,
    setModelStatus,
    setNotice,
    setSystemStatus,
    setWechatBaseUrl,
    setWechatStatus,
    shouldUseLocalGatewayApi,
    syncNodeStateView,
    syncSetupProfileState,
    systemStatus,
  ]);

  const refreshSystemStatus = useCallback(async () => {
    if (!shouldUseLocalGatewayApi) return;
    const next = (await refreshGatewaySummarySnapshot())?.system ?? null;
    onRefreshSystemStatus?.(next);
    return next;
  }, [onRefreshSystemStatus, refreshGatewaySummarySnapshot, shouldUseLocalGatewayApi]);

  const runGatewaySetup = useCallback(async (options?: { showResultScreen?: boolean; successNotice?: string }) => {
    const showResultScreen = options?.showResultScreen ?? true;
    try {
      const payload: GatewaySetupSaveRequest = {
        config: gatewaySetup,
        console_gateway_base_url: consoleSetup.gateway_base_url || undefined,
      };
      const result = await withBusy(
        "setup-gateway",
        () => requestJson<GatewaySetupSaveResponse>("/api/setup/gateway/save", { method: "POST", body: JSON.stringify(payload) }),
      );
      setSetupTask(result.task);
      if (showResultScreen) {
        setSetupMode("result");
      }
      if (gatewaySetup.wechat_base_url) setWechatBaseUrl(gatewaySetup.wechat_base_url);
      if (gatewaySetup.wechat_token) setManualToken(gatewaySetup.wechat_token);
      await refreshSetupProfile();
      await applyLauncherPolicyForRole("gateway_host");
      setNotice(options?.successNotice || result.task.summary);
    } catch (error) {
      setNotice(`保存网关配置失败：${(error as Error).message}`);
    }
  }, [
    applyLauncherPolicyForRole,
    gatewaySetup,
    consoleSetup.gateway_base_url,
    refreshSetupProfile,
    requestJson,
    setManualToken,
    setNotice,
    setSetupMode,
    setSetupTask,
    setWechatBaseUrl,
    withBusy,
  ]);

  const runWorkerSetup = useCallback(async (options?: { showResultScreen?: boolean }) => {
    const showResultScreen = options?.showResultScreen ?? true;
    try {
      if (launcherAvailable && runtimeMachineRole !== "node") {
        await applyLauncherPolicyForRole("worker_node");
      }
      if (launcherAvailable && hasText(workerSetup.gateway_base_url)) {
        await requestJson<LauncherStatusResponse>("/local/bootstrap/set-gateway-url", {
          method: "POST",
          body: JSON.stringify({ gateway_base_url: safeTrim(workerSetup.gateway_base_url) }),
        });
        await refreshLauncherStatus();
      }
      const result = await withBusy(
        "setup-worker",
        () => requestJson<SetupTaskEnvelope>("/local/node/install", { method: "POST", body: JSON.stringify({ config: workerSetup }) }),
      );
      setSetupTask(result.task);
      if (showResultScreen) setSetupMode("result");
      setWorkerSetup((current) => ({
        ...current,
        gateway_base_url: result.task.metadata.gateway_base_url || current.gateway_base_url,
        node_token: "",
      }));
      onWorkerInstallStarted?.();
      await refreshSetupProfile();
      setNotice("节点安装任务已启动；本次不会生成 token，安装完成后请到网关角色下完成配对。");
    } catch (error) {
      setNotice(`启动工作节点安装失败：${(error as Error).message}`);
    }
  }, [
    applyLauncherPolicyForRole,
    launcherAvailable,
    onWorkerInstallStarted,
    refreshLauncherStatus,
    refreshSetupProfile,
    requestJson,
    runtimeMachineRole,
    setNotice,
    setSetupMode,
    setSetupTask,
    setWorkerSetup,
    withBusy,
    workerSetup,
  ]);

  const runConsoleSetup = useCallback(async () => {
    try {
      const remoteGatewayBaseUrl = safeTrim(sessionRemoteGatewayBaseUrl) || safeTrim(consoleSetup.gateway_base_url);
      const localOrigin = safeTrim(window.location.origin);
      const shouldUseRemoteEndpoint = Boolean(remoteGatewayBaseUrl) && remoteGatewayBaseUrl !== localOrigin;
      const endpoint = shouldUseRemoteEndpoint
        ? `${remoteGatewayBaseUrl}/api/setup/console/connect`
        : shouldUseLocalGatewayApi
          ? "/api/setup/console/connect"
          : remoteGatewayBaseUrl
            ? `${remoteGatewayBaseUrl}/api/setup/console/connect`
            : "";
      if (!endpoint) {
        setNotice("请先填写可访问的目标网关地址，再执行控制台接入校验。");
        return;
      }
      const result = await withBusy(
        "setup-console",
        () => requestJson<SetupTaskEnvelope>(endpoint, { method: "POST", body: JSON.stringify({ config: consoleSetup }) }),
      );
      setSetupTask(result.task);
      setSetupMode("result");
      await refreshSetupProfile();
      await applyLauncherPolicyForRole("console_only");
      setNotice(result.task.summary);
    } catch (error) {
      setNotice(`校验控制台连接失败：${(error as Error).message}`);
    }
  }, [
    applyLauncherPolicyForRole,
    consoleSetup,
    refreshSetupProfile,
    requestJson,
    sessionRemoteGatewayBaseUrl,
    setNotice,
    setSetupMode,
    setSetupTask,
    shouldUseLocalGatewayApi,
    withBusy,
  ]);

  const runGatewayConsoleSetup = useCallback(async () => {
    try {
      const payload: GatewayConsoleSetupRequest = { gateway: gatewaySetup, console: consoleSetup };
      const result = await withBusy(
        "setup-gateway-console",
        () => requestJson<SetupTaskEnvelope>("/api/setup/gateway-console/run", { method: "POST", body: JSON.stringify(payload) }),
      );
      setSetupTask(result.task);
      setSetupMode("result");
      if (gatewaySetup.wechat_base_url) setWechatBaseUrl(gatewaySetup.wechat_base_url);
      if (gatewaySetup.wechat_token) setManualToken(gatewaySetup.wechat_token);
      await refreshSetupProfile();
      await applyLauncherPolicyForRole("gateway_host_console");
      setNotice(result.task.summary);
    } catch (error) {
      setNotice(`执行网关主机+控制台配置失败：${(error as Error).message}`);
    }
  }, [
    applyLauncherPolicyForRole,
    consoleSetup,
    gatewaySetup,
    refreshSetupProfile,
    requestJson,
    setManualToken,
    setNotice,
    setSetupMode,
    setSetupTask,
    setWechatBaseUrl,
    withBusy,
  ]);

  const toggleGatewayDispatchMode = useCallback(async (enabled: boolean) => {
    const result = await requestJson<SetupTaskEnvelope>("/api/setup/gateway/dispatch-mode", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    setSetupTask(result.task);
  }, [requestJson, setSetupTask]);

  const toggleLauncherDispatchMode = useCallback(async (enabled: boolean) => {
    await requestJson<LauncherStatusResponse>("/local/bootstrap/dispatch-mode", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    await refreshLauncherStatus();
  }, [refreshLauncherStatus, requestJson]);

  const applyDispatchMode = useCallback(async (enabled: boolean) => {
    try {
      await withBusy("dispatch-mode-toggle", async () => {
        await toggleGatewayDispatchMode(enabled);
        if (launcherAvailable) {
          await toggleLauncherDispatchMode(enabled);
        }
      });
      await Promise.all([
        refreshSetupProfile(),
        refreshGatewaySummarySnapshot(),
        refreshLauncherStatus(),
      ]);
      setNotice(enabled ? "已开启分发模式：当前主机只负责分发，不再由本机节点处理消息。" : "已关闭分发模式：本机节点可重新参与调度。");
    } catch (error) {
      setNotice(`更新分发模式失败：${(error as Error).message}`);
    }
  }, [
    launcherAvailable,
    refreshGatewaySummarySnapshot,
    refreshLauncherStatus,
    refreshSetupProfile,
    setNotice,
    toggleGatewayDispatchMode,
    toggleLauncherDispatchMode,
    withBusy,
  ]);

  const submitSetupRole = useCallback(() => {
    if (!setupRole) {
      setNotice("请先选择一个部署角色。");
      return;
    }
    if (setupMode === "config") {
      if (setupRole === "worker_node" && !validateWorkerGatewayUrl(workerSetup.gateway_base_url)) {
        setNotice("请填写目标网关地址后再继续。");
        return;
      }
      setSetupMode("preview");
      return;
    }
    if (setupRole === "gateway_host") {
      void runGatewaySetup();
      return;
    }
    if (setupRole === "gateway_host_console") {
      void runGatewayConsoleSetup();
      return;
    }
    if (setupRole === "worker_node") {
      void runWorkerSetup();
      return;
    }
    void runConsoleSetup();
  }, [
    runConsoleSetup,
    runGatewayConsoleSetup,
    runGatewaySetup,
    runWorkerSetup,
    setNotice,
    setSetupMode,
    setupMode,
    setupRole,
    validateWorkerGatewayUrl,
    workerSetup.gateway_base_url,
  ]);

  return {
    refreshSetupProfile,
    refreshQuickSetupStatus,
    refreshSystemStatus,
    runGatewaySetup,
    runWorkerSetup,
    runConsoleSetup,
    runGatewayConsoleSetup,
    applyDispatchMode,
    submitSetupRole,
  };
}
