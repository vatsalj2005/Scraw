import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './RoomManager';

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(426); // Upgrade Required
    res.end('This is a WebSocket server. Please connect via ws://');
  }
});

const wss = new WebSocketServer({ server });
const roomManager = new RoomManager();

// Heartbeat to keep connections alive on cloud providers (Railway/Render)
const interval = setInterval(() => {
  wss.clients.forEach((ws: any) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('connection', (ws: any, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  
  console.log(`New connection from ${req.socket.remoteAddress}`);
  
  ws.on('message', (data: Buffer) => {
    try {
        const msg = JSON.parse(data.toString());
        const type = msg[0];
        roomManager.handleMessage(ws, type, msg);
    } catch(e) {
        console.error("Error processing message:", e);
    }
  });

  ws.on('error', (err: Error) => {
    console.error("WS Socket Error:", err);
  });

  ws.on('close', (code: number, reason: string) => {
    console.log(`Connection closed: ${code} ${reason}`);
    roomManager.handleDisconnect(ws);
  });
});

server.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
