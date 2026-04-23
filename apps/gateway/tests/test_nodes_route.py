from __future__ import annotations

from datetime import UTC, datetime
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException

from app.api.routes.nodes import (
    _dispatch_task_queue_age_ms,
    _summarize_task_stream_event,
    download_node_media,
    stream_node_tasks,
)
from app.services.node_stream import NodeStreamReceiveResult
from app.models.node import NodeStatus
from app.models.node import NodeRecord
from app.services.node_inventory import build_node_inventory
from app.services.wechat_media_store import WeChatMediaNotFoundError


def build_node(
    node_id: str,
    *,
    status: NodeStatus = NodeStatus.HEALTHY,
    lan_ip: str | None = None,
    hostname: str | None = None,
) -> NodeRecord:
    now = datetime.now(UTC)
    return NodeRecord(
        node_id=node_id,
        base_url=f"worker://{node_id}",
        advertised_address=lan_ip,
        lan_ip=lan_ip,
        max_concurrency=1,
        current_load=0,
        status=status,
        last_heartbeat_at=now,
        updated_at=now,
        hostname=hostname,
        channel_capacity=12,
        channel_in_use=0,
    )


class NodeInventoryTests(unittest.TestCase):
    def test_inventory_includes_online_and_paired_offline_nodes(self) -> None:
        inventory = build_node_inventory(
            [build_node("node-online", lan_ip="192.168.0.4", hostname="NODE-ONLINE")],
            {"node-online": "token-1", "node-offline": "token-2"},
            "",
        )

        self.assertEqual([item.node_id for item in inventory], ["node-online", "node-offline"])
        self.assertTrue(inventory[0].online)
        self.assertEqual(inventory[0].connection_state, "connected")
        self.assertFalse(inventory[1].online)
        self.assertEqual(inventory[1].connection_state, "paired_offline")

    def test_inventory_keeps_online_unpaired_nodes(self) -> None:
        inventory = build_node_inventory(
            [build_node("node-transient", lan_ip="192.168.0.7")],
            {},
            "",
        )

        self.assertEqual(len(inventory), 1)
        self.assertFalse(inventory[0].paired)
        self.assertTrue(inventory[0].online)
        self.assertEqual(inventory[0].connection_state, "online_unpaired")

    def test_inventory_deduplicates_online_and_paired_entry_by_node_id(self) -> None:
        inventory = build_node_inventory(
            [build_node("node-a", lan_ip="192.168.0.8")],
            {"node-a": "token-a"},
            "",
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].node_id, "node-a")
        self.assertTrue(inventory[0].paired)
        self.assertTrue(inventory[0].online)

    def test_inventory_marks_pairing_pending_from_diagnostics(self) -> None:
        inventory = build_node_inventory(
            [],
            {"node-a": "token-a"},
            "",
            {"node-a": {"connection_state": "pairing_pending", "last_error": "等待注册确认"}},
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].connection_state, "pairing_pending")
        self.assertEqual(inventory[0].last_error, "等待注册确认")

    def test_inventory_marks_register_failure_from_diagnostics(self) -> None:
        inventory = build_node_inventory(
            [],
            {"node-a": "token-a"},
            "",
            {"node-a": {"connection_state": "register_failed", "last_error": "register returned 500"}},
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].connection_state, "register_failed")
        self.assertEqual(inventory[0].last_error, "register returned 500")

    def test_inventory_marks_auth_failure_from_diagnostics(self) -> None:
        inventory = build_node_inventory(
            [],
            {"node-a": "token-a"},
            "",
            {"node-a": {"connection_state": "auth_failed", "last_error": "401 Unauthorized"}},
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].connection_state, "auth_failed")
        self.assertEqual(inventory[0].last_error, "401 Unauthorized")

    def test_inventory_preserves_waiting_pair_state_from_diagnostics(self) -> None:
        inventory = build_node_inventory(
            [],
            {"node-a": "token-a"},
            "",
            {"node-a": {"connection_state": "waiting_pair", "last_error": "等待配对"}},
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].connection_state, "waiting_pair")
        self.assertEqual(inventory[0].last_error, "等待配对")

    def test_inventory_preserves_needs_repair_state_from_diagnostics(self) -> None:
        inventory = build_node_inventory(
            [],
            {"node-a": "token-a"},
            "",
            {"node-a": {"connection_state": "needs_repair", "last_error": "推理后端未配置"}},
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].connection_state, "needs_repair")
        self.assertEqual(inventory[0].last_error, "推理后端未配置")


