import type {
  LocalNodeConversationTestRequest,
  LocalNodeConversationTestResponse,
  LocalNodeModelConfigRequest,
  LocalNodeStatusResponse,
} from "../../../types";
import { hasText } from "../../../stringUtils";
import { InfoRow, SnippetBlock, ToggleSecretInput } from "./ConnectionUi";

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
  onChange: <K extends keyof LocalNodeModelConfigRequest>(key: K, value: LocalNodeModelConfigRequest[K]) => void;
  onRefresh: () => void;
  onRestart: () => void;
  onSave: () => void;
  onExport: () => void;
  onRunConversationTest?: (payload: LocalNodeConversationTestRequest) => Promise<LocalNodeConversationTestResponse>;
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
  onRestart,
  onSave,
  onExport,
}: NodeModelConfigPanelProps) {
  if (!launcherAvailable) {
    return (
      <section className="surface">
        <div className="section-head compact-head">
          <div>
            <div className="section-kicker">节点与模型参数</div>
            <h3>本机节点模型配置</h3>
          </div>
        </div>
        <div className="empty-state">当前未检测到 launcher 本地托管能力，暂时无法读取或保存内置节点模型配置。</div>
      </section>
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
  const selectedProvider = draft.model_provider === "openai" || draft.model_provider === "dify" ? draft.model_provider : "auto";
  const providerHeadline =
    selectedProvider === "openai"
      ? "OpenAI 兼容接口"
      : selectedProvider === "dify"
        ? "Dify 工作流"
        : "自动选择已完整配置的 Provider";
  const openaiKeyConfigured = Boolean(status?.model_settings?.openai_api_key_configured);
  const difyKeyConfigured = Boolean(status?.model_settings?.dify_api_key_configured);
  const openaiKeyMode = draft.clear_openai_api_key ? "clear" : hasText(draft.openai_api_key) ? "replace" : draft.preserve_openai_api_key ? "keep" : "missing";
  const difyKeyMode = draft.clear_dify_api_key ? "clear" : hasText(draft.dify_api_key) ? "replace" : draft.preserve_dify_api_key ? "keep" : "missing";

  return (
    <section className="surface">
      <div className="section-head">
        <div>
          <div className="section-kicker">节点与模型参数</div>
          <h3>本机内置节点与推理后端</h3>
          {gatewayControl ? (
            <div className="connection-host-inline-meta">
              <span className="connection-host-inline-pill">主网关 {gatewayControl.managed ? "托管中" : "未托管"}</span>
              <span className="connection-host-inline-detail">状态 {gatewayControl.state}</span>
            </div>
          ) : null}
        </div>
        <div className="inline-actions">
          {gatewayControl ? (
            <button type="button" className="ghost-button" onClick={gatewayControl.onRestart} disabled={gatewayControl.disabled}>
              {gatewayControl.busy ? "网关重启中..." : "重启网关"}
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={onRefresh} disabled={busyKey !== null}>
            刷新节点状态
          </button>
          <button type="button" className="ghost-button" onClick={onRestart} disabled={busyKey !== null || applyBusy}>
            {busyKey === "local-node-restart" || applyBusy ? "重启中..." : "重启节点"}
          </button>
          <button type="button" className="ghost-button" onClick={onExport} disabled={busyKey !== null}>
            {busyKey === "local-node-export" ? "导出中..." : "导出诊断包"}
          </button>
          <button type="button" onClick={onSave} disabled={busyKey !== null || applyBusy}>
            {saveButtonLabel}
          </button>
        </div>
      </div>

      <div className="inline-tip">
        配置会写入节点自己的 <code>node.env</code>。密钥改成了显式的保留 / 替换 / 清空语义，留空不再默认为清空。
      </div>

      <div className="connection-fact-grid connection-fact-grid-wide">
        <div className="connection-fact-tile">
          <span>节点身份</span>
          <strong>{status?.node_kind === "local" ? "网关内置节点" : "当前工作节点"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>服务状态</span>
          <strong>{status?.state || "未读取"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>网关注册状态</span>
          <strong>{runtimeSummary.label}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>当前 Provider</span>
          <strong>{status?.active_model_provider || status?.configured_model_provider || "未读取"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>OpenAI Key</span>
          <strong>{openaiKeyConfigured ? "已保存" : "未保存"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>Dify Key</span>
          <strong>{difyKeyConfigured ? "已保存" : "未保存"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>配置应用状态</span>
          <strong>{applyStateLabel}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>推理后端</span>
          <strong>{status?.inference_ready ? "已就绪" : "未就绪"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>待保存变更</span>
          <strong>{dirty ? "有变更待提交" : "当前没有草稿差异"}</strong>
        </div>
      </div>

      <div className="node-model-shell">
        <div className="node-model-primary-card">
          <div className="section-kicker">Primary Config</div>
          <h4>先决定当前节点走哪条推理链路</h4>
          <p className="node-model-copy">
            {providerHeadline}
          </p>
          <div className="node-provider-toggle">
            {(["auto", "openai", "dify"] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                className={`node-provider-chip ${draft.model_provider === provider ? "node-provider-chip-active" : ""}`}
                onClick={() => onChange("model_provider", provider)}
              >
                {provider === "auto" ? "自动" : provider === "openai" ? "OpenAI" : "Dify"}
              </button>
            ))}
          </div>
          <div className="connection-form-grid">
            <label>
              <span>OpenAI Base URL</span>
              <input
                value={draft.openai_base_url}
                onChange={(event) => onChange("openai_base_url", event.target.value)}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
              />
            </label>
            <label>
              <span>OpenAI Model</span>
              <input
                value={draft.openai_model}
                onChange={(event) => onChange("openai_model", event.target.value)}
                placeholder="qwen-plus / gpt-4o-mini / deepseek-chat"
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
        </div>

        <div className="node-model-secret-grid">
          <SecretCard
            title="OpenAI Key"
            subtitle={openaiKeyConfigured ? "当前节点已保存密钥，留空可以继续沿用。" : "当前节点还没有保存密钥。"}
            status={openaiKeyMode}
            value={draft.openai_api_key}
            configured={openaiKeyConfigured}
            preserve={draft.preserve_openai_api_key}
            clear={draft.clear_openai_api_key}
            placeholder={openaiKeyConfigured ? "输入新 Key 才会替换现有值" : "输入 OpenAI 兼容 API Key"}
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
            subtitle={difyKeyConfigured ? "当前节点已保存密钥，只有输入新值时才会替换。" : "当前节点还没有保存 Dify Key。"}
            status={difyKeyMode}
            value={draft.dify_api_key}
            configured={difyKeyConfigured}
            preserve={draft.preserve_dify_api_key}
            clear={draft.clear_dify_api_key}
            placeholder={difyKeyConfigured ? "输入新 Key 才会替换现有值" : "输入 Dify API Key"}
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
      </div>

      <details className="form-advanced-details connection-fold-card">
        <summary>
          <span className="section-kicker">高级模型参数</span>
          <span className="connection-fold-hint">温度、搜索、thinking、多模态与 stop sequences</span>
        </summary>
        <div className="connection-form-grid">
          <label>
            <span>Temperature</span>
            <input type="number" step="0.1" min="0" max="2" value={draft.openai_temperature} onChange={(event) => onChange("openai_temperature", Number(event.target.value) || 0)} />
          </label>
          <label>
            <span>Top P</span>
            <input type="number" step="0.1" min="0" max="1" value={draft.openai_top_p} onChange={(event) => onChange("openai_top_p", Number(event.target.value) || 0)} />
          </label>
          <label>
            <span>Max Tokens</span>
            <input type="number" min="0" value={draft.openai_max_tokens} onChange={(event) => onChange("openai_max_tokens", Number(event.target.value) || 0)} />
          </label>
          <label>
            <span>Seed</span>
            <input type="number" min="0" value={draft.openai_seed} onChange={(event) => onChange("openai_seed", Number(event.target.value) || 0)} />
          </label>
          <label>
            <span>Thinking Budget</span>
            <input type="number" min="0" value={draft.openai_thinking_budget} onChange={(event) => onChange("openai_thinking_budget", Number(event.target.value) || 0)} />
          </label>
          <label>
            <span>搜索策略</span>
            <select value={draft.openai_search_strategy} onChange={(event) => onChange("openai_search_strategy", event.target.value)}>
              <option value="turbo">turbo</option>
              <option value="max">max</option>
              <option value="agent">agent</option>
              <option value="agent_max">agent_max</option>
            </select>
          </label>
          <label className="connection-full-span">
            <span>Stop Sequences（每行一个，或 JSON 数组）</span>
            <textarea value={draft.openai_stop} onChange={(event) => onChange("openai_stop", event.target.value)} placeholder={"Observation:\n[\"</answer>\", \"###\"]"} />
          </label>
        </div>
        <div className="connection-checkbox-grid">
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.openai_enable_thinking} onChange={(event) => onChange("openai_enable_thinking", event.target.checked)} />
            <span>启用 OpenAI Thinking</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.openai_enable_search} onChange={(event) => onChange("openai_enable_search", event.target.checked)} />
            <span>启用联网搜索</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.openai_search_forced} onChange={(event) => onChange("openai_search_forced", event.target.checked)} />
            <span>强制搜索</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.openai_enable_search_extension} onChange={(event) => onChange("openai_enable_search_extension", event.target.checked)} />
            <span>垂域搜索扩展</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.openai_multimodal_enabled} onChange={(event) => onChange("openai_multimodal_enabled", event.target.checked)} />
            <span>启用多模态输入</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.restart_service} onChange={(event) => onChange("restart_service", event.target.checked)} />
            <span>保存后自动重启节点</span>
          </label>
        </div>
      </details>

      <details className="form-advanced-details connection-fold-card">
        <summary>
          <span className="section-kicker">运行时详情</span>
          <span className="connection-fold-hint">服务路径、注册时间与诊断状态</span>
        </summary>
        <div className="info-stack connection-inline-info">
          <InfoRow label="服务名" value={status?.service_name || "未读取"} multiline />
          <InfoRow label="配置文件" value={status?.config_path || "未读取"} multiline />
          <InfoRow label="诊断文件" value={status?.diagnostics_path || "未读取"} multiline />
          <InfoRow label="运行详情" value={runtimeSummary.detail || status?.detail || "未读取"} multiline />
          <InfoRow label="本地状态机" value={status?.runtime_state || String(status?.diagnostics?.current_state || "未记录")} multiline />
          <InfoRow label="当前生效 Provider" value={status?.active_model_provider || "未读取"} multiline />
          <InfoRow label="推理后端状态" value={status?.inference_ready ? "已就绪" : "未就绪"} />
          <InfoRow label="推理后端说明" value={status?.inference_detail || "暂无"} multiline />
          <InfoRow label="最近注册结果" value={status?.last_register_result || "暂无"} multiline />
          <InfoRow label="最近注册时间" value={status?.last_register_at || "暂无"} />
          <InfoRow label="最近应用时间" value={status?.last_apply_at || "暂无"} />
          <InfoRow label="最近应用错误" value={status?.last_apply_error || "无"} multiline />
        </div>
      </details>

      {eventPreview ? <SnippetBlock label="本机节点事件日志" content={eventPreview} /> : null}
    </section>
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
      ? "将替换"
      : status === "clear"
        ? "将清空"
        : status === "keep"
          ? "将保留"
          : configured
            ? "待确认"
            : "未提供";

  return (
    <section className="node-secret-card">
      <div className="node-secret-head">
        <div>
          <div className="section-kicker">Credential</div>
          <h4>{title}</h4>
        </div>
        <span className={`node-secret-badge node-secret-badge-${status}`}>{statusLabel}</span>
      </div>
      <p className="node-model-copy">{subtitle}</p>
      <ToggleSecretInput
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
      />
      {configured ? (
        <div className="connection-checkbox-grid node-secret-options">
          <label className="checkbox-row">
            <input type="checkbox" checked={preserve && !clear} onChange={(event) => onPreserveChange(event.target.checked)} />
            <span>保留当前已保存的 Key</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={clear} onChange={(event) => onClearChange(event.target.checked)} />
            <span>保存时清空这个 Key</span>
          </label>
        </div>
      ) : null}
    </section>
  );
}
