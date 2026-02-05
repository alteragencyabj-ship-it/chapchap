import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../config/constants';

let socket: Socket | null = null;

export const connectSocket = (userId: string) => {
  if (socket?.connected) {
    return socket;
  }

  socket = io(API_BASE_URL, {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    autoConnect: true,
  });

  socket.on('connect', () => {
    console.log('✅ Socket connected');
    socket?.emit('authenticate', { user_id: userId });
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected');
  });

  socket.on('error', (error: any) => {
    console.error('Socket error:', error);
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = () => socket;

export const sendMessage = (receiverId: string, requestId: string, message: string) => {
  socket?.emit('send_message', {
    receiver_id: receiverId,
    request_id: requestId,
    message,
  });
};

export const getChatHistory = (otherUserId: string, requestId?: string) => {
  socket?.emit('get_history', {
    other_user_id: otherUserId,
    request_id: requestId,
  });
};