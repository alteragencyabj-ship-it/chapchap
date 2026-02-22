"""
Conversation Routes
====================
REST endpoints for conversations and messages.
Socket.IO handles real-time; these are fallback/initial-load.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from datetime import datetime
from bson import ObjectId

import database as db_module
from auth import get_current_user
from models import Conversation, Message, MessageCreate
from socketio_server import sio, connected_users

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


async def _get_user(current_user: dict) -> dict:
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["_id"] = str(user["_id"])
    return user


def _display_name(user_doc: dict | None) -> str:
    if not user_doc:
        return "Utilisateur"
    name = str(user_doc.get("name") or "").strip()
    if name:
        return name
    first = str(user_doc.get("first_name") or "").strip()
    last = str(user_doc.get("last_name") or "").strip()
    full = f"{first} {last}".strip()
    if full:
        return full
    email = str(user_doc.get("email") or "").strip()
    if email:
        return email.split("@")[0]
    return "Utilisateur"


async def _enrich_conversation_for_user(conv: dict, current_user_id: str) -> dict:
    """Attach the other participant identity for UI labels."""
    participants = [str(p) for p in conv.get("participants", [])]
    other_ids = [p for p in participants if p != current_user_id]
    other_id = other_ids[0] if other_ids else None

    other_user = None
    if other_id:
        try:
            other_user = await db_module.db.users.find_one(
                {"_id": ObjectId(other_id)},
                {"name": 1, "first_name": 1, "last_name": 1, "email": 1, "role": 1},
            )
        except Exception:
            other_user = None

    conv["other_party_id"] = other_id
    conv["other_party_name"] = _display_name(other_user)
    conv["other_party_role"] = str(other_user.get("role")) if other_user and other_user.get("role") else None
    return conv


@router.get("", response_model=List[Conversation])
async def list_conversations(
    current_user: dict = Depends(get_current_user),
):
    """Get all conversations for the current user, sorted by last message."""
    user = await _get_user(current_user)

    results = []
    async for conv in db_module.db.conversations.find(
        {"participants": user["_id"]}
    ).sort("last_message_at", -1):
        conv["_id"] = str(conv["_id"])
        conv = await _enrich_conversation_for_user(conv, user["_id"])
        results.append(Conversation(**conv))
    return results


@router.get("/{conversation_id}", response_model=Conversation)
async def get_conversation(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get conversation details."""
    user = await _get_user(current_user)

    conv = await db_module.db.conversations.find_one({"_id": ObjectId(conversation_id)})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if user["_id"] not in conv.get("participants", []) and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not a participant")

    conv["_id"] = str(conv["_id"])
    conv = await _enrich_conversation_for_user(conv, user["_id"])
    return Conversation(**conv)


@router.get("/{conversation_id}/messages", response_model=List[Message])
async def get_messages(
    conversation_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Get paginated messages for a conversation."""
    user = await _get_user(current_user)

    conv = await db_module.db.conversations.find_one({"_id": ObjectId(conversation_id)})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if user["_id"] not in conv.get("participants", []) and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not a participant")

    skip = (page - 1) * limit
    messages = []
    async for msg in db_module.db.messages.find(
        {"conversation_id": conversation_id}
    ).sort("timestamp", -1).skip(skip).limit(limit):
        msg["_id"] = str(msg["_id"])
        messages.append(Message(**msg))

    messages.reverse()  # chronological order
    return messages


@router.post("/{conversation_id}/messages", response_model=Message)
async def send_message(
    conversation_id: str,
    data: MessageCreate,
    current_user: dict = Depends(get_current_user),
):
    """Send a message in a conversation (REST fallback for Socket.IO)."""
    user = await _get_user(current_user)

    conv = await db_module.db.conversations.find_one({"_id": ObjectId(conversation_id)})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if user["_id"] not in conv.get("participants", []):
        raise HTTPException(status_code=403, detail="Not a participant")

    # Check chat availability via request status
    req_id = conv.get("request_id")
    if req_id:
        from state_machine import normalize_status, is_chat_available
        linked_req = await db_module.db.service_requests.find_one(
            {"_id": ObjectId(req_id)}, {"status": 1}
        )
        if linked_req:
            try:
                req_status = normalize_status(linked_req["status"])
                if not is_chat_available(req_status):
                    raise HTTPException(
                        status_code=403,
                        detail="Le chat n'est pas disponible dans l'etat actuel de la mission."
                    )
            except ValueError:
                pass

    # Determine receiver
    other_id = [p for p in conv["participants"] if p != user["_id"]]
    receiver_id = other_id[0] if other_id else user["_id"]

    now = datetime.utcnow()
    msg_doc = {
        "conversation_id": conversation_id,
        "request_id": conv.get("request_id"),
        "sender_id": user["_id"],
        "receiver_id": receiver_id,
        "message": data.message,
        "message_type": "user",
        "timestamp": now,
        "read": False,
    }

    result = await db_module.db.messages.insert_one(msg_doc)
    msg_doc["_id"] = str(result.inserted_id)

    # Update conversation metadata
    await db_module.db.conversations.update_one(
        {"_id": ObjectId(conversation_id)},
        {
            "$set": {
                "last_message": data.message[:100],
                "last_message_at": now,
            },
            "$inc": {f"unread_count.{receiver_id}": 1},
        },
    )

    # Push via Socket.IO if receiver online
    if receiver_id in connected_users:
        for sid in connected_users[receiver_id]:
            payload = {**msg_doc, "timestamp": now.isoformat()}
            await sio.emit("receive_message", payload, to=sid)

    # Persist + push notification for incoming message (without refresh).
    try:
        from notification_service import send_notification

        await send_notification(
            recipient_id=receiver_id,
            notif_type="new_message",
            data={
                "conversation_id": conversation_id,
                "request_id": conv.get("request_id"),
            },
            template_vars={
                "sender_name": _display_name(user),
                "preview": data.message[:80],
            },
        )
    except Exception:
        # Never block messaging if notification delivery fails.
        pass

    return Message(**msg_doc)


@router.post("/{conversation_id}/read")
async def mark_read(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark all messages in this conversation as read for the current user."""
    user = await _get_user(current_user)

    # Verify participant
    conv = await db_module.db.conversations.find_one({"_id": ObjectId(conversation_id)})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    if user["_id"] not in conv.get("participants", []) and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Non autorise")

    # Reset unread counter
    await db_module.db.conversations.update_one(
        {"_id": ObjectId(conversation_id)},
        {"$set": {f"unread_count.{user['_id']}": 0}},
    )

    # Mark messages as read
    await db_module.db.messages.update_many(
        {"conversation_id": conversation_id, "receiver_id": user["_id"], "read": False},
        {"$set": {"read": True}},
    )

    return {"message": "Marked as read"}
