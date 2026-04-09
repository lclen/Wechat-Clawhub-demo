import { SnippetBlock } from "../Connection/ConnectionUi";
import type { SetupMode, SetupRole, SetupTaskResult } from "../../../types";

type QuickSetupExecutionStageProps = {
  setupMode: Extract<SetupMode, "preview" | "result">;
  setupRole: SetupRole;
  setupTask: SetupTaskResult | null;
  installProgressSummary: string;
  busyKey: string | null;
  previewContent: (role: SetupRole) => string;
  previewOutcome: (role: SetupRole) => string;
  onSubmit: () => void;
  onBackToConfig: () => void;
  onRefreshProfile: () => void;
  onGoToConnection: () => void;
};

export function QuickSetupExecutionStage({
  setupMode,
  setupRole,
  setupTask,
  installProgressSummary,
  busyKey,
  previewContent,
  previewOutcome,
  onSubmit,
  onBackToConfig,
  onRefreshProfile,
  onGoToConnection,
}: QuickSetupExecutionStageProps) {
  const executing = busyKey === "setup-gateway" || busyKey === "setup-gateway-console" || busyKey === "setup-worker" || busyKey === "setup-console";

  return (
    <>
      {setupMode === "preview" ? (
        <div className="snippet-stack">
          <SnippetBlock label="将执行的动作" content={previewContent(setupRole)} />
          <SnippetBlock label="预期产物" content={previewOutcome(setupRole)} />
        </div>
      ) : (
        <div className="snippet-stack">
          <SnippetBlock label="执行摘要" content={setupTask?.summary || "任务尚未启动。"} />
          {setupTask?.kind === "node_install" ? <SnippetBlock label="安装进度" content={installProgressSummary} /> : null}
          <SnippetBlock label="最新日志" content={setupTask?.logs?.length ? setupTask.logs.join("\n") : "等待日志输出…"} />
        </div>
      )}
      <div className="inline-actions quick-setup-actions">
        {setupMode === "preview" ? <button type="button" onClick={onSubmit} disabled={busyKey !== null}>{executing ? "执行中..." : "开始执行"}</button> : null}
        <button type="button" className="ghost-button" onClick={onBackToConfig}>返回修改参数</button>
        {setupMode === "result" ? <button type="button" className="ghost-button" onClick={onRefreshProfile}>刷新配置状态</button> : null}
        {setupMode === "result" ? <button type="button" className="ghost-button" onClick={onGoToConnection}>去接入中心</button> : null}
      </div>
    </>
  );
}
