from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status

from app.core.config import Settings
from app.core.deps import (
    ensure_redis_available,
    get_dispatch_queue,
    get_node_auth,
    get_node_diagnostics_stream,
    get_node_registry,
    get_redis_store,
    get_settings_dep,
    get_setup_service,
)
from app.dispatch.queue import DispatchQueue, DispatchQueueError, DispatchTaskNotFoundError
from app.models.dispatch import ChannelReleasedRequest, PullTaskResponse, TaskFailureRequest, TaskResultRequest
from app.models.node import (
    NodeDiagnosticsRecord,
    NodeDiagnosticsResponse,
    NodeHeartbeatRequest,
    NodeDeleteResponse,
    NodeListResponse,
    NodeOperationResponse,
    NodeRegistrationRequest,
    NodeUpdateRequest,
)
from app.services.node_auth import NodeAuthService
from app.services.node_diagnostics_stream import NodeDiagnosticsStreamBroker
from app.services.node_inventory import build_node_list_response
from app.services.node_registry import NodeNotFoundError, NodeRegistry, NodeRegistryError
from app.services.redis_store import RedisStore
from app.services.setup_service import SetupService

router = APIRouter(prefix="/api/nodes", tags=["nodes"])
logger = logging.getLogger(__name__)


@router.get("", response_model=NodeListResponse)
async def list_nodes(
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    settings: Settings = Depends(get_settings_dep),
    setup_service: SetupService = Depends(get_setup_service),
) -> NodeListResponse:
    await ensure_redis_available(store)
    try:
        nodes = await registry.list_nodes()
        return build_node_list_response(
            nodes=nodes,
            node_tokens=settings.node_tokens,
            local_node_id=settings.local_node_id,
            pairing_diagnostics=setup_service.get_pairing_diagnostics(),
        )
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post("/register", response_model=NodeOperationResponse, status_code=status.HTTP_201_CREATED)
async def register_node(
    request: Request,
    payload: NodeRegistrationRequest,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    node_auth: NodeAuthService = Depends(get_node_auth),
) -> NodeOperationResponse:
    await ensure_redis_available(store)
    node_auth.verify_request(request, payload.node_id)
    try:
        node = await registry.register(payload)
        request.app.state.setup_service.record_register_event(
            payload.node_id,
            trace_id=request.headers.get("X-Pairing-Trace-Id", "").strip(),
            result="accepted",
            message="节点 register 已被网关接受。",
            node_kind="local" if payload.node_id == request.app.state.settings.local_node_id else "remote",
            connection_state="connected",
            metadata={
                "lan_ip": payload.lan_ip or "",
                "hostname": payload.hostname or "",
                "base_url": payload.base_url,
            },
        )
        await request.app.state.gateway_summary_service.publish_if_needed()
        return NodeOperationResponse(node=node)
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post("/{node_id}/heartbeat", response_model=NodeOperationResponse)
async def heartbeat_node(
    request: Request,
    node_id: str,
    payload: NodeHeartbeatRequest,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    node_auth: NodeAuthService = Depends(get_node_auth),
) -> NodeOperationResponse:
    await ensure_redis_available(store)
    node_auth.verify_request(request, node_id)
    try:
        node = await registry.heartbeat(node_id, payload)
        request.app.state.setup_service.record_heartbeat_event(
            node_id,
            trace_id=request.headers.get("X-Pairing-Trace-Id", "").strip(),
            result="accepted",
            message="节点 heartbeat 已被网关接受。",
            node_kind="local" if node_id == request.app.state.settings.local_node_id else "remote",
            connection_state="connected",
            metadata={
                "current_load": str(payload.current_load),
                "status": payload.status.value,
            },
        )
        await request.app.state.gateway_summary_service.publish_if_needed()
        return NodeOperationResponse(node=node)
    except NodeNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.patch("/{node_id}", response_model=NodeOperationResponse)
async def update_node(
    node_id: str,
    payload: NodeUpdateRequest,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
) -> NodeOperationResponse:
    await ensure_redis_available(store)
    try:
        node = await registry.update(node_id, payload)
        return NodeOperationResponse(node=node)
    except NodeNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.delete("/{node_id}", response_model=NodeDeleteResponse)
