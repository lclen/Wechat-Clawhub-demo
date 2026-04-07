from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime

from app.models.gateway_summary import GatewaySummaryResponse
from app.models.session import SessionRecord


@dataclass(slots=True)
class GatewaySummarySnapshot:
    summary: GatewaySummaryResponse
    generated_at: datetime
    source_version: str
    degraded: bool = False


@dataclass(slots=True)
class SessionOverviewSnapshot:
    sessions: list[SessionRecord]
    generated_at: datetime
    source_version: str
    degraded: bool = False


class GatewaySummarySnapshotService:
    def __init__(self) -> None:
        self._snapshot: GatewaySummarySnapshot | None = None
        self._lock = asyncio.Lock()

    async def update(
        self,
        summary: GatewaySummaryResponse,
        *,
        source_version: str,
        degraded: bool = False,
    ) -> GatewaySummarySnapshot:
        snapshot = GatewaySummarySnapshot(
            summary=summary.model_copy(deep=True),
            generated_at=datetime.now(UTC),
            source_version=source_version,
            degraded=degraded,
        )
        async with self._lock:
            self._snapshot = snapshot
        return snapshot

    async def get_snapshot(self) -> GatewaySummarySnapshot | None:
        async with self._lock:
            return self._snapshot


class SessionOverviewSnapshotService:
    def __init__(self) -> None:
        self._snapshot: SessionOverviewSnapshot | None = None
        self._lock = asyncio.Lock()

    async def update(
        self,
        sessions: list[SessionRecord],
        *,
        source_version: str,
        degraded: bool = False,
    ) -> SessionOverviewSnapshot:
        snapshot = SessionOverviewSnapshot(
            sessions=[session.model_copy(deep=True) for session in sessions],
            generated_at=datetime.now(UTC),
            source_version=source_version,
            degraded=degraded,
        )
        async with self._lock:
            self._snapshot = snapshot
        return snapshot

    async def get_snapshot(self) -> SessionOverviewSnapshot | None:
        async with self._lock:
            return self._snapshot
