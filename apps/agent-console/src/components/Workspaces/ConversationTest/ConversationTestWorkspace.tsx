import { useMemo, useState } from "react";
import {
  CommandBar,
  InfoList,
  MetricStrip,
  SectionHeader,
  SignalBadge,
  SurfaceCard,
} from "../../shared/ConsolePrimitives";
import { formatModelProviderLabel } from "../../../stringUtils";
import type {
  LocalNodeConversationTestRequest,
  LocalNodeConversationTestResponse,
  LocalNodeStatusResponse,
} from "../../../types";

type ConversationTestWorkspaceProps = {
  currentRoleIsWorker: boolean;
  title: string;
  description: string;
  heroTitle: string;
  heroDescription: string;
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
  title,
  description,
  heroTitle,
  heroDescription,
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
    formatModelProviderLabel(localNodeStatus?.configured_model_provider) || "未读取";
  const activeProvider =
    formatModelProviderLabel(localNodeStatus?.active_model_provider) || "未读取";
  const canRun = launcherAvailable && localNodeStatus !== null;

  const usageText = useMemo(() => {
    if (!result?.usage || Object.keys(result.usage).length === 0) return "暂无数据";
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
            {currentRoleIsWorker ? "节点测试" : "端到端模型测试"}
          </div>
          <h2>{title}</h2>
          {description ? <div className="workspace-caption">{description}</div> : null}
        </div>
      </div>

      {!launcherAvailable ? (
        <SurfaceCard className="empty-state-card">
          <div className="console-empty-state">
            <strong>本机 Launcher 未就绪</strong>
            <span>当前前端没有连接到本地 launcher，暂时无法发起测试。</span>
          </div>
        </SurfaceCard>
      ) : !localNodeStatus ? (
        <SurfaceCard className="status-refresh-card">
          <SectionHeader
            kicker="节点状态"
            title="初始化会话链路"
            actions={
              <button
                type="button"
                className="ghost-button"
                onClick={onRefreshLocalNodeDiagnostics}
              >
                获取节点信息
              </button>
            }
          />
          <div className="console-empty-state" style={{ marginTop: 24 }}>
            <span>请先获取本机节点状态以加载当前推理配置。</span>
          </div>
        </SurfaceCard>
      ) : (
        <div className="conversation-test-layout" style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16, alignItems: "start" }}>
          {/* 左侧：测试指令面板 */}
          <SurfaceCard className="conversation-command-shell" tone="accent">
            <SectionHeader
              kicker="指令面板"
              title={heroTitle}
              description="手动选择链路并发送即时测试指令。此配置仅影响本次对话测试。"
              actions={
                <div className="inline-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={onRefreshLocalNodeDiagnostics}
                    disabled={busyKey !== null}
                  >
                    同步配置
                  </button>
                  <button
                    type="button"
                    onClick={handleRunTest}
                    disabled={busyKey !== null || !canRun}
                  >
                    {busyKey === "local-node-conversation-test" ? "正在推理..." : "发起请求"}
                  </button>
                </div>
              }
            />

            <MetricStrip
              className="conversation-test-metrics"
              style={{ marginTop: 12, marginBottom: 12 }}
              items={[
                { label: "生效后端", value: activeProvider },
                { label: "配置后端", value: configuredProvider },
                { label: "推理库", value: localNodeStatus.inference_ready ? "就绪" : "载入中" },
              ]}
            />

            {localNodeModelDirty ? (
              <div
                className="inline-tip conversation-test-warning"
                style={{ backgroundColor: "rgba(255, 120, 0, 0.05)", border: "1px solid rgba(255, 120, 0, 0.2)", padding: 12, borderRadius: 6, margin: "12px 0", fontSize: "0.9em" }}
              >
                <div style={{ color: "var(--warn)" }}>当前节点有未应用的修改。</div>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ marginTop: 8, height: 28 }}
                  onClick={onSaveLocalNodeModelConfig}
                  disabled={busyKey !== null}
                >
                  {busyKey === "local-node-model-save" ? "保存中..." : "立即保存并应用"}
                </button>
              </div>
            ) : null}

            <div className="console-section-copy" style={{ marginTop: 20, marginBottom: 12 }}>
              <span className="section-kicker">链路路由</span>
              <h4>后端 Provider 覆盖</h4>
            </div>
            <div className="node-provider-toggle">
              {([
                { value: "current", label: "默认配置" },
                { value: "openai", label: "DashScope" },
                { value: "dify", label: "Dify" },
              ] as const).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`node-provider-chip ${
                    provider === item.value ? "node-provider-chip-active" : ""
                  }`}
                  onClick={() => setProvider(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="conversation-test-editor-wrap" style={{ marginTop: 24 }}>
              <div className="console-section-copy" style={{ marginBottom: 12 }}>
                <span className="section-kicker">消息正文</span>
                <h4>输入测试 Prompt</h4>
              </div>
              <textarea
                style={{
                  width: "100%",
                  minHeight: 120,
                  backgroundColor: "var(--app-bg)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: 12,
                  color: "inherit",
                  fontSize: "14px",
                  lineHeight: "1.5",
                  resize: "vertical"
                }}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="在此输入你想让 AI 回答测试消息"
              />
              <div style={{ fontSize: "11px", opacity: 0.5, marginTop: 8 }}>
                提示：短文本更有利于快速验证连通性。模型回复可能受网络和配置影响。
              </div>
            </div>
          </SurfaceCard>

          {/* 右侧：对话回执面板 */}
          <SurfaceCard className="conversation-result-shell" tone="strong">
            <SectionHeader kicker="工作详情" title="本次对话回执" />

            {errorText ? (
              <div
                className="conversation-test-error"
                style={{
                  backgroundColor: "rgba(220, 38, 38, 0.05)",
                  border: "1px solid rgba(220, 38, 38, 0.2)",
                  padding: 16,
                  borderRadius: 8,
                  marginTop: 16,
                }}
              >
                <strong style={{ color: "var(--danger)", display: "block", marginBottom: 4 }}>
                  请求出现异常
                </strong>
                <div style={{ fontSize: "14px", whiteSpace: "pre-wrap" }}>{errorText}</div>
              </div>
            ) : null}

            {result ? (
              <div className="conversation-test-result" style={{ marginTop: 12 }}>
                <MetricStrip
                  className="conversation-result-metrics"
                  items={[
                    {
                      label: "路由链路",
                      value: formatModelProviderLabel(result.provider) || result.provider,
                    },
                    { label: "推理耗时", value: `${result.latency_ms} ms` },
                    { label: "响应状态", value: result.ok ? "SUCCESS" : "FAIL" },
                  ]}
                />

                <div style={{ marginTop: 20 }}>
                  <InfoList
                    items={[
                      { label: "接口说明", value: result.detail || "暂无回执详情" },
                      {
                        label: "配置来源",
                        value: result.config_path || localNodeStatus.config_path || "内置默认",
                      },
                    ]}
                  />
                </div>

                <div className="snippet-block" style={{ marginTop: 20 }}>
                  <div className="snippet-label" style={{ marginBottom: 8, fontSize: "12px", opacity: 0.6 }}>AI 模型回复</div>
                  <pre
                    style={{
                      backgroundColor: "rgba(0,0,0,0.2)",
                      padding: 16,
                      borderRadius: 8,
                      fontSize: "13px",
                      lineHeight: "1.6",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      border: "1px solid var(--line)"
                    }}
                  >
                    {result.reply || "后端接口返回 200，但模型推理内容为空。可能由于 API 设置或参数不匹配导致。"}
                  </pre>
                </div>

                <div className="snippet-block" style={{ marginTop: 16 }}>
                  <div className="snippet-label" style={{ marginBottom: 8, fontSize: "11px", opacity: 0.4 }}>Token Usage</div>
                  <pre
                    style={{
                      backgroundColor: "transparent",
                      padding: 12,
                      borderRadius: 6,
                      fontSize: "12px",
                      opacity: 0.8,
                      border: "1px dashed var(--line)"
                    }}
                  >
                    {usageText}
                  </pre>
                </div>
              </div>
            ) : !errorText ? (
              <div className="console-empty-state" style={{ marginTop: 40, padding: "60px 0" }}>
                <span>暂无待处理回执。成功向后端发起请求后，这里将展示完整的 AI 响应正文与推理开销细节。</span>
              </div>
            ) : null}
          </SurfaceCard>
        </div>
      )}
    </section>
  );
}
