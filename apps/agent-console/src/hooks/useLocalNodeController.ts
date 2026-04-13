import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { buildLocalNodeModelDraftFromStatus } from "../appBootstrap";
import { hasText, safeTrim } from "../stringUtils";
import type {
  LauncherLogResponse,
  LauncherStatusResponse,
  LocalNodeActionResponse,
  LocalNodeChannelAssessmentApplyRequest,
  LocalNodeChannelAssessmentResult,
  LocalNodeChannelAssessmentStartRequest,
  LocalNodeConversationTestRequest,
  LocalNodeConversationTestResponse,
  LocalNodeExportResponse,
  LocalNodeLogsResponse,
  LocalNodeModelConfigRequest,
  LocalNodeStatusResponse,
} from "../types";

const MAX_CHANNEL_ASSESSMENT_ROUNDS = 999;

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;
type WithBusy = <T>(key: string, task: () => Promise<T>) => Promise<T>;

type UseLocalNodeControllerOptions = {
  requestJson: RequestJson;
  withBusy: WithBusy;
  launcherAvailable: boolean;
  launcherStatus: LauncherStatusResponse | null;
  localNodeStatus: LocalNodeStatusResponse | null;
  assessmentMaxRounds: number;
  assessmentApplyStrategy: "balanced" | "peak";
  localNodeModelDirty: boolean;
  localNodeModelDraft: LocalNodeModelConfigRequest;
  setLocalNodeStatus: (next: LocalNodeStatusResponse | null) => void;
  setLocalNodeLogs: (next: LocalNodeLogsResponse | null) => void;
  setLauncherLogs: Dispatch<SetStateAction<Record<string, string>>>;
  setRuntimeLogsRefreshing: (next: boolean) => void;
  setLocalNodeModelDraft: Dispatch<SetStateAction<LocalNodeModelConfigRequest>>;
  setLocalNodeModelDirty: (next: boolean) => void;
  setNotice: (next: string) => void;
  refreshLauncherStatus: () => Promise<LauncherStatusResponse | null>;
};

