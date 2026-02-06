"""
Health check routes.

GET /api/health          -- Liveness probe
GET /api/health/db       -- MongoDB connectivity
GET /api/health/version  -- Build info (git SHA, environment)
"""

from __future__ import annotations

import os
import subprocess
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

import database as db_module

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/health", tags=["health"])

_cached_git_sha: str | None = None


def _get_git_sha() -> str:
    global _cached_git_sha
    if _cached_git_sha is not None:
        return _cached_git_sha
    try:
        sha = (
            subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=str(Path(__file__).resolve().parents[2]),
                stderr=subprocess.DEVNULL,
            )
            .decode()
            .strip()
        )
        _cached_git_sha = sha
    except Exception:
        _cached_git_sha = "unknown"
    return _cached_git_sha


@router.get("", operation_id="health_liveness")
async def health_liveness():
    """Liveness probe."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@router.get("/db")
async def health_db():
    """Check MongoDB connectivity."""
    try:
        result = await db_module.db.command("ping")
        return {
            "status": "healthy",
            "mongo": "connected",
            "ping": result,
        }
    except Exception as e:
        logger.error(f"MongoDB health check failed: {e}")
        raise HTTPException(status_code=503, detail="Database unreachable")


@router.get("/version")
async def health_version():
    """Build and version info."""
    return {
        "version": "1.0.0",
        "git_sha": _get_git_sha(),
        "environment": os.getenv("ENVIRONMENT", "development"),
        "python_socketio": True,
        "payment_provider": os.getenv("PAYMENT_PROVIDER", "mock"),
    }
