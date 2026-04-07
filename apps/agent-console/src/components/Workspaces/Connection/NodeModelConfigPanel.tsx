import type { LocalNodeModelConfigRequest, LocalNodeStatusResponse } from "../../../types";
import { InfoRow, SnippetBlock, ToggleSecretInput } from "./ConnectionUi";

type NodeModelConfigPanelProps = {
  launcherAvailable: boolean;
  busyKey: string | null;
  status: LocalNodeStatusResponse | null;
  runtimeSummary: { label: string; detail: string };
  eventPreview: string;
  draft: LocalNodeModelConfigRequest;
  onChange: <K extends keyof LocalNodeModelConfigRequest>(key: K, value: LocalNodeModelConfigRequest[K]) => void;
  onRefresh: () => void;
  onRestart: () => void;
  onSave: () => void;
  onExport: () => void;
};

export function NodeModelConfigPanel({
  launcherAvailable,
  busyKey,
  status,
  runtimeSummary,
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
          : "保存并应用";
  const applyStateLabel =
    applyState === "saving"
      ? "正在保存"
      : applyState === "restarting"
        ? "正在重启节点服务"
        : applyState === "applied"
          ? "已应用"
          : applyState === "failed"
            ? "应用失败"
            : "空闲";

  return (
    <section className="surface">
      <div className="section-head">
        <div>
          <div className="section-kicker">节点与模型参数</div>
          <h3>本机内置节点与推理后端</h3>
        </div>
        <div className="inline-actions">
          <button type="button" className="ghost-button" onClick={onRefresh} disabled={busyKey !== null}>
            刷新
          </button>
          <button type="button" className="ghost-button" onClick={onRestart} disabled={busyKey !== null || applyBusy}>
            {busyKey === "local-node-restart" || applyBusy ? "重启中..." : "重启服务"}
          </button>
          <button type="button" className="ghost-button" onClick={onExport} disabled={busyKey !== null}>
            {busyKey === "local-node-export" ? "导出中..." : "导出诊断包"}
          </button>
          <button type="button" className="ghost-button" onClick={onSave} disabled={busyKey !== null || applyBusy}>
            {saveButtonLabel}
          </button>
        </div>
      </div>

      <div className="inline-tip">
        这里展示的是网关当前机器自带的内置节点，不是局域网中其它远端工作节点。模型配置以节点自己的 `node.env` 为准，保存后会在后台重启节点服务。
      </div>

      <div className="connection-fact-grid connection-fact-grid-wide">
        <div className="connection-fact-tile">
          <span>节点身份</span>
          <strong>{status?.node_kind === "local" ? "网关内置节点" : "未读取"}</strong>
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
          <span>配置中的 Provider</span>
          <strong>{status?.configured_model_provider || status?.model_settings?.model_provider || "未读取"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>当前生效 Provider</span>
          <strong>{status?.active_model_provider || "未读取"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>OpenAI Key</span>
          <strong>{status?.model_settings?.openai_api_key_configured ? "已配置" : "未配置"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>Dify Key</span>
          <strong>{status?.model_settings?.dify_api_key_configured ? "已配置" : "未配置"}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>配置应用状态</span>
          <strong>{applyStateLabel}</strong>
        </div>
        <div className="connection-fact-tile">
          <span>推理后端</span>
          <strong>{status?.inference_ready ? "已就绪" : "未就绪"}</strong>
        </div>
      </div>

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

      <div className="connection-panel-subhead">
        <div>
          <div className="section-kicker">基础参数</div>
          <h4>保持常用项可见，高级项折叠</h4>
        </div>
      </div>

      <div className="connection-form-grid">
        <label>
          <span>模型提供方</span>
          <select value={draft.model_provider} onChange={(event) => onChange("model_provider", event.target.value)}>
            <option value="auto">auto</option>
            <option value="openai">openai</option>
            <option value="dify">dify</option>
          </select>
        </label>
        <label>
          <span>OpenAI Base URL</span>
          <input value={draft.openai_base_url} onChange={(event) => onChange("openai_base_url", event.target.value)} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
        </label>
        <label>
          <span>OpenAI Model</span>
          <input value={draft.openai_model} onChange={(event) => onChange("openai_model", event.target.value)} placeholder="qwen3.5-plus" />
        </label>
        <label>
          <span>Dify Base URL</span>
          <input value={draft.dify_base_url} onChange={(event) => onChange("dify_base_url", event.target.value)} placeholder="https://api.dify.ai/v1" />
        </label>
      </div>

      <details className="form-advanced-details connection-fold-card">
        <summary>
          <span className="section-kicker">高级模型参数</span>
          <span className="connection-fold-hint">展开管理温度、搜索与密钥</span>
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
          <label>
            <span>OpenAI API Key</span>
            <ToggleSecretInput value={draft.openai_api_key} onChange={(event) => onChange("openai_api_key", event.target.value)} placeholder={status?.model_settings?.openai_api_key_configured ? "留空表示继续使用当前 Key" : "输入新的 API Key"} autoComplete="new-password" />
          </label>
          <label>
            <span>Dify API Key</span>
            <ToggleSecretInput value={draft.dify_api_key} onChange={(event) => onChange("dify_api_key", event.target.value)} placeholder={status?.model_settings?.dify_api_key_configured ? "留空表示继续使用当前 Key" : "输入新的 API Key"} autoComplete="new-password" />
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
            <span>保存后自动重启服务</span>
          </label>
        </div>
      </details>

      <SnippetBlock label="本机节点事件日志" content={eventPreview} />
    </section>
  );
}
