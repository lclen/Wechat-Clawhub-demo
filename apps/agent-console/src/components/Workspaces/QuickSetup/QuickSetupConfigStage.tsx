import { ToggleSecretInput } from "../Connection/ConnectionUi";
import type {
  ConsoleSetupConfig,
  DiscoveredNodeRecord,
  GatewaySetupConfig,
  ManualPairDraft,
  PairingStatus,
  SetupRole,
  SetupTaskResult,
  WorkerGatewayConnectionState,
  WorkerNodeSetupConfig,
} from "../../../types";

type QuickSetupConfigStageProps = {
  setupRole: SetupRole;
  busyKey: string | null;
  gatewaySetup: GatewaySetupConfig;
  workerSetup: WorkerNodeSetupConfig;
  consoleSetup: ConsoleSetupConfig;
  currentNodeLanIp: string;
  discoveredNodes: DiscoveredNodeRecord[];
  pairingStatuses: Record<string, PairingStatus>;
  pairingSecrets: Record<string, string>;
  manualPair: ManualPairDraft;
  workerGatewayProbeTask: SetupTaskResult | null;
  workerGatewayConnectionLabel: string;
  workerGatewayConnectionState: WorkerGatewayConnectionState;
  workerPairingKeyVisible: boolean;
  workerModelExpanded: boolean;
  builtinModelLabel: string;
  onUpdateGatewaySetup: <K extends keyof GatewaySetupConfig>(key: K, value: GatewaySetupConfig[K]) => void;
  onUpdateWorkerSetup: <K extends keyof WorkerNodeSetupConfig>(key: K, value: WorkerNodeSetupConfig[K]) => void;
  onUpdateConsoleSetup: (key: "gateway_base_url", value: string) => void;
  onUpdatePairingSecret: (discoveryId: string, value: string) => void;
  onScanLanNodes: () => void;
  onPairLanNode: (discovered: DiscoveredNodeRecord) => void;
  onApplyPreferredGatewayBaseUrlToWorker: () => void;
  onProbeWorkerGateway: () => void;
  onToggleWorkerPairingKeyVisible: () => void;
  onToggleWorkerModelExpanded: () => void;
  onUpdateManualPair: <K extends keyof ManualPairDraft>(key: K, value: ManualPairDraft[K]) => void;
  pairingStatusLabel: (status: PairingStatus) => string;
  pairingStatusTone: (status: PairingStatus) => string;
  validateWorkerGatewayUrl: (value: string) => boolean;
  resolveTokenWaiting: (token: string) => boolean;
};

