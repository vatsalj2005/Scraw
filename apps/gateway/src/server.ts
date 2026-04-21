import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import axios from 'axios';
import http from 'http';
import https from 'https';
import { MsgType } from '@scraw/shared';

// Configure axios to reuse connections and prevent socket listener leaks
const httpAgent = new http.Agent({ 
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  keepAliveMsecs: 1000
});

const httpsAgent = new https.Agent({ 
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  keepAliveMsecs: 1000
});

// Increase max listeners to handle concurrent requests
httpAgent.setMaxListeners(50);
httpsAgent.setMaxListeners(50);

axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

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
    let leaderFound = false;
    
    for (const replica of REPLICAS) {
      try {
        const res = await axios.get(`http://${replica}/status`, { timeout: 1000 });
        this.markReachable(replica);
        if (res.data.state === 'LEADER') {
          if (this.currentLeader !== replica) {
            console.log(`[GATEWAY] New leader discovered: ${replica}`);
            this.currentLeader = replica;
          }
          leaderFound = true;
        }
      } catch (e) {
        this.markUnreachable(replica);
      }
    }

    // If no leader found, clear stale leader reference
    if (!leaderFound) {
      this.currentLeader = null;
      
      if (!this.quorumLost) {
        console.log('[GATEWAY] No leader found among reachable replicas (election may be in progress)');
      }
    }
  }

  async forwardToLeader(msg: any[], roomId: string): Promise<boolean> {
    // Check if quorum is lost before attempting to forward
    if (this.quorumLost) {
      console.log('[GATEWAY] Cannot forward stroke - quorum lost (cluster unavailable)');
      return false;
    }

    // Retry up to 5 times with longer delays to allow for election completion
    // RAFT elections can take up to 800ms, so we need to be patient
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!this.currentLeader) {
        await this.discoverLeader();
        if (!this.currentLeader) {
          if (this.quorumLost) {
            console.log('[GATEWAY] Cannot forward stroke - quorum lost');
            return false;
          }
          // Wait longer on later attempts to allow election to complete
          const delay = attempt < 2 ? 200 : 400;
          console.log(`[GATEWAY] No leader available (attempt ${attempt + 1}/5), waiting ${delay}ms for election...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }

      try {
        await axios.post(
          `http://${this.currentLeader}/client-stroke`,
          { stroke: msg, roomId },
          { timeout: 500 }  // Increased timeout from 200ms to 500ms
        );
        return true;
      } catch (e) {
        console.log(`[GATEWAY] Forward to leader ${this.currentLeader} failed (attempt ${attempt + 1}), re-discovering...`);
        this.currentLeader = null;
      }
    }

    console.error('[GATEWAY] Failed to forward stroke after 5 attempts');
    return false;
  }

  async syncRoomHistory(roomId: string): Promise<any[]> {
    if (!this.currentLeader) {
      await this.discoverLeader();
      if (!this.currentLeader) return [];
    }

    try {
      const res = await axios.get(`http://${this.currentLeader}/room-log/${encodeURIComponent(roomId)}`, { timeout: 1000 });
      return res.data.log || [];
    } catch (e) {
      return [];
    }
  }

  broadcastToRoom(roomId: string, msg: any[]) {
    const payload = JSON.stringify(msg);
    let sentCount = 0;
    for (const client of this.clients) {
      if (client.roomId === roomId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
        sentCount++;
      }
    }
    console.log(`[GATEWAY] Broadcast to ${sentCount} clients in room ${roomId}`);
  }

  handleConnection(ws: WebSocket) {
    let client: Client | null = null;

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!Array.isArray(msg) || typeof msg[0] !== 'number') {
          console.error('[GATEWAY] Invalid message format:', msg);
          return;
        }
        const type = msg[0];

        if (type === MsgType.JOIN_ROOM) {
          const roomId = msg[1];
          const playerId = msg[2];
          client = { ws, roomId, playerId };
          this.clients.add(client);
          console.log(`[GATEWAY] Client ${playerId} joined room ${roomId}. Total clients: ${this.clients.size}`);

          const history = await this.syncRoomHistory(roomId);
          if (history.length > 0) {
            ws.send(JSON.stringify([MsgType.SYNC, history]));
            console.log(`[GATEWAY] Sent ${history.length} history strokes to ${playerId}`);
          }

        } else if (type === MsgType.STROKE) {
          // Complete stroke: [STROKE, color, width, [[x,y],...]]
          // Append playerId then forward to leader as one atomic entry
          if (!client) return;
          msg.push(client.playerId);
          console.log(`[GATEWAY] Forwarding STROKE from ${client.playerId} to leader`);
          const success = await this.forwardToLeader(msg, client.roomId);
          
          // If forward failed due to quorum loss, optionally notify client
          if (!success && this.quorumLost) {
            console.log(`[GATEWAY] Stroke from ${client.playerId} dropped - cluster unavailable`);
          }
        }
      } catch (e) {
        console.error('[GATEWAY] Error handling message:', e);
      }
    });

    ws.on('close', () => {
      if (client) {
        console.log(`[GATEWAY] Client ${client.playerId} disconnected from room ${client.roomId}`);
        this.clients.delete(client);
      }
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
            if (!roomId || !stroke) {
              console.error('[GATEWAY] Missing roomId or stroke in commit');
              res.writeHead(400);
              res.end('Missing fields');
              return;
            }
            console.log(`[GATEWAY] Received commit for room ${roomId}, broadcasting to ${this.clients.size} clients`);
            const clientsInRoom = Array.from(this.clients).filter(c => c.roomId === roomId);
            console.log(`[GATEWAY] Clients in room ${roomId}: ${clientsInRoom.length}`);
            this.broadcastToRoom(roomId, stroke);
            res.writeHead(200);
            res.end('OK');
          } catch (e) {
            console.error('[GATEWAY] Error processing commit:', e);
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
    console.log('[GATEWAY] Commit listener started on port 8081');
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
