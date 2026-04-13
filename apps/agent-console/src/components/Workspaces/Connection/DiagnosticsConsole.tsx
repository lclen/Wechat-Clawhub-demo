import {
  SectionHeader,
  SignalBadge,
  SurfaceCard,
} from "../../shared/ConsolePrimitives";

export type DiagnosticsConsoleEntry = {
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

export function DiagnosticsConsole({
  title,
  subtitle,
  emptyText,
  entries,
  onClear,
}: DiagnosticsConsoleProps) {
  return (
    <SurfaceCard className="connection-ops-console" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "20px 24px" }}>
        <SectionHeader
          kicker="运维调试"
          title={title}
          description={subtitle}
          actions={
            <div className="inline-actions">
              <span style={{ fontSize: "11px", opacity: 0.5, marginRight: 12 }}>保留最近记录</span>
              <button
                type="button"
                className="ghost-button"
                onClick={onClear}
                disabled={!entries.length}
              >
                清空列表
              </button>
            </div>
          }
        />
      </div>

      {!entries.length ? (
        <div className="console-empty-state" style={{ padding: "40px 24px", borderTop: "1px solid var(--line)" }}>
          <span>{emptyText}</span>
        </div>
      ) : (
        <div className="pairing-debug-list" style={{ borderTop: "1px solid var(--line)" }}>
          {entries.map((entry, index) => (
            <details
              key={entry.id}
              className="pairing-debug-card-collapsible"
              open={index === 0}
              style={{ borderBottom: index === entries.length - 1 ? "none" : "1px solid var(--line)" }}
            >
              <summary
                style={{
                  padding: "16px 24px",
                  cursor: "pointer",
                  backgroundColor: "rgba(0,0,0,0.02)",
                  listStyle: "none"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "14px" }}>{entry.title}</div>
                    <div style={{ fontSize: "12px", opacity: 0.5, marginTop: 2 }}>
                      {entry.target} · {entry.updatedAtLabel}
                    </div>
                  </div>
                  <SignalBadge
                    tone={
                      entry.statusTone === "human"
                        ? "info"
                        : entry.statusTone === "typing"
                        ? "good"
                        : entry.statusTone === "queued"
                        ? "neutral"
                        : "neutral"
                    }
                  >
                    {entry.statusLabel}
                  </SignalBadge>
                </div>
                <div style={{ fontSize: "13px", marginTop: 8, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {entry.summary || "等待更多日志..."}
                </div>
              </summary>
              <div style={{ padding: "0 24px 20px 24px" }}>
                <pre
                  style={{
                    backgroundColor: "rgba(0,0,0,0.2)",
                    padding: "12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                    overflowX: "auto",
                    border: "1px solid var(--line)",
                    margin: 0,
                    marginTop: 12
                  }}
                >
                  {entry.logText || "暂无回执详情"}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
