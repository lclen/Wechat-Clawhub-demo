import { useCallback } from "react";
import { isLauncherGatewayOwned } from "../selectors/launcherSelectors";
import type { LauncherStatusResponse, PollResponse, QrStart, WeChatStatus } from "../types";

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;
type WithBusy = <T>(key: string, task: () => Promise<T>) => Promise<T>;

type UseWechatOnboardingOptions = {
  requestJson: RequestJson;
  withBusy: WithBusy;
  qr: QrStart | null;
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

  const startQrFlow = useCallback(async () => {
    try {
      const result = await withBusy("wechat-qr", () => requestJson<QrStart>("/api/wechat/onboard/start", { method: "POST" }));
      setQr(result);
      setPollState({ status: "wait" });
      setNotice("二维码已生成。请扫码并轮询状态。");
    } catch (error) {
      setNotice(`获取二维码失败：${(error as Error).message}`);
    }
  }, [requestJson, setNotice, setPollState, setQr, withBusy]);

  const pollQrStatus = useCallback(async () => {
    if (!qr?.qrcode) {
      setNotice("请先生成二维码。");
      return;
    }
    try {
      const result = await withBusy(
        "wechat-poll",
        () => requestJson<PollResponse>("/api/wechat/onboard/poll", { method: "POST", body: JSON.stringify({ qrcode: qr.qrcode }) }),
      );
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
      setNotice(
        result.status === "scaned"
          ? "二维码已扫码，请在手机端确认。"
          : result.status === "expired"
            ? "二维码已过期，请重新生成。"
            : result.status === "error"
              ? `扫码状态异常：${result.message ?? "未知错误"}`
              : "等待用户扫码。",
      );
    } catch (error) {
      setNotice(`轮询失败：${(error as Error).message}`);
    }
  }, [connectWeChat, launcherStatus, qr, requestJson, setNotice, setPollState, wechatBaseUrl, withBusy]);

  const connectManualToken = useCallback(async () => {
    if (!manualToken.trim()) {
      setNotice("请先填写 token，或通过扫码自动获取。");
      return;
    }
    try {
      await connectWeChat(manualToken.trim(), wechatBaseUrl.trim());
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
