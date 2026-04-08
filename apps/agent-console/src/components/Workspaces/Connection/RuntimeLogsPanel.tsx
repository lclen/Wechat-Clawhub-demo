export type RuntimeLogEntry = {
  id: string;
  title: string;
  detail?: string;
  content: string;
  tone?: "human" | "typing" | "queued";
};

type RuntimeLogsPanelProps = {
  title: string;
  subtitle: string;
  helperText?: string;
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
    <details className="surface connection-ops-console" open>
      <summary className="connection-ops-summary">
        <div>
          <div className="section-kicker">运行日志</div>
          <h3>{title}</h3>
          <div className="workspace-caption">{subtitle}</div>
        </div>
        <div className="inline-actions">
          {helperText ? <span className="small-note">{helperText}</span> : null}
          <button type="button" className="ghost-button" onClick={(event) => { event.preventDefault(); onRefresh(); }}>
            {refreshing ? "刷新中..." : "刷新日志"}
          </button>
        </div>
      </summary>

      {!entries.length ? (
        <div className="empty-state">当前还没有可展示的运行日志。</div>
      ) : (
        <div className="pairing-debug-list">
          {entries.map((entry) => (
            <article key={entry.id} className="pairing-debug-card">
              <div className="pairing-debug-top">
                <div>
                  <div className="node-card-title">{entry.title}</div>
                  {entry.detail ? <div className="node-card-subtitle">{entry.detail}</div> : null}
                </div>
                <span className={`session-badge session-badge-${entry.tone || "typing"}`}>运行中</span>
              </div>
              <pre className="pairing-debug-log">{entry.content || "暂无详细日志"}</pre>
            </article>
          ))}
        </div>
      )}
    </details>
  );
}
