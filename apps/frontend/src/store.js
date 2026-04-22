import { create } from 'zustand';
import { MsgType } from './protocol';

export const useStore = create((set, get) => ({
  ws: null,
  roomId: '',
  playerId: '',
  sessionId: 0,
  remoteStrokesQueue: [],

  connect: (roomId) => {
    const existing = get().ws;
    if (existing) {
      if (
        get().roomId === roomId &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }
      existing.close();
    }

    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8080';
    const ws = new WebSocket(wsUrl);
    const playerId = 'player_' + Math.random().toString(36).slice(2, 11);

    ws.onopen = () => {
      ws.send(JSON.stringify([MsgType.JOIN_ROOM, roomId, playerId]));
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = (event) => {
      if (event.code !== 1000 && event.code !== 1001) {
        setTimeout(() => {
          const currentRoomId = get().roomId;
          if (currentRoomId) {
            get().connect(currentRoomId);
          }
        }, 2000);
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!Array.isArray(msg) || typeof msg[0] !== 'number') {
        return;
      }

      const type = msg[0];
      if (type === MsgType.SYNC) {
        const history = msg[1] || [];
        get().remoteStrokesQueue.push(...history);
      } else if (type === MsgType.STROKE) {
        const strokePlayerId = msg[msg.length - 1];
        if (strokePlayerId !== playerId) {
          get().remoteStrokesQueue.push(msg);
        }
      }
    };

    set({ ws, roomId, playerId, remoteStrokesQueue: [], sessionId: get().sessionId + 1 });
  },

  sendBatch: (msg) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  },
}));
