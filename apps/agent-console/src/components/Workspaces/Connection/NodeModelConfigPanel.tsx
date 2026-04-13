import type {
  LocalNodeConversationTestRequest,
  LocalNodeConversationTestResponse,
  LocalNodeModelConfigRequest,
  LocalNodeStatusResponse,
} from "../../../types";
import { hasText } from "../../../stringUtils";
import { SnippetBlock, ToggleSecretInput } from "./ConnectionUi";
import {
  CommandBar,
  InfoList,
  SectionHeader,
  SignalBadge,
  SurfaceCard,
} from "../../shared/ConsolePrimitives";

type NodeModelConfigPanelProps = {
  launcherAvailable: boolean;
  busyKey: string | null;
  dirty: boolean;
  status: LocalNodeStatusResponse | null;
  runtimeSummary: { label: string; detail: string };
  gatewayControl?: {
    managed: boolean;
    state: string;
    onRestart: () => void;
    disabled: boolean;
    busy: boolean;
  } | null;
  eventPreview: string;
  draft: LocalNodeModelConfigRequest;
  onChange: <K extends keyof LocalNodeModelConfigRequest>(
    key: K,
    value: LocalNodeModelConfigRequest[K]
  ) => void;
  onRefresh: () => void;
  onStart?: () => void;
  onStop?: () => void;
  onRestart: () => void;
  onSave: () => void;
  onExport: () => void;
  onRepair?: () => void;
  onReset?: () => void;
  onRunConversationTest?: (
    payload: LocalNodeConversationTestRequest
  ) => Promise<LocalNodeConversationTestResponse>;
};

