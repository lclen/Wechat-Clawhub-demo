import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { PublicEntryProfileResponse } from "../types";
import { safeTrim } from "../stringUtils";

type PublicEntryTicketStatus = "pending_qr" | "waiting_confirm" | "bound" | "expired" | "failed";

type PublicEntryTicketResponse = {
  ticket_id: string;
  client_id: string;
  status: PublicEntryTicketStatus;
  qrcode: string;
  qrcode_url: string;
  qrcode_image_src: string;
  expires_at: string;
  detail: string;
  bound_agent_id: string | null;
  external_account_id: string | null;
};

const CLIENT_STORAGE_KEY = "wch-public-entry-client-id";
const POLL_INTERVAL_MS = 2200;
const AUTO_RENEW_DELAY_MS = 900;
const EARLY_RENEW_WINDOW_MS = 90 * 1000;

function ensureClientId() {
  const existing = window.localStorage.getItem(CLIENT_STORAGE_KEY);
  if (existing) return existing;
  const generated =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `client-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  window.localStorage.setItem(CLIENT_STORAGE_KEY, generated);
  return generated;
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: `Request failed: ${response.status}` }));
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `Request failed: ${response.status}`;
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function resolveStatusText(status: PublicEntryTicketStatus) {
  if (status === "waiting_confirm") return "已进入接入，等待微信确认";
  if (status === "bound") return "绑定成功，可以开始聊天";
  if (status === "expired") return "二维码已过期";
  if (status === "failed") return "绑定失败";
  return "专属接入待开始";
}

function resolveStatusTone(status: PublicEntryTicketStatus) {
  if (status === "waiting_confirm") return "waiting";
  if (status === "bound") return "bound";
  if (status === "expired") return "expired";
  if (status === "failed") return "failed";
  return "";
}

function detectWechatMobile() {
  const ua = navigator.userAgent || "";
  return /MicroMessenger/i.test(ua) && /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function PublicEntryPage() {
  const [profile, setProfile] = useState<PublicEntryProfileResponse | null>(null);
  const [ticket, setTicket] = useState<PublicEntryTicketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrImageSrc, setQrImageSrc] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const expiresCheckRef = useRef<number | null>(null);
  const renewTimeoutRef = useRef<number | null>(null);
  const renewingRef = useRef(false);
  const currentExpiresAtRef = useRef<string>("");
  const startFlowRef = useRef<() => Promise<void>>(async () => undefined);
  const lifecycleTokenRef = useRef(0);
  const createTicketControllerRef = useRef<AbortController | null>(null);
  const loadTicketControllerRef = useRef<AbortController | null>(null);
  const clientId = useMemo(() => ensureClientId(), []);
  const isWechatMobile = useMemo(() => detectWechatMobile(), []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    if (expiresCheckRef.current !== null) {
      window.clearInterval(expiresCheckRef.current);
      expiresCheckRef.current = null;
    }
    if (renewTimeoutRef.current !== null) {
      window.clearTimeout(renewTimeoutRef.current);
      renewTimeoutRef.current = null;
    }
    loadTicketControllerRef.current?.abort();
    loadTicketControllerRef.current = null;
    createTicketControllerRef.current?.abort();
    createTicketControllerRef.current = null;
  }, []);

  const scheduleRenew = useCallback((reason: "expired" | "clock") => {
    if (renewingRef.current) return;
    renewingRef.current = true;
    stopPolling();
    setError(null);
    setLoading(true);
    setTicket((current) =>
      current
        ? {
            ...current,
            detail:
              reason === "expired"
                ? "当前专属二维码已过期，正在自动领取新的专属二维码..."
                : "当前专属二维码即将失效，正在后台刷新新的专属二维码...",
          }
        : current,
    );
  }, [stopPolling]);

  const loadTicket = useCallback(async (ticketId: string) => {
    loadTicketControllerRef.current = new AbortController();
    const next = await requestJson<PublicEntryTicketResponse>(`/api/public-entry/tickets/${encodeURIComponent(ticketId)}`, {
      signal: loadTicketControllerRef.current.signal,
    });
    loadTicketControllerRef.current = null;
    setTicket(next);
    if (next.status === "bound" || next.status === "expired" || next.status === "failed") {
      stopPolling();
    }
    return next;
  }, [stopPolling]);

  const schedulePoll = useCallback(
    (ticketId: string, delayMs = 2200) => {
      if (renewingRef.current || intervalRef.current !== null) {
        return;
      }
      const token = lifecycleTokenRef.current;
      intervalRef.current = window.setTimeout(() => {
        intervalRef.current = null;
        void loadTicket(ticketId)
          .then((next) => {
            if (token !== lifecycleTokenRef.current) {
              return;
            }
            if (next.status === "bound" || next.status === "failed") {
              renewingRef.current = false;
              return;
            }
            if (next.status === "expired") {
              scheduleRenew("expired");
              renewTimeoutRef.current = window.setTimeout(() => {
                void startFlowRef.current();
              }, AUTO_RENEW_DELAY_MS);
              return;
            }
            const expiresAt = Date.parse(next.expires_at);
            if (Number.isFinite(expiresAt) && expiresAt - Date.now() <= EARLY_RENEW_WINDOW_MS) {
              scheduleRenew("clock");
              renewTimeoutRef.current = window.setTimeout(() => {
                void startFlowRef.current();
              }, AUTO_RENEW_DELAY_MS);
              return;
            }
            schedulePoll(ticketId);
          })
          .catch((loadError) => {
            if ((loadError as Error).name === "AbortError") {
              return;
            }
            stopPolling();
            renewingRef.current = false;
            setError((loadError as Error).message);
          });
      }, delayMs);
    },
    [loadTicket, scheduleRenew, stopPolling],
  );

  const startFlow = useCallback(async (forceNew = false) => {
    stopPolling();
    lifecycleTokenRef.current += 1;
    setLoading(true);
    setError(null);
    try {
      const nextProfile = await requestJson<PublicEntryProfileResponse>("/api/setup/public-entry");
      setProfile(nextProfile);
      if (!nextProfile.enabled) {
        setTicket(null);
        setLoading(false);
        return;
      }
      const token = lifecycleTokenRef.current;
      createTicketControllerRef.current = new AbortController();
      const created = await requestJson<PublicEntryTicketResponse>("/api/public-entry/tickets", {
        method: "POST",
        body: JSON.stringify({ client_id: clientId, force_new: forceNew }),
        signal: createTicketControllerRef.current.signal,
      });
      createTicketControllerRef.current = null;
      if (token !== lifecycleTokenRef.current) {
        return;
      }
      renewingRef.current = false;
      currentExpiresAtRef.current = created.expires_at;
      setTicket(created);
      schedulePoll(created.ticket_id, forceNew ? 0 : POLL_INTERVAL_MS);
      expiresCheckRef.current = window.setInterval(() => {
        const expiresAt = Date.parse(currentExpiresAtRef.current);
        if (Number.isFinite(expiresAt) && expiresAt - Date.now() <= EARLY_RENEW_WINDOW_MS) {
          scheduleRenew(Date.now() >= expiresAt ? "expired" : "clock");
          renewTimeoutRef.current = window.setTimeout(() => {
            void startFlowRef.current();
          }, AUTO_RENEW_DELAY_MS);
        }
      }, 1000);
    } catch (requestError) {
      if ((requestError as Error).name === "AbortError") {
        return;
      }
      renewingRef.current = false;
      setError((requestError as Error).message);
      setTicket(null);
    } finally {
      setLoading(false);
    }
  }, [clientId, schedulePoll, scheduleRenew, stopPolling]);

  useEffect(() => {
    void startFlow();
    return () => stopPolling();
  }, [startFlow, stopPolling]);

  useEffect(() => {
    startFlowRef.current = startFlow;
  }, [startFlow]);

  useEffect(() => {
    currentExpiresAtRef.current = ticket?.expires_at ?? "";
    if (!ticket) return;
    if (ticket.status === "expired") {
      scheduleRenew("expired");
      renewTimeoutRef.current = window.setTimeout(() => {
        void startFlowRef.current();
      }, AUTO_RENEW_DELAY_MS);
      return;
    }
    if (ticket.status === "bound" || ticket.status === "failed") {
      renewingRef.current = false;
    }
  }, [scheduleRenew, startFlow, ticket]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const imageSrc = safeTrim(ticket?.qrcode_image_src);
      if (imageSrc) {
        setQrImageSrc(imageSrc);
        return;
      }
      const rawQrUrl = safeTrim(ticket?.qrcode_url);
      if (!rawQrUrl) {
        setQrImageSrc(null);
        return;
      }
      if (rawQrUrl.startsWith("data:image/")) {
        setQrImageSrc(rawQrUrl);
        return;
      }
      if (!rawQrUrl.startsWith("http")) {
        setQrImageSrc(`data:image/png;base64,${rawQrUrl}`);
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(rawQrUrl, {
          margin: 1,
          width: 360,
          color: { dark: "#10233a", light: "#f8fbff" },
        });
        if (!cancelled) setQrImageSrc(dataUrl);
      } catch {
        if (!cancelled) setQrImageSrc(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ticket?.qrcode_image_src, ticket?.qrcode_url]);

  useEffect(() => {
    if (!loading && renewingRef.current && ticket && ticket.status !== "expired") {
      renewingRef.current = false;
    }
  }, [loading, ticket]);

  const status = ticket?.status ?? "pending_qr";
  const enabled = profile?.enabled ?? false;
  const joinUrl = safeTrim(ticket?.qrcode_url);
  const shouldShowJoinCard = joinUrl.startsWith("http");
  const joinLabel = profile?.display_name || "ClawBot 专属入口";

  return (
    <div className="public-entry-page">
      <main className="public-entry-shell">
        <section className="public-entry-story surface-card surface-card-strong">
          <div className="public-entry-overline">Public Entry</div>
          <h1>{profile?.display_name || "ClawBot 统一入口"}</h1>
          <p className="public-entry-story-copy">
            {profile?.notes || "首次接入会自动为你生成专属 OpenClaw 配对二维码，完成确认后即可用微信与系统持续对话。"}
          </p>

          <div className="public-entry-story-grid">
            <article className="public-entry-story-card">
              <span>接入方式</span>
              <strong>{"公共页 -> 专属二维码 -> 微信确认"}</strong>
              <p>每次进入都会为当前访问者创建或恢复自己的 ticket，避免多人共用同一张专属二维码。</p>
            </article>
            <article className="public-entry-story-card">
              <span>会话身份</span>
              <strong>复用稳定的 Logical Agent</strong>
              <p>同一微信号再次走公共入口时，会默认复用之前绑定的逻辑 Agent，不会把历史身份冲散。</p>
            </article>
            <article className="public-entry-story-card">
              <span>入口 URL</span>
              <strong>{profile?.access_url || window.location.href}</strong>
              <p>这就是对外分享的固定公共二维码落点。</p>
            </article>
            <article className="public-entry-story-card">
              <span>使用提示</span>
              <strong>{profile?.contact_hint || "完成确认后，回到微信发送问题即可开始对话。"}</strong>
              <p>如果二维码过期，页面会自动刷新新的专属二维码；只有连续失败时才需要你手动重新领取。</p>
            </article>
          </div>
        </section>

        <section className="public-entry-stage surface-card surface-card-strong">
          <div className="public-entry-stage-head">
            <div className="public-entry-overline">Dedicated Pairing</div>
            <h2>专属 OpenClaw 接入</h2>
            <p>页面会自动生成或恢复你的专属 ticket。这里会直接生成一张可长按识别的专属二维码图片；在手机里可长按识别，在电脑上可用另一台手机微信扫码。</p>
          </div>

          <div className={`public-entry-status-badge ${resolveStatusTone(status)}`}>
            <span className="public-entry-status-dot" />
            <span>{resolveStatusText(status)}</span>
          </div>

          <div className="public-entry-stage-card">
            <div className="public-entry-qr-frame">
              {enabled ? (
                shouldShowJoinCard ? (
                  <div className="public-entry-join-card">
                    <div className="public-entry-join-title">
                      <span>Dedicated Claw</span>
                      <strong>{joinLabel}</strong>
                    </div>
                    <p>
                      {isWechatMobile
                        ? "请直接长按下方图片，识别图中二维码进入 OpenClaw 接入确认。"
                        : "当前页面不在微信内。请直接用微信扫一扫下方专属二维码图片完成接入；如果你在手机浏览器里打开，也可以长按图片识别。"}
                    </p>
                    <div className="public-entry-join-qr-shell">
                      <div className="public-entry-join-qr-label">长按识别图中二维码</div>
                      <div className="public-entry-join-qr-stage">
                        {qrImageSrc ? (
                          <img src={qrImageSrc} alt="长按识别图中二维码" />
                        ) : (
                          <div className="public-entry-qr-placeholder">
                            <div className="public-entry-spinner" />
                            <div>{loading ? "正在准备二维码图片..." : "当前无法生成专属二维码图片，请改用下方接入链接。"}</div>
                          </div>
                        )}
                      </div>
                    </div>
                    <ol className="public-entry-join-steps">
                      <li>手机里打开当前页面时，直接长按二维码图片识别。</li>
                      <li>电脑端打开时，请用另一台手机微信扫一扫这张图片。</li>
                      <li>在微信内确认连接 OpenClaw 后，即可开始聊天。</li>
                    </ol>
                    <button
                      type="button"
                      className="public-entry-join-secondary"
                      onClick={() => void navigator.clipboard.writeText(joinUrl).catch(() => undefined)}
                    >
                      复制接入链接
                    </button>
                    {qrImageSrc ? (
                      <a className="public-entry-join-secondary" href={qrImageSrc} target="_blank" rel="noreferrer noopener">
                        单独打开二维码图片
                      </a>
                    ) : null}
                    <div className="public-entry-join-url">{joinUrl}</div>
                  </div>
                ) : qrImageSrc ? (
                  <img src={qrImageSrc} alt={profile?.display_name || "专属配对二维码"} />
                ) : (
                  <div className="public-entry-qr-placeholder">
                    <div className="public-entry-spinner" />
                    <div>{loading ? "正在准备专属接入信息..." : "等待生成专属接入信息..."}</div>
                  </div>
                )
              ) : (
                <div className="public-entry-qr-placeholder">
                  <div>公共入口当前未启用，请联系管理员先在接入中心开启。</div>
                </div>
              )}
            </div>

            <div className={`public-entry-detail ${!enabled ? "is-danger" : ""}`}>
              {error
                ? error
                : ticket?.detail ||
                  (enabled
                    ? "正在向网关领取专属接入信息；电脑浏览器请直接微信扫码，手机微信内则继续接入。"
                    : "管理员还没有开启公共入口。")}
            </div>

            <div className="public-entry-meta">
              <div className="public-entry-meta-row">
                <span>Client</span>
                <strong>{clientId}</strong>
              </div>
              <div className="public-entry-meta-row">
                <span>Ticket</span>
                <strong>{ticket?.ticket_id || "等待生成"}</strong>
              </div>
              <div className="public-entry-meta-row">
                <span>过期时间</span>
                <strong>{ticket?.expires_at ? new Date(ticket.expires_at).toLocaleString("zh-CN") : "等待生成"}</strong>
              </div>
              <div className="public-entry-meta-row">
                <span>绑定 Agent</span>
                <strong>{ticket?.bound_agent_id || "尚未绑定"}</strong>
              </div>
            </div>

            <div className="public-entry-actions">
              <button type="button" onClick={() => void startFlow()}>
                {ticket?.status === "expired" || ticket?.status === "failed" ? "重新领取二维码" : "刷新当前状态"}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
