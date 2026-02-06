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

    return Message(**msg_doc)


@router.post("/{conversation_id}/read")
async def mark_read(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark all messages in this conversation as read for the current user."""
    user = await _get_user(current_user)

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