export function NodeModelConfigPanel({
  launcherAvailable,
  busyKey,
  dirty,
  status,
  runtimeSummary,
  gatewayControl,
  eventPreview,
  draft,
  onChange,
  onRefresh,
  onStart,
  onStop,
  onRestart,
  onSave,
  onExport,
  onRepair,
  onReset,
}: NodeModelConfigPanelProps) {
  if (!launcherAvailable) {
    return (
      <SurfaceCard className="node-model-config-empty">
        <SectionHeader kicker="节点与模型参数" title="本机节点模型配置" />
        <div className="empty-state" style={{ marginTop: 24, padding: "40px 0" }}>
          <strong>检测能力受限</strong>
          <p style={{ marginTop: 8, opacity: 0.7 }}>当前未检测到 launcher 本地托管能力，暂时无法读取或保存内置节点模型配置。</p>
        </div>
      </SurfaceCard>
    );
  }

  const applyState = status?.config_apply_state ?? "idle";
  const applyBusy = applyState === "saving" || applyState === "restarting";
  const applyJustSucceeded =
    applyState === "applied" &&
    typeof status?.last_apply_at === "string" &&
    Date.now() - Date.parse(status.last_apply_at) < 20000;
  
  const saveButtonLabel =
    busyKey === "local-node-model-save"
      ? "保存中..."
      : applyBusy
      ? "正在重启节点..."
      : applyJustSucceeded
      ? "已应用"
      : dirty
      ? "保存并应用"
      : "重新应用配置";

  const applyStateLabel =
    applyState === "saving"
      ? "正在保存"
      : applyState === "restarting"
      ? "正在重启节点"
      : applyState === "applied"
      ? "已应用"
      : applyState === "failed"
      ? "应用失败"
      : "空闲";

  const selectedProvider =
    draft.model_provider === "openai" || draft.model_provider === "dify"
      ? draft.model_provider
      : "auto";

  const providerHeadline =
    selectedProvider === "openai"
      ? "DashScope（阿里云通义千问）"
      : selectedProvider === "dify"
      ? "Dify 工作流"
      : "自动选择已完整配置的 Provider";

  const openaiKeyConfigured = Boolean(
    status?.model_settings?.openai_api_key_configured
  );
  const difyKeyConfigured = Boolean(
    status?.model_settings?.dify_api_key_configured
  );
  
  const openaiKeyMode = draft.clear_openai_api_key
    ? "clear"
    : hasText(draft.openai_api_key)
    ? "replace"
    : draft.preserve_openai_api_key
    ? "keep"
    : "missing";
  
  const difyKeyMode = draft.clear_dify_api_key
    ? "clear"
    : hasText(draft.dify_api_key)
    ? "replace"
    : draft.preserve_dify_api_key
    ? "keep"
    : "missing";
  const serviceStatus = status?.service_status || status?.state || "stopped";
  const serviceRunning = serviceStatus === "running";
  const repairRequired = Boolean(status?.repair_required);
  const repairReason = status?.repair_reason || "";
  const venvStatus = status?.venv_status || "unknown";
  const hasModelConfig =
    draft.model_provider === "dify"
      ? Boolean(draft.dify_base_url.trim() && (draft.dify_api_key.trim() || draft.preserve_dify_api_key))
      : draft.model_provider === "openai"
        ? Boolean(draft.openai_base_url.trim() && draft.openai_model.trim() && (draft.openai_api_key.trim() || draft.preserve_openai_api_key))
        : Boolean(
            (draft.dify_base_url.trim() && (draft.dify_api_key.trim() || draft.preserve_dify_api_key))
            || (draft.openai_base_url.trim() && draft.openai_model.trim() && (draft.openai_api_key.trim() || draft.preserve_openai_api_key))
          );
  const canStartService = !serviceRunning && !repairRequired && hasModelConfig;
  const canRestartService = serviceRunning && !repairRequired;
  const canStopService = serviceRunning;
  const environmentTone = repairRequired || venvStatus === "broken" ? "warn" : hasModelConfig ? "good" : "neutral";
  const environmentTitle = repairRequired
    ? "当前环境需要修复"
    : venvStatus === "broken"
      ? "Python 环境损坏"
      : !hasModelConfig
        ? "先补齐模型配置"
        : serviceRunning
          ? "当前可直接管理服务"
          : "当前可直接启动节点";
  const environmentDetail = repairRequired
    ? repairReason || "当前安装层或运行配置不一致，请使用“重装当前机器节点”。"
    : venvStatus === "broken"
      ? "本机节点 `.venv` 不完整，建议直接重装当前机器节点。"
      : !hasModelConfig
        ? "当前服务不会自动修复模型配置，请先保存并应用后再启动节点。"
        : serviceRunning
          ? "服务已安装且配置完整，可直接停止、重启或重新应用配置。"
          : "服务已安装且配置完整，可直接启动节点。";

  return (
    <SurfaceCard className="node-console-shell" tone="accent">
      <section className="node-console-section node-console-section-head">
        <SectionHeader
          kicker="节点控制台"
          title="本机内置节点与推理后端"
          description="配置会直接写入 node.env。密钥采用显式管理模式（保留/替换/清空），确保凭据安全且确定。"
          actions={
            <div className="inline-actions">
              {gatewayControl ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={gatewayControl.onRestart}
                  disabled={gatewayControl.disabled}
                >
                  {gatewayControl.busy ? "网关重启中..." : "重启网关"}
                </button>
              ) : null}
              <button
                type="button"
                className="ghost-button"
                onClick={onRefresh}
                disabled={busyKey !== null}
              >
                刷新状态
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={onRestart}
                disabled={busyKey !== null || applyBusy}
              >
                {busyKey === "local-node-restart" || applyBusy ? "重启中..." : "重启节点"}
              </button>
              <button type="button" onClick={onSave} disabled={busyKey !== null || applyBusy}>
                {saveButtonLabel}
              </button>
            </div>
          }
        />
        {gatewayControl ? (
          <div className="connection-host-inline-meta" style={{ marginTop: -8, marginBottom: 12 }}>
            <span className="connection-host-inline-pill">
              主网关 {gatewayControl.managed ? "托管中" : "未托管"}
            </span>
            <span className="connection-host-inline-detail">
              状态 {gatewayControl.state}
            </span>
          </div>
        ) : null}
        <div className="connection-fact-grid">
          <div className="connection-fact-tile">
            <span>节点身份</span>
            <strong>{status?.node_kind === "local" ? "网关内置" : "工作节点"}</strong>
          </div>
          <div className="connection-fact-tile">
            <span>服务状态</span>
            <strong>{status?.state || "未读取"}</strong>
          </div>
          <div className="connection-fact-tile">
            <span>网关注册</span>
            <strong>{runtimeSummary.label}</strong>
          </div>
          <div className="connection-fact-tile">
            <span>应用状态</span>
            <strong>{applyStateLabel}</strong>
          </div>
        </div>
        <CommandBar
          label={environmentTitle}
          detail={environmentDetail}
          className={`node-console-status-bar node-console-status-bar-${environmentTone}`}
        >
          <SignalBadge tone={environmentTone === "good" ? "good" : environmentTone === "warn" ? "warn" : "neutral"}>
            {repairRequired ? "需修复" : venvStatus === "ready" ? "环境可用" : venvStatus === "broken" ? "venv 损坏" : "待检查"}
          </SignalBadge>
        </CommandBar>
      </section>

      <section className="node-console-section node-console-section-actions">
        <div className="node-console-action-grid">
          <CommandBar
            label="运行控制"
            detail="仅控制服务启停，不修改安装。"
            className="node-console-action-bar"
          >
            <div className="inline-actions">
              <button type="button" onClick={onStart} disabled={!onStart || busyKey !== null || !canStartService}>
                {busyKey === "local-node-start" ? "启动中..." : "启动节点"}
              </button>
              <button type="button" className="ghost-button" onClick={onStop} disabled={!onStop || busyKey !== null || !canStopService}>
                {busyKey === "local-node-stop" ? "停止中..." : "停止节点"}
              </button>
              <button type="button" className="ghost-button" onClick={onRestart} disabled={busyKey !== null || !canRestartService}>
                {busyKey === "local-node-restart" || applyBusy ? "重启中..." : "重启节点"}
              </button>
            </div>
          </CommandBar>

          <CommandBar
            label="配置应用"
            detail="按当前保存配置重新生效，不重建安装层。"
            className="node-console-action-bar"
          >
            <div className="inline-actions">
              <button type="button" onClick={onSave} disabled={busyKey !== null || applyBusy}>
                {saveButtonLabel}
              </button>
              <button type="button" className="ghost-button" onClick={onRefresh} disabled={busyKey !== null}>
                刷新状态
              </button>
            </div>
          </CommandBar>

          {onRepair ? (
            <CommandBar
              label="安装修复"
              detail="重建 `.venv`、依赖和服务定义，用于修复安装层。"
              className="node-console-action-bar"
            >
              <div className="inline-actions">
                <button type="button" className="ghost-button" onClick={onRepair} disabled={busyKey !== null}>
                  {busyKey === "setup-worker" ? "重装中..." : "重装当前机器节点"}
                </button>
                <button type="button" className="ghost-button" onClick={onExport} disabled={busyKey !== null}>
                  {busyKey === "local-node-export" ? "导出中..." : "导出诊断包"}
                </button>
              </div>
            </CommandBar>
          ) : null}

          {onReset ? (
            <CommandBar
              label="高风险恢复"
              detail="清空节点身份与注册信息，不替代重装。"
              className="node-console-action-bar node-console-action-bar-danger"
            >
              <div className="inline-actions">
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    if (!onReset) return;
                    if (window.confirm("这会清空当前节点身份、目标网关地址和配对凭据，不会执行重装。是否继续？")) {
                      onReset();
                    }
                  }}
                  disabled={busyKey !== null}
                >
                  {busyKey === "local-node-reset" ? "重置中..." : "重置节点"}
                </button>
              </div>
            </CommandBar>
          ) : null}
        </div>
      </section>

      <section className="node-console-section">
        <div className="console-section-copy" style={{ marginBottom: 16 }}>
          <span className="section-kicker">推理链路</span>
          <h3>路由与后端选择</h3>
          <p className="console-section-description">{providerHeadline}</p>
        </div>
        <div className="node-provider-toggle">
          {(["auto", "openai", "dify"] as const).map((provider) => (
            <button
              key={provider}
              type="button"
              className={`node-provider-chip ${
                draft.model_provider === provider ? "node-provider-chip-active" : ""
              }`}
              onClick={() => onChange("model_provider", provider)}
            >
              {provider === "auto" ? "自动分配" : provider === "openai" ? "DashScope" : "Dify"}
            </button>
          ))}
        </div>
        <div className="connection-form-grid" style={{ marginTop: 24 }}>
          <label>
            <span>DashScope Base URL</span>
            <input
              value={draft.openai_base_url}
              onChange={(event) => onChange("openai_base_url", event.target.value)}
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </label>
          <label>
            <span>DashScope 模型</span>
            <input
              value={draft.openai_model}
              onChange={(event) => onChange("openai_model", event.target.value)}
              placeholder="qwen-plus / qwen-max"
            />
          </label>
          <label className="connection-full-span">
            <span>Dify Base URL</span>
            <input
              value={draft.dify_base_url}
              onChange={(event) => onChange("dify_base_url", event.target.value)}
              placeholder="https://api.dify.ai/v1"
            />
          </label>
        </div>
      </section>

      <section className="node-console-section">
        <div className="console-section-copy" style={{ marginBottom: 16 }}>
          <span className="section-kicker">安全凭据</span>
          <h3>密钥与凭据</h3>
          <p className="console-section-description">所有后端凭据在同一块里管理，避免来回跳转。</p>
        </div>
        <div className="node-model-secret-grid">
        <SecretCard
          title="DashScope API Key"
          subtitle={
            openaiKeyConfigured
              ? "当前节点已保存密钥，留空继续沿用。"
              : "当前节点还没有保存 DashScope API Key。"
          }
          status={openaiKeyMode}
          value={draft.openai_api_key}
          configured={openaiKeyConfigured}
          preserve={draft.preserve_openai_api_key}
          clear={draft.clear_openai_api_key}
          placeholder={
            openaiKeyConfigured ? "输入新 Key 替换现有值" : "输入 DashScope API Key"
          }
          onValueChange={(value) => onChange("openai_api_key", value)}
          onPreserveChange={(checked) => {
            onChange("preserve_openai_api_key", checked);
            if (checked) onChange("clear_openai_api_key", false);
          }}
          onClearChange={(checked) => {
            onChange("clear_openai_api_key", checked);
            if (checked) {
              onChange("preserve_openai_api_key", false);
              onChange("openai_api_key", "");
            }
          }}
        />
        <SecretCard
          title="Dify Key"
          subtitle={
            difyKeyConfigured
              ? "当前节点已保存密钥，只有输入新值时才会替换。"
              : "当前节点还没有保存 Dify Key。"
          }
          status={difyKeyMode}
          value={draft.dify_api_key}
          configured={difyKeyConfigured}
          preserve={draft.preserve_dify_api_key}
          clear={draft.clear_dify_api_key}
          placeholder={difyKeyConfigured ? "输入新 Key 替换现有值" : "输入 Dify API Key"}
          onValueChange={(value) => onChange("dify_api_key", value)}
          onPreserveChange={(checked) => {
            onChange("preserve_dify_api_key", checked);
            if (checked) onChange("clear_dify_api_key", false);
          }}
          onClearChange={(checked) => {
            onChange("clear_dify_api_key", checked);
            if (checked) {
              onChange("preserve_dify_api_key", false);
              onChange("dify_api_key", "");
            }
          }}
        />
        </div>
      </section>

      <section className="node-console-section">
        <details className="form-advanced-details connection-fold-card">
          <summary>
            <div className="console-section-copy">
              <span className="section-kicker">高级推理参数</span>
              <h3>详细控制</h3>
              <p className="console-section-description">温度、搜索、Thinking 模式与多模态扩展。</p>
            </div>
          </summary>
          <div className="connection-form-grid" style={{ marginTop: 24 }}>
            <label>
              <span>Temperature</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={draft.openai_temperature}
                onChange={(event) =>
                  onChange("openai_temperature", Number(event.target.value) || 0)
                }
              />
            </label>
            <label>
              <span>Top P</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={draft.openai_top_p}
                onChange={(event) => onChange("openai_top_p", Number(event.target.value) || 0)}
              />
            </label>
            <label>
              <span>Max Tokens</span>
              <input
                type="number"
                min="0"
                value={draft.openai_max_tokens}
                onChange={(event) =>
                  onChange("openai_max_tokens", Number(event.target.value) || 0)
                }
              />
            </label>
            <label>
              <span>Seed</span>
              <input
                type="number"
                min="0"
                value={draft.openai_seed}
                onChange={(event) => onChange("openai_seed", Number(event.target.value) || 0)}
              />
            </label>
            <label>
              <span>Thinking Budget</span>
              <input
                type="number"
                min="0"
                value={draft.openai_thinking_budget}
                onChange={(event) =>
                  onChange("openai_thinking_budget", Number(event.target.value) || 0)
                }
              />
            </label>
            <label>
              <span>搜索策略</span>
              <select
                value={draft.openai_search_strategy}
                onChange={(event) => onChange("openai_search_strategy", event.target.value)}
              >
                <option value="turbo">turbo</option>
                <option value="max">max</option>
                <option value="agent">agent</option>
                <option value="agent_max">agent_max</option>
              </select>
            </label>
            <label className="connection-full-span">
              <span>Stop Sequences（每行一个）</span>
              <textarea
                value={draft.openai_stop}
                onChange={(event) => onChange("openai_stop", event.target.value)}
                placeholder={"Observation:\n[\"</answer>\"]"}
              />
            </label>
          </div>
          <div className="connection-checkbox-grid" style={{ marginTop: 20 }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.openai_enable_thinking}
                onChange={(event) => onChange("openai_enable_thinking", event.target.checked)}
              />
              <span>启用 DashScope Thinking</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.openai_enable_search}
                onChange={(event) => onChange("openai_enable_search", event.target.checked)}
              />
              <span>启用联网搜索</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.openai_search_forced}
                onChange={(event) => onChange("openai_search_forced", event.target.checked)}
              />
              <span>强制搜索</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.openai_enable_search_extension}
                onChange={(event) =>
                  onChange("openai_enable_search_extension", event.target.checked)
                }
              />
              <span>垂域搜索扩展</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.openai_multimodal_enabled}
                onChange={(event) => onChange("openai_multimodal_enabled", event.target.checked)}
              />
              <span>启用多模态输入</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.restart_service}
                onChange={(event) => onChange("restart_service", event.target.checked)}
              />
              <span>保存后自动重启节点</span>
            </label>
          </div>
        </details>
      </section>

      <section className="node-console-section node-console-section-tail">
        <SectionHeader
          kicker="运行时诊断"
          title="底层详情"
          actions={
            <button
              type="button"
              className="ghost-button"
              onClick={onExport}
              disabled={busyKey !== null}
            >
              {busyKey === "local-node-export" ? "导出中..." : "导出诊断包"}
            </button>
          }
        />
        <InfoList
          items={[
            { label: "服务名", value: status?.service_name || "未读取" },
            { label: "配置文件", value: status?.config_path || "未读取", multiline: true },
            { label: "诊断文件", value: status?.diagnostics_path || "未读取", multiline: true },
            {
              label: "运行详情",
              value: runtimeSummary.detail || status?.detail || "未读取",
              multiline: true,
            },
            {
              label: "最新注册结果",
              value: status?.last_register_result || "等待注册...",
              multiline: true,
            },
          ]}
        />
      </section>

      {eventPreview ? <SnippetBlock label="本机节点活跃日志" content={eventPreview} /> : null}
    </SurfaceCard>
  );
}