async def delete_node(
    node_id: str,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    setup_service: SetupService = Depends(get_setup_service),
    request: Request = None,
) -> NodeDeleteResponse:
    await ensure_redis_available(store)
    try:
        removed_pairing, removed_runtime = await setup_service.remove_paired_node(node_id, registry)
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if not removed_pairing and not removed_runtime:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Node '{node_id}' not found")

    # 推送 summary 更新（节点列表变更）
    if request:
        await request.app.state.gateway_summary_service.publish_if_needed()

    return NodeDeleteResponse(
        node_id=node_id,
        removed_pairing=removed_pairing,
        removed_runtime=removed_runtime,
        detail=(
            "已删除配对凭据并清理运行态节点记录。"
            if removed_pairing and removed_runtime
            else "已删除配对凭据。"
            if removed_pairing
            else "已清理运行态节点记录。"
        ),
    )


@router.post("/{node_id}/disconnect", response_model=NodeDeleteResponse)
async def disconnect_node(
    node_id: str,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    request: Request = None,
) -> NodeDeleteResponse:
    """Remove node from Redis active set only, keeping pairing token intact.
    The node can reconnect automatically on next heartbeat/register."""
    await ensure_redis_available(store)
    try:
        removed_runtime = await registry.remove(node_id)
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if not removed_runtime:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Node '{node_id}' not found in active registry")

    # 推送 summary 更新（节点列表变更）
    if request:
        await request.app.state.gateway_summary_service.publish_if_needed()

    return NodeDeleteResponse(
        node_id=node_id,
        removed_pairing=False,
        removed_runtime=True,
        detail="已断开节点连接；配对凭据保留，节点重启后可自动重连。",
    )


@router.get("/{node_id}/diagnostics", response_model=NodeDiagnosticsResponse)
async def get_node_diagnostics(
    node_id: str,
    setup_service: SetupService = Depends(get_setup_service),
) -> NodeDiagnosticsResponse:
    diagnostics = NodeDiagnosticsRecord.model_validate(setup_service.get_node_diagnostics(node_id))
    return NodeDiagnosticsResponse(node_id=node_id, diagnostics=diagnostics)


@router.websocket("/{node_id}/diagnostics/ws")
async def stream_node_diagnostics(
    websocket: WebSocket,
    node_id: str,
) -> None:
    await websocket.accept()
    try:
        setup_service: SetupService = websocket.app.state.setup_service
        stream: NodeDiagnosticsStreamBroker = websocket.app.state.node_diagnostics_stream
    except AttributeError:
        await websocket.close(code=4500, reason="server_not_ready")
        return

    try:
        await stream.publish_snapshot(
            node_id=node_id,
            websocket=websocket,
            diagnostics=setup_service.get_node_diagnostics(node_id),
        )
        await stream.subscribe(node_id, websocket)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await stream.unsubscribe(node_id, websocket)


@router.post("/{node_id}/pull-task", response_model=PullTaskResponse)
async def pull_task(
    request: Request,
    node_id: str,
    wait_seconds: int = Query(default=0, ge=0, le=30),
    store: RedisStore = Depends(get_redis_store),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
    node_auth: NodeAuthService = Depends(get_node_auth),
) -> PullTaskResponse:
    await ensure_redis_available(store)
    node_auth.verify_request(request, node_id)
    try:
        task = await dispatch_queue.pull_for_node(node_id, wait_seconds=wait_seconds)
        return PullTaskResponse(task=task)
    except DispatchQueueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.websocket("/{node_id}/ws")
