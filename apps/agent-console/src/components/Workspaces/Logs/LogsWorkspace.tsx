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
        <div className="workspace-caption">
          {currentRoleIsWorker ? "这里不再混入安装配置表单，只保留当前机器节点的关键日志。" : "接入中心负责配置与状态，日志中心负责集中排障与运行追踪。"}
        </div>
      </div>

      <CommandBar
        label="日志视角"
        detail={currentRoleIsWorker ? "优先看回连、节点服务和配对过程。" : "优先看主机组件、本机节点和纳管过程的串联日志。"}
      >
        <button type="button" className="ghost-button" onClick={onRefreshRuntimeLogs}>
          刷新运行日志
        </button>
      </CommandBar>

      <div className="logs-workspace-stack">
        {currentRoleIsWorker ? <SnippetBlock label="节点连接日志" content={workerConnectionLog} /> : null}
        <RuntimeLogsPanel
          title={currentRoleIsWorker ? "节点本地运行与回连日志" : "主机组件与本机节点日志"}
          subtitle={currentRoleIsWorker ? "展示当前机器节点的服务、回连与诊断日志。" : "这里集中查看 launcher、主网关和本机内置节点的运行日志。"}
          helperText="日志中心可见时每 4 秒自动刷新"
          entries={runtimeLogEntries}
          onRefresh={onRefreshRuntimeLogs}
          refreshing={runtimeLogsRefreshing}
        />
        <DiagnosticsConsole
          title={currentRoleIsWorker ? "节点配对与回连日志" : "配对与纳管日志中心"}
          subtitle={currentRoleIsWorker ? "记录当前节点与网关的配对、检测和回连结果。" : "集中展示扫描、手动配对和节点纳管的调试输出。"}
          emptyText={currentRoleIsWorker ? "当前还没有节点配对日志；执行网关探测或等待回连后会显示在这里。" : "当前还没有网关配对日志；开始扫描或连接节点后会在这里出现。"}
          entries={pairingDebugViewEntries}
          onClear={onClearPairingDebugEntries}
        />
      </div>
    </section>
  );
}
