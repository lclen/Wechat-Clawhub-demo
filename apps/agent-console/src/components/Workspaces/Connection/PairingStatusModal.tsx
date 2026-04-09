type PairingStatusModalProps = {
  open: boolean;
  statusText: string;
  showSpinner: boolean;
  showActions: boolean;
  onClose: () => void;
};

export function PairingStatusModal({
  open,
  statusText,
  showSpinner,
  showActions,
  onClose,
}: PairingStatusModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="pairing-modal-overlay"
      onClick={() => {
        if (showActions) onClose();
      }}
    >
      <div className="pairing-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="pairing-modal-title">节点配对</div>
        <div className="pairing-modal-status">{statusText}</div>
        {showSpinner ? <div className="pairing-modal-spinner" aria-label="配对中" /> : null}
        {showActions ? (
          <div className="pairing-modal-actions">
            <button type="button" onClick={onClose}>重试</button>
            <button type="button" className="ghost-button" onClick={onClose}>关闭</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