export function QuickSetupConfigStage({
  setupRole,
  busyKey,
  gatewaySetup,
  workerSetup,
  consoleSetup,
  currentNodeLanIp,
  discoveredNodes,
  pairingStatuses,
  pairingSecrets,
  manualPair,
  workerGatewayProbeTask,
  workerGatewayConnectionLabel,
  workerGatewayConnectionState,
  workerPairingKeyVisible,
  workerModelExpanded,
  builtinModelLabel,
  onUpdateGatewaySetup,
  onUpdateWorkerSetup,
  onUpdateConsoleSetup,
  onUpdatePairingSecret,
  onScanLanNodes,
  onPairLanNode,
  onApplyPreferredGatewayBaseUrlToWorker,
  onProbeWorkerGateway,
  onToggleWorkerPairingKeyVisible,
  onToggleWorkerModelExpanded,
  onUpdateManualPair,
  pairingStatusLabel,
  pairingStatusTone,
  validateWorkerGatewayUrl,
  resolveTokenWaiting,
}: QuickSetupConfigStageProps) {
  if (setupRole === "gateway_host" || setupRole === "gateway_host_console") {
    return (
      <>
        <div className="form-grid">
          <label><span>Redis URL</span><input value={gatewaySetup.redis_url} onChange={(event) => onUpdateGatewaySetup("redis_url", event.target.value)} /></label>
          <label><span>默认 Agent ID</span><input value={gatewaySetup.default_agent_id} onChange={(event) => onUpdateGatewaySetup("default_agent_id", event.target.value)} /></label>
          <label><span>主网关访问地址</span><input value={consoleSetup.gateway_base_url} onChange={(event) => onUpdateConsoleSetup("gateway_base_url", event.target.value)} placeholder="节点回连主机时使用这个地址" /></label>
          <label><span>Dify Base URL（留空则默认走内置模型）</span><input value={gatewaySetup.dify_base_url} onChange={(event) => onUpdateGatewaySetup("dify_base_url", event.target.value)} placeholder="https://api.dify.ai/v1" /></label>
          <label><span>Dify API Key</span><textarea value={gatewaySetup.dify_api_key} onChange={(event) => onUpdateGatewaySetup("dify_api_key", event.target.value)} placeholder="留空时保留当前已保存值；若同时未填 Dify Base URL，则回退到内置模型。" /></label>
          <label><span>DashScope Base URL</span><input value={gatewaySetup.builtin_model_base_url} onChange={(event) => onUpdateGatewaySetup("builtin_model_base_url", event.target.value)} placeholder="留空时默认使用 https://dashscope.aliyuncs.com/compatible-mode/v1" /></label>
          <label><span>DashScope API Key</span><textarea value={gatewaySetup.builtin_model_api_key} onChange={(event) => onUpdateGatewaySetup("builtin_model_api_key", event.target.value)} placeholder="留空则保留当前已保存的 DashScope API Key。" /></label>
          <label><span>DashScope 模型</span><input value={gatewaySetup.builtin_model_name} onChange={(event) => onUpdateGatewaySetup("builtin_model_name", event.target.value)} placeholder="留空时默认使用 qwen3.5-plus" /></label>
          <label><span>微信 Base URL</span><input value={gatewaySetup.wechat_base_url} onChange={(event) => onUpdateGatewaySetup("wechat_base_url", event.target.value)} /></label>
          <label><span>微信 Token</span><textarea value={gatewaySetup.wechat_token} onChange={(event) => onUpdateGatewaySetup("wechat_token", event.target.value)} placeholder="留空则保留当前已保存 token；填写后保存会尝试直接刷新连接。" /></label>
        </div>
        <div className="inline-tip">
          当前网关内置模型仅支持阿里云 DashScope / 通义千问模型，暂不提供其他兼容供应商入口。
        </div>
        <details className="form-advanced-details connection-fold-card">
          <summary>
            <span className="section-kicker">DashScope 高级参数</span>
            <span className="connection-fold-hint">thinking、采样、搜索、多模态与 stop sequences</span>
          </summary>
          <div className="connection-form-grid">
            <label><span>Temperature</span><input type="number" step="0.1" min="0" max="2" value={gatewaySetup.builtin_model_temperature} onChange={(event) => onUpdateGatewaySetup("builtin_model_temperature", Number(event.target.value) || 0)} /></label>
            <label><span>Top P</span><input type="number" step="0.1" min="0" max="1" value={gatewaySetup.builtin_model_top_p} onChange={(event) => onUpdateGatewaySetup("builtin_model_top_p", Number(event.target.value) || 0)} /></label>
            <label><span>Max Tokens</span><input type="number" min="0" value={gatewaySetup.builtin_model_max_tokens} onChange={(event) => onUpdateGatewaySetup("builtin_model_max_tokens", Number(event.target.value) || 0)} /></label>
            <label><span>Seed</span><input type="number" min="0" value={gatewaySetup.builtin_model_seed} onChange={(event) => onUpdateGatewaySetup("builtin_model_seed", Number(event.target.value) || 0)} /></label>
            <label><span>Thinking Budget</span><input type="number" min="0" value={gatewaySetup.builtin_model_thinking_budget} onChange={(event) => onUpdateGatewaySetup("builtin_model_thinking_budget", Number(event.target.value) || 0)} /></label>
            <label>
              <span>搜索策略</span>
              <select value={gatewaySetup.builtin_model_search_strategy} onChange={(event) => onUpdateGatewaySetup("builtin_model_search_strategy", event.target.value)}>
                <option value="turbo">turbo</option>
                <option value="max">max</option>
                <option value="agent">agent</option>
                <option value="agent_max">agent_max</option>
              </select>
            </label>
            <label className="connection-full-span">
              <span>Stop Sequences（每行一个，或 JSON 数组）</span>
              <textarea value={gatewaySetup.builtin_model_stop} onChange={(event) => onUpdateGatewaySetup("builtin_model_stop", event.target.value)} placeholder={"Observation:\n[\"</answer>\", \"###\"]"} />
            </label>
          </div>
          <div className="connection-checkbox-grid">
            <label className="checkbox-row"><input type="checkbox" checked={gatewaySetup.builtin_model_enable_thinking} onChange={(event) => onUpdateGatewaySetup("builtin_model_enable_thinking", event.target.checked)} /><span>启用 DashScope Thinking</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={gatewaySetup.builtin_model_enable_search} onChange={(event) => onUpdateGatewaySetup("builtin_model_enable_search", event.target.checked)} /><span>启用联网搜索</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={gatewaySetup.builtin_model_search_forced} onChange={(event) => onUpdateGatewaySetup("builtin_model_search_forced", event.target.checked)} /><span>强制搜索</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={gatewaySetup.builtin_model_enable_search_extension} onChange={(event) => onUpdateGatewaySetup("builtin_model_enable_search_extension", event.target.checked)} /><span>垂域搜索扩展</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={gatewaySetup.builtin_model_multimodal_enabled} onChange={(event) => onUpdateGatewaySetup("builtin_model_multimodal_enabled", event.target.checked)} /><span>启用多模态输入</span></label>
          </div>
        </details>
        <section className="surface surface-subsection">
          <div className="section-head">
            <div><div className="section-kicker">自动发现</div><h3>搜索局域网内已运行的工作节点</h3></div>
            <button type="button" onClick={onScanLanNodes} disabled={busyKey !== null}>{busyKey === "setup-discovery-scan" ? "搜索中..." : "搜索局域网节点"}</button>
          </div>
          {!discoveredNodes.length ? <div className="empty-state">保存主机配置后，点击“搜索局域网节点”即可发现同网段内已运行且开启发现响应的 `claw-node`。</div> : (
            <div className="discovery-list">
              {discoveredNodes.map((item) => {
                const status = pairingStatuses[item.discovery_id] || (item.already_paired ? "already_paired" : "pending");
                return (
                  <div key={item.discovery_id} className="discovery-card">
                    <div className="discovery-card-top">
                      <div>
                        <div className="node-card-title">{item.pairing_label || item.hostname}</div>
                        <div className="node-card-subtitle">{[item.lan_ip || "-", item.platform || "-", item.node_version || "-"].join(" · ")}</div>
                      </div>
                      <span className={`session-badge session-badge-${pairingStatusTone(status)}`}>{pairingStatusLabel(status)}</span>
                    </div>
                    <div className="node-card-grid">
                      <div><div className="node-card-label">局域网 IP</div><div className="node-card-value">{item.lan_ip || "未上报"}</div></div>
                      <div><div className="node-card-label">配对端口</div><div className="node-card-value">{item.pairing_port}</div></div>
                      <div><div className="node-card-label">能力</div><div className="node-card-value">{item.capabilities.join(", ") || "未声明"}</div></div>
                      <div><div className="node-card-label">正式节点 ID</div><div className="node-card-value">{item.node_id || "配对时自动生成"}</div></div>
                    </div>
                    <div className="discovery-actions">
                      <input value={pairingSecrets[item.discovery_id] || ""} onChange={(event) => onUpdatePairingSecret(item.discovery_id, event.target.value)} placeholder="输入该机器的配对密钥" />
                      <button type="button" onClick={() => onPairLanNode(item)} disabled={busyKey !== null}>{busyKey === "setup-discovery-pair" ? "连接中..." : "输入密钥并连接"}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </>
    );
  }

  if (setupRole === "worker_node") {
    return (
      <div className="worker-wizard">
        <div className="worker-wizard-identity" style={{ marginBottom: 16 }}>
          <div className="worker-wizard-identity-ip">{currentNodeLanIp || "检测中…"}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            端口：{workerSetup.discovery_port} &nbsp;&middot;&nbsp; 这是本机节点的地址，网关管理员需要用这个地址来发现和配对你的节点
          </div>
        </div>

        <div className="form-grid">
          <label><span>节点 ID</span><input value={workerSetup.node_id} onChange={(event) => onUpdateWorkerSetup("node_id", event.target.value)} /></label>
          <label>
            <span>目标网关地址 <span style={{ color: "var(--red, #c0392b)" }}>*</span></span>
            <div className="field-with-action">
              <input
                value={workerSetup.gateway_base_url}
                onChange={(event) => onUpdateWorkerSetup("gateway_base_url", event.target.value)}
                placeholder="例如 http://192.168.0.18:8300"
                style={!validateWorkerGatewayUrl(workerSetup.gateway_base_url) && workerSetup.gateway_base_url !== "" ? { borderColor: "var(--red, #c0392b)" } : undefined}
              />
              <button type="button" className="ghost-button" onClick={onApplyPreferredGatewayBaseUrlToWorker}>填入本机地址</button>
              <button type="button" className="ghost-button" onClick={onProbeWorkerGateway} disabled={busyKey !== null}>
                {busyKey === "setup-gateway-probe" ? "检测中..." : "检测连接"}
              </button>
            </div>
            {workerGatewayProbeTask ? (
              <div style={{ fontSize: 12, marginTop: 4, color: workerGatewayConnectionState === "gateway_reachable_node_connected" || workerGatewayConnectionState === "gateway_reachable_node_pending_confirm" ? "var(--green)" : "var(--amber)" }}>
                {workerGatewayConnectionLabel}
              </div>
            ) : null}
          </label>
          <label>
            <span>配对密鑰</span>
            <div className="field-with-action">
              <input type={workerPairingKeyVisible ? "text" : "password"} value={workerSetup.pairing_key} onChange={(event) => onUpdateWorkerSetup("pairing_key", event.target.value)} placeholder="节点与网关需保持一致" autoComplete="new-password" />
              <button type="button" className="ghost-button" onClick={onToggleWorkerPairingKeyVisible}>{workerPairingKeyVisible ? "隐藏" : "显示"}</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>配对密鑰由你自己设定，网关管理员在配对时需要输入相同的密鑰</div>
          </label>
          <label><span>安装目录</span><input value={workerSetup.install_dir} onChange={(event) => onUpdateWorkerSetup("install_dir", event.target.value)} /></label>
          <label><span>发现响应端口</span><input type="number" value={workerSetup.discovery_port} onChange={(event) => onUpdateWorkerSetup("discovery_port", Number(event.target.value) || 9531)} /></label>
          <label><span>启用局域网发现</span><input type="checkbox" checked={workerSetup.discovery_enabled} onChange={(event) => onUpdateWorkerSetup("discovery_enabled", event.target.checked)} /></label>
          <label><span>Bundle 路径（可选）</span><input value={workerSetup.bundle_path} onChange={(event) => onUpdateWorkerSetup("bundle_path", event.target.value)} placeholder="留空则自动查找" /></label>
        </div>

        <div className="worker-token-readonly" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>节点 Token（只读）</div>
          <div>{resolveTokenWaiting(workerSetup.node_token) ? "空（等待网关配对后自动下发）" : "已配对"}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Token 无需手动填写，完成配对后网关会自动将 Token 写入本机配置</div>
        </div>

        <div className="worker-model-collapse" style={{ marginTop: 16 }}>
          <div className="worker-model-collapse-header" onClick={onToggleWorkerModelExpanded}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>模型配置（可选）</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{workerModelExpanded ? "收起" : "展开"}</span>
          </div>
          {!workerModelExpanded ? (
            <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
              当前机器节点使用独立模型配置；未配置则不会自动回复，请先保存并应用节点配置。
            </div>
          ) : (
            <div className="worker-model-collapse-body">
              <div className="inline-tip">
                当前机器节点使用独立模型配置；请直接填写节点自己的 DashScope 或 Dify 参数。
              </div>
              <div className="form-grid">
                <label><span>DashScope Base URL</span><input value={workerSetup.openai_base_url} onChange={(event) => onUpdateWorkerSetup("openai_base_url", event.target.value)} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" /></label>
                <label><span>DashScope 模型</span><input value={workerSetup.openai_model} onChange={(event) => onUpdateWorkerSetup("openai_model", event.target.value)} placeholder="qwen3.5-plus / qwen-plus / qwen-max" /></label>
                <label className="connection-full-span"><span>DashScope API Key</span><ToggleSecretInput value={workerSetup.openai_api_key} onChange={(event) => onUpdateWorkerSetup("openai_api_key", event.target.value)} placeholder="输入当前机器节点专用的 DashScope API Key" autoComplete="new-password" /></label>
                <label><span>Dify Base URL</span><input value={workerSetup.dify_base_url} onChange={(event) => onUpdateWorkerSetup("dify_base_url", event.target.value)} /></label>
                <label><span>Dify API Key</span><textarea value={workerSetup.dify_api_key} onChange={(event) => onUpdateWorkerSetup("dify_api_key", event.target.value)} /></label>
                <label><span>最大并发</span><input type="number" value={workerSetup.max_concurrency} onChange={(event) => onUpdateWorkerSetup("max_concurrency", Number(event.target.value) || 1)} /></label>
              </div>
              <details className="form-advanced-details connection-fold-card">
                <summary>
                  <span className="section-kicker">DashScope 高级参数</span>
                  <span className="connection-fold-hint">当前机器节点自己的推理参数</span>
                </summary>
                <div className="connection-form-grid">
                  <label><span>Temperature</span><input type="number" step="0.1" min="0" max="2" value={workerSetup.openai_temperature} onChange={(event) => onUpdateWorkerSetup("openai_temperature", Number(event.target.value) || 0)} /></label>
                  <label><span>Top P</span><input type="number" step="0.1" min="0" max="1" value={workerSetup.openai_top_p} onChange={(event) => onUpdateWorkerSetup("openai_top_p", Number(event.target.value) || 0)} /></label>
                  <label><span>Max Tokens</span><input type="number" min="0" value={workerSetup.openai_max_tokens} onChange={(event) => onUpdateWorkerSetup("openai_max_tokens", Number(event.target.value) || 0)} /></label>
                  <label><span>Seed</span><input type="number" min="0" value={workerSetup.openai_seed} onChange={(event) => onUpdateWorkerSetup("openai_seed", Number(event.target.value) || 0)} /></label>
                  <label><span>Thinking Budget</span><input type="number" min="0" value={workerSetup.openai_thinking_budget} onChange={(event) => onUpdateWorkerSetup("openai_thinking_budget", Number(event.target.value) || 0)} /></label>
                  <label>
                    <span>搜索策略</span>
                    <select value={workerSetup.openai_search_strategy} onChange={(event) => onUpdateWorkerSetup("openai_search_strategy", event.target.value)}>
                      <option value="turbo">turbo</option>
                      <option value="max">max</option>
                      <option value="agent">agent</option>
                      <option value="agent_max">agent_max</option>
                    </select>
                  </label>
                  <label className="connection-full-span">
                    <span>Stop Sequences（每行一个，或 JSON 数组）</span>
                    <textarea value={workerSetup.openai_stop} onChange={(event) => onUpdateWorkerSetup("openai_stop", event.target.value)} placeholder={"Observation:\n[\"</answer>\", \"###\"]"} />
                  </label>
                </div>
                <div className="connection-checkbox-grid">
                  <label className="checkbox-row"><input type="checkbox" checked={workerSetup.openai_enable_thinking} onChange={(event) => onUpdateWorkerSetup("openai_enable_thinking", event.target.checked)} /><span>启用 DashScope Thinking</span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={workerSetup.openai_enable_search} onChange={(event) => onUpdateWorkerSetup("openai_enable_search", event.target.checked)} /><span>启用联网搜索</span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={workerSetup.openai_search_forced} onChange={(event) => onUpdateWorkerSetup("openai_search_forced", event.target.checked)} /><span>强制搜索</span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={workerSetup.openai_enable_search_extension} onChange={(event) => onUpdateWorkerSetup("openai_enable_search_extension", event.target.checked)} /><span>垂域搜索扩展</span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={workerSetup.openai_multimodal_enabled} onChange={(event) => onUpdateWorkerSetup("openai_multimodal_enabled", event.target.checked)} /><span>启用多模态输入</span></label>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="form-grid">
      <label><span>目标网关地址</span><input value={consoleSetup.gateway_base_url} onChange={(event) => onUpdateConsoleSetup("gateway_base_url", event.target.value)} /></label>
      <label><span>目标 IP / 主机名</span><input value={manualPair.host} onChange={(event) => onUpdateManualPair("host", event.target.value)} placeholder="例如 192.168.0.23" /></label>
      <label><span>配对端口</span><input type="number" value={manualPair.pairing_port} onChange={(event) => onUpdateManualPair("pairing_port", Number(event.target.value) || 9532)} /></label>
      <label><span>配对密钥</span><ToggleSecretInput value={manualPair.pairing_key} onChange={(event) => onUpdateManualPair("pairing_key", event.target.value)} placeholder="与目标节点上的 CLAW_PAIRING_KEY 一致" autoComplete="new-password" /></label>
      <label><span>指定节点 ID（可选）</span><input value={manualPair.node_id} onChange={(event) => onUpdateManualPair("node_id", event.target.value)} placeholder="留空则自动生成或沿用远端值" /></label>
    </div>
  );
}
