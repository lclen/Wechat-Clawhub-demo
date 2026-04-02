from __future__ import annotations

import asyncio
import logging
import sys

from claw_node.config import get_settings
from claw_node.worker import Worker


def configure_logging() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


async def _main() -> None:
    settings = get_settings()
    worker = Worker(settings)
    await worker.run()


def main() -> None:
    configure_logging()
    asyncio.run(_main())


if __name__ == "__main__":
    main()
