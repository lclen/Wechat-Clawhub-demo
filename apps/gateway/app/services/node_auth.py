from __future__ import annotations

from fastapi import HTTPException, Request, status

from app.core.config import Settings


class NodeAuthService:
    """Validate node credentials against pre-shared tokens."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def verify_request(self, request: Request, node_id: str) -> None:
        expected = self._settings.node_tokens.get(node_id)
        if not expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Node token is not configured for '{node_id}'",
            )

        provided = self._extract_token(request)
        if provided != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid node token",
            )

    def _extract_token(self, request: Request) -> str | None:
        bearer = request.headers.get("Authorization", "")
        if bearer.startswith("Bearer "):
            return bearer[7:].strip()
        return request.headers.get("X-Node-Token")
