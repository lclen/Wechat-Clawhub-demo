from __future__ import annotations

from datetime import datetime
from typing import Any

from launcher.models import LocalNodeConnectivityCheckItem


def _wechat_status_value(wechat_status: dict[str, Any] | None, key: str, default: Any = None) -> Any:
    if not isinstance(wechat_status, dict):
        return default
    return wechat_status.get(key, default)


def describe_wechat_session_pause(wechat_status: dict[str, Any] | None) -> str | None:
    if not bool(_wechat_status_value(wechat_status, "session_paused", False)):
        return None
    reason = str(
        _wechat_status_value(wechat_status, "session_pause_reason")
        or _wechat_status_value(wechat_status, "last_error")
        or "session timeout"
    ).strip() or "session timeout"
    paused_until = _wechat_status_value(wechat_status, "session_paused_until")
    if not isinstance(paused_until, (int, float)) or paused_until <= 0:
        return f"当前会话已暂停，原因：{reason}。"
    until_label = datetime.fromtimestamp(float(paused_until)).strftime("%H:%M:%S")
    return f"当前会话已暂停，预计 {until_label} 自动恢复。原因：{reason}。"


def build_wechat_admin_connectivity_item(wechat_status: dict[str, Any] | None) -> LocalNodeConnectivityCheckItem:
    has_token = bool(_wechat_status_value(wechat_status, "has_token", False))
    running = bool(_wechat_status_value(wechat_status, "running", False))
    needs_rescan = bool(_wechat_status_value(wechat_status, "needs_rescan", False))
    lease_state = str(_wechat_status_value(wechat_status, "lease_state", "") or "")
    last_error = str(_wechat_status_value(wechat_status, "last_error", "") or "").strip()
    session_paused = bool(_wechat_status_value(wechat_status, "session_paused", False))

    if has_token and running and not needs_rescan and not session_paused:
        return LocalNodeConnectivityCheckItem(
            key="wechat-admin",
            label="管理员扫码",
            status="passed",
            summary="轮询中",
            detail=last_error or "已持有 token，轮询链路正在运行。",
        )
    if needs_rescan:
        return LocalNodeConnectivityCheckItem(
            key="wechat-admin",
            label="管理员扫码",
            status="warning",
            summary="需要重新扫码",
            detail="当前会话已被上游判定失效，需要重新扫码恢复。",
        )
    if session_paused:
        return LocalNodeConnectivityCheckItem(
            key="wechat-admin",
            label="管理员扫码",
            status="warning",
            summary="暂停冷却中",
            detail=describe_wechat_session_pause(wechat_status) or "当前会话已暂停，稍后会自动恢复。",
        )
    if lease_state == "standby":
        return LocalNodeConnectivityCheckItem(
            key="wechat-admin",
            label="管理员扫码",
            status="warning",
            summary="备用实例待接管",
            detail="当前实例检测到扫码 token，但轮询租约在其他实例上，管理员扫码链路会在主实例释放后自动接管。",
        )
    return LocalNodeConnectivityCheckItem(
        key="wechat-admin",
        label="管理员扫码",
        status="failed",
        summary="未就绪",
        detail=last_error or "未检测到稳定轮询，请检查 token、租约或网络。",
    )
