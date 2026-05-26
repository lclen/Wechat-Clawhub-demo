import type { ConnectivityCheckItem, WeChatStatus } from "../types";

export type WeChatRuntimePresentation = {
  value: string;
  detail: string;
  tone: "good" | "warn";
  runningLabel: string;
  connectivityStatus: ConnectivityCheckItem["status"];
  connectivitySummary: string;
  connectivityDetail: string;
};

export function describeWechatSessionPause(wechatStatus: WeChatStatus | null, nowMs = Date.now()) {
  if (!wechatStatus?.session_paused) {
    return null;
  }
  const reason = (wechatStatus.session_pause_reason || wechatStatus.last_error || "session timeout").trim() || "session timeout";
  const pausedUntil = wechatStatus.session_paused_until;
  if (typeof pausedUntil !== "number" || !Number.isFinite(pausedUntil) || pausedUntil <= 0) {
    return `会话已暂停，原因：${reason}。`;
  }
  const pausedUntilMs = pausedUntil * 1000;
  const remainingMs = pausedUntilMs - nowMs;
  const untilLabel = new Date(pausedUntilMs).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (remainingMs <= 0) {
    return `会话已暂停，预计 ${untilLabel} 自动恢复。原因：${reason}。`;
  }
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return `会话已暂停，约 ${remainingMinutes} 分钟后自动恢复（预计 ${untilLabel}）。原因：${reason}。`;
}

function isWechatSessionPauseHint(wechatStatus: WeChatStatus | null) {
  if (!wechatStatus) {
    return false;
  }
  if (wechatStatus.session_paused) {
    return true;
  }
  const errorText = `${wechatStatus.session_pause_reason || ""} ${wechatStatus.last_error || ""}`.toLowerCase();
  return errorText.includes("polling paused") || errorText.includes("session timeout");
}

function resolveWechatPauseDetail(wechatStatus: WeChatStatus, nowMs?: number) {
  if (wechatStatus.session_paused) {
    return describeWechatSessionPause(wechatStatus, nowMs) || "WeChat 会话已暂停，稍后会自动恢复。";
  }
  return wechatStatus.last_error || wechatStatus.session_pause_reason || "WeChat 会话处于暂停冷却中，稍后会自动恢复。";
}

export function resolveWechatRuntimePresentation(
  wechatStatus: WeChatStatus | null,
  options: {
    gatewayManaged: boolean;
    baseUrlConfigured: boolean;
    nowMs?: number;
  },
): WeChatRuntimePresentation {
  if (!options.gatewayManaged) {
    return {
      value: "远端网关",
      detail: "当前机器不托管主网关，请到远端网关查看微信接入状态。",
      tone: "warn",
      runningLabel: "远端网关",
      connectivityStatus: "warning",
      connectivitySummary: "远端网关",
      connectivityDetail: "当前机器不托管主网关，完整检测只代表当前客户端视角。",
    };
  }
  if (!options.baseUrlConfigured) {
    return {
      value: "未配置",
      detail: "尚未填写微信 Base URL。",
      tone: "warn",
      runningLabel: "未配置",
      connectivityStatus: "failed",
      connectivitySummary: "未配置",
      connectivityDetail: "尚未填写微信 Base URL，请先完成管理员扫码接入配置。",
    };
  }
  if (!wechatStatus?.has_token) {
    return {
      value: "待接入",
      detail: "当前还没有写入微信 token。",
      tone: "warn",
      runningLabel: "未轮询",
      connectivityStatus: "failed",
      connectivitySummary: "未就绪",
      connectivityDetail: "未检测到扫码 token，请先完成管理员扫码或手动写入 token。",
    };
  }
  if (wechatStatus.needs_rescan) {
    return {
      value: "需重新扫码",
      detail: wechatStatus.last_error || "WeChat 会话已过期，请重新扫码。",
      tone: "warn",
      runningLabel: "需重新扫码",
      connectivityStatus: "warning",
      connectivitySummary: "需要重新扫码",
      connectivityDetail: "当前会话已被上游判定失效，需要重新扫码恢复。",
    };
  }
  if (isWechatSessionPauseHint(wechatStatus)) {
    const pauseDetail = resolveWechatPauseDetail(wechatStatus, options.nowMs);
    return {
      value: "暂停冷却中",
      detail: pauseDetail,
      tone: "warn",
      runningLabel: "暂停冷却中",
      connectivityStatus: "warning",
      connectivitySummary: "暂停冷却中",
      connectivityDetail: pauseDetail,
    };
  }
  if (wechatStatus.lease_state === "standby") {
    return {
      value: "待接管",
      detail: "已配置，等待主实例释放微信轮询锁。",
      tone: "warn",
      runningLabel: "待接管",
      connectivityStatus: "warning",
      connectivitySummary: "备用实例待接管",
      connectivityDetail: "当前实例检测到扫码 token，但轮询租约在其他实例上，管理员扫码链路会在主实例释放后自动接管。",
    };
  }
  if (!wechatStatus.running) {
    return {
      value: "已配置",
      detail: wechatStatus.last_error || "token 已保存，但轮询尚未运行。",
      tone: "warn",
      runningLabel: "未轮询",
      connectivityStatus: "failed",
      connectivitySummary: "未就绪",
      connectivityDetail: wechatStatus.last_error || "未检测到稳定轮询，请检查 token、租约或网络。",
    };
  }
  return {
    value: "轮询中",
    detail: wechatStatus.last_error || `Base URL：${wechatStatus.base_url}`,
    tone: "good",
    runningLabel: "轮询中",
    connectivityStatus: "passed",
    connectivitySummary: "轮询中",
    connectivityDetail: wechatStatus.last_error || "已持有 token，轮询链路正在运行。",
  };
}

export function buildWechatAdminConnectivityItem(
  wechatStatus: WeChatStatus | null,
  options: {
    gatewayManaged: boolean;
    baseUrlConfigured: boolean;
    nowMs?: number;
  },
): ConnectivityCheckItem {
  const presentation = resolveWechatRuntimePresentation(wechatStatus, options);
  return {
    key: "wechat-admin",
    label: "管理员扫码",
    status: presentation.connectivityStatus,
    summary: presentation.connectivitySummary,
    detail: presentation.connectivityDetail,
  };
}

export function buildWechatStatusRows(
  wechatStatus: WeChatStatus | null,
  presentation: WeChatRuntimePresentation,
  nowMs = Date.now(),
) {
  return [
    { label: "接入状态", value: presentation.value, multiline: true },
    { label: "Token 状态", value: wechatStatus?.has_token ? "已写入当前网关" : "尚未写入" },
    { label: "运行状态", value: presentation.runningLabel },
    ...(wechatStatus?.session_paused
      ? [
          { label: "暂停原因", value: wechatStatus.session_pause_reason || wechatStatus.last_error || "session timeout", multiline: true },
          { label: "预计恢复", value: describeWechatSessionPause(wechatStatus, nowMs) || "会话已暂停，等待自动恢复。", multiline: true },
        ]
      : []),
    ...(wechatStatus?.last_error ? [{ label: "最近错误", value: wechatStatus.last_error, multiline: true }] : []),
  ];
}
