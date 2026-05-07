import { SignalBadge } from "../../shared/ConsolePrimitives";
import type { ConnectivityCheckReport } from "../../../types";

type ConnectivityCheckModalProps = {
  open: boolean;
  report: ConnectivityCheckReport | null;
  onClose: () => void;
};

function badgeTone(status: "passed" | "failed" | "warning") {
  if (status === "passed") return "good" as const;
  if (status === "failed") return "warn" as const;
  return "info" as const;
}

function badgeLabel(status: "passed" | "failed" | "warning") {
  if (status === "passed") return "通过";
  if (status === "failed") return "失败";
  return "注意";
}

export function ConnectivityCheckModal({ open, report, onClose }: ConnectivityCheckModalProps) {
  if (!open || !report) {
    return null;
  }

  return (
    <div className="pairing-modal-overlay" onClick={onClose}>
      <div
        className="pairing-modal-card connectivity-check-modal-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connectivity-check-title"
      >
        <div className="connectivity-check-modal-header">
          <div>
            <div className="pairing-modal-title" id="connectivity-check-title">完整检测结果</div>
            <div className="pairing-modal-status">{report.summary}</div>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>关闭</button>
        </div>

        <div className="connectivity-check-modal-meta">
          <SignalBadge tone={report.failed_count === 0 ? "good" : "warn"}>
            {report.failed_count === 0 ? "链路可用" : `${report.failed_count} 项失败`}
          </SignalBadge>
          <span>{new Date(report.checked_at).toLocaleString()}</span>
        </div>

        <div className="connectivity-check-modal-list">
          {report.items.map((item) => (
            <article key={item.key} className="connectivity-check-modal-item">
              <div className="connectivity-check-modal-row">
                <strong>{item.label}</strong>
                <SignalBadge tone={badgeTone(item.status)}>{badgeLabel(item.status)}</SignalBadge>
              </div>
              <div className="connectivity-check-modal-summary">{item.summary}</div>
              <div className="connectivity-check-modal-detail">{item.detail}</div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
