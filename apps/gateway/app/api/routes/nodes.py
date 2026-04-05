from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status

from app.core.config import Settings
from app.core.deps import (
    ensure_redis_available,
    get_dispatch_queue,
    get_node_auth,
    get_node_registry,
    get_redis_store,
    get_settings_dep,
    get_setup_service,
)
from app.dispatch.queue import DispatchQueue, DispatchQueueError, DispatchTaskNotFoundError
from app.models.dispatch import PullTaskResponse, TaskFailureRequest, TaskResultRequest
from app.models.node import (
    NodeDiagnosticsRecord,
    NodeDiagnosticsResponse,
    NodeKind,
    NodeInventoryRecord,
    NodeInventorySummary,
    NodeHeartbeatRequest,
    NodeDeleteResponse,
    NodeListResponse,
    NodeOperationResponse,
    NodeRegistrationRequest,
    NodeRecord,
    NodeUpdateRequest,
)
from app.services.node_auth import NodeAuthService
from app.services.node_registry import NodeNotFoundError, NodeRegistry, NodeRegistryError
from app.services.redis_store import RedisStore
from app.services.setup_service import SetupService

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


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
        inventory = build_node_inventory(
            nodes,
            settings.node_tokens,
            settings.local_node_id,
            setup_service.get_pairing_diagnostics(),
        )
        summary = NodeInventorySummary(
            paired_total=sum(1 for item in inventory if item.paired),
            online_total=sum(1 for item in inventory if item.online),
            offline_total=sum(1 for item in inventory if not item.online),
        )
        return NodeListResponse(nodes=nodes, inventory=inventory, summary=summary)
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
        return NodeOperationResponse(node=node)
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def build_node_inventory(
    nodes: list[NodeRecord],
    node_tokens: dict[str, str],
    local_node_id: str,
    pairing_diagnostics: dict[str, dict[str, str]] | None = None,
) -> list[NodeInventoryRecord]:
    online_by_id = {node.node_id: node for node in nodes}
    paired_ids = {node_id.strip() for node_id in node_tokens if node_id.strip()}
    inventory_ids = sorted((paired_ids | set(online_by_id) | {local_node_id.strip()}) - {""})
    pairing_diagnostics = pairing_diagnostics or {}
    inventory: list[NodeInventoryRecord] = []
    for node_id in inventory_ids:
        online = online_by_id.get(node_id)
        node_kind: NodeKind = "local" if node_id == local_node_id.strip() else "remote"
        paired = node_id in paired_ids or node_kind == "local"
        diagnostic = pairing_diagnostics.get(node_id, {})
        offline_state = diagnostic.get("connection_state") or "paired_offline"
        if offline_state not in {"pairing_pending", "register_failed", "auth_failed", "paired_offline"}:
            offline_state = "paired_offline"
        inventory.append(
            NodeInventoryRecord(
                node_id=node_id,
                node_kind=node_kind,
                paired=paired,
                online=online is not None,
                connection_state=(
                    "connected"
                    if online is not None and paired
                    else "online_unpaired"
                    if online is not None
                    else offline_state
                    if paired
                    else "online_unpaired"
                ),
                status=online.status if online else None,
                last_heartbeat_at=online.last_heartbeat_at if online else None,
                updated_at=online.updated_at if online else None,
                hostname=online.hostname if online else None,
                lan_ip=online.lan_ip if online else None,
                platform=online.platform if online else None,
                node_version=online.node_version if online else None,
                advertised_address=online.advertised_address if online else None,
                last_error=online.last_error if online else (diagnostic.get("last_error") or None),
                base_url=online.base_url if online else None,
                max_concurrency=online.max_concurrency if online else None,
                current_load=online.current_load if online else None,
                channel_capacity=online.channel_capacity if online else None,
                channel_in_use=online.channel_in_use if online else None,
                last_pairing_trace_id=diagnostic.get("last_pairing_trace_id") or None,
                last_register_result=diagnostic.get("last_register_result") or None,
                last_register_at=_parse_optional_datetime(diagnostic.get("last_register_at")),
                last_auth_failure_at=_parse_optional_datetime(diagnostic.get("last_auth_failure_at")),
            )
        )
    inventory.sort(key=lambda item: (not item.online, item.node_kind != "local", not item.paired, item.node_id))
    return inventory


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
) -> NodeDeleteResponse:
    await ensure_redis_available(store)
    try:
        removed_pairing, removed_runtime = await setup_service.remove_paired_node(node_id, registry)
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if not removed_pairing and not removed_runtime:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Node '{node_id}' not found")
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
            event = await node_stream.receive_event(websocket)
            if event is None:
                # Connection closed
                break

            event_type = event.get("type")

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
                # Node completed a task
                task_id = event.get("task_id")
                result = event.get("result")
                if not task_id or not result:
                    await websocket.send_json({"type": "error", "reason": "invalid_task_result"})
                    continue
                try:
                    # Convert to TaskResultRequest format
                    from app.models.dispatch import TaskResultRequest
                    payload = TaskResultRequest(
                        node_id=node_id,
                        task_id=task_id,
                        result=result,
                    )
                    await dispatch_queue.submit_result(payload)
                    await websocket.send_json({"type": "ack", "task_id": task_id})
                except DispatchTaskNotFoundError:
                    await websocket.send_json({"type": "error", "task_id": task_id, "reason": "task_not_found"})
                except DispatchQueueError:
                    await websocket.send_json({"type": "error", "task_id": task_id, "reason": "dispatch_error"})

            elif event_type == "task_failure":
                # Node failed a task
                task_id = event.get("task_id")
                error = event.get("error")
                if not task_id or not error:
                    await websocket.send_json({"type": "error", "reason": "invalid_task_failure"})
                    continue
                try:
                    # Convert to TaskFailureRequest format
                    from app.models.dispatch import TaskFailureRequest
                    payload = TaskFailureRequest(
                        node_id=node_id,
                        task_id=task_id,
                        error=error,
                    )
                    await dispatch_queue.submit_failure(payload)
                    await websocket.send_json({"type": "ack", "task_id": task_id})
                except DispatchTaskNotFoundError:
                    await websocket.send_json({"type": "error", "task_id": task_id, "reason": "task_not_found"})
                except DispatchQueueError:
                    await websocket.send_json({"type": "error", "task_id": task_id, "reason": "dispatch_error"})

            elif event_type == "heartbeat":
                # Node heartbeat
                await websocket.send_json({"type": "pong"})

            elif event_type == "diagnostics":
                # Node diagnostics update
                diagnostics = event.get("diagnostics")
                if diagnostics:
                    # Store diagnostics (future enhancement)
                    await websocket.send_json({"type": "ack"})

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
        await dispatch_queue.submit_failure(payload)
        node = await registry.get(node_id)
        return NodeOperationResponse(node=node)
    except DispatchTaskNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DispatchQueueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def _parse_optional_datetime(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None
