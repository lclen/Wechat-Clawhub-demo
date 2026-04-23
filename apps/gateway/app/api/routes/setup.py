from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.deps import get_node_registry, get_public_entry_service, get_setup_service
from app.models.setup import (
    ConsoleConnectRequest,
    GatewayDispatchModeRequest,
    GatewayProbeRequest,
    DiscoveryPairRequest,
    DiscoveryPairResponse,
    DiscoveryScanRequest,
    DiscoveryScanResponse,
    GatewayConsoleSetupRequest,
    PublicEntryProfileResponse,
    GatewaySetupSaveRequest,
    GatewaySetupSaveResponse,
    ManualPairRequest,
    NodeCredentialResetRequest,
    NodeInstallRequest,
    SetupProfileResponse,
    SetupTaskEnvelope,
)
from app.services.setup_service import SetupService
from app.services.node_registry import NodeRegistry
from app.services.public_entry_service import PublicEntryService

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/profile", response_model=SetupProfileResponse)
async def get_setup_profile(
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupProfileResponse:
    return setup_service.get_profile()


@router.get("/public-entry", response_model=PublicEntryProfileResponse)
async def get_public_entry_profile(
    request: Request,
    setup_service: SetupService = Depends(get_setup_service),
    public_entry_service: PublicEntryService = Depends(get_public_entry_service),
) -> PublicEntryProfileResponse:
    return setup_service.get_public_entry_profile(
        access_url=public_entry_service.build_access_url(str(request.base_url).rstrip("/")),
        stats=public_entry_service.get_stats(),
    )


@router.post("/reset", status_code=200)
async def reset_setup(
    setup_service: SetupService = Depends(get_setup_service),
    registry: NodeRegistry = Depends(get_node_registry),
) -> dict[str, object]:
    return await setup_service.full_reset(registry)


@router.post("/gateway/save", response_model=GatewaySetupSaveResponse)
async def save_gateway_setup(
    payload: GatewaySetupSaveRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> GatewaySetupSaveResponse:
    task, applied_runtime = await setup_service.save_gateway_config(
        payload.config,
        console_gateway_base_url=payload.console_gateway_base_url,
    )
    return GatewaySetupSaveResponse(
        task=task,
        applied_runtime=applied_runtime,
        restart_required=True,
    )


@router.post("/gateway/dispatch-mode", response_model=SetupTaskEnvelope)
async def update_gateway_dispatch_mode(
    payload: GatewayDispatchModeRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupTaskEnvelope:
    task = await setup_service.set_dispatch_mode(payload.enabled)
    return SetupTaskEnvelope(task=task)


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


@router.post("/node/reset-credentials", response_model=SetupTaskEnvelope)
async def reset_worker_node_credentials(
    payload: NodeCredentialResetRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupTaskEnvelope:
    task = await setup_service.reset_worker_node_credentials(payload.node_id, payload.install_dir)
    return SetupTaskEnvelope(task=task)


@router.post("/console/connect", response_model=SetupTaskEnvelope)
async def connect_console_setup(
    payload: ConsoleConnectRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupTaskEnvelope:
    task = await setup_service.connect_console(payload.config)
    return SetupTaskEnvelope(task=task)


@router.post("/gateway/probe", response_model=SetupTaskEnvelope)
async def probe_worker_gateway(
    payload: GatewayProbeRequest,
    setup_service: SetupService = Depends(get_setup_service),
) -> SetupTaskEnvelope:
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"probe_worker_gateway called with gateway_base_url={payload.gateway_base_url}, node_id={payload.node_id}")
    try:
        task = await setup_service.probe_gateway(payload.gateway_base_url, payload.node_id, payload.timeout_ms)
        logger.info(f"probe_gateway completed: task_id={task.task_id}, status={task.status}")
        response = SetupTaskEnvelope(task=task)
        logger.info(f"Response object created successfully")
        return response
    except Exception as exc:
        logger.error(f"Unexpected error in probe_worker_gateway: {exc}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal error: {exc}") from exc


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
    registry: NodeRegistry = Depends(get_node_registry),
) -> DiscoveryPairResponse:
    return await setup_service.pair_discovered_node(payload, registry)


@router.post("/manual-pair", response_model=DiscoveryPairResponse)
async def manual_pair_node(
    payload: ManualPairRequest,
    setup_service: SetupService = Depends(get_setup_service),
    registry: NodeRegistry = Depends(get_node_registry),
) -> DiscoveryPairResponse:
    return await setup_service.manual_pair_node(payload, registry)


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
