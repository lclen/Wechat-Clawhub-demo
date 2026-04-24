from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable
from uuid import uuid4

from claw_node.config import NodeSettings
from claw_node.inference import create_inference_client


AssessmentCallback = Callable[[dict[str, Any]], Awaitable[None] | None]

logger = logging.getLogger(__name__)

_ROUND_TIMEOUT_SECONDS = 45.0
_STABLE_LATENCY_THRESHOLD_MS = 20_000
_RECOMMENDED_LATENCY_THRESHOLD_MS = 6_000
_BALANCED_LATENCY_THRESHOLD_MS = 5_000
_LATENCY_GROWTH_GUARD_MS = 5_000
_LATENCY_GROWTH_RATIO = 3.5
_ROUND_STEPS = (1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56)
_PROBE_MESSAGE = "Reply with OK only."
_MAX_CHANNEL_ASSESSMENT_ROUNDS = 999
_FAILURE_DETAIL_LIMIT = 5


async def run_channel_assessment(
    settings: NodeSettings,
    *,
    max_rounds: int = 20,
    progress_callback: AssessmentCallback | None = None,
) -> dict[str, Any]:
    inference_client, inference_error = create_inference_client(settings)
    if inference_client is None:
        raise RuntimeError(inference_error or "Inference backend is unavailable for assessment.")

    started_at = _utcnow().isoformat()
    rounds: list[dict[str, Any]] = []
    stable_round: dict[str, Any] | None = None
    baseline_latency_ms: int | None = None
    current_channel_capacity = int(settings.channel_capacity)
    current_max_concurrency = int(settings.max_concurrency)
    step_values = _resolve_round_steps(
        current_max_concurrency,
        current_channel_capacity=current_channel_capacity,
        max_rounds=max_rounds,
    )

    try:
        await _emit_progress(
            progress_callback,
            {
                "status": "running",
                "started_at": started_at,
                "finished_at": None,
                "current_channel_capacity": current_channel_capacity,
                "current_max_concurrency": current_max_concurrency,
                "recommended_channel_capacity": None,
                "recommended_max_concurrency": None,
                "summary": "通道评估已启动，正在执行首轮压测。",
                "rounds": rounds,
                "risk_level": "unknown",
                "can_start": False,
                "start_blocking_reason": "通道评估执行中",
                "blocking_reason": "",
                "stage": "正在创建评估探针",
                "active_session_count": 0,
                "active_task_count": 0,
                "last_error": "",
            },
        )

        for round_index, concurrency in enumerate(step_values, start=1):
            logger.info(
                "[channel-assessment] round_started round=%s concurrency=%s baseline_latency_ms=%s timeout_s=%s",
                round_index,
                concurrency,
                baseline_latency_ms if baseline_latency_ms is not None else "-",
                int(_ROUND_TIMEOUT_SECONDS),
            )
            round_result = await _run_round(
                inference_client,
                concurrency=concurrency,
                round_index=round_index,
                baseline_latency_ms=baseline_latency_ms,
            )
            rounds.append(round_result)
            logger.info(
                "[channel-assessment] round_completed round=%s concurrency=%s success=%s/%s failures=%s timeouts=%s avg_ms=%s max_ms=%s stable=%s stop_reason=%s first_error=%s",
                round_index,
                concurrency,
                round_result["success_count"],
                round_result["request_count"],
                round_result["failure_count"],
                round_result["timeout_count"],
                round_result["average_latency_ms"],
                round_result["max_latency_ms"],
                round_result["stable"],
                round_result["stop_reason"] or "-",
                round_result.get("first_error") or "-",
            )
            if round_result["stable"]:
                stable_round = round_result
                if baseline_latency_ms is None and round_result["average_latency_ms"] > 0:
                    baseline_latency_ms = int(round_result["average_latency_ms"])

            stage_text = (
                f"第 {round_index} 轮稳定，继续升压到更高并发。"
                if round_result["stable"]
                else f"第 {round_index} 轮达到失败阈值，停止继续升压。"
            )
            await _emit_progress(
                progress_callback,
                {
                    "status": "running",
                    "started_at": started_at,
                    "finished_at": None,
                    "current_channel_capacity": current_channel_capacity,
                    "current_max_concurrency": current_max_concurrency,
                    "recommended_channel_capacity": (
                        stable_round["channel_capacity"] if stable_round is not None else None
                    ),
                    "recommended_max_concurrency": (
                        stable_round["max_concurrency"] if stable_round is not None else None
                    ),
                    "summary": stage_text,
                    "rounds": rounds,
                    "risk_level": "unknown",
                    "can_start": False,
                    "start_blocking_reason": "通道评估执行中",
                    "blocking_reason": "",
                    "stage": stage_text,
                    "active_session_count": 0,
                    "active_task_count": 0,
                    "last_error": "",
                },
            )
            if not round_result["stable"]:
                break

        finished_at = _utcnow().isoformat()
        if stable_round is None:
            return {
                "status": "failed",
                "started_at": started_at,
                "finished_at": finished_at,
                "current_channel_capacity": current_channel_capacity,
                "current_max_concurrency": current_max_concurrency,
                "recommended_channel_capacity": None,
                "recommended_max_concurrency": None,
                "balanced_channel_capacity": None,
                "balanced_max_concurrency": None,
                "summary": "未找到稳定轮次，建议先降低模型负载或检查当前推理链路后再重试。",
                "rounds": rounds,
                "risk_level": "high",
                "can_start": True,
                "start_blocking_reason": "",
                "blocking_reason": "",
                "stage": "评估结束",
                "active_session_count": 0,
                "active_task_count": 0,
                "last_error": rounds[-1]["stop_reason"] if rounds else "",
            }

        balanced_round = _select_balanced_round(rounds, stable_round)
        recommendation_summary = (
            f"建议将最大并发调整为 {stable_round['max_concurrency']}，"
            f"建议通道数调整为 {stable_round['channel_capacity']}。"
        )
        if balanced_round is not None and balanced_round != stable_round:
            recommendation_summary += (
                f" 如需更平衡的体验，可改用通道数 {balanced_round['channel_capacity']} / 最大并发 {balanced_round['max_concurrency']}。"
            )
        risk_level = (
            "medium"
            if stable_round["max_concurrency"] < current_max_concurrency
            or stable_round["channel_capacity"] < current_channel_capacity
            else "low"
        )
        return {
            "status": "completed",
            "started_at": started_at,
            "finished_at": finished_at,
            "current_channel_capacity": current_channel_capacity,
            "current_max_concurrency": current_max_concurrency,
            "recommended_channel_capacity": stable_round["channel_capacity"],
            "recommended_max_concurrency": stable_round["max_concurrency"],
            "balanced_channel_capacity": balanced_round["channel_capacity"] if balanced_round is not None else stable_round["channel_capacity"],
            "balanced_max_concurrency": balanced_round["max_concurrency"] if balanced_round is not None else stable_round["max_concurrency"],
            "summary": recommendation_summary,
            "rounds": rounds,
            "risk_level": risk_level,
            "can_start": True,
            "start_blocking_reason": "",
            "blocking_reason": "",
            "stage": "评估结束",
            "active_session_count": 0,
            "active_task_count": 0,
            "last_error": "",
        }
    finally:
        close_method = getattr(inference_client, "close", None)
        if callable(close_method):
            with contextlib.suppress(Exception):
                await close_method()