async def stream_node_tasks(
    websocket: WebSocket,
    node_id: str,
    wait_seconds: int = Query(default=15, ge=0, le=30),
) -> None:
    await websocket.accept()
    try:
        store: RedisStore = websocket.app.state.redis_store
        dispatch_queue: DispatchQueue = websocket.app.state.dispatch_queue
        node_auth: NodeAuthService = websocket.app.state.node_auth
        node_stream = websocket.app.state.node_stream
        registry: NodeRegistry = websocket.app.state.node_registry
    except AttributeError:
        await websocket.close(code=4500, reason="server_not_ready")
        return

    try:
        node_auth.verify_websocket(websocket, node_id)
    except HTTPException as exc:
        await websocket.close(code=4401, reason=str(exc.detail))
        return

    try:
        if not await store.ping():
            await websocket.close(code=4503, reason="redis_unavailable")
            return
    except Exception:
        await websocket.close(code=4503, reason="redis_unavailable")
        return

    # Register node connection
    await node_stream.register_connection(node_id, websocket)

    try:
        while True:
            receive_started_at = time.perf_counter()
            event = await node_stream.receive_event(websocket)
            if event is None:
                # Connection closed
                break

            event_type = event.get("type")
            receive_ms = (time.perf_counter() - receive_started_at) * 1000

            if event_type == "ready":
                # Node is ready for a task
                task = await dispatch_queue.pull_for_node(node_id, wait_seconds=wait_seconds)
                if task is None:
                    await websocket.send_json({"type": "noop"})
                    continue
                await websocket.send_json({
                    "type": "task_assigned",
                    "task": task.model_dump(mode="json"),
                })

            elif event_type == "task_result":
                if not event.get("task_id") or not event.get("session_id") or event.get("content") is None:
                    await websocket.send_json({"type": "error", "reason": "invalid_task_result"})
                    continue
                try:
                    from app.models.dispatch import TaskResultRequest
                    payload = TaskResultRequest(
                        task_id=str(event["task_id"]),
                        session_id=str(event["session_id"]),
                        node_id=node_id,
                        context_version=int(event.get("context_version", 0)),
                        content=str(event["content"]),
                        usage=event.get("usage") if isinstance(event.get("usage"), dict) else None,
                        metadata={k: str(v) for k, v in (event.get("metadata") or {}).items()} if isinstance(event.get("metadata"), dict) else {},
                    )
                    logger.info(
                        "[dispatch] task_result_received source=ws node=%s task_id=%s session=%s chars=%s receive_ms=%.0f",
                        node_id,
                        payload.task_id,
                        payload.session_id,
                        len(payload.content),
                        receive_ms,
                    )
                    submit_started_at = time.perf_counter()
                    logger.info(
                        "[dispatch] task_result_dispatching source=ws node=%s task_id=%s session=%s chars=%s",
                        node_id,
                        payload.task_id,
                        payload.session_id,
                        len(payload.content),
                    )
                    await dispatch_queue.submit_result(payload)
                    logger.info(
                        "[dispatch] task_result_dispatched source=ws node=%s task_id=%s session=%s submit_ms=%.0f",
                        node_id,
                        payload.task_id,
                        payload.session_id,
                        (time.perf_counter() - submit_started_at) * 1000,
                    )
                except DispatchTaskNotFoundError:
                    await websocket.send_json({"type": "error", "task_id": str(event.get("task_id", "")), "reason": "task_not_found"})
                except DispatchQueueError:
                    await websocket.send_json({"type": "error", "task_id": str(event.get("task_id", "")), "reason": "dispatch_error"})

            elif event_type == "task_failure":
                if (
                    not event.get("task_id")
                    or not event.get("session_id")
                    or not event.get("error_code")
                    or not event.get("error_message")
                ):
                    await websocket.send_json({"type": "error", "reason": "invalid_task_failure"})
                    continue
                try:
                    from app.models.dispatch import TaskFailureRequest
                    payload = TaskFailureRequest(
                        task_id=str(event["task_id"]),
                        session_id=str(event["session_id"]),
                        node_id=node_id,
                        context_version=int(event.get("context_version", 0)),
                        error_code=str(event["error_code"]),
                        error_message=str(event["error_message"]),
                        retryable=bool(event.get("retryable", False)),
                        metadata={k: str(v) for k, v in (event.get("metadata") or {}).items()} if isinstance(event.get("metadata"), dict) else {},
                    )
                    logger.warning(
                        "[dispatch] task_failure_received source=ws node=%s task_id=%s session=%s error_code=%s retryable=%s",
                        node_id,
                        payload.task_id,
                        payload.session_id,
                        payload.error_code,
                        payload.retryable,
                    )
                    await dispatch_queue.submit_failure(payload)
                except DispatchTaskNotFoundError:
                    await websocket.send_json({"type": "error", "task_id": str(event.get("task_id", "")), "reason": "task_not_found"})
                except DispatchQueueError:
                    await websocket.send_json({"type": "error", "task_id": str(event.get("task_id", "")), "reason": "dispatch_error"})

            elif event_type == "channel_released":
                if not event.get("session_id") or not event.get("slot_id"):
                    await websocket.send_json({"type": "error", "reason": "invalid_channel_released"})
                    continue
                try:
                    payload = ChannelReleasedRequest(
                        session_id=str(event["session_id"]),
                        node_id=node_id,
                        slot_id=str(event["slot_id"]),
                        reason=str(event.get("reason") or "idle_timeout"),
                        last_active_at=event.get("last_active_at"),
                        released_at=event.get("released_at"),
                    )
                    await dispatch_queue.release_channel_from_node(payload)
                    websocket.app.state.setup_service.record_channel_event(
                        node_id,
                        result="released",
                        message=f"节点已释放空闲通道 {payload.slot_id}",
                        reason=payload.reason,
                        session_id=payload.session_id,
                        slot_id=payload.slot_id,
                        last_active_at=payload.last_active_at.isoformat() if payload.last_active_at else "",
                        released_at=payload.released_at.isoformat() if payload.released_at else "",
                    )
                    await websocket.app.state.gateway_summary_service.publish_if_needed()
                    await websocket.send_json({"type": "ack", "event": "channel_released"})
                except DispatchQueueError:
                    await websocket.send_json({"type": "error", "reason": "dispatch_error"})

            elif event_type == "heartbeat":
                # Node heartbeat
                await websocket.send_json({"type": "pong"})

            elif event_type == "diagnostics":
                # Node diagnostics update
                diagnostics = event.get("diagnostics")
                if isinstance(diagnostics, dict):
                    websocket.app.state.setup_service.ingest_node_diagnostics_event(node_id, diagnostics)

            else:
                # Unknown event type, but don't close connection
                await websocket.send_json({"type": "error", "reason": "unknown_event_type"})

    except WebSocketDisconnect:
        pass
    except DispatchQueueError:
        await websocket.close(code=4503, reason="dispatch_unavailable")
    finally:
        await node_stream.unregister_connection(node_id)


