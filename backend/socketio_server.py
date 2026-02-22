import socketio
import os
import jwt
from typing import Dict, Set
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from bson import ObjectId

# Load env for CORS config
_root = Path(__file__).parent
load_dotenv(_root / '.env')

_origins_raw = os.getenv("ALLOWED_ORIGINS", "*")
_env = os.getenv("ENVIRONMENT", "development").lower()
_sio_cors = [o.strip() for o in _origins_raw.split(",") if o.strip()] if _origins_raw != "*" else "*"
if _env == "development":
    # Expo/Metro origins change often (LAN/tunnel/ports). Keep Socket.IO permissive in local dev.
    _sio_cors = "*"

# JWT config — must match auth.py
JWT_SECRET = os.getenv("JWT_SECRET") or os.getenv("JWT_SECRET_KEY") or "your-super-secret-jwt-key"
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# Create Socket.IO server with ASGI mode for FastAPI compatibility
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=_sio_cors,
    ping_interval=25,
    ping_timeout=10,
    logger=True,
    engineio_logger=True
)

# Track connected users: user_id -> set of socket_ids
connected_users: Dict[str, Set[str]] = {}
user_sockets: Dict[str, str] = {}  # socket_id -> user_id


def _verify_token(token: str) -> dict | None:
    """Verify JWT token and return payload, or None on failure."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


@sio.event
async def connect(sid, environ, auth=None):
    """Handle client connection (supports optional Socket.IO auth payload)."""
    print(f"Socket.IO: Client {sid} connected (pending auth)")

    # Socket.IO v4 client may send auth payload at connect-time.
    token = None
    if isinstance(auth, dict):
        token = auth.get("token")

    payload = _verify_token(token) if token else None
    if payload and "sub" in payload:
        user_id = payload["sub"]
        if user_id not in connected_users:
            connected_users[user_id] = set()
        connected_users[user_id].add(sid)
        user_sockets[sid] = user_id
        await sio.emit("auth_response", {"status": "authenticated", "user_id": user_id}, to=sid)
        await sio.emit("connection_status", {"status": "authenticated"}, to=sid)
        print(f"Socket.IO: User {user_id} auto-authenticated with socket {sid}")
        return

    await sio.emit("connection_status", {"status": "connected"}, to=sid)


@sio.event
async def disconnect(sid):
    """Handle client disconnection"""
    if sid in user_sockets:
        user_id = user_sockets.pop(sid)
        if user_id in connected_users:
            connected_users[user_id].discard(sid)
            if not connected_users[user_id]:
                del connected_users[user_id]
        print(f"Socket.IO: User {user_id} disconnected")
    else:
        print(f"Socket.IO: Client {sid} disconnected")


@sio.event
async def authenticate(sid, data):
    """Authenticate user via JWT token and track connection."""
    token = data.get("token")
    if not token:
        await sio.emit("error", {"message": "Missing token"}, to=sid)
        return

    payload = _verify_token(token)
    if not payload or "sub" not in payload:
        await sio.emit("error", {"message": "Invalid or expired token"}, to=sid)
        return

    user_id = payload["sub"]
    if user_id not in connected_users:
        connected_users[user_id] = set()
    connected_users[user_id].add(sid)
    user_sockets[sid] = user_id
    await sio.emit("auth_response", {"status": "authenticated", "user_id": user_id}, to=sid)
    print(f"Socket.IO: User {user_id} authenticated with socket {sid}")


@sio.event
async def send_message(sid, data):
    """Handle incoming message — requires conversation_id and participant check."""
    import database as db_module

    sender_id = user_sockets.get(sid)
    if not sender_id:
        await sio.emit("error", {"message": "Not authenticated"}, to=sid)
        return

    conversation_id = data.get("conversation_id")
    content = data.get("message")

    if not conversation_id or not content:
        await sio.emit("error", {"message": "Missing conversation_id or message"}, to=sid)
        return

    # Verify sender is a participant of this conversation
    try:
        conv = await db_module.db.conversations.find_one({"_id": ObjectId(conversation_id)})
    except Exception:
        await sio.emit("error", {"message": "Invalid conversation_id"}, to=sid)
        return

    if not conv:
        await sio.emit("error", {"message": "Conversation not found"}, to=sid)
        return

    participants = conv.get("participants", [])
    if sender_id not in participants:
        await sio.emit("error", {"message": "Not a participant of this conversation"}, to=sid)
        return

    # Check chat availability via request status
    request_id = conv.get("request_id")
    if request_id:
        from state_machine import normalize_status, is_chat_available
        req = await db_module.db.service_requests.find_one(
            {"_id": ObjectId(request_id)}, {"status": 1}
        )
        if req:
            try:
                status = normalize_status(req["status"])
                if not is_chat_available(status):
                    await sio.emit("error", {"message": "Chat not available in current state"}, to=sid)
                    return
            except ValueError:
                pass

    # Derive receiver from conversation participants
    other_ids = [p for p in participants if p != sender_id]
    receiver_id = other_ids[0] if other_ids else sender_id

    now = datetime.utcnow()
    message_doc = {
        "conversation_id": conversation_id,
        "request_id": request_id,
        "sender_id": sender_id,
        "receiver_id": receiver_id,
        "message": content,
        "message_type": "user",
        "timestamp": now,
        "read": False
    }

    result = await db_module.db.messages.insert_one(message_doc)
    message_doc["_id"] = str(result.inserted_id)
    message_doc["timestamp"] = message_doc["timestamp"].isoformat()

    # Update conversation metadata
    await db_module.db.conversations.update_one(
        {"_id": ObjectId(conversation_id)},
        {
            "$set": {
                "last_message": content[:100],
                "last_message_at": now,
            },
            "$inc": {f"unread_count.{receiver_id}": 1},
        },
    )

    # Emit to receiver if connected
    if receiver_id in connected_users:
        for receiver_sid in connected_users[receiver_id]:
            await sio.emit("receive_message", message_doc, to=receiver_sid)

    # Persist + push notification for incoming message (without refresh).
    try:
        from notification_service import send_notification

        sender_user = await db_module.db.users.find_one({"_id": ObjectId(sender_id)}, {"name": 1, "email": 1})
        sender_name = (
            (sender_user or {}).get("name")
            or ((sender_user or {}).get("email") or "Utilisateur").split("@")[0]
        )

        await send_notification(
            recipient_id=receiver_id,
            notif_type="new_message",
            data={
                "conversation_id": conversation_id,
                "request_id": request_id,
            },
            template_vars={
                "sender_name": sender_name,
                "preview": str(content)[:80],
            },
        )
    except Exception:
        # Never block chat delivery if notification delivery fails.
        pass

    # Confirm to sender (do NOT echo back via receive_message to avoid duplicates)
    await sio.emit("message_sent", {"id": message_doc["_id"], "status": "delivered"}, to=sid)
    print(f"Message from {sender_id} to {receiver_id} in conv {conversation_id}")


@sio.event
async def get_history(sid, data):
    """Send chat history — scoped to a conversation the user participates in."""
    import database as db_module

    user_id = user_sockets.get(sid)
    if not user_id:
        await sio.emit("error", {"message": "Not authenticated"}, to=sid)
        return

    conversation_id = data.get("conversation_id")
    if not conversation_id:
        await sio.emit("error", {"message": "Missing conversation_id"}, to=sid)
        return

    # Verify participation
    try:
        conv = await db_module.db.conversations.find_one({"_id": ObjectId(conversation_id)})
    except Exception:
        await sio.emit("error", {"message": "Invalid conversation_id"}, to=sid)
        return

    if not conv or user_id not in conv.get("participants", []):
        await sio.emit("error", {"message": "Not a participant"}, to=sid)
        return

    messages = []
    async for msg in db_module.db.messages.find(
        {"conversation_id": conversation_id}
    ).sort("timestamp", 1).limit(100):
        msg["_id"] = str(msg["_id"])
        msg["timestamp"] = msg["timestamp"].isoformat()
        messages.append(msg)

    await sio.emit("chat_history", {"messages": messages}, to=sid)
    print(f"Sent {len(messages)} messages to {user_id}")


@sio.event
async def mark_read(sid, data):
    """Mark messages as read"""
    import database as db_module

    user_id = user_sockets.get(sid)
    if not user_id:
        return

    message_ids = data.get("message_ids", [])
    if message_ids:
        await db_module.db.messages.update_many(
            {"_id": {"$in": [ObjectId(mid) for mid in message_ids]}, "receiver_id": user_id},
            {"$set": {"read": True}}
        )


async def emit_to_user(user_id: str | None, event_name: str, payload: dict) -> None:
    """Emit an event to every active socket of a user."""
    if not user_id:
        return
    for sid in connected_users.get(user_id, set()):
        await sio.emit(event_name, payload, to=sid)


async def emit_mission_update(client_id: str | None, artisan_id: str | None, payload: dict) -> None:
    """Emit a mission update to both mission participants for global sync."""
    if client_id:
        await emit_to_user(client_id, "mission_update", payload)
    if artisan_id and artisan_id != client_id:
        await emit_to_user(artisan_id, "mission_update", payload)


async def emit_wallet_update(client_id: str | None, artisan_id: str | None, payload: dict) -> None:
    """Emit wallet/accounting updates to both mission participants."""
    if client_id:
        await emit_to_user(client_id, "wallet_update", payload)
    if artisan_id and artisan_id != client_id:
        await emit_to_user(artisan_id, "wallet_update", payload)

print("[OK] Socket.IO server configured")
