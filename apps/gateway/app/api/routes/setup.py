from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_setup_service
from app.models.setup import (
    ConsoleConnectRequest,
    DiscoveryPairRequest,
    DiscoveryPairResponse,
    DiscoveryScanRequest,
    DiscoveryScanResponse,
    GatewayConsoleSetupRequest,
    GatewaySetupSaveRequest,
    GatewaySetupSaveResponse,
    NodeInstallRequest,
    SetupProfileResponse,
    SetupTaskEnvelope,
)
from app.services.setup_service import SetupService

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/profile", response_model=SetupProfileResponse)
async def get_setup_profile(
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupProfileResponse:
    return setup_service.get_profile()


@router.post("/gateway/save", response_model=GatewaySetupSaveResponse)
async def save_gateway_setup(
    payload: GatewaySetupSaveRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> GatewaySetupSaveResponse:
    task, applied_runtime = await setup_service.save_gateway_config(payload.config)
    return GatewaySetupSaveResponse(
        task=task,
        applied_runtime=applied_runtime,
        restart_required=True,
    )


@router.post("/gateway-console/run", response_model=SetupTaskEnvelope)
async def run_gateway_console_setup(
    payload: GatewayConsoleSetupRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupTaskEnvelope:
    task = await setup_service.run_gateway_console_setup(payload.gateway, payload.console)
    return SetupTaskEnvelope(task=task)


@router.post("/node/install", response_model=SetupTaskEnvelope)
async def install_worker_node(
    payload: NodeInstallRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupTaskEnvelope:
    task = await setup_service.start_node_install(payload.config)
    return SetupTaskEnvelope(task=task)


@router.post("/console/connect", response_model=SetupTaskEnvelope)
async def connect_console_setup(
    payload: ConsoleConnectRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupTaskEnvelope:
    task = await setup_service.connect_console(payload.config)
    return SetupTaskEnvelope(task=task)


@router.post("/discovery/scan", response_model=DiscoveryScanResponse)
async def scan_discovery_nodes(
    payload: DiscoveryScanRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> DiscoveryScanResponse:
    return await setup_service.scan_discovery(payload.timeout_ms)


@router.post("/discovery/pair", response_model=DiscoveryPairResponse)
async def pair_discovered_node(
    payload: DiscoveryPairRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> DiscoveryPairResponse:
    return await setup_service.pair_discovered_node(payload)


@router.get("/tasks/{task_id}", response_model=SetupTaskEnvelope)
async def get_setup_task(
    task_id: str,
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupTaskEnvelope:
    task = setup_service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setup task not found")
    return SetupTaskEnvelope(task=task)


@router.get("/discovery/tasks/{task_id}", response_model=SetupTaskEnvelope)
async def get_discovery_task(
    task_id: str,
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupTaskEnvelope:
    task = setup_service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setup task not found")
    return SetupTaskEnvelope(task=task)
