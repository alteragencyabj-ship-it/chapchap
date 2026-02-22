import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config/constants';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ---------- Token refresh lock ----------
// Prevents multiple concurrent 401 responses from each triggering a refresh/logout.
let isRefreshing = false;
let refreshSubscribers: Array<(token: string | null) => void> = [];

function onRefreshed(token: string | null) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string | null) => void) {
  refreshSubscribers.push(cb);
}

// ---------- Request interceptor ----------
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ---------- Response interceptor ----------
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Network / timeout errors
    if (!error.response) {
      if (error.code === 'ECONNABORTED') {
        const timeoutError = new Error('La requete a expire. Verifiez votre connexion.');
        (timeoutError as any).isTimeout = true;
        return Promise.reject(timeoutError);
      }
      const networkError = new Error('Erreur reseau. Verifiez votre connexion internet.');
      (networkError as any).isNetwork = true;
      return Promise.reject(networkError);
    }

    const status = error.response.status;

    // 401 — Token expired or invalid
    if (status === 401 && originalRequest && !originalRequest._retry) {
      // If we're already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          addRefreshSubscriber((newToken) => {
            if (newToken) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              resolve(api(originalRequest));
            } else {
              reject(error);
            }
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Attempt to refresh via /auth/me — if the token is still partially valid
        // the backend may return fresh user data. If it fails, we log out.
        const token = useAuthStore.getState().token;
        if (!token) {
          throw new Error('No token');
        }

        // Try refreshing the token
        const refreshRes = await axios.post(
          `${API_BASE_URL}/api/auth/refresh`,
          {},
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 10000,
          }
        );

        const newToken = refreshRes.data?.token;
        if (newToken) {
          await useAuthStore.getState().setToken(newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          onRefreshed(newToken);
          isRefreshing = false;
          return api(originalRequest);
        }

        throw new Error('No token in refresh response');
      } catch {
        // Refresh failed — logout
        onRefreshed(null);
        isRefreshing = false;
        await useAuthStore.getState().logout();
        return Promise.reject(error);
      }
    }

    // 500+ — Server error
    if (status >= 500) {
      const serverError = new Error(
        error.response.data && typeof error.response.data === 'object' && 'message' in error.response.data
          ? (error.response.data as any).message
          : 'Erreur serveur. Veuillez reessayer plus tard.'
      );
      (serverError as any).isServer = true;
      (serverError as any).status = status;
      return Promise.reject(serverError);
    }

    return Promise.reject(error);
  }
);

export default api;
