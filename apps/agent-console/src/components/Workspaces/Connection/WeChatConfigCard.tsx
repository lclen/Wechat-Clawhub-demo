import { ToggleSecretInput } from "./ConnectionUi";
import {
  CommandBar,
  SectionHeader,
  SurfaceCard,
  SignalBadge,
} from "../../shared/ConsolePrimitives";

type WeChatConfigCardProps = {
  statusRows: Array<{ label: string; value: string; multiline?: boolean }>;
  qrImageSrc: string | null;
  pollStatus: string;
  wechatBaseUrl: string;
  manualToken: string;
  busyKey: string | null;
  onWechatBaseUrlChange: (value: string) => void;
  onManualTokenChange: (value: string) => void;
  onStartQrFlow: () => void;
  onPollQrStatus: () => void;
  onConnectManualToken: () => void;
  onDisconnectWeChat: () => void;
};

export function WeChatConfigCard({
  statusRows,
  qrImageSrc,
  pollStatus,
  wechatBaseUrl,
  manualToken,
  busyKey,
  onWechatBaseUrlChange,
  onManualTokenChange,
  onStartQrFlow,
  onPollQrStatus,
  onConnectManualToken,
  onDisconnectWeChat,
}: WeChatConfigCardProps) {
  return (
    <SurfaceCard className="wechat-command-surface" tone="strong">
      <SectionHeader
        kicker="核心平台"
        title="微信交互链路"
        description="支持通过原生微信扫码进行身份同步。首次接入建议使用扫码模式，联调阶段可切换为手动 Token 模式。"
        actions={
          <div className="inline-actions">
            <button
              type="button"
              onClick={onStartQrFlow}
              disabled={busyKey !== null}
            >
              {busyKey === "wechat-qr" ? "生成中..." : "生成二维码"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={onPollQrStatus}
              disabled={busyKey !== null}
            >
              {busyKey === "wechat-poll" ? "同步状态..." : "刷新状态"}
            </button>
          </div>
        }
      />

      <div className="connection-wechat-layout" style={{ marginTop: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
          {/* 左侧：状态统计 */}
          <div className="connection-fact-grid" style={{ height: "fit-content" }}>
            {statusRows.map((row) => (
              <div key={row.label} className="connection-fact-tile">
                <span>{row.label}</span>
                <strong className={row.multiline ? "multiline" : ""}>{row.value}</strong>
              </div>
            ))}
          </div>

          {/* 右侧：二维码展示区 */}
          <div
            className="qr-stage"
            style={{
              backgroundColor: "rgba(0,0,0,0.1)",
              borderRadius: 12,
              padding: 24,
              border: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center"
            }}
          >
            <div
              className="qr-frame"
              style={{
                width: 160,
                height: 160,
                backgroundColor: "var(--panel)",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                border: "1px solid var(--line)"
              }}
            >
              {qrImageSrc ? (
                <img
                  className="qr-image"
                  src={qrImageSrc}
                  alt="WeChat QR code"
                  style={{ width: "90%", height: "90%", imageRendering: "pixelated" }}
                />
              ) : (
                <div
                  className="qr-placeholder"
                  style={{ padding: 20, textAlign: "center", fontSize: "11px", opacity: 0.4 }}
                >
                  等待生成...
                </div>
              )}
            </div>
            <div className="qr-meta" style={{ marginTop: 16, textAlign: "center" }}>
              <div
                className="qr-status-line"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <span style={{ fontSize: "13px", opacity: 0.6 }}>扫码态</span>
                <SignalBadge tone={qrImageSrc ? "info" : "neutral"}>{pollStatus}</SignalBadge>
              </div>
            </div>
          </div>
        </div>

        <CommandBar
          label="接入策略"
          detail="扫码成功后 Token 将自动同步，无需手动操作。"
          style={{ marginTop: 24, marginBottom: 16 }}
        />

        {/* 手动调试模式 */}
        <details className="form-advanced-details connection-fold-card">
          <summary>
            <div className="console-section-copy">
              <span className="section-kicker">调试模式</span>
              <h3>手动直连</h3>
              <p className="console-section-description">用于本地联调或规避扫码风控。</p>
            </div>
          </summary>
          <div className="connection-form-grid" style={{ marginTop: 20 }}>
            <label>
              <span>WeChat Base URL</span>
              <input
                value={wechatBaseUrl}
                onChange={(event) => onWechatBaseUrlChange(event.target.value)}
                placeholder="https://ilinkai.weixin.qq.com"
              />
            </label>
            <label className="connection-full-span">
              <span>手动 Token</span>
              <ToggleSecretInput
                value={manualToken}
                onChange={(event) => onManualTokenChange(event.target.value)}
                placeholder="在此输入 ilink 提供的 Token"
              />
            </label>
          </div>
          <div className="inline-actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={onConnectManualToken}
              disabled={busyKey !== null}
            >
              {busyKey === "wechat-connect" ? "正在握手..." : "尝试手动连接"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={onDisconnectWeChat}
              disabled={busyKey !== null}
            >
              断开当前链路
            </button>
          </div>
        </details>
      </div>
    </SurfaceCard>
  );
}