type SecretCardProps = {
  title: string;
  subtitle: string;
  status: "keep" | "replace" | "clear" | "missing";
  value: string;
  configured: boolean;
  preserve: boolean;
  clear: boolean;
  placeholder: string;
  onValueChange: (value: string) => void;
  onPreserveChange: (checked: boolean) => void;
  onClearChange: (checked: boolean) => void;
};

function SecretCard({
  title,
  subtitle,
  status,
  value,
  configured,
  preserve,
  clear,
  placeholder,
  onValueChange,
  onPreserveChange,
  onClearChange,
}: SecretCardProps) {
  const statusLabel =
    status === "replace"
      ? "已更改"
      : status === "clear"
      ? "将清空"
      : status === "keep"
      ? "已加密保留"
      : configured
      ? "准备就绪"
      : "未提供";

  const statusTone =
    status === "keep" ? "good" : status === "replace" ? "info" : status === "clear" ? "warn" : "neutral";

  return (
    <div className="node-secret-card">
      <div className="node-secret-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div className="console-section-copy">
          <span className="section-kicker">安全凭据</span>
          <h3 style={{ margin: "4px 0" }}>{title}</h3>
        </div>
        <SignalBadge tone={statusTone}>{statusLabel}</SignalBadge>
      </div>
      <p className="console-section-description" style={{ marginBottom: 16, opacity: 0.8 }}>
        {subtitle}
      </p>
      <ToggleSecretInput
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
      />
      {configured ? (
        <div className="connection-checkbox-grid node-secret-options" style={{ marginTop: 20 }}>
          <label className="checkbox-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              style={{ width: 14, height: 14 }}
              checked={preserve && !clear}
              onChange={(event) => onPreserveChange(event.target.checked)}
            />
            <span style={{ fontSize: "0.9em" }}>继续沿用已保存的 Key</span>
          </label>
          <label className="checkbox-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 8 }}>
            <input
              type="checkbox"
              style={{ width: 14, height: 14 }}
              checked={clear}
              onChange={(event) => onClearChange(event.target.checked)}
            />
            <span style={{ fontSize: "0.9em" }}>彻底移除此 Key</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