async def _run_round(
    inference_client: Any,
    *,
    concurrency: int,
    round_index: int,
    baseline_latency_ms: int | None,
) -> dict[str, Any]:
    latencies: list[int] = []
    success_count = 0
    failure_count = 0
    timeout_count = 0
    failure_details: list[str] = []

    def remember_failure(detail: str) -> None:
        if len(failure_details) < _FAILURE_DETAIL_LIMIT:
            failure_details.append(detail)

    def failure_sample(detail: str) -> str:
        return detail if len(detail) <= 240 else f"{detail[:237]}..."

    async def probe_call(probe_index: int) -> None:
        nonlocal success_count, failure_count, timeout_count
        started = time.perf_counter()
        try:
            await asyncio.wait_for(
                inference_client.ask(
                    session_id=f"assessment-session-{round_index}-{probe_index}-{uuid4().hex[:8]}",
                    user_id=f"assessment-user-{probe_index}",
                    agent_id="channel-assessment",
                    query=_PROBE_MESSAGE,
                    context_summary="Launcher-driven local channel assessment probe.",
                    recent_messages=[],
                ),
                timeout=_ROUND_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            timeout_count += 1
            failure_count += 1
            detail = f"probe={probe_index} timeout after {int(_ROUND_TIMEOUT_SECONDS)}s"
            remember_failure(detail)
            logger.warning(
                "[channel-assessment] probe_failed round=%s concurrency=%s probe=%s kind=timeout detail=%s",
                round_index,
                concurrency,
                probe_index,
                detail,
            )
            return
        except Exception as exc:
            failure_count += 1
            detail = f"probe={probe_index} {type(exc).__name__}: {exc}"
            remember_failure(failure_sample(detail))
            logger.warning(
                "[channel-assessment] probe_failed round=%s concurrency=%s probe=%s kind=error error_type=%s detail=%s",
                round_index,
                concurrency,
                probe_index,
                type(exc).__name__,
                failure_sample(str(exc) or type(exc).__name__),
            )
            return
        success_count += 1
        latencies.append(max(1, int((time.perf_counter() - started) * 1000)))

    await asyncio.gather(*(probe_call(index) for index in range(concurrency)))

    request_count = concurrency
    average_latency_ms = int(sum(latencies) / len(latencies)) if latencies else 0
    max_latency_ms = max(latencies) if latencies else 0
    success_rate = round(success_count / request_count, 4) if request_count else 0.0
    latency_growth_limit_ms = _latency_growth_limit_ms(baseline_latency_ms)
    stable = (
        failure_count == 0
        and timeout_count == 0
        and success_count == request_count
        and average_latency_ms <= _STABLE_LATENCY_THRESHOLD_MS
        and average_latency_ms <= _RECOMMENDED_LATENCY_THRESHOLD_MS
        and average_latency_ms <= latency_growth_limit_ms
    )
    stop_reason = ""
    if timeout_count:
        stop_reason = f"出现 {timeout_count} 次超时"
    elif failure_count:
        stop_reason = f"出现 {failure_count} 次失败"
    elif average_latency_ms > _RECOMMENDED_LATENCY_THRESHOLD_MS:
        stop_reason = f"平均延迟升至 {average_latency_ms} ms，超过建议阈值 {_RECOMMENDED_LATENCY_THRESHOLD_MS} ms"
    elif average_latency_ms > latency_growth_limit_ms:
        stop_reason = f"平均延迟升至 {average_latency_ms} ms，超过基线劣化阈值 {latency_growth_limit_ms} ms"
    elif average_latency_ms > _STABLE_LATENCY_THRESHOLD_MS:
        stop_reason = f"平均延迟升至 {average_latency_ms} ms"

    channel_capacity = max(concurrency * 2, concurrency)
    summary = (
        f"{success_count}/{request_count} 成功，平均延迟 {average_latency_ms} ms。"
        if stable
        else f"{success_count}/{request_count} 成功，已触发停止条件：{stop_reason or '稳定性不足'}。"
    )
    return {
        "round_index": round_index,
        "max_concurrency": concurrency,
        "channel_capacity": channel_capacity,
        "request_count": request_count,
        "success_count": success_count,
        "failure_count": failure_count,
        "timeout_count": timeout_count,
        "success_rate": success_rate,
        "average_latency_ms": average_latency_ms,
        "max_latency_ms": max_latency_ms,
        "stable": stable,
        "stop_reason": stop_reason,
        "summary": summary,
        "first_error": failure_details[0] if failure_details else "",
        "failure_details": failure_details,
    }


async def _emit_progress(
    callback: AssessmentCallback | None,
    payload: dict[str, Any],
) -> None:
    if callback is None:
        return
    result = callback(payload)
    if asyncio.iscoroutine(result):
        await result


def _resolve_round_steps(
    current_max_concurrency: int,
    *,
    current_channel_capacity: int,
    max_rounds: int,
) -> list[int]:
    configured_rounds = max(1, min(max_rounds, _MAX_CHANNEL_ASSESSMENT_ROUNDS))
    candidate_steps = list(_ROUND_STEPS)
    while len(candidate_steps) < configured_rounds:
        candidate_steps.append(candidate_steps[-1] + 8)
    return [max(1, value) for value in candidate_steps[:configured_rounds]]


def _latency_growth_limit_ms(baseline_latency_ms: int | None) -> int:
    if baseline_latency_ms is None or baseline_latency_ms <= 0:
        return _RECOMMENDED_LATENCY_THRESHOLD_MS
    return min(
        _RECOMMENDED_LATENCY_THRESHOLD_MS,
        max(_LATENCY_GROWTH_GUARD_MS, int(baseline_latency_ms * _LATENCY_GROWTH_RATIO)),
    )


def _select_balanced_round(rounds: list[dict[str, Any]], stable_round: dict[str, Any]) -> dict[str, Any]:
    stable_rounds = [round_result for round_result in rounds if bool(round_result.get("stable"))]
    if not stable_rounds:
        return stable_round
    balanced_candidates = [
        round_result
        for round_result in stable_rounds
        if int(round_result.get("average_latency_ms", 0) or 0) <= _BALANCED_LATENCY_THRESHOLD_MS
    ]
    if balanced_candidates:
        return balanced_candidates[-1]
    return stable_rounds[0]


def _utcnow() -> datetime:
    return datetime.now(UTC)
