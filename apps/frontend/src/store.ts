import { create } from 'zustand';
import { MsgType } from '@scraw/shared';

interface DrawState {
  ws: WebSocket | null;
  roomId: string;
  playerId: string;
  sessionId: number;  // increments on every new connection; triggers canvas reset
  connect: (roomId: string) => void;
  sendBatch: (msg: any[]) => void;
  remoteStrokesQueue: any[];
}

export const useStore = create<DrawState>((set, get) => ({
  ws: null,
  roomId: '',
  playerId: '',
  sessionId: 0,
  remoteStrokesQueue: [],
  connect: (roomId) => {
    const existing = get().ws;
    if (existing) {
        if (get().roomId === roomId && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
            console.log("Already connected/connecting to this room");
            return;
        }
        console.log("Closing existing connection to switch rooms...");
        existing.close();
    }

    console.log(`Connecting to Gateway for room: ${roomId}...`);
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8080';
    const ws = new WebSocket(wsUrl);
    
    // Generate persistent playerId for this session
    const playerId = 'player_' + Math.random().toString(36).substr(2, 9);
    
    ws.onopen = () => {
        console.log("WS Connected!");
        ws.send(JSON.stringify([MsgType.JOIN_ROOM, roomId, playerId]));
    };
    
    ws.onerror = (e) => console.error("WS Socket Error:", e);
    
    ws.onclose = (e) => {
      console.log("WS Closed:", e.code, e.reason);
      // Auto-reconnect on unexpected close (not normal closure or going away)
      if (e.code !== 1000 && e.code !== 1001) {
        console.log("Attempting to reconnect in 2 seconds...");
        setTimeout(() => {
          const currentRoomId = get().roomId;
          if (currentRoomId) {
            connect(currentRoomId);
          }
        }, 2000);
      }
    };
    
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (!Array.isArray(msg) || typeof msg[0] !== 'number') {
        console.error('[FRONTEND] Invalid message format:', msg);
        return;
      }
      const type = msg[0];

      if (type === MsgType.SYNC) {
        // history is an array of complete STROKE messages
        const history = msg[1] as any[][];
        console.log('SYNC history:', history.length, 'strokes');
        get().remoteStrokesQueue.push(...history);

      } else if (type === MsgType.STROKE) {
        // Live broadcast of a committed stroke — filter own strokes
        const strokePlayerId = msg[msg.length - 1];
        if (strokePlayerId !== playerId) {
          get().remoteStrokesQueue.push(msg);
        }
      }
      // Ignore legacy DRAW_START / DRAW_MOVE / DRAW_END
    };
    
    set({ ws, roomId, playerId, remoteStrokesQueue: [], sessionId: get().sessionId + 1 });
  },
  sendBatch: (msg) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}));
