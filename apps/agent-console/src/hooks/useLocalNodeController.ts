import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { buildLocalNodeModelDraftFromStatus } from "../appBootstrap";
import type {
  LauncherLogResponse,
  LauncherStatusResponse,
  LocalNodeActionResponse,
  LocalNodeConversationTestRequest,
  LocalNodeConversationTestResponse,
  LocalNodeExportResponse,
  LocalNodeLogsResponse,
  LocalNodeModelConfigRequest,
  LocalNodeStatusResponse,
} from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;
type WithBusy = <T>(key: string, task: () => Promise<T>) => Promise<T>;

type UseLocalNodeControllerOptions = {
  requestJson: RequestJson;
  withBusy: WithBusy;
  launcherAvailable: boolean;
  launcherStatus: LauncherStatusResponse | null;
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
        const hasNewValue = String(value).trim().length > 0;
        next.preserve_openai_api_key = !hasNewValue && current.preserve_openai_api_key;
        next.clear_openai_api_key = false;
      }
      if (key === "dify_api_key") {
        const hasNewValue = String(value).trim().length > 0;
        next.preserve_dify_api_key = !hasNewValue && current.preserve_dify_api_key;
        next.clear_dify_api_key = false;
      }

      return next;
    });
  }, [setLocalNodeModelDirty, setLocalNodeModelDraft]);

  const saveLocalNodeModelConfig = useCallback(async () => {
    if (localNodeModelDraft.model_provider === "openai") {
      if (!localNodeModelDraft.openai_base_url.trim()) {
        setNotice("当前 Provider 已切换为 OpenAI，请先填写 OpenAI Base URL。");
        return;
      }
      const openaiKeyAvailable =
        localNodeModelDraft.openai_api_key.trim()
        || (localNodeModelDraft.preserve_openai_api_key && !localNodeModelDraft.clear_openai_api_key);
      if (!openaiKeyAvailable) {
        setNotice("当前 Provider 已切换为 OpenAI，请先填写 OpenAI API Key。");
        return;
      }
      if (!localNodeModelDraft.openai_model.trim()) {
        setNotice("当前 Provider 已切换为 OpenAI，请先填写 OpenAI Model。");
        return;
      }
    }
    if (localNodeModelDraft.model_provider === "dify") {
      if (!localNodeModelDraft.dify_base_url.trim()) {
        setNotice("当前 Provider 已切换为 Dify，请先填写 Dify Base URL。");
        return;
      }
      const difyKeyAvailable =
        localNodeModelDraft.dify_api_key.trim()
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

  return {
    refreshLocalNodeStatus,
    refreshLocalNodeLogs,
    refreshLocalNodeDiagnostics,
    refreshRuntimeLogs,
    updateLocalNodeModelDraft,
    saveLocalNodeModelConfig,
    restartLocalNodeService,
    exportLocalNodeDiagnostics,
    runLocalNodeConversationTest,
  };
}
