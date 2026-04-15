import { create } from 'zustand';
import { MsgType } from '@scraw/shared';

interface DrawState {
  ws: WebSocket | null;
  roomId: string;
  connect: (roomId: string) => void;
  sendBatch: (msg: any[]) => void;
  remoteStrokesQueue: any[];
}

export const useStore = create<DrawState>((set, get) => ({
  ws: null,
  roomId: '',
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
    
    ws.onopen = () => {
        console.log("WS Connected!");
        ws.send(JSON.stringify([MsgType.JOIN_ROOM, roomId, 'player_' + Math.floor(Math.random()*1000)]));
    };
    
    ws.onerror = (e) => console.error("WS Socket Error:", e);
    
    ws.onclose = (e) => console.log("WS Closed:", e.code, e.reason);
    
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const type = msg[0];
      
      if (type === MsgType.SYNC) {
          const history = msg[1] as any[][];
          get().remoteStrokesQueue.push(...history);
      } else if (type >= MsgType.DRAW_START && type <= MsgType.DRAW_END) {
        get().remoteStrokesQueue.push(msg);
      }
    };
    
    set({ ws, roomId, remoteStrokesQueue: [] });
  },
  sendBatch: (msg) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}));
