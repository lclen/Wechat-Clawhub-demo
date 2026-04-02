from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.deps import (
    ensure_redis_available,
    get_dispatch_queue,
    get_node_auth,
    get_node_registry,
    get_redis_store,
)
from app.dispatch.queue import DispatchQueue, DispatchQueueError, DispatchTaskNotFoundError
from app.models.dispatch import PullTaskResponse, TaskFailureRequest, TaskResultRequest
from app.models.node import (
    NodeHeartbeatRequest,
    NodeListResponse,
    NodeOperationResponse,
    NodeRegistrationRequest,
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
) -> NodeListResponse:
    await ensure_redis_available(store)
    try:
        return NodeListResponse(nodes=await registry.list_nodes())
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
