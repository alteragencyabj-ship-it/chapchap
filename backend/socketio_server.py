import socketio
import os
from typing import Dict, Set
from datetime import datetime
from bson import ObjectId

# Create Socket.IO server with ASGI mode for FastAPI compatibility
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins="*",
    ping_interval=25,
    ping_timeout=10,
    logger=True,
    engineio_logger=True
)

# Track connected users: user_id -> set of socket_ids
connected_users: Dict[str, Set[str]] = {}
user_sockets: Dict[str, str] = {}  # socket_id -> user_id

@sio.event
async def connect(sid, environ):
    """Handle client connection"""
    print(f"✅ Socket.IO: Client {sid} connected")
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
        print(f"❌ Socket.IO: User {user_id} disconnected")
    else:
        print(f"❌ Socket.IO: Client {sid} disconnected")

@sio.event
async def authenticate(sid, data):
    """Authenticate user and track connection"""
    user_id = data.get("user_id")
    if user_id:
        if user_id not in connected_users:
            connected_users[user_id] = set()
        connected_users[user_id].add(sid)
        user_sockets[sid] = user_id
        await sio.emit("auth_response", {"status": "authenticated", "user_id": user_id}, to=sid)
        print(f"✅ Socket.IO: User {user_id} authenticated with socket {sid}")
    else:
        await sio.emit("error", {"message": "Missing user_id"}, to=sid)

@sio.event
async def send_message(sid, data):
    """Handle incoming message"""
    import database as db_module
    
    sender_id = user_sockets.get(sid)
    if not sender_id:
        await sio.emit("error", {"message": "Not authenticated"}, to=sid)
        return
    
    receiver_id = data.get("receiver_id")
    request_id = data.get("request_id")
    content = data.get("message")
    
    if not receiver_id or not content:
        await sio.emit("error", {"message": "Missing receiver_id or message"}, to=sid)
        return
    
    # Save message to MongoDB
    message_doc = {
        "request_id": request_id,
        "sender_id": sender_id,
        "receiver_id": receiver_id,
        "message": content,
        "timestamp": datetime.utcnow(),
        "read": False
    }
    
    result = await db.messages.insert_one(message_doc)
    message_doc["_id"] = str(result.inserted_id)
    message_doc["timestamp"] = message_doc["timestamp"].isoformat()
    
    # Emit to receiver if connected
    if receiver_id in connected_users:
        for receiver_sid in connected_users[receiver_id]:
            await sio.emit("receive_message", message_doc, to=receiver_sid)
    
    # Confirm to sender
    await sio.emit("message_sent", {"id": message_doc["_id"], "status": "delivered"}, to=sid)
    print(f"💬 Message from {sender_id} to {receiver_id}")

@sio.event
async def get_history(sid, data):
    """Send chat history to client"""
    from database import db
    
    user_id = user_sockets.get(sid)
    if not user_id:
        await sio.emit("error", {"message": "Not authenticated"}, to=sid)
        return
    
    other_user_id = data.get("other_user_id")
    request_id = data.get("request_id")
    
    query = {}
    if request_id:
        query["request_id"] = request_id
    
    query["$or"] = [
        {"sender_id": user_id, "receiver_id": other_user_id},
        {"sender_id": other_user_id, "receiver_id": user_id}
    ]
    
    messages = []
    async for msg in db.messages.find(query).sort("timestamp", 1).limit(100):
        msg["_id"] = str(msg["_id"])
        msg["timestamp"] = msg["timestamp"].isoformat()
        messages.append(msg)
    
    await sio.emit("chat_history", {"messages": messages}, to=sid)
    print(f"📚 Sent {len(messages)} messages to {user_id}")

@sio.event
async def mark_read(sid, data):
    """Mark messages as read"""
    from database import db
    
    user_id = user_sockets.get(sid)
    if not user_id:
        return
    
    message_ids = data.get("message_ids", [])
    if message_ids:
        await db.messages.update_many(
            {"_id": {"$in": [ObjectId(mid) for mid in message_ids]}, "receiver_id": user_id},
            {"$set": {"read": True}}
        )

print("[OK] Socket.IO server configured")