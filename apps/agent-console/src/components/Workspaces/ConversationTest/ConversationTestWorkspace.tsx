import { useMemo, useState } from "react";
import type {
  LocalNodeConversationTestRequest,
  LocalNodeConversationTestResponse,
  LocalNodeStatusResponse,
} from "../../../types";

type ConversationTestWorkspaceProps = {
  currentRoleIsWorker: boolean;
  launcherAvailable: boolean;
  busyKey: string | null;
  localNodeStatus: LocalNodeStatusResponse | null;
  localNodeModelDirty: boolean;
  onSaveLocalNodeModelConfig: () => void;
  onRefreshLocalNodeDiagnostics: () => void;
  onRunLocalNodeConversationTest: (
    payload: LocalNodeConversationTestRequest
  ) => Promise<LocalNodeConversationTestResponse>;
};

const DEFAULT_MESSAGE =
  "请用一句话回复：如果你已经收到这条测试消息，请说明当前走的是哪条推理链路。";

export function ConversationTestWorkspace({
  currentRoleIsWorker,
  launcherAvailable,
  busyKey,
  localNodeStatus,
  localNodeModelDirty,
  onSaveLocalNodeModelConfig,
  onRefreshLocalNodeDiagnostics,
  onRunLocalNodeConversationTest,
}: ConversationTestWorkspaceProps) {
  const [provider, setProvider] =
    useState<LocalNodeConversationTestRequest["provider"]>("current");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [result, setResult] = useState<LocalNodeConversationTestResponse | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const configuredProvider =
    localNodeStatus?.configured_model_provider || "未读取";
  const activeProvider = localNodeStatus?.active_model_provider || "未读取";
  const canRun = launcherAvailable && localNodeStatus !== null;
  const usageText = useMemo(() => {
    if (!result?.usage || Object.keys(result.usage).length === 0) return "暂无 usage 数据";
    return JSON.stringify(result.usage, null, 2);
  }, [result]);

  async function handleRunTest() {
    setErrorText(null);
    try {
      const response = await onRunLocalNodeConversationTest({ provider, message });
      setResult(response);
    } catch (error) {
      setResult(null);
      setErrorText((error as Error).message);
    }
  }

  return (
    <section className="workspace-frame conversation-test-workspace">
      <div className="workspace-heading">
        <div>
          <div className="section-kicker">
            {currentRoleIsWorker ? "节点对话测试" : "模型对话测试"}
          </div>
          <h2>直接发一条测试消息，确认当前 OpenAI 或 Dify 配置真的能收到回复</h2>
        </div>
        <div className="workspace-caption">
          这个页面验证的是“可真正完成一轮对话”，而不只是模型列表可访问。
        </div>
      </div>

      {!launcherAvailable ? (
        <section className="surface">
          <div className="empty-state">
            当前前端没有连接到本地 launcher，暂时无法发起本机节点对话测试。
          </div>
        </section>
      ) : !localNodeStatus ? (
        <section className="surface">
          <div className="section-head compact-head">
            <div>
              <div className="section-kicker">节点状态</div>
              <h3>先读取本机节点运行态</h3>
            </div>
            <button type="button" className="ghost-button" onClick={onRefreshLocalNodeDiagnostics}>
              刷新节点状态
            </button>
          </div>
          <div className="empty-state">
            还没有读到本机节点状态，请先刷新一次，确认 launcher 已经拿到当前节点配置。
          </div>
        </section>
      ) : (
        <div className="conversation-test-layout">
          <section className="surface">
            <div className="section-head">
              <div>
                <div className="section-kicker">Test Setup</div>
                <h3>选择测试链路</h3>
              </div>
              <div className="inline-actions">
                <button type="button" className="ghost-button" onClick={onRefreshLocalNodeDiagnostics} disabled={busyKey !== null}>
                  刷新节点状态
                </button>
                <button type="button" onClick={handleRunTest} disabled={busyKey !== null || !canRun}>
                  {busyKey === "local-node-conversation-test" ? "测试中..." : "发送测试消息"}
                </button>
              </div>
            </div>

            <div className="conversation-test-facts">
              <div className="connection-fact-tile">
                <span>已保存 Provider</span>
                <strong>{configuredProvider}</strong>
              </div>
              <div className="connection-fact-tile">
                <span>当前生效 Provider</span>
                <strong>{activeProvider}</strong>
              </div>
              <div className="connection-fact-tile">
                <span>推理后端状态</span>
                <strong>{localNodeStatus.inference_ready ? "已就绪" : "未就绪"}</strong>
              </div>
              <div className="connection-fact-tile">
                <span>配置文件</span>
                <strong>{localNodeStatus.config_path || "未读取"}</strong>
              </div>
            </div>

            {localNodeModelDirty ? (
              <div className="inline-tip conversation-test-warning">
                当前还有未保存的模型草稿。对话测试走的是节点已保存到 <code>node.env</code> 的配置，不会自动带上未保存改动。
                <button type="button" className="ghost-button" onClick={onSaveLocalNodeModelConfig} disabled={busyKey !== null}>
                  {busyKey === "local-node-model-save" ? "保存中..." : "先保存当前模型配置"}
                </button>
              </div>
            ) : null}

            <div className="conversation-provider-row" role="tablist" aria-label="Conversation test providers">
              {([
                { value: "current", label: "当前配置" },
                { value: "openai", label: "OpenAI" },
                { value: "dify", label: "Dify" },
              ] as const).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`node-provider-chip ${provider === item.value ? "node-provider-chip-active" : ""}`}
                  onClick={() => setProvider(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <label className="conversation-test-editor">
              <span>测试消息</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="输入一条你想让 AI 回答的测试消息"
              />
            </label>

            <div className="inline-tip">
              建议先用一句短问题测试连通性，确认成功后再试业务提示词。
            </div>
          </section>

          <section className="surface">
            <div className="section-head">
              <div>
                <div className="section-kicker">Test Result</div>
                <h3>本次对话回执</h3>
              </div>
            </div>

            {errorText ? (
              <div className="conversation-test-error">
                <strong>测试失败</strong>
                <div>{errorText}</div>
              </div>
            ) : null}

            {result ? (
              <div className="conversation-test-result">
                <div className="connection-fact-grid connection-fact-grid-wide">
                  <div className="connection-fact-tile">
                    <span>实际走的链路</span>
                    <strong>{result.provider}</strong>
                  </div>
                  <div className="connection-fact-tile">
                    <span>保存的 Provider</span>
                    <strong>{result.configured_provider || "未读取"}</strong>
                  </div>
                  <div className="connection-fact-tile">
                    <span>耗时</span>
                    <strong>{result.latency_ms} ms</strong>
                  </div>
                  <div className="connection-fact-tile">
                    <span>结果</span>
                    <strong>{result.ok ? "已收到回复" : "失败"}</strong>
                  </div>
                </div>

                <div className="info-stack connection-inline-info">
                  <div className="info-row">
                    <span className="info-label">接口说明</span>
                    <span className="info-value">{result.detail || "暂无说明"}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">配置来源</span>
                    <span className="info-value">{result.config_path || localNodeStatus.config_path || "未读取"}</span>
                  </div>
                </div>

                <div className="snippet-block">
                  <div className="snippet-label">AI 回复</div>
                  <pre>{result.reply || "接口返回成功，但回复为空。"}</pre>
                </div>

                <div className="snippet-block">
                  <div className="snippet-label">Usage</div>
                  <pre>{usageText}</pre>
                </div>
              </div>
            ) : !errorText ? (
              <div className="empty-state">
                还没有执行测试。发送一条消息后，这里会显示实际走的 provider、耗时和 AI 回复正文。
              </div>
            ) : null}
          </section>
        </div>
      )}
    </section>
  );
}
