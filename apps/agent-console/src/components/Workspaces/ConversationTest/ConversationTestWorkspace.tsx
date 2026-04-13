import { useMemo, useState } from "react";
import { CommandBar, EmptyState, MetricStrip, SectionHeader, SignalBadge, SurfaceCard } from "../../shared/ConsolePrimitives";
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
  const activeProvider = formatModelProviderLabel(localNodeStatus?.active_model_provider) || "未读取";
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
          <h2>{title}</h2>
        </div>
        {description ? <div className="workspace-caption">{description}</div> : null}
      </div>

      {!launcherAvailable ? (
        <SurfaceCard>
          <EmptyState title="当前前端没有连接到本地 launcher" detail="暂时无法发起本机节点对话测试。" />
        </SurfaceCard>
      ) : !localNodeStatus ? (
        <SurfaceCard>
          <SectionHeader
            kicker="节点状态"
            title="先读取本机节点运行态"
            actions={<button type="button" className="ghost-button" onClick={onRefreshLocalNodeDiagnostics}>刷新节点状态</button>}
          />
          <EmptyState title="还没有读到本机节点状态" detail="请先刷新一次，确认 launcher 已经拿到当前节点配置。" />
        </SurfaceCard>
      ) : (
        <div className="conversation-test-layout">
          <SurfaceCard className="conversation-command-shell" tone="accent">
            <SectionHeader
              kicker="测试链路"
              title={heroTitle}
              actions={
                <div className="inline-actions">
                  <button type="button" className="ghost-button" onClick={onRefreshLocalNodeDiagnostics} disabled={busyKey !== null}>
                    刷新节点状态
                  </button>
                  <button type="button" onClick={handleRunTest} disabled={busyKey !== null || !canRun}>
                    {busyKey === "local-node-conversation-test" ? "测试中..." : "发送测试消息"}
                  </button>
                </div>
              }
            />

            <MetricStrip
              className="conversation-test-metrics"
              items={[
                { label: "已保存 Provider", value: configuredProvider },
                { label: "当前生效 Provider", value: activeProvider },
                { label: "推理状态", value: localNodeStatus.inference_ready ? "已就绪" : "未就绪" },
                { label: "配置文件", value: localNodeStatus.config_path || "未读取" },
              ]}
            />

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
                { value: "openai", label: "DashScope" },
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

            <CommandBar
              label="当前测试链路"
              detail="先测连通，再测业务提示词。"
              className="conversation-test-command-bar"
            >
              <SignalBadge tone="info">{provider === "current" ? "当前配置" : provider === "openai" ? "DashScope" : "Dify"}</SignalBadge>
            </CommandBar>

            <label className="conversation-test-editor">
              <span>测试消息</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="输入一条你想让 AI 回答的测试消息"
              />
            </label>

            <div className="inline-tip">
              建议先发短句。
            </div>
          </SurfaceCard>

          <SurfaceCard className="conversation-result-shell" tone="strong">
            <SectionHeader
              kicker="回执面板"
              title="本次对话回执"
            />

            {errorText ? (
              <div className="conversation-test-error">
                <strong>测试失败</strong>
                <div>{errorText}</div>
              </div>
            ) : null}

            {result ? (
              <div className="conversation-test-result">
                <MetricStrip
                  className="conversation-result-metrics"
                  items={[
                    { label: "实际走的链路", value: formatModelProviderLabel(result.provider) || result.provider },
                    { label: "保存的 Provider", value: formatModelProviderLabel(result.configured_provider) || "未读取" },
                    { label: "耗时", value: `${result.latency_ms} ms` },
                    { label: "结果", value: result.ok ? "已收到回复" : "失败" },
                  ]}
                />

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
              <EmptyState title="还没有执行测试" detail="发送一条消息后，这里会显示实际走的 provider、耗时和 AI 回复正文。" />
            ) : null}
          </SurfaceCard>
        </div>
      )}
    </section>
  );
}
