"""
Scheduler -- Delayed notification & timeout system with MongoDB persistence
============================================================================
Schedules future notifications and state machine timeouts.
Persists deadlines to MongoDB so they survive server restarts.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from bson import ObjectId

logger = logging.getLogger(__name__)

# Registry of in-memory scheduled tasks: key -> asyncio.Task
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


async def schedule_timeout(
    key: str,
    request_id: str,
    delay_seconds: int,
    target_status: str,
    from_status: str,
    reason: str,
) -> None:
    """Schedule a state machine timeout with DB persistence.

    Saves the deadline to MongoDB so it survives restarts.
    """
    import database as db_module

    await cancel_scheduled(key)

    fire_at = datetime.utcnow() + timedelta(seconds=delay_seconds)

    # Persist to DB
    await db_module.db.pending_timeouts.update_one(
        {"key": key},
        {"$set": {
            "key": key,
            "request_id": request_id,
            "target_status": target_status,
            "from_status": from_status,
            "reason": reason,
            "fire_at": fire_at,
            "created_at": datetime.utcnow(),
        }},
        upsert=True,
    )

    # Schedule in-memory
    _schedule_timeout_task(key, request_id, delay_seconds, target_status, from_status, reason)
    logger.info(f"Scheduled timeout '{key}' at {fire_at.isoformat()} for request {request_id}")


def _schedule_timeout_task(
    key: str,
    request_id: str,
    delay_seconds: int,
    target_status: str,
    from_status: str,
    reason: str,
) -> None:
    """Create the in-memory asyncio task for a timeout."""

    async def _execute_timeout():
        import database as db_module
        try:
            await asyncio.sleep(max(0, delay_seconds))

            # Re-check current status
            current = await db_module.db.service_requests.find_one(
                {"_id": ObjectId(request_id)}, {"status": 1}
            )
            if not current:
                return

            from state_machine import normalize_status, RequestStatus, transition
            current_s = normalize_status(current["status"])
            expected_s = normalize_status(from_status)
            if current_s != expected_s:
                return  # Already moved on

            target_s = normalize_status(target_status)
            await transition(
                request_id=request_id,
                new_status=target_s,
                actor_id="system",
                actor_role="system",
                reason=reason,
            )
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception(f"Timeout transition failed for request {request_id}")
        finally:
            _scheduled.pop(key, None)
            # Clean up DB record
            try:
                await db_module.db.pending_timeouts.delete_one({"key": key})
            except Exception:
                pass

    task = asyncio.create_task(_execute_timeout())
    _scheduled[key] = task


async def restore_timeouts_on_startup() -> int:
    """Called at server startup to restore pending timeouts from DB.

    Returns the number of restored timeouts.
    """
    import database as db_module

    now = datetime.utcnow()
    count = 0

    async for timeout in db_module.db.pending_timeouts.find():
        key = timeout["key"]
        fire_at = timeout["fire_at"]
        remaining = (fire_at - now).total_seconds()

        if remaining <= 0:
            # Overdue: fire immediately (0 delay)
            remaining = 0

        _schedule_timeout_task(
            key=key,
            request_id=timeout["request_id"],
            delay_seconds=remaining,
            target_status=timeout["target_status"],
            from_status=timeout["from_status"],
            reason=timeout["reason"],
        )
        count += 1
        logger.info(f"Restored timeout '{key}' (fires in {remaining:.0f}s)")

    if count:
        logger.info(f"Restored {count} pending timeouts from database")
    return count


async def cancel_scheduled(key: str) -> bool:
    """Cancel a scheduled notification/timeout by key. Returns True if it existed."""
    import database as db_module

    task = _scheduled.pop(key, None)
    cancelled = False
    if task and not task.done():
        task.cancel()
        cancelled = True

    # Also remove from DB
    try:
        result = await db_module.db.pending_timeouts.delete_one({"key": key})
        if result.deleted_count > 0:
            cancelled = True
    except Exception:
        pass

    if cancelled:
        logger.info(f"Cancelled scheduled '{key}'")
    return cancelled


async def cancel_all_for_request(request_id: str) -> int:
    """Cancel all scheduled notifications/timeouts related to a request_id."""
    import database as db_module

    keys_to_cancel = [k for k in _scheduled if request_id in k]
    count = 0
    for key in keys_to_cancel:
        task = _scheduled.pop(key, None)
        if task and not task.done():
            task.cancel()
            count += 1

    # Also clean DB
    try:
        result = await db_module.db.pending_timeouts.delete_many({"request_id": request_id})
        count = max(count, result.deleted_count)
    except Exception:
        pass

    return count


def get_scheduled_keys() -> list:
    """Return list of currently scheduled keys (for debugging)."""
    return list(_scheduled.keys())