@router.post("/{node_id}/task-result", response_model=NodeOperationResponse)
async def submit_task_result(
    request: Request,
    node_id: str,
    payload: TaskResultRequest,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
    node_auth: NodeAuthService = Depends(get_node_auth),
) -> NodeOperationResponse:
    await ensure_redis_available(store)
    node_auth.verify_request(request, node_id)
    if payload.node_id != node_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="node_id mismatch")
    try:
        logger.info(
            "[dispatch] task_result_received source=http node=%s task_id=%s session=%s chars=%s",
            node_id,
            payload.task_id,
            payload.session_id,
            len(payload.content),
        )
        await dispatch_queue.submit_result(payload)
        node = await registry.get(node_id)
        return NodeOperationResponse(node=node)
    except DispatchTaskNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DispatchQueueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post("/{node_id}/task-failure", response_model=NodeOperationResponse)
async def submit_task_failure(
    request: Request,
    node_id: str,
    payload: TaskFailureRequest,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
    node_auth: NodeAuthService = Depends(get_node_auth),
) -> NodeOperationResponse:
    await ensure_redis_available(store)
    node_auth.verify_request(request, node_id)
    if payload.node_id != node_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="node_id mismatch")
    try:
        logger.warning(
            "[dispatch] task_failure_received source=http node=%s task_id=%s session=%s error_code=%s retryable=%s",
            node_id,
            payload.task_id,
            payload.session_id,
            payload.error_code,
            payload.retryable,
        )
        await dispatch_queue.submit_failure(payload)
        node = await registry.get(node_id)
        return NodeOperationResponse(node=node)
    except DispatchTaskNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DispatchQueueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post("/{node_id}/channel-released", response_model=NodeOperationResponse)
async def submit_channel_released(
    request: Request,
    node_id: str,
    payload: ChannelReleasedRequest,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
    node_auth: NodeAuthService = Depends(get_node_auth),
) -> NodeOperationResponse:
    await ensure_redis_available(store)
    node_auth.verify_request(request, node_id)
    if payload.node_id != node_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="node_id mismatch")
    try:
        await dispatch_queue.release_channel_from_node(payload)
        request.app.state.setup_service.record_channel_event(
            node_id,
            result="released",
            message=f"节点已释放空闲通道 {payload.slot_id}",
            reason=payload.reason,
            session_id=payload.session_id,
            slot_id=payload.slot_id,
            last_active_at=payload.last_active_at.isoformat() if payload.last_active_at else "",
            released_at=payload.released_at.isoformat() if payload.released_at else "",
        )
        await request.app.state.gateway_summary_service.publish_if_needed()
        node = await registry.get(node_id)
        return NodeOperationResponse(node=node)
    except DispatchQueueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
