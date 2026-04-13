import { SnippetBlock } from "../Connection/ConnectionUi";
import { DiagnosticsConsole, type DiagnosticsConsoleEntry } from "../Connection/DiagnosticsConsole";
import { RuntimeLogsPanel, type RuntimeLogEntry } from "../Connection/RuntimeLogsPanel";
import { CommandBar } from "../../shared/ConsolePrimitives";

type LogsWorkspaceProps = {
  currentRoleIsWorker: boolean;
  workerConnectionLog: string;
  runtimeLogEntries: RuntimeLogEntry[];
  runtimeLogsRefreshing: boolean;
  pairingDebugViewEntries: DiagnosticsConsoleEntry[];
  onRefreshRuntimeLogs: () => void;
  onClearPairingDebugEntries: () => void;
};

export function LogsWorkspace({
  currentRoleIsWorker,
  workerConnectionLog,
  runtimeLogEntries,
  runtimeLogsRefreshing,
  pairingDebugViewEntries,
  onRefreshRuntimeLogs,
  onClearPairingDebugEntries,
}: LogsWorkspaceProps) {
  return (
    <section className="workspace-frame connection-workspace">
      <div className="workspace-heading">
        <div>
          <div className="section-kicker">日志中心</div>
          <h2>{currentRoleIsWorker ? "集中查看节点回连、配对与本地运行日志" : "集中查看主机组件、本机节点与配对日志"}</h2>
        </div>
        <div className="workspace-caption">{currentRoleIsWorker ? "只看当前节点日志。" : "集中看运行与配对日志。"}</div>
      </div>

      <CommandBar
        label="日志视角"
        detail={currentRoleIsWorker ? "优先看回连与配对。" : "优先看运行与纳管链路。"}
      >
        <button type="button" className="ghost-button" onClick={onRefreshRuntimeLogs}>
          刷新运行日志
        </button>
      </CommandBar>

      <div className="logs-workspace-stack">
        {currentRoleIsWorker ? <SnippetBlock label="节点连接日志" content={workerConnectionLog} /> : null}
        <RuntimeLogsPanel
          title={currentRoleIsWorker ? "节点本地运行与回连日志" : "主机组件与本机节点日志"}
          subtitle={currentRoleIsWorker ? "服务、回连、诊断。" : "launcher、网关、本机节点。"}
          helperText="可见时每 4 秒自动刷新"
          entries={runtimeLogEntries}
          onRefresh={onRefreshRuntimeLogs}
          refreshing={runtimeLogsRefreshing}
        />
        <DiagnosticsConsole
          title={currentRoleIsWorker ? "节点配对与回连日志" : "配对与纳管日志中心"}
          subtitle={currentRoleIsWorker ? "配对、探测、回连结果。" : "扫描、配对、纳管输出。"}
          emptyText={currentRoleIsWorker ? "当前还没有节点配对日志；执行网关探测或等待回连后会显示在这里。" : "当前还没有网关配对日志；开始扫描或连接节点后会在这里出现。"}
          entries={pairingDebugViewEntries}
          onClear={onClearPairingDebugEntries}
        />
      </div>
    </section>
  );
}
