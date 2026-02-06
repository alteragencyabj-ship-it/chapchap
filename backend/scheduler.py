"""
Scheduler -- Delayed notification system using asyncio
=======================================================
Schedules future notifications (e.g., 2h artisan reminder, 24h confirm reminder).
In-process only (no external queue needed at this scale).
"""

import asyncio
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# Registry of scheduled tasks: key -> asyncio.Task
_scheduled: Dict[str, asyncio.Task] = {}


async def schedule_notification(
    key: str,
    delay_seconds: int,
    notif_type: str,
    recipient_id: str,
    data: Optional[Dict[str, Any]] = None,
    template_vars: Optional[Dict[str, Any]] = None,
) -> None:
    """Schedule a notification to be sent after a delay.

    The `key` uniquely identifies this scheduled item so it can be cancelled.
    If a task with the same key already exists, it is replaced.
    """
    # Cancel existing task with same key
    await cancel_scheduled(key)

    async def _delayed_send():
        try:
            await asyncio.sleep(delay_seconds)
            from notification_service import send_notification
            await send_notification(
                recipient_id=recipient_id,
                notif_type=notif_type,
                data=data,
                template_vars=template_vars,
            )
            logger.info(f"Scheduled notification '{key}' sent to {recipient_id}")
        except asyncio.CancelledError:
            logger.debug(f"Scheduled notification '{key}' was cancelled")
        except Exception:
            logger.exception(f"Scheduled notification '{key}' failed")
        finally:
            _scheduled.pop(key, None)

    task = asyncio.create_task(_delayed_send())
    _scheduled[key] = task
    logger.info(f"Scheduled notification '{key}' in {delay_seconds}s for {recipient_id}")


async def cancel_scheduled(key: str) -> bool:
    """Cancel a scheduled notification by key. Returns True if it existed."""
    task = _scheduled.pop(key, None)
    if task and not task.done():
        task.cancel()
        logger.info(f"Cancelled scheduled notification '{key}'")
        return True
    return False


async def cancel_all_for_request(request_id: str) -> int:
    """Cancel all scheduled notifications related to a request_id."""
    keys_to_cancel = [k for k in _scheduled if request_id in k]
    count = 0
    for key in keys_to_cancel:
        if await cancel_scheduled(key):
            count += 1
    return count


def get_scheduled_keys() -> list:
    """Return list of currently scheduled notification keys (for debugging)."""
    return list(_scheduled.keys())