export function useLocalNodeController(options: UseLocalNodeControllerOptions) {
  const {
    requestJson,
    withBusy,
    launcherAvailable,
    launcherStatus,
    localNodeStatus,
    assessmentMaxRounds,
    assessmentApplyStrategy,
    localNodeModelDirty,
    localNodeModelDraft,
    setLocalNodeStatus,
    setLocalNodeLogs,
    setLauncherLogs,
    setRuntimeLogsRefreshing,
    setLocalNodeModelDraft,
    setLocalNodeModelDirty,
    setNotice,
    refreshLauncherStatus,
  } = options;
  const localNodeModelDirtyRef = useRef(localNodeModelDirty);
  const refreshLauncherStatusRef = useRef(refreshLauncherStatus);

  useEffect(() => {
    localNodeModelDirtyRef.current = localNodeModelDirty;
  }, [localNodeModelDirty]);

  useEffect(() => {
    refreshLauncherStatusRef.current = refreshLauncherStatus;
  }, [refreshLauncherStatus]);

  const refreshLocalNodeStatus = useCallback(async () => {
    if (!launcherAvailable) return;
    try {
      const status = await requestJson<LocalNodeStatusResponse>("/local/node/status");
      setLocalNodeStatus(status);
      if (!localNodeModelDirtyRef.current) {
        setLocalNodeModelDraft(buildLocalNodeModelDraftFromStatus(status));
      }
    } catch {
      // local diagnostics are best-effort
    }
  }, [launcherAvailable, requestJson, setLocalNodeModelDraft, setLocalNodeStatus]);

  useEffect(() => {
    if (!launcherAvailable) return undefined;
    if (localNodeStatus?.channel_assessment?.status !== "running") return undefined;
    const timer = window.setTimeout(() => {
      void requestJson<LocalNodeChannelAssessmentResult>("/local/node/channel-assessment")
        .then(() => refreshLocalNodeStatus())
        .catch(() => undefined);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [launcherAvailable, localNodeStatus?.channel_assessment?.status, refreshLocalNodeStatus, requestJson]);

  const refreshLocalNodeLogs = useCallback(async () => {
    if (!launcherAvailable) return;
    try {
      const logs = await requestJson<LocalNodeLogsResponse>("/local/node/logs");
      setLocalNodeLogs(logs);
    } catch {
      // local logs are best-effort
    }
  }, [launcherAvailable, requestJson, setLocalNodeLogs]);

  const refreshLocalNodeDiagnostics = useCallback(async () => {
    await Promise.all([refreshLocalNodeStatus(), refreshLocalNodeLogs()]);
  }, [refreshLocalNodeLogs, refreshLocalNodeStatus]);

  const refreshRuntimeLogs = useCallback(async (options?: { silent?: boolean }) => {
    if (!launcherAvailable) return;
    const trackedComponents = (launcherStatus?.components || []).filter((component) =>
      ["gateway", "host-redis", "local-node", "node-cache-redis"].includes(component.name)
        && (component.log_path || component.state !== "stopped" || component.error_code),
    );
    setRuntimeLogsRefreshing(true);
    try {
      const launcherLogResults = await Promise.all(
        trackedComponents.map(async (component) => {
          try {
            const result = await requestJson<LauncherLogResponse>(`/local/bootstrap/logs/${encodeURIComponent(component.name)}`);
            return [component.name, result.content || "暂无日志"] as const;
          } catch {
            return [component.name, "日志读取失败"] as const;
          }
        }),
      );
      setLauncherLogs((current) => ({
        ...current,
        ...Object.fromEntries(launcherLogResults),
      }));
      if (launcherStatus?.profile.enable_local_node) {
        await refreshLocalNodeLogs();
      }
    } catch (error) {
      if (!options?.silent) {
        setNotice(`刷新运行日志失败：${(error as Error).message}`);
      }
    } finally {
      setRuntimeLogsRefreshing(false);
    }
  }, [launcherAvailable, launcherStatus, refreshLocalNodeLogs, requestJson, setLauncherLogs, setNotice, setRuntimeLogsRefreshing]);

  const updateLocalNodeModelDraft = useCallback(<K extends keyof LocalNodeModelConfigRequest>(key: K, value: LocalNodeModelConfigRequest[K]) => {
    setLocalNodeModelDirty(true);
    setLocalNodeModelDraft((current) => {
      const next = { ...current, [key]: value };

      if (key === "openai_api_key") {
        const hasNewValue = hasText(value);
        next.preserve_openai_api_key = !hasNewValue && current.preserve_openai_api_key;
        next.clear_openai_api_key = false;
      }
      if (key === "dify_api_key") {
        const hasNewValue = hasText(value);
        next.preserve_dify_api_key = !hasNewValue && current.preserve_dify_api_key;
        next.clear_dify_api_key = false;
      }

      return next;
    });
  }, [setLocalNodeModelDirty, setLocalNodeModelDraft]);

  const saveLocalNodeModelConfig = useCallback(async () => {
    if (localNodeModelDraft.model_provider === "openai") {
      if (!hasText(localNodeModelDraft.openai_base_url)) {
        setNotice("当前 Provider 已切换为 DashScope，请先填写 DashScope Base URL。");
        return;
      }
      const openaiKeyAvailable =
        safeTrim(localNodeModelDraft.openai_api_key)
        || (localNodeModelDraft.preserve_openai_api_key && !localNodeModelDraft.clear_openai_api_key);
      if (!openaiKeyAvailable) {
        setNotice("当前 Provider 已切换为 DashScope，请先填写 DashScope API Key。");
        return;
      }
      if (!hasText(localNodeModelDraft.openai_model)) {
        setNotice("当前 Provider 已切换为 DashScope，请先填写 DashScope 模型名称。");
        return;
      }
    }
    if (localNodeModelDraft.model_provider === "dify") {
      if (!hasText(localNodeModelDraft.dify_base_url)) {
        setNotice("当前 Provider 已切换为 Dify，请先填写 Dify Base URL。");
        return;
      }
      const difyKeyAvailable =
        safeTrim(localNodeModelDraft.dify_api_key)
        || (localNodeModelDraft.preserve_dify_api_key && !localNodeModelDraft.clear_dify_api_key);
      if (!difyKeyAvailable) {
        setNotice("当前 Provider 已切换为 Dify，请先填写 Dify API Key。");
        return;
      }
    }
    try {
      const result = await withBusy(
        "local-node-model-save",
        () => requestJson<LocalNodeActionResponse>("/local/node/model-config", {
          method: "POST",
          body: JSON.stringify(localNodeModelDraft),
        }),
      );
      setLocalNodeStatus(result.status);
      setLocalNodeModelDirty(false);
      setLocalNodeModelDraft(buildLocalNodeModelDraftFromStatus(result.status));
      void refreshLauncherStatusRef.current();
      setNotice(result.detail || "本机节点模型配置已保存。");
    } catch (error) {
      setNotice(`保存本机节点模型配置失败：${(error as Error).message}`);
    }
  }, [localNodeModelDraft, requestJson, setLocalNodeModelDirty, setLocalNodeModelDraft, setLocalNodeStatus, setNotice, withBusy]);

  const restartLocalNodeService = useCallback(async () => {
    try {
      const result = await withBusy(
        "local-node-restart",
        () => requestJson<LocalNodeActionResponse>("/local/node/service/restart", { method: "POST" }),
      );
      setLocalNodeStatus(result.status);
      await refreshLauncherStatusRef.current();
      await refreshLocalNodeDiagnostics();
      setNotice(result.detail || "本机节点已重启。");
    } catch (error) {
      setNotice(`重启本机节点失败：${(error as Error).message}`);
    }
  }, [refreshLocalNodeDiagnostics, requestJson, setLocalNodeStatus, setNotice, withBusy]);

  const startLocalNodeService = useCallback(async () => {
    try {
      const result = await withBusy(
        "local-node-start",
        () => requestJson<LocalNodeActionResponse>("/local/node/service/start", { method: "POST" }),
      );
      setLocalNodeStatus(result.status);
      await refreshLauncherStatusRef.current();
      await refreshLocalNodeDiagnostics();
      setNotice(result.detail || "本机节点已启动。");
    } catch (error) {
      setNotice(`启动本机节点失败：${(error as Error).message}`);
    }
  }, [refreshLocalNodeDiagnostics, requestJson, setLocalNodeStatus, setNotice, withBusy]);

  const stopLocalNodeService = useCallback(async () => {
    try {
      await withBusy(
        "local-node-stop",
        () => requestJson<LauncherStatusResponse>("/local/bootstrap/stop", {
          method: "POST",
          body: JSON.stringify({ component: "local-node" }),
        }),
      );
      await refreshLauncherStatusRef.current();
      await refreshLocalNodeDiagnostics();
      setNotice("本机节点已停止，可以开始执行通道评估。");
    } catch (error) {
      setNotice(`停止本机节点失败：${(error as Error).message}`);
    }
  }, [refreshLocalNodeDiagnostics, requestJson, setNotice, withBusy]);

  const exportLocalNodeDiagnostics = useCallback(async () => {
    try {
      const result = await withBusy(
        "local-node-export",
        () => requestJson<LocalNodeExportResponse>("/local/node/diagnostics/export", { method: "POST" }),
      );
      setNotice(result.detail || `诊断包已导出：${result.export_path}`);
    } catch (error) {
      setNotice(`导出本机节点诊断包失败：${(error as Error).message}`);
    }
  }, [requestJson, setNotice, withBusy]);

  const runLocalNodeConversationTest = useCallback(async (payload: LocalNodeConversationTestRequest) => {
    try {
      const result = await withBusy(
        "local-node-conversation-test",
        () => requestJson<LocalNodeConversationTestResponse>("/local/node/conversation-test", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
      setNotice(result.detail || "当前模型配置已成功返回回复。");
      return result;
    } catch (error) {
      const message = `当前模型对话测试失败：${(error as Error).message}`;
      setNotice(message);
      throw error;
    }
  }, [requestJson, setNotice, withBusy]);

  const startLocalNodeChannelAssessment = useCallback(async () => {
    const payload: LocalNodeChannelAssessmentStartRequest = {
      max_rounds: Math.max(1, Math.min(MAX_CHANNEL_ASSESSMENT_ROUNDS, Number(assessmentMaxRounds) || 1)),
    };
    try {
      const result = await withBusy(
        "local-node-channel-assessment-start",
        () => requestJson<LocalNodeChannelAssessmentResult>("/local/node/channel-assessment/start", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
      await refreshLocalNodeStatus();
      if (result.status === "blocked") {
        setNotice(result.blocking_reason || result.summary || "当前节点不满足通道评估前置条件。");
        return result;
      }
      setNotice(result.summary || "通道评估已启动。");
      return result;
    } catch (error) {
      const message = `启动通道评估失败：${(error as Error).message}`;
      setNotice(message);
      throw error;
    }
  }, [assessmentMaxRounds, refreshLocalNodeStatus, requestJson, setNotice, withBusy]);

  const applyLocalNodeChannelAssessment = useCallback(async () => {
    try {
      const result = await withBusy(
        "local-node-channel-assessment-apply",
        () => requestJson<LocalNodeActionResponse>("/local/node/channel-assessment/apply", {
          method: "POST",
          body: JSON.stringify({ strategy: assessmentApplyStrategy } satisfies LocalNodeChannelAssessmentApplyRequest),
        }),
      );
      setLocalNodeStatus(result.status);
      await refreshLauncherStatusRef.current();
      await refreshLocalNodeDiagnostics();
      setNotice(result.detail || "已应用通道评估建议。");
      return result;
    } catch (error) {
      const message = `应用通道评估建议失败：${(error as Error).message}`;
      setNotice(message);
      throw error;
    }
  }, [assessmentApplyStrategy, refreshLocalNodeDiagnostics, requestJson, setLocalNodeStatus, setNotice, withBusy]);

  return {
    refreshLocalNodeStatus,
    refreshLocalNodeLogs,
    refreshLocalNodeDiagnostics,
    refreshRuntimeLogs,
    updateLocalNodeModelDraft,
    saveLocalNodeModelConfig,
    startLocalNodeService,
    restartLocalNodeService,
    stopLocalNodeService,
    exportLocalNodeDiagnostics,
    runLocalNodeConversationTest,
    startLocalNodeChannelAssessment,
    applyLocalNodeChannelAssessment,
  };
}