class NodeTaskStreamEventSummaryTests(unittest.TestCase):
    def test_event_summary_includes_type_task_and_session(self) -> None:
        self.assertEqual(
            _summarize_task_stream_event(
                {
                    "type": "task_result",
                    "task_id": "task-1",
                    "session_id": "session-1",
                    "content": "hello",
                }
            ),
            "type=task_result task_id=task-1 session_id=session-1 keys=content,session_id,task_id,type",
        )

    def test_event_summary_handles_missing_fields(self) -> None:
        self.assertEqual(
            _summarize_task_stream_event({"foo": "bar"}),
            "type=<missing> task_id=- session_id=- keys=foo",
        )


class NodeTaskQueueAgeTests(unittest.TestCase):
    def test_queue_age_is_non_negative_for_utc_timestamp(self) -> None:
        age_ms = _dispatch_task_queue_age_ms(datetime.now(UTC))

        self.assertIsNotNone(age_ms)
        assert age_ms is not None
        self.assertGreaterEqual(age_ms, 0)

    def test_queue_age_accepts_naive_datetime(self) -> None:
        age_ms = _dispatch_task_queue_age_ms(datetime.now().replace(microsecond=0))

        self.assertIsNotNone(age_ms)
        assert age_ms is not None
        self.assertGreaterEqual(age_ms, 0)


class NodeMediaRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_download_node_media_returns_file_response(self) -> None:
        request = SimpleNamespace(
            headers={},
            client=None,
            url=SimpleNamespace(path="/api/nodes/node-1/media/wm_1"),
        )
        store = SimpleNamespace(ping=AsyncMock(return_value=True))
        node_auth = SimpleNamespace(verify_request=MagicMock())
        media_store = SimpleNamespace(
            open=MagicMock(
                return_value=(
                    SimpleNamespace(mime_type="image/png", filename="sample.png"),
                    "D:/wechat-claw-hub/runtime/wechat-media/files/wm_1.png",
                )
            )
        )

        response = await download_node_media(
            request=request,
            node_id="node-1",
            media_id="wm_1",
            store=store,
            node_auth=node_auth,
            media_store=media_store,
        )

        self.assertEqual(response.media_type, "image/png")
        self.assertIn('filename="sample.png"', response.headers.get("content-disposition", ""))
        node_auth.verify_request.assert_called_once_with(request, "node-1")

    async def test_download_node_media_returns_404_for_missing_media(self) -> None:
        request = SimpleNamespace(
            headers={},
            client=None,
            url=SimpleNamespace(path="/api/nodes/node-1/media/wm_missing"),
        )
        store = SimpleNamespace(ping=AsyncMock(return_value=True))
        node_auth = SimpleNamespace(verify_request=MagicMock())
        media_store = SimpleNamespace(open=MagicMock(side_effect=WeChatMediaNotFoundError("missing")))

        with self.assertRaises(HTTPException) as ctx:
            await download_node_media(
                request=request,
                node_id="node-1",
                media_id="wm_missing",
                store=store,
                node_auth=node_auth,
                media_store=media_store,
            )

        self.assertEqual(ctx.exception.status_code, 404)


class NodeTaskStreamRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_node_tasks_rejects_legacy_ready_protocol(self) -> None:
        setup_service = SimpleNamespace(
            record_task_stream_connected=MagicMock(),
            record_task_stream_disconnected=MagicMock(),
            record_task_stream_receive_failure=MagicMock(),
            record_task_stream_event=MagicMock(),
            record_task_stream_legacy_protocol_rejected=MagicMock(),
            ingest_node_diagnostics_event=MagicMock(),
        )
        websocket = SimpleNamespace(
            headers={},
            app=SimpleNamespace(
                state=SimpleNamespace(
                    redis_store=SimpleNamespace(ping=AsyncMock(return_value=True)),
                    dispatch_queue=SimpleNamespace(pull_for_node=AsyncMock()),
                    node_auth=SimpleNamespace(verify_websocket=MagicMock()),
                    node_stream=SimpleNamespace(
                        register_connection=AsyncMock(),
                        unregister_connection=AsyncMock(),
                        receive_event=AsyncMock(
                            side_effect=[
                                NodeStreamReceiveResult(
                                    kind="event",
                                    event={"type": "ready"},
                                    metrics={"read_ms": 0.0, "decode_ms": 0.0, "message_chars": 16},
                                ),
                                NodeStreamReceiveResult(kind="closed"),
                            ]
                        ),
                        inflight_count=MagicMock(return_value=0),
                        mark_task_finished=MagicMock(),
                    ),
                    setup_service=setup_service,
                    gateway_summary_service=SimpleNamespace(publish_if_needed=AsyncMock()),
                )
            ),
            accept=AsyncMock(),
            close=AsyncMock(),
            send_json=AsyncMock(),
        )

        await stream_node_tasks(websocket, "node-1")

        websocket.app.state.dispatch_queue.pull_for_node.assert_not_awaited()
        websocket.close.assert_awaited_once_with(code=4409, reason="legacy_protocol_rejected")
        setup_service.record_task_stream_legacy_protocol_rejected.assert_called_once()

    async def test_stream_node_tasks_ingests_batched_diagnostics(self) -> None:
        diagnostics_payload = {
            "count": 2,
            "events": [
                {"category": "task", "result": "started", "message": "任务开始", "trace_id": "trace-1"},
                {"category": "task", "result": "completed", "message": "任务完成", "trace_id": "trace-1"},
            ],
            "snapshot": {"node_id": "node-1", "node_kind": "remote"},
        }
        setup_service = SimpleNamespace(
            record_task_stream_connected=MagicMock(),
            record_task_stream_disconnected=MagicMock(),
            record_task_stream_receive_failure=MagicMock(),
            record_task_stream_event=MagicMock(),
            record_task_stream_legacy_protocol_rejected=MagicMock(),
            ingest_node_diagnostics_event=MagicMock(),
        )
        websocket = SimpleNamespace(
            headers={"x-task-stream-protocol": "task-stream-v2"},
            app=SimpleNamespace(
                state=SimpleNamespace(
                    redis_store=SimpleNamespace(ping=AsyncMock(return_value=True)),
                    dispatch_queue=SimpleNamespace(),
                    node_auth=SimpleNamespace(verify_websocket=MagicMock()),
                    node_stream=SimpleNamespace(
                        register_connection=AsyncMock(),
                        unregister_connection=AsyncMock(),
                        receive_event=AsyncMock(
                            side_effect=[
                                NodeStreamReceiveResult(
                                    kind="event",
                                    event={"type": "diagnostics", "diagnostics": diagnostics_payload},
                                    metrics={"read_ms": 0.0, "decode_ms": 0.0, "message_chars": 64},
                                ),
                                NodeStreamReceiveResult(kind="closed"),
                            ]
                        ),
                        inflight_count=MagicMock(return_value=0),
                        mark_task_finished=MagicMock(),
                    ),
                    setup_service=setup_service,
                    gateway_summary_service=SimpleNamespace(publish_if_needed=AsyncMock()),
                )
            ),
            accept=AsyncMock(),
            close=AsyncMock(),
            send_json=AsyncMock(),
        )

        await stream_node_tasks(websocket, "node-1")

        setup_service.ingest_node_diagnostics_event.assert_called_once_with("node-1", diagnostics_payload)
        websocket.send_json.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
