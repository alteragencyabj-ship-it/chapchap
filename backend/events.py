"""
Event Bus -- In-process async event system for ChapChap
========================================================
Decouples business logic: state machine emits events,
handlers react (notifications, conversations, credits, etc.)
"""

import asyncio
import logging
from typing import Callable, Dict, List, Any

logger = logging.getLogger(__name__)

# Registry: event_name -> list of async handler callables
_handlers: Dict[str, List[Callable]] = {}


def on(event_name: str):
    """Decorator to register an async handler for an event.

    Usage:
        @on("request.accepted")
        async def handle_accepted(request_id: str, artisan_id: str, **kwargs):
            ...
    """

    def decorator(func: Callable) -> Callable:
        if event_name not in _handlers:
            _handlers[event_name] = []
        _handlers[event_name].append(func)
        logger.info(f"Event handler registered: {event_name} -> {func.__name__}")
        return func

    return decorator


async def emit(event_name: str, **kwargs: Any) -> None:
    """Emit an event, running all registered handlers concurrently.

    Handlers that raise exceptions are logged but do NOT block other handlers
    or the caller.
    """
    handlers = _handlers.get(event_name, [])
    if not handlers:
        logger.debug(f"Event '{event_name}' emitted with no handlers")
        return

    logger.info(f"Event '{event_name}' emitted -> {len(handlers)} handler(s)")

    async def _safe_run(handler: Callable):
        try:
            await handler(**kwargs)
        except Exception:
            logger.exception(f"Handler {handler.__name__} failed for event '{event_name}'")

    await asyncio.gather(*[_safe_run(h) for h in handlers])


def clear_handlers() -> None:
    """Remove all handlers (useful for testing)."""
    _handlers.clear()


def list_events() -> Dict[str, List[str]]:
    """Return a summary of registered events and handler names."""
    return {event: [h.__name__ for h in hs] for event, hs in _handlers.items()}
