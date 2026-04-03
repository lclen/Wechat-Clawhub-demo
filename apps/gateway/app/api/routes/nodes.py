from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.config import Settings
from app.core.deps import (
    ensure_redis_available,
    get_dispatch_queue,
    get_node_auth,
    get_node_registry,
    get_redis_store,
    get_settings_dep,
)
from app.dispatch.queue import DispatchQueue, DispatchQueueError, DispatchTaskNotFoundError
from app.models.dispatch import PullTaskResponse, TaskFailureRequest, TaskResultRequest
from app.models.node import (
    NodeInventoryRecord,
    NodeInventorySummary,
    NodeHeartbeatRequest,
    NodeListResponse,
    NodeOperationResponse,
    NodeRegistrationRequest,
    NodeRecord,
    NodeUpdateRequest,
)
from app.services.node_auth import NodeAuthService
from app.services.node_registry import NodeNotFoundError, NodeRegistry, NodeRegistryError
from app.services.redis_store import RedisStore

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


@router.get("", response_model=NodeListResponse)
async def list_nodes(
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    settings: Settings = Depends(get_settings_dep),
) -> NodeListResponse:
    await ensure_redis_available(store)
    try:
        nodes = await registry.list_nodes()
        inventory = build_node_inventory(nodes, settings.node_tokens)
        summary = NodeInventorySummary(
            paired_total=sum(1 for node_id in settings.node_tokens if node_id.strip()),
            online_total=sum(1 for item in inventory if item.online),
            offline_total=sum(1 for item in inventory if item.paired and not item.online),
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
        return NodeOperationResponse(node=node)
    except NodeRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def build_node_inventory(nodes: list[NodeRecord], node_tokens: dict[str, str]) -> list[NodeInventoryRecord]:
    online_by_id = {node.node_id: node for node in nodes}
    paired_ids = {node_id.strip() for node_id in node_tokens if node_id.strip()}
    inventory_ids = sorted(paired_ids | set(online_by_id))
    inventory: list[NodeInventoryRecord] = []
    for node_id in inventory_ids:
        online = online_by_id.get(node_id)
        paired = node_id in paired_ids
        inventory.append(
            NodeInventoryRecord(
                node_id=node_id,
                paired=paired,
                online=online is not None,
                connection_state=(
                    "connected"
                    if online is not None and paired
                    else "online_unpaired"
                    if online is not None
                    else "paired_offline"
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
                last_error=online.last_error if online else None,
                base_url=online.base_url if online else None,
                max_concurrency=online.max_concurrency if online else None,
                current_load=online.current_load if online else None,
                channel_capacity=online.channel_capacity if online else None,
                channel_in_use=online.channel_in_use if online else None,
            )
        )
    inventory.sort(key=lambda item: (not item.online, not item.paired, item.node_id))
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


@router.post("/{node_id}/pull-task", response_model=PullTaskResponse)
async def pull_task(
    request: Request,
    node_id: str,
    store: RedisStore = Depends(get_redis_store),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
    node_auth: NodeAuthService = Depends(get_node_auth),
) -> PullTaskResponse:
    await ensure_redis_available(store)
    node_auth.verify_request(request, node_id)
    try:
        task = await dispatch_queue.pull_for_node(node_id)
        return PullTaskResponse(task=task)
    except DispatchQueueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


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
