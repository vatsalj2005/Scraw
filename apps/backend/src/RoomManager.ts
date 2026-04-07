import { WebSocket } from 'ws';
import { MsgType } from '@scraw/shared';

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

    // Room state is kept in memory even if players.size === 0 
    // for persistence during the current server session.
  }

  private joinRoom(ws: WebSocket, roomId: string, playerId: string) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { roomId, players: new Map(), currentDrawer: null, word: null, strokesBuffer: [] };
      this.rooms.set(roomId, room);
    }
    
    if (room.players.size >= 10) return; // Full
    
    room.players.set(playerId, { id: playerId, ws, score: 0 });
    this.playerRooms.set(ws, room);

    // Send history
    for(const stroke of room.strokesBuffer) {
        ws.send(JSON.stringify(stroke));
    }

    // Broadcast new player list
    const pList = Array.from(room.players.keys());
    this.broadcastToRoom(room, [MsgType.PLAYER_LIST, pList]);
  }

  private broadcastDraw(ws: WebSocket, msg: any[]) {
    const room = this.playerRooms.get(ws);
    if (!room) return;
    
    room.strokesBuffer.push(msg);

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
