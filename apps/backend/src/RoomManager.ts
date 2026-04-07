import { WebSocket } from 'ws';
import { MsgType } from '@scraw/shared';
import Redis from 'ioredis';

interface Player {
  id: string;
  ws: WebSocket;
  score: number;
}

interface RoomState {
  roomId: string;
  players: Map<string, Player>;
  currentDrawer: string | null;
  word: string | null;
  strokesBuffer: any[];
}

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  private playerRooms = new WeakMap<WebSocket, RoomState>();
  private redis: Redis | null = null;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      console.log(`[REDIS] Connecting to: ${redisUrl}`);
      this.redis = new Redis(redisUrl);
      this.redis.on('error', (err: any) => console.error('[REDIS] Connection Error:', err));
    } else {
      console.warn('[REDIS] No REDIS_URL provided. Drawings will be lost on server restart.');
    }
  }

  handleMessage(ws: WebSocket, type: number, msg: any[]) {
    switch (type) {
        case MsgType.JOIN_ROOM:
            this.joinRoom(ws, msg[1], msg[2]);
            break;
        case MsgType.DRAW_START:
        case MsgType.DRAW_MOVE:
        case MsgType.DRAW_END:
            this.broadcastDraw(ws, msg);
            break;
        case MsgType.GUESS:
            this.handleGuess(ws, msg[1]);
            break;
    }
  }

  handleDisconnect(ws: WebSocket) {
    const room = this.playerRooms.get(ws);
    if (!room) return;

    for (const [id, player] of room.players.entries()) {
      if (player.ws === ws) {
        room.players.delete(id);
        break;
      }
    }
    
    // Broadcast updated player list
    const pList = Array.from(room.players.keys());
    this.broadcastToRoom(room, [MsgType.PLAYER_LIST, pList]);

    if (room.players.size === 0) {
      console.log(`[ROOM] Room empty, cleaning up: ${room.roomId}`);
      this.rooms.delete(room.roomId);
      if (this.redis) {
          this.redis.del(`room:${room.roomId}:strokes`).catch(() => {});
      }
    }
  }

  private async joinRoom(ws: WebSocket, roomId: string, playerId: string) {
    let room = this.rooms.get(roomId);
    if (!room) {
      console.log(`[ROOM] Creating/Loading room: ${roomId}`);
      room = { roomId, players: new Map(), currentDrawer: null, word: null, strokesBuffer: [] };
      this.rooms.set(roomId, room);
      
      // Load from Redis if it's a "new" room object but data might exist
      if (this.redis) {
          const history = await this.redis.lrange(`room:${roomId}:strokes`, 0, -1);
          room.strokesBuffer = history.map(s => JSON.parse(s));
      }
    }
    
    if (room.players.size >= 10) return; // Full
    
    room.players.set(playerId, { id: playerId, ws, score: 0 });
    this.playerRooms.set(ws, room);

    // Send history as a single batch (Snapshot sync)
    if (room.strokesBuffer.length > 0) {
        console.log(`[SYNC] Sending ${room.strokesBuffer.length} strokes to player ${playerId} from Redis/Cache`);
        ws.send(JSON.stringify([MsgType.SYNC, room.strokesBuffer]));
    }

    // Broadcast new player list
    const pList = Array.from(room.players.keys());
    this.broadcastToRoom(room, [MsgType.PLAYER_LIST, pList]);
  }

  private broadcastDraw(ws: WebSocket, msg: any[]) {
    const room = this.playerRooms.get(ws);
    if (!room) return;
    
    room.strokesBuffer.push(msg);

    // Persist to Redis (Fire and forget, but handled asynchronously)
    if (this.redis) {
        this.redis.rpush(`room:${room.roomId}:strokes`, JSON.stringify(msg))
            .catch(err => console.error('[REDIS] Write Error:', err));
    }

    const out = JSON.stringify(msg);
    for (const player of room.players.values()) {
      if (player.ws !== ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(out);
      }
    }
  }

  private handleGuess(ws: WebSocket, text: string) {
      const room = this.playerRooms.get(ws);
      if(!room) return;
      
      // Check if correct
      if (room.word && text.toLowerCase() === room.word.toLowerCase()) {
          this.broadcastToRoom(room, [MsgType.CORRECT_GUESS, text]);
      } else {
          this.broadcastToRoom(room, [MsgType.GUESS, text]);
      }
  }
  
  private broadcastToRoom(room: RoomState, msg: any[]) {
      const out = JSON.stringify(msg);
      for (const player of room.players.values()) {
        if (player.ws.readyState === WebSocket.OPEN) {
          player.ws.send(out);
        }
      }
  }
}
