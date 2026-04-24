import { useCallback, useEffect, useRef } from "react";
import { isLauncherGatewayOwned } from "../selectors/launcherSelectors";
import { hasText, safeTrim } from "../stringUtils";
import type { LauncherStatusResponse, PollResponse, QrStart, WeChatStatus } from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;
type WithBusy = <T>(key: string, task: () => Promise<T>) => Promise<T>;

const QR_AUTO_POLL_WAIT_MS = 1800;
const QR_AUTO_POLL_SCANED_MS = 1200;

type UseWechatOnboardingOptions = {
  requestJson: RequestJson;
  withBusy: WithBusy;
  qr: QrStart | null;
  pollState: PollResponse | null;
  wechatBaseUrl: string;
  manualToken: string;
  launcherStatus: LauncherStatusResponse | null;
  setQr: (next: QrStart | null) => void;
  setPollState: (next: PollResponse | null) => void;
  setWechatStatus: (next: WeChatStatus | null) => void;
  setManualToken: (next: string) => void;
  setWechatBaseUrl: (next: string) => void;
  setNotice: (next: string) => void;
};

export function useWechatOnboarding(options: UseWechatOnboardingOptions) {
  const {
    requestJson,
    withBusy,
    qr,
    pollState,
    wechatBaseUrl,
    manualToken,
    launcherStatus,
    setQr,
    setPollState,
    setWechatStatus,
    setManualToken,
    setWechatBaseUrl,
    setNotice,
  } = options;
  const qrPollInFlightRef = useRef(false);

  const connectWeChat = useCallback(async (token: string, baseUrl: string) => {
    const status = await withBusy(
      "wechat-connect",
      () => requestJson<WeChatStatus>("/api/wechat/onboard/connect", {
        method: "POST",
        body: JSON.stringify({ token, base_url: baseUrl, enable_polling: true }),
      }),
    );
    setWechatStatus(status);
    setManualToken(token);
    if (status.base_url) setWechatBaseUrl(status.base_url);
    return status;
  }, [requestJson, setManualToken, setWechatBaseUrl, setWechatStatus, withBusy]);

  const fetchQrCode = useCallback(async () => {
    const result = await requestJson<QrStart>("/api/wechat/onboard/start", { method: "POST" });
    setQr(result);
    setPollState({ status: "wait" });
    return result;
  }, [requestJson, setPollState, setQr]);

  const startQrFlow = useCallback(async () => {
    try {
      await withBusy("wechat-qr", fetchQrCode);
      setNotice("二维码已生成，系统会自动同步扫码状态。");
    } catch (error) {
      setNotice(`获取二维码失败：${(error as Error).message}`);
    }
  }, [fetchQrCode, setNotice, withBusy]);

  const handlePollResult = useCallback(async (result: PollResponse, options?: { auto?: boolean }) => {
    setPollState(result);
    if (result.status === "confirmed" && result.token) {
      await connectWeChat(result.token, result.base_url || wechatBaseUrl);
      setNotice(
        isLauncherGatewayOwned(launcherStatus)
          ? "微信 token 已写入当前主网关，轮询已启动。"
          : "扫码成功，但当前主网关不是桌面启动器托管实例，状态可能不会同步。",
      );
      return;
    }

    if (result.status === "expired") {
      try {
        await fetchQrCode();
        setNotice("登录二维码已过期，已自动切换到最新二维码。");
      } catch (error) {
        setNotice(`二维码已过期，但自动刷新失败：${(error as Error).message}`);
      }
      return;
    }

    if (result.status === "scaned") {
      setNotice("二维码已扫码，正在等待手机端确认。");
      return;
    }

    if (result.status === "error") {
      setNotice(`扫码状态异常：${result.message ?? "未知错误"}`);
      return;
    }

    if (!options?.auto) {
      setNotice("等待用户扫码。");
    }
  }, [
    connectWeChat,
    fetchQrCode,
    launcherStatus,
    setNotice,
    setPollState,
    wechatBaseUrl,
  ]);

  const pollQrStatus = useCallback(async (options?: { auto?: boolean; qrcode?: string }) => {
    const currentQr = safeTrim(options?.qrcode ?? qr?.qrcode ?? "");
    if (!currentQr) {
      setNotice("请先生成二维码。");
      return;
    }
    try {
      const result = options?.auto
        ? await requestJson<PollResponse>("/api/wechat/onboard/poll", { method: "POST", body: JSON.stringify({ qrcode: currentQr }) })
        : await withBusy(
            "wechat-poll",
            () => requestJson<PollResponse>("/api/wechat/onboard/poll", { method: "POST", body: JSON.stringify({ qrcode: currentQr }) }),
          );
      await handlePollResult(result, { auto: options?.auto });
    } catch (error) {
      setNotice(`轮询失败：${(error as Error).message}`);
    }
  }, [handlePollResult, qr, requestJson, setNotice, withBusy]);

  useEffect(() => {
    const currentQr = safeTrim(qr?.qrcode ?? "");
    if (!currentQr) return;
    if (pollState?.status === "confirmed") return;
    if (qrPollInFlightRef.current) return;

    const delayMs = pollState?.status === "scaned" ? QR_AUTO_POLL_SCANED_MS : QR_AUTO_POLL_WAIT_MS;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled || qrPollInFlightRef.current) return;
      qrPollInFlightRef.current = true;
      try {
        await pollQrStatus({ auto: true, qrcode: currentQr });
      } finally {
        qrPollInFlightRef.current = false;
      }
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pollQrStatus, pollState?.status, qr?.qrcode]);

  const connectManualToken = useCallback(async () => {
    if (!hasText(manualToken)) {
      setNotice("请先填写 token，或通过扫码自动获取。");
      return;
    }
    try {
      await connectWeChat(safeTrim(manualToken), safeTrim(wechatBaseUrl));
      setNotice(
        isLauncherGatewayOwned(launcherStatus)
          ? "微信 token 已写入当前主网关，轮询已启动。"
          : "已提交手动 token，但当前主网关不是桌面启动器托管实例，状态可能不会同步。",
      );
    } catch (error) {
      setNotice(`手动连接失败：${(error as Error).message}`);
    }
  }, [connectWeChat, launcherStatus, manualToken, setNotice, wechatBaseUrl]);

  const disconnectWeChat = useCallback(async () => {
    try {
      const status = await withBusy("wechat-disconnect", () => requestJson<WeChatStatus>("/api/wechat/onboard/disconnect", { method: "POST" }));
      setWechatStatus(status);
      setNotice("微信轮询已停止。");
    } catch (error) {
      setNotice(`断开失败：${(error as Error).message}`);
    }
  }, [requestJson, setNotice, setWechatStatus, withBusy]);

  return {
    startQrFlow,
    pollQrStatus,
    connectWeChat,
    connectManualToken,
    disconnectWeChat,
  };
}
