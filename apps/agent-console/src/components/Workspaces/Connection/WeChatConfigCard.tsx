import { ToggleSecretInput } from "./ConnectionUi";
import {
  CommandBar,
  MetricStrip,
  SectionHeader,
  SurfaceCard,
  SignalBadge,
  InfoList,
} from "../../shared/ConsolePrimitives";

const DEFAULT_PUBLIC_ENTRY_URL = "http://121.41.47.90:5014/entry";

type PublicEntryProfile = {
  enabled: boolean;
  baseUrl: string;
  displayName: string;
  contactHint: string;
  notes: string;
  greetingMessage: string;
  accessUrl: string;
  accessQrImageSrc: string | null;
  stats: {
    pendingQr: number;
    waitingConfirm: number;
    bound: number;
    expired: number;
    failed: number;
    activeBindings: number;
  };
};

type WeChatConfigCardProps = {
  showLoginSection: boolean;
  showPublicEntrySection: boolean;
  canManagePublicEntry: boolean;
  statusRows: Array<{ label: string; value: string; multiline?: boolean }>;
  qrImageSrc: string | null;
  pollStatus: string;
  wechatBaseUrl: string;
  manualToken: string;
  publicEntryProfile: PublicEntryProfile;
  busyKey: string | null;
  onWechatBaseUrlChange: (value: string) => void;
  onManualTokenChange: (value: string) => void;
  onUpdatePublicEntryProfile: (
    key:
      | "public_entry_enabled"
      | "public_entry_base_url"
      | "public_entry_display_name"
      | "public_entry_contact_hint"
      | "public_entry_notes"
      | "public_entry_greeting_message",
    value: boolean | string,
  ) => void;
  onSavePublicEntryProfile: () => void;
  onCopyPublicEntryUrl: () => void;
  onStartQrFlow: () => void;
  onPollQrStatus: () => void;
  onConnectManualToken: () => void;
  onDisconnectWeChat: () => void;
};

