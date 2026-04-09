import { useCallback } from "react";
import {
  buildLauncherStartPayload,
  findLauncherComponent,
  launcherMachineRoleValue,
  launcherShouldRunGateway,
  runningLauncherComponents,
} from "../selectors/launcherSelectors";
import { isGatewayRole, setupRoleToLauncherMachineRole } from "../selectors/quickSetupSelectors";
import { resolveWorkerNodeId } from "../selectors/quickSetupSelectors";
import type { Dispatch, SetStateAction } from "react";
import type {
  LauncherLogResponse,
  LauncherMachineRole,
  LauncherRedisSource,
  LauncherStartRequest,
  LauncherStatusResponse,
  SetupRole,
  WorkerNodeSetupConfig,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;
type WithBusy = <T>(key: string, task: () => Promise<T>) => Promise<T>;

type UseLauncherControllerOptions = {
  requestJson: RequestJson;
  withBusy: WithBusy;
  launcherAvailable: boolean;
  launcherStatus: LauncherStatusResponse | null;
  gatewayDispatchModeEnabled: boolean;
  workerNodeId: string;
  effectiveRole: SetupRole | null;
  setNotice: (next: string) => void;
  setLauncherStatus: (next: LauncherStatusResponse | null) => void;
  setLauncherAvailable: (next: boolean) => void;
  setWorkerSetup: Dispatch<SetStateAction<WorkerNodeSetupConfig>>;
  setLauncherLogs: Dispatch<SetStateAction<Record<string, string>>>;
  refreshGatewaySummarySnapshot: () => Promise<unknown>;
  refreshLocalNodeDiagnostics: () => Promise<unknown>;
  roleName: (role: SetupRole) => string;
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useLauncherController(options: UseLauncherControllerOptions) {
  const {
    requestJson,
    withBusy,
    launcherAvailable,
    launcherStatus,
    gatewayDispatchModeEnabled,
    workerNodeId,
    effectiveRole,
    setNotice,
    setLauncherStatus,
    setLauncherAvailable,
    setWorkerSetup,
    setLauncherLogs,
    refreshGatewaySummarySnapshot,
    refreshLocalNodeDiagnostics,
    roleName,
  } = options;

  const applyLauncherStatusState = useCallback((status: LauncherStatusResponse) => {
    setLauncherStatus(status);
    setLauncherAvailable(true);
    setWorkerSetup((current) => ({
      ...current,
      node_id: resolveWorkerNodeId(current.node_id, status.profile),
      gateway_base_url: status.profile.gateway_base_url?.trim() || current.gateway_base_url,
    }));
  }, [setLauncherAvailable, setLauncherStatus, setWorkerSetup]);

  const refreshLauncherStatus = useCallback(async () => {
    try {
      const status = await requestJson<LauncherStatusResponse>("/local/bootstrap/status");
      applyLauncherStatusState(status);
      return status;
    } catch {
      setLauncherAvailable(false);
      return null;
    }
  }, [applyLauncherStatusState, requestJson, setLauncherAvailable]);

  const waitForGatewayReady = useCallback(async (expectedPid?: number | null) => {
    const maxAttempts = 12;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const status = await refreshLauncherStatus();
      const gateway = findLauncherComponent(status, "gateway");
      if (gateway?.state === "running" && (!expectedPid || gateway.pid === expectedPid || gateway.pid !== null)) {
        try {
          await refreshGatewaySummarySnapshot();
          return status;
        } catch {
          // gateway process is up, summary can still be warming up
        }
      }
      await sleep(500);
    }
    return await refreshLauncherStatus();
  }, [refreshGatewaySummarySnapshot, refreshLauncherStatus]);

  const ensureLauncherRuntimeForQuickSetup = useCallback(async (role: SetupRole) => {
    if (!launcherAvailable || !launcherStatus?.profile.workdir) return;
    if (!isGatewayRole(role)) return;
    const targetMachineRole = setupRoleToLauncherMachineRole(role);
    const running = runningLauncherComponents(launcherStatus);
    const needsLocalNode = targetMachineRole === "gateway_console" && !gatewayDispatchModeEnabled;
    const shouldStart =
      launcherMachineRoleValue(launcherStatus) !== targetMachineRole ||
      !running.has("host-redis") ||
      !running.has("gateway") ||
      (needsLocalNode && !running.has("local-node"));
    if (!shouldStart) return;
    try {
      const status = await withBusy(
        "launcher-start",
        () =>
          requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
            method: "POST",
            body: JSON.stringify(
              buildLauncherStartPayload(launcherStatus, targetMachineRole, {
                dispatchModeEnabled: gatewayDispatchModeEnabled,
                localNodeId: targetMachineRole === "node" ? workerNodeId : undefined,
              }),
            ),
          }),
      );
      applyLauncherStatusState(status);
      setNotice(`已为${roleName(role)}预启动本地组件，便于立即配置网关与节点。`);
    } catch (error) {
      const failure = error as Error & { code?: string };
      setNotice(failure.code === "external_port_in_use" ? `主网关端口被其它进程占用：${failure.message}` : `预启动本地组件失败：${failure.message}`);
    }
  }, [gatewayDispatchModeEnabled, launcherAvailable, launcherStatus, requestJson, roleName, setNotice, withBusy, workerNodeId, applyLauncherStatusState]);

  const applyLauncherPolicyForRole = useCallback(async (role: SetupRole) => {
    if (!launcherAvailable) return;
    const targetMachineRole = setupRoleToLauncherMachineRole(role);
    try {
      const status = await withBusy(
        "launcher-start",
        () =>
          requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
            method: "POST",
            body: JSON.stringify(
              buildLauncherStartPayload(launcherStatus, targetMachineRole, {
                dispatchModeEnabled: gatewayDispatchModeEnabled,
                localNodeId: targetMachineRole === "node" ? workerNodeId : undefined,
              }),
            ),
          }),
      );
      applyLauncherStatusState(status);
      setNotice(`已按${roleName(role)}收敛本地运行模型。`);
    } catch (error) {
      const failure = error as Error & { code?: string };
      setNotice(failure.code === "external_port_in_use" ? `主网关端口被其它进程占用：${failure.message}` : `按角色收敛本地运行模型失败：${failure.message}`);
    }
  }, [gatewayDispatchModeEnabled, launcherAvailable, launcherStatus, requestJson, roleName, setNotice, withBusy, workerNodeId, applyLauncherStatusState]);

  const installLauncherRedis = useCallback(async (target: "host" | "node-cache", source: LauncherRedisSource) => {
    try {
      setNotice(`正在下载 ${target === "host" ? "主机" : "节点缓存"} Redis，会自动尝试镜像源和官方源，请稍候（约 1-3 分钟）...`);
      const status = await withBusy(
        `launcher-install-${target}`,
        () =>
          requestJson<LauncherStatusResponse>("/local/bootstrap/install-redis", {
            method: "POST",
            body: JSON.stringify({ target, source }),
          }),
      );
      applyLauncherStatusState(status);
      setNotice(target === "host" ? "主机 Redis 已准备完成。" : "节点缓存 Redis 已准备完成。");
    } catch (error) {
      setNotice(`安装 Redis 失败：${(error as Error).message}`);
    }
  }, [requestJson, setNotice, withBusy, applyLauncherStatusState]);

  const startLauncherStack = useCallback(async (overrides?: { enableNodeCacheRedis?: boolean }) => {
    try {
      const defaultMachineRole: LauncherMachineRole = effectiveRole
        ? setupRoleToLauncherMachineRole(effectiveRole)
        : (launcherMachineRoleValue(launcherStatus) || "gateway_console");
      const enableNodeCacheRedis = overrides?.enableNodeCacheRedis ?? (launcherStatus?.profile.node_cache_policy !== "disabled");
      const status = await withBusy(
        "launcher-start",
        () =>
          requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
            method: "POST",
            body: JSON.stringify(
              buildLauncherStartPayload(launcherStatus, defaultMachineRole, {
                dispatchModeEnabled: gatewayDispatchModeEnabled,
                enableNodeCacheRedis,
                localNodeId: defaultMachineRole === "node" ? workerNodeId : undefined,
              }),
            ),
          }),
      );
      applyLauncherStatusState(status);
      setNotice(defaultMachineRole === "node" ? "节点服务启动命令已下发。" : "本地运行模型启动命令已下发。");
    } catch (error) {
      const failure = error as Error & { code?: string };
      setNotice(failure.code === "external_port_in_use" ? `主网关端口被其它进程占用：${failure.message}` : `启动本地组件失败：${failure.message}`);
    }
  }, [effectiveRole, gatewayDispatchModeEnabled, launcherStatus, requestJson, setNotice, withBusy, workerNodeId, applyLauncherStatusState]);

  const stopLauncherStack = useCallback(async (component?: string) => {
    try {
      const status = await withBusy(
        "launcher-stop",
        () =>
          requestJson<LauncherStatusResponse>("/local/bootstrap/stop", {
            method: "POST",
            body: JSON.stringify({ component: component || null }),
          }),
      );
      applyLauncherStatusState(status);
      setNotice(component ? `${component} 已停止。` : "已停止所有本地组件。");
    } catch (error) {
      setNotice(`停止组件失败：${(error as Error).message}`);
    }
  }, [requestJson, setNotice, withBusy, applyLauncherStatusState]);

  const toggleLauncherNodeCache = useCallback(async (enabled: boolean) => {
    try {
      const status = await withBusy(
        "launcher-node-cache-toggle",
        () =>
          requestJson<LauncherStatusResponse>("/local/bootstrap/node-cache/toggle", {
            method: "POST",
            body: JSON.stringify({ enabled }),
          }),
      );
      applyLauncherStatusState(status);
      setNotice(enabled ? "已启用节点本地缓存 Redis。" : "已关闭节点本地缓存 Redis。");
    } catch (error) {
      setNotice(`更新节点缓存策略失败：${(error as Error).message}`);
    }
  }, [requestJson, setNotice, withBusy, applyLauncherStatusState]);

  const readLauncherLog = useCallback(async (component: string) => {
    try {
      const result = await requestJson<LauncherLogResponse>(`/local/bootstrap/logs/${encodeURIComponent(component)}`);
      setLauncherLogs((current) => ({ ...current, [component]: result.content || "暂无日志" }));
    } catch (error) {
      setNotice(`读取组件日志失败：${(error as Error).message}`);
    }
  }, [requestJson, setLauncherLogs, setNotice]);

  const restartGatewayService = useCallback(async () => {
    if (!launcherAvailable) {
      setNotice("当前未检测到桌面启动器，无法重启主网关。");
      return;
    }
    const currentLauncherStatus = launcherStatus;
    const machineRole = effectiveRole
      ? setupRoleToLauncherMachineRole(effectiveRole)
      : (launcherMachineRoleValue(currentLauncherStatus) || "gateway_console");
    if (!launcherShouldRunGateway(currentLauncherStatus)) {
      setNotice("当前机器不是主网关托管角色，无法在本机重启主网关。");
      return;
    }

    try {
      const restarted = await withBusy("launcher-gateway-restart", async () => {
        const shouldRunBuiltinLocalNode = !(currentLauncherStatus?.profile.dispatch_mode_enabled ?? false);
        const restartPayload: LauncherStartRequest = {
          enable_gateway: true,
          enable_local_node: shouldRunBuiltinLocalNode,
          enable_node_cache_redis: currentLauncherStatus?.profile.node_cache_policy !== "disabled",
          dispatch_mode_enabled: currentLauncherStatus?.profile.dispatch_mode_enabled ?? false,
          redis_source: currentLauncherStatus?.profile.redis_source || "mirror",
          node_cache_redis_source: currentLauncherStatus?.profile.node_cache_redis_source || "mirror",
          local_node_id: currentLauncherStatus?.profile.local_node_id || (machineRole === "node" ? workerNodeId : "local-node"),
        };
        await requestJson<LauncherStatusResponse>("/local/bootstrap/stop", {
          method: "POST",
          body: JSON.stringify({ component: "gateway" }),
        });
        return requestJson<LauncherStatusResponse>("/local/bootstrap/start", {
          method: "POST",
          body: JSON.stringify(restartPayload),
        });
      });
      applyLauncherStatusState(restarted);
      const settledStatus = await waitForGatewayReady(findLauncherComponent(restarted, "gateway")?.pid ?? null);
      if (settledStatus) {
        applyLauncherStatusState(settledStatus);
      }
      await Promise.all([
        refreshGatewaySummarySnapshot().catch(() => null),
        refreshLocalNodeDiagnostics().catch(() => null),
      ]);
      setNotice("主网关已执行重启，当前状态已刷新。");
    } catch (error) {
      setNotice(`重启主网关失败：${(error as Error).message}`);
    }
  }, [
    applyLauncherStatusState,
    effectiveRole,
    gatewayDispatchModeEnabled,
    launcherAvailable,
    launcherStatus,
    refreshGatewaySummarySnapshot,
    refreshLocalNodeDiagnostics,
    requestJson,
    setNotice,
    waitForGatewayReady,
    withBusy,
    workerNodeId,
  ]);

  return {
    applyLauncherStatusState,
    refreshLauncherStatus,
    waitForGatewayReady,
    ensureLauncherRuntimeForQuickSetup,
    applyLauncherPolicyForRole,
    installLauncherRedis,
    startLauncherStack,
    stopLauncherStack,
    toggleLauncherNodeCache,
    readLauncherLog,
    restartGatewayService,
  };
}
