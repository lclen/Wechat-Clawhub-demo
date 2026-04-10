import { ToggleSecretInput } from "./ConnectionUi";
import { CommandBar, SectionHeader, SurfaceCard } from "../../shared/ConsolePrimitives";

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
    <SurfaceCard className="surface-feature wechat-command-surface">
      <SectionHeader
        kicker="基础平台配置"
        title="微信接入"
        description="扫码接入保持为主路径，手动 Token 模式收纳在折叠区里，只在联调和回归时展开。"
        actions={
          <div className="inline-actions">
            <button type="button" onClick={onStartQrFlow} disabled={busyKey !== null}>
              {busyKey === "wechat-qr" ? "生成中..." : "生成二维码"}
            </button>
            <button type="button" onClick={onPollQrStatus} disabled={busyKey !== null}>
              {busyKey === "wechat-poll" ? "轮询中..." : "轮询状态"}
            </button>
          </div>
        }
      />

      <CommandBar
        label="接入策略"
        detail="先扫码写入当前生效网关，再用手动 Token 做联调和回归验证。"
        className="wechat-command-bar"
      >
        <span className="small-note">运行中的微信链路会在状态卡和二维码区同步反馈。</span>
      </CommandBar>

      <div className="connection-wechat-layout">
        <div className="connection-fact-grid">
          {statusRows.map((row) => (
            <div key={row.label} className="connection-fact-tile">
              <span>{row.label}</span>
              <strong className={row.multiline ? "multiline" : ""}>{row.value}</strong>
            </div>
          ))}
        </div>

        <div className="qr-stage">
          <div className="qr-frame">
            {qrImageSrc ? <img className="qr-image" src={qrImageSrc} alt="WeChat QR code" /> : <div className="qr-placeholder">点击“生成二维码”后，这里会显示扫码图。</div>}
          </div>
          <div className="qr-meta">
            <div className="qr-status-line">
              <span>当前状态</span>
              <strong>{pollStatus}</strong>
            </div>
            <div className="small-note">扫码成功后会优先写入当前生效网关；手动 token 更适合联调和回归验证。</div>
          </div>
        </div>

        <details className="form-advanced-details connection-fold-card">
          <summary>
            <span className="section-kicker">手动模式</span>
            <span className="connection-fold-hint">需要时再展开 Token 直连</span>
          </summary>
          <div className="connection-form-grid">
            <label>
              <span>WeChat Base URL</span>
              <input value={wechatBaseUrl} onChange={(event) => onWechatBaseUrlChange(event.target.value)} placeholder="https://ilinkai.weixin.qq.com" />
            </label>
            <label className="connection-full-span">
              <span>手动 Token</span>
              <ToggleSecretInput value={manualToken} onChange={(event) => onManualTokenChange(event.target.value)} placeholder="也可以先扫码，扫码确认后会自动填入并接入。" />
            </label>
          </div>
          <div className="inline-actions">
            <button type="button" onClick={onConnectManualToken} disabled={busyKey !== null}>
              {busyKey === "wechat-connect" ? "连接中..." : "使用当前 Token 连接"}
            </button>
            <button type="button" className="ghost-button" onClick={onDisconnectWeChat} disabled={busyKey !== null}>
              断开连接
            </button>
          </div>
        </details>
      </div>
    </SurfaceCard>
  );
}