export function WeChatConfigCard({
  showLoginSection,
  showPublicEntrySection,
  canManagePublicEntry,
  statusRows,
  qrImageSrc,
  pollStatus,
  wechatBaseUrl,
  manualToken,
  publicEntryProfile,
  busyKey,
  onWechatBaseUrlChange,
  onManualTokenChange,
  onUpdatePublicEntryProfile,
  onSavePublicEntryProfile,
  onCopyPublicEntryUrl,
  onStartQrFlow,
  onPollQrStatus,
  onConnectManualToken,
  onDisconnectWeChat,
}: WeChatConfigCardProps) {
  const publicEntryUrl = publicEntryProfile.accessUrl || DEFAULT_PUBLIC_ENTRY_URL;

  return (
    <SurfaceCard className="wechat-command-surface" tone="strong">
      <SectionHeader
        kicker="固定入口"
        title="微信入口配置"
        description="把入口账号登录链路和给外部用户的固定入口资料拆开管理，避免把扫码登录二维码误当成公共用户入口。"
      />

      <div className="wechat-sections">
        {showLoginSection ? (
          <section className="wechat-split-section">
            <SectionHeader
              kicker="入口账号登录"
              title="绑定入口账号"
              description="这里只负责把当前网关绑定到固定微信入口账号。对外用户入口资料在下方单独维护。"
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

            <div className="wechat-login-grid">
              <div className="connection-fact-grid connection-fact-grid-wide">
                {statusRows.map((row) => (
                  <div key={row.label} className="connection-fact-tile">
                    <span>{row.label}</span>
                    <strong className={row.multiline ? "multiline" : ""}>{row.value}</strong>
                  </div>
                ))}
              </div>

              <div className="qr-stage">
                <div className="qr-frame">
                  {qrImageSrc ? (
                    <img
                      className="qr-image"
                      src={qrImageSrc}
                      alt="WeChat QR code"
                      style={{ width: "90%", height: "90%", imageRendering: "pixelated" }}
                    />
                  ) : (
                    <div className="qr-placeholder">
                      等待生成绑定二维码...
                    </div>
                  )}
                </div>
                <div className="qr-meta">
                  <div className="qr-status-line">
                    <span>扫码态</span>
                    <SignalBadge tone={qrImageSrc ? "info" : "neutral"}>{pollStatus}</SignalBadge>
                  </div>
                  <p>这里的二维码只用于当前入口账号登录，不直接给外部用户使用。</p>
                </div>
              </div>
            </div>

            <CommandBar
              label="登录链路"
              detail="扫码成功后 Token 会自动同步；联调或补录时也可以走手动 Token 直连。"
              style={{ marginTop: 18, marginBottom: 12 }}
            />

            <details className="form-advanced-details connection-fold-card">
              <summary>
                <div className="console-section-copy">
                  <span className="section-kicker">调试模式</span>
                  <h3>手动直连</h3>
                  <p className="console-section-description">用于本地联调或规避扫码链路异常。</p>
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
          </section>
        ) : null}

        {showPublicEntrySection ? (
          <section className="wechat-split-section">
            <SectionHeader
              className="public-entry-section-header"
              kicker="公共入口资料"
              title="给外部用户的固定入口资料"
              description="这里维护的是系统托管的固定公共入口。外部用户点击公共入口按钮进入页面，再领取自己的专属 OpenClaw 配对二维码。"
              actions={
                <div className="inline-actions">
                  {publicEntryProfile.accessUrl ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={onCopyPublicEntryUrl}
                    >
                      复制入口链接
                    </button>
                  ) : null}
                  {canManagePublicEntry ? (
                    <button
                      type="button"
                      onClick={onSavePublicEntryProfile}
                      disabled={busyKey !== null}
                    >
                      {busyKey === "setup-gateway" ? "保存中..." : "保存公共入口资料"}
                    </button>
                  ) : null}
                </div>
              }
            />

            <div className="public-entry-shell">
              <div className="public-entry-form">
                <label className="public-entry-checkbox">
                  <input
                    type="checkbox"
                    checked={publicEntryProfile.enabled}
                    disabled={!canManagePublicEntry || busyKey !== null}
                    onChange={(event) => onUpdatePublicEntryProfile("public_entry_enabled", event.target.checked)}
                  />
                  <div>
                    <strong>启用公共入口资料</strong>
                    <span>启用后，网关会对外开放固定入口页，并为每位访问者创建一次性的专属配对二维码。</span>
                  </div>
                </label>

                <CommandBar
                  className="public-entry-share-bar"
                  label="固定分享入口"
                  detail="填写外部用户真正能访问到的公网基址，系统会自动在后面拼上 /entry。"
                >
                  <div className="public-entry-url-line">
                    <code>{publicEntryUrl}</code>
                  </div>
                </CommandBar>

                <MetricStrip
                  className="public-entry-metric-strip"
                  items={[
                    { label: "待扫码", value: String(publicEntryProfile.stats.pendingQr) },
                    { label: "待确认", value: String(publicEntryProfile.stats.waitingConfirm) },
                    { label: "已绑定", value: String(publicEntryProfile.stats.bound) },
                    { label: "活跃绑定", value: String(publicEntryProfile.stats.activeBindings) },
                  ]}
                />

                <div className="connection-form-grid">
                  <label className="connection-full-span">
                    <span>公网入口 URL</span>
                    <input
                      value={publicEntryProfile.baseUrl}
                      readOnly={!canManagePublicEntry}
                      onChange={(event) => onUpdatePublicEntryProfile("public_entry_base_url", event.target.value)}
                      placeholder="例如 http://121.41.47.90:5014"
                    />
                  </label>
                  <label>
                    <span>显示名称</span>
                    <input
                      value={publicEntryProfile.displayName}
                      readOnly={!canManagePublicEntry}
                      onChange={(event) => onUpdatePublicEntryProfile("public_entry_display_name", event.target.value)}
                      placeholder="例如 ClawBot 服务入口"
                    />
                  </label>
                  <label>
                    <span>联系提示</span>
                    <input
                      value={publicEntryProfile.contactHint}
                      readOnly={!canManagePublicEntry}
                      onChange={(event) => onUpdatePublicEntryProfile("public_entry_contact_hint", event.target.value)}
                      placeholder="例如 添加后发送问题即可开始对话"
                    />
                  </label>
                  <label className="connection-full-span">
                    <span>扫码后问候语</span>
                    <textarea
                      value={publicEntryProfile.greetingMessage}
                      readOnly={!canManagePublicEntry}
                      onChange={(event) => onUpdatePublicEntryProfile("public_entry_greeting_message", event.target.value)}
                      placeholder="你好，已成功连接到专属 Claw。你可以直接发送问题，我会在这里回复你。"
                    />
                  </label>
                  <label className="connection-full-span">
                    <span>备注</span>
                    <textarea
                      value={publicEntryProfile.notes}
                      readOnly={!canManagePublicEntry}
                      onChange={(event) => onUpdatePublicEntryProfile("public_entry_notes", event.target.value)}
                      placeholder="补充给控制台或外部说明使用，不会当成会话消息。"
                    />
                  </label>
                </div>
              </div>

              <aside className="public-entry-preview">
                <div className="public-entry-preview-frame">
                  <a
                    className="public-entry-open-button"
                    href={publicEntryUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开公共入口
                  </a>
                  <div className="public-entry-preview-empty">
                    进入 {publicEntryUrl} 后，外部用户再扫码连接自己的专属 Claw。
                  </div>
                </div>
                <div className="public-entry-preview-copy">
                  <div className="public-entry-preview-heading">
                    <strong>{publicEntryProfile.displayName || "未设置显示名称"}</strong>
                    <SignalBadge tone={publicEntryProfile.enabled ? "good" : "neutral"}>
                      {publicEntryProfile.enabled ? "已启用" : "未启用"}
                    </SignalBadge>
                  </div>
                  <p>{publicEntryProfile.contactHint || "尚未填写联系提示。"}</p>
                  <InfoList
                    items={[
                      { label: "公网基址", value: publicEntryProfile.baseUrl || "未设置" },
                      { label: "入口页", value: publicEntryProfile.accessUrl || "未生成" },
                      { label: "失败/过期", value: `${publicEntryProfile.stats.failed} / ${publicEntryProfile.stats.expired}` },
                    ]}
                  />
                  <div className="public-entry-preview-notes">
                    {publicEntryProfile.notes || "尚未填写备注。"}
                  </div>
                </div>
              </aside>
            </div>
          </section>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
