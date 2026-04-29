"""Regression test: events.broadcaster must be thread-safe.

Reviewer flagged that asyncio.Queue.put_nowait is unsafe across threads.
We now use stdlib queue.Queue. This test stresses the path: subscribe in
main thread, publish from many worker threads, ensure no crash and all
events arrive.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone


def test_broadcaster_concurrent_publish_is_safe():
    from server.engine.events import EmittedEvent, broadcaster
    from server.utils.ids import new_id

    channel = f"run:{new_id('run')}"
    sub = broadcaster.subscribe(channel)

    n_threads = 8
    per_thread = 50
    total = n_threads * per_thread

    def emit_burst(idx: int) -> None:
        for k in range(per_thread):
            event = EmittedEvent(
                id=f"ev_{idx}_{k}",
                step_id="st_x",
                event_type="progress_note",
                visibility="summary",
                payload={"i": idx, "k": k},
                created_at=datetime.now(timezone.utc),
            )
            broadcaster.publish([channel], event)

    threads = [threading.Thread(target=emit_burst, args=(i,)) for i in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    received = []
    while not sub.empty():
        received.append(sub.get_nowait())

    broadcaster.unsubscribe(channel, sub)

    assert len(received) == total, f"expected {total}, got {len(received)}"
    assert {e.payload["i"] for e in received} == set(range(n_threads))
