type RuntimeLogEntry = {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: "human" | "typing" | "queued";
  summary: string;
  logText: string;
};

type RuntimeLogsPanelProps = {
  title: string;
  subtitle: string;
  helperText: string;
  entries: RuntimeLogEntry[];
  onRefresh: () => void;
  refreshing: boolean;
};

export function RuntimeLogsPanel({
  title,
  subtitle,
  helperText,
  entries,
  onRefresh,
  refreshing,
}: RuntimeLogsPanelProps) {
  return (
    <section className="surface connection-runtime-console">
      <div className="section-head">
        <div>
          <div className="section-kicker">实时运行日志</div>
          <h3>{title}</h3>
          <div className="workspace-caption">{subtitle}</div>
        </div>
        <div className="inline-actions">
          <span className="small-note">{helperText}</span>
          <button type="button" className="ghost-button" onClick={onRefresh}>
            {refreshing ? "刷新中..." : "立即刷新"}
          </button>
        </div>
      </div>

      {!entries.length ? (
        <div className="empty-state">当前还没有可展示的运行日志；启动相关组件后会自动在这里刷新。</div>
      ) : (
        <div className="pairing-debug-list">
          {entries.map((entry, index) => (
            <details key={entry.id} className="pairing-debug-card pairing-debug-card-collapsible" open={index === 0}>
              <summary className="pairing-debug-summary-row">
                <div className="pairing-debug-top">
                  <div>
                    <div className="node-card-title">{entry.title}</div>
                    <div className="node-card-subtitle">{entry.subtitle}</div>
                  </div>
                  <span className={`session-badge session-badge-${entry.statusTone}`}>{entry.statusLabel}</span>
                </div>
                <div className="pairing-debug-summary">{entry.summary}</div>
              </summary>
              <pre className="pairing-debug-log">{entry.logText || "暂无日志内容"}</pre>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
