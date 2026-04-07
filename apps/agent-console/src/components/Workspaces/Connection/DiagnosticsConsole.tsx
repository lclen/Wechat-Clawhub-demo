type DiagnosticsConsoleEntry = {
  id: string;
  title: string;
  target: string;
  updatedAtLabel: string;
  statusLabel: string;
  statusTone: "human" | "typing" | "queued";
  summary: string;
  logText: string;
};

type DiagnosticsConsoleProps = {
  title: string;
  subtitle: string;
  emptyText: string;
  entries: DiagnosticsConsoleEntry[];
  onClear: () => void;
};

export function DiagnosticsConsole({ title, subtitle, emptyText, entries, onClear }: DiagnosticsConsoleProps) {
  return (
    <details className="surface connection-ops-console">
      <summary className="connection-ops-summary">
        <div>
          <div className="section-kicker">运维与配对日志</div>
          <h3>{title}</h3>
          <div className="workspace-caption">{subtitle}</div>
        </div>
        <div className="inline-actions">
          <span className="small-note">保留最近 12 条扫描/配对记录</span>
          <button
            type="button"
            className="ghost-button"
            onClick={(event) => {
              event.preventDefault();
              onClear();
            }}
            disabled={!entries.length}
          >
            清空日志
          </button>
        </div>
      </summary>

      {!entries.length ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        <div className="pairing-debug-list">
          {entries.map((entry) => (
            <article key={entry.id} className="pairing-debug-card">
              <div className="pairing-debug-top">
                <div>
                  <div className="node-card-title">{entry.title}</div>
                  <div className="node-card-subtitle">
                    {entry.target} · {entry.updatedAtLabel}
                  </div>
                </div>
                <span className={`session-badge session-badge-${entry.statusTone}`}>{entry.statusLabel}</span>
              </div>
              <div className="pairing-debug-summary">{entry.summary || "等待更多日志..."}</div>
              <pre className="pairing-debug-log">{entry.logText || "暂无详细日志"}</pre>
            </article>
          ))}
        </div>
      )}
    </details>
  );
}
