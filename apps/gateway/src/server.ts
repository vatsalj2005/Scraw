import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import axios from 'axios';
import { MsgType } from '@scraw/shared';

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const REPLICAS = ['replica1:3001', 'replica2:3002', 'replica3:3003'];

interface Client {
  ws: WebSocket;
  roomId: string;
  playerId: string;
}

class Gateway {
  private clients: Set<Client> = new Set();
  private currentLeader: string | null = null;

  constructor() {
    setInterval(() => this.discoverLeader(), 2000);
    this.discoverLeader();
  }

  async discoverLeader() {
    for (const replica of REPLICAS) {
      try {
        const res = await axios.get(`http://${replica}/status`, { timeout: 1000 });
        if (res.data.state === 'LEADER') {
          if (this.currentLeader !== replica) {
            console.log(`[GATEWAY] New leader discovered: ${replica}`);
            this.currentLeader = replica;
          }
          return;
        }
      } catch (e) {}
    }
    console.log('[GATEWAY] No leader found, retrying...');
  }

  async forwardToLeader(msg: any[], roomId: string): Promise<boolean> {
    if (!this.currentLeader) {
      await this.discoverLeader();
      if (!this.currentLeader) return false;
    }

    try {
      await axios.post(`http://${this.currentLeader}/client-stroke`, { stroke: msg, roomId }, { timeout: 200 });
      return true;
    } catch (e) {
      this.currentLeader = null;
      return false;
    }
  }

  async syncRoomHistory(roomId: string): Promise<any[]> {
    if (!this.currentLeader) {
      await this.discoverLeader();
      if (!this.currentLeader) return [];
    }

    try {
      const res = await axios.get(`http://${this.currentLeader}/room-log/${roomId}`, { timeout: 1000 });
      return res.data.log || [];
    } catch (e) {
      return [];
    }
  }

  broadcastToRoom(roomId: string, msg: any[]) {
    const payload = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.roomId === roomId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  handleConnection(ws: WebSocket) {
    let client: Client | null = null;

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        const type = msg[0];

        if (type === MsgType.JOIN_ROOM) {
          const roomId = msg[1];
          const playerId = msg[2];
          client = { ws, roomId, playerId };
          this.clients.add(client);

          const history = await this.syncRoomHistory(roomId);
          if (history.length > 0) {
            ws.send(JSON.stringify([MsgType.SYNC, history]));
          }

        } else if (type >= MsgType.DRAW_START && type <= MsgType.DRAW_END) {
          if (!client) return;
          msg.push(client.playerId);
          await this.forwardToLeader(msg, client.roomId);
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      if (client) this.clients.delete(client);
    });
  }

  startCommitListener() {
    const commitServer = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/commit') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { roomId, stroke } = JSON.parse(body);
            this.broadcastToRoom(roomId, stroke);
            res.writeHead(200);
            res.end('OK');
          } catch (e) {
            res.writeHead(400);
            res.end('Bad Request');
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    commitServer.listen(8081);
  }
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(426);
    res.end('WebSocket server');
  }
});

const wss = new WebSocketServer({ server });
const gateway = new Gateway();
gateway.startCommitListener();

wss.on('connection', (ws) => gateway.handleConnection(ws));

server.listen(port, () => {
  console.log(`[GATEWAY] Listening on port ${port}`);
});
