from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse

from app.core.deps import get_public_entry_service
from app.models.public_entry import PublicEntryTicketCreateRequest, PublicEntryTicketResponse
from app.services.public_entry_service import PublicEntryService, PublicEntryServiceError


router = APIRouter(tags=["public-entry"])


@router.get("/entry", response_class=HTMLResponse, include_in_schema=False)
async def get_public_entry_page(
    request: Request,
    public_entry_service: PublicEntryService = Depends(get_public_entry_service),
) -> HTMLResponse:
    html = public_entry_service.render_entry_page(base_url=str(request.base_url).rstrip("/"))
    return HTMLResponse(content=html)


@router.post("/api/public-entry/tickets", response_model=PublicEntryTicketResponse)
async def create_public_entry_ticket(
    payload: PublicEntryTicketCreateRequest,
    public_entry_service: PublicEntryService = Depends(get_public_entry_service),
) -> PublicEntryTicketResponse:
    try:
        return await public_entry_service.create_or_restore_ticket(payload.client_id, force_new=payload.force_new)
    except PublicEntryServiceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/api/public-entry/tickets/{ticket_id}", response_model=PublicEntryTicketResponse)
async def get_public_entry_ticket(
    ticket_id: str,
    public_entry_service: PublicEntryService = Depends(get_public_entry_service),
) -> PublicEntryTicketResponse:
    try:
        return await public_entry_service.get_ticket(ticket_id)
    except PublicEntryServiceError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
