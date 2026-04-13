import { SnippetBlock } from "../Connection/ConnectionUi";
import {
  DiagnosticsConsole,
  type DiagnosticsConsoleEntry,
} from "../Connection/DiagnosticsConsole";
import {
  RuntimeLogsPanel,
  type RuntimeLogEntry,
} from "../Connection/RuntimeLogsPanel";
import {
  CommandBar,
  SectionHeader,
} from "../../shared/ConsolePrimitives";

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
    <section className="workspace-frame logs-workspace">
      <div className="workspace-heading">
        <SectionHeader
          kicker="监控中心"
          title="日志服务"
          description={
            currentRoleIsWorker
              ? "集中查看节点回连、配对与本地运行日志。"
              : "集中查看主机组件、本机节点与配对日志流水。"
          }
        />
      </div>

      <CommandBar
        label="视图控制"
        detail={currentRoleIsWorker ? "当前：独立节点视图" : "当前：控制台全局视图"}
        className="logs-command-bar"
        style={{ marginBottom: 16 }}
      >
        <button
          type="button"
          className="ghost-button"
          onClick={onRefreshRuntimeLogs}
          disabled={runtimeLogsRefreshing}
        >
          {runtimeLogsRefreshing ? "正在同步..." : "刷新运行日志"}
        </button>
      </CommandBar>

      <div className="connection-panel-stack">
        {currentRoleIsWorker && workerConnectionLog ? (
          <SnippetBlock label="节点回连链路轨迹" content={workerConnectionLog} />
        ) : null}

        <RuntimeLogsPanel
          title={currentRoleIsWorker ? "节点本地运行日志" : "系统组件与本机节点日志"}
          subtitle={currentRoleIsWorker ? "Service & Connection Diagnostics" : "Launcher, Gateway & Local Node"}
          helperText="可见时自动刷新（每 4s）"
          entries={runtimeLogEntries}
          onRefresh={onRefreshRuntimeLogs}
          refreshing={runtimeLogsRefreshing}
        />

        <DiagnosticsConsole
          title={currentRoleIsWorker ? "节点配对连接轨迹" : "配对与纳管生命周期日志"}
          subtitle={currentRoleIsWorker ? "Pairing & Health Probings" : "Scanning & Onboarding Events"}
          emptyText={
            currentRoleIsWorker
              ? "等待节点进行网关探测或执行回连动作..."
              : "开始扫描或手动连接节点后，配对轨迹将在此显示。"
          }
          entries={pairingDebugViewEntries}
          onClear={onClearPairingDebugEntries}
        />
      </div>
    </section>
  );
}
