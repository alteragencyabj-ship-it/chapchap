import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../config/constants';

let socket: Socket | null = null;
let _token: string | null = null;
let _authenticated = false;

export type SocketConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated';
type ConnectionListener = (state: SocketConnectionState) => void;
const _connectionListeners = new Set<ConnectionListener>();
let _connectionState: SocketConnectionState = 'disconnected';

function _setConnectionState(state: SocketConnectionState) {
  _connectionState = state;
  _connectionListeners.forEach((fn) => { try { fn(state); } catch {} });
}

export const onConnectionStateChange = (listener: ConnectionListener) => {
  _connectionListeners.add(listener);
  // Immediately notify current state
  try { listener(_connectionState); } catch {}
  return () => { _connectionListeners.delete(listener); };
};

export const getConnectionState = () => _connectionState;

export const connectSocket = (userId: string, token: string) => {
  _token = token;

  if (socket?.connected) {
    // Re-authenticate if token changed but socket already connected
    if (!_authenticated) {
      socket.emit('authenticate', { token: _token });
    }
    return socket;
  }

  // If socket exists but is disconnected, clean up before creating new one
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  _authenticated = false;
  _setConnectionState('connecting');

  socket = io(API_BASE_URL, {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    autoConnect: true,
    auth: { token },
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket?.id);
    _setConnectionState('connected');
    _authenticated = false;
    // Authenticate with JWT token on every (re)connect
    if (_token) {
      socket?.emit('authenticate', { token: _token });
    }
  });

  socket.on('auth_response', (data: any) => {
    if (data?.status === 'authenticated') {
      _authenticated = true;
      _setConnectionState('authenticated');
      console.log('[Socket] Authenticated');
    }
  });

  socket.on('disconnect', (reason: string) => {
    console.log('[Socket] Disconnected:', reason);
    _authenticated = false;
    _setConnectionState('disconnected');
  });

  socket.on('connect_error', (error: any) => {
    console.warn('[Socket] Connection error:', error?.message || error);
    _setConnectionState('disconnected');
  });

  socket.on('error', (error: any) => {
    console.error('[Socket] Error:', error);
  });

  // Re-authenticate on reconnect
  socket.io.on('reconnect', () => {
    console.log('[Socket] Reconnected');
    _authenticated = false;
    if (_token) {
      socket?.emit('authenticate', { token: _token });
    }
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  _token = null;
  _authenticated = false;
  _setConnectionState('disconnected');
};

export const getSocket = () => socket;

export const isSocketAuthenticated = () => _authenticated;
