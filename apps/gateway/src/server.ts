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

  // Reachability tracking per replica
  private replicaReachable: Map<string, boolean> = new Map(
    REPLICAS.map(r => [r, true])
  );
  private quorumLost = false;

  constructor() {
    setInterval(() => this.discoverLeader(), 2000);
    this.discoverLeader();
  }

  // ─── Replica health tracking ──────────────────────────────────────────────

  private markReachable(replica: string) {
    if (this.replicaReachable.get(replica) === false) {
      console.log(`\n[GATEWAY] Replica ${replica} is back online\n`);
      this.replicaReachable.set(replica, true);
      this.checkQuorum();
    }
  }

  private markUnreachable(replica: string) {
    if (this.replicaReachable.get(replica) !== false) {
      console.log(`\n[GATEWAY] Replica ${replica} appears to be DOWN\n`);
      this.replicaReachable.set(replica, false);
      this.checkQuorum();
    }
  }

  private checkQuorum() {
    const upCount = [...this.replicaReachable.values()].filter(Boolean).length;
    const total = REPLICAS.length;
    const majority = Math.floor(total / 2) + 1;

    if (upCount < majority && !this.quorumLost) {
      this.quorumLost = true;
      console.log(
        `\n[GATEWAY] QUORUM LOST — only ${upCount}/${total} replicas reachable` +
        ` (need ${majority}). Writes will be unavailable until quorum is restored.\n`
      );
    } else if (upCount >= majority && this.quorumLost) {
      this.quorumLost = false;
      console.log(
        `\n[GATEWAY] QUORUM RESTORED — ${upCount}/${total} replicas reachable.` +
        ` Cluster is healthy again.\n`
      );
    }
  }

  // ─── Leader discovery ─────────────────────────────────────────────────────

  async discoverLeader() {
    for (const replica of REPLICAS) {
      try {
        const res = await axios.get(`http://${replica}/status`, { timeout: 1000 });
        this.markReachable(replica);
        if (res.data.state === 'LEADER') {
          if (this.currentLeader !== replica) {
            console.log(`[GATEWAY] New leader discovered: ${replica}`);
            this.currentLeader = replica;
          }
          return;
        }
      } catch (e) {
        this.markUnreachable(replica);
      }
    }

    if (!this.quorumLost) {
      console.log('[GATEWAY] No leader found among reachable replicas, retrying...');
    }
  }

  async forwardToLeader(msg: any[], roomId: string): Promise<boolean> {
    // Retry up to 3 times to handle leader failover mid-stroke
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.currentLeader) {
        await this.discoverLeader();
        if (!this.currentLeader) {
          console.log('[GATEWAY] No leader available, retrying...');
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
      }

      try {
        await axios.post(
          `http://${this.currentLeader}/client-stroke`,
          { stroke: msg, roomId },
          { timeout: 200 }
        );
        return true;
      } catch (e) {
        console.log(`[GATEWAY] Forward to leader ${this.currentLeader} failed (attempt ${attempt + 1}), re-discovering...`);
        this.currentLeader = null;
      }
    }

    console.error('[GATEWAY] Failed to forward stroke after 3 attempts');
    return false;
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
