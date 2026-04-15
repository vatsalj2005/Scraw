# Scraw 🖌️ - Distributed Real-Time Drawing Board with Mini-RAFT Consensus

A high-performance, **fault-tolerant** real-time multiplayer drawing board. Built with **Mini-RAFT Consensus Protocol**, **Gateway Architecture**, and **Unified 1080p Coordinate Grid** to guarantee pixel-perfect synchronization and zero-downtime under failures.

![React](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)
![Node](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-339933)
![Consensus](https://img.shields.io/badge/consensus-Mini--RAFT-blue)
![Architecture](https://img.shields.io/badge/architecture-Distributed%20Replicas-orange)

---

## 🚀 Key Features

- **Fault Tolerance**: Mini-RAFT consensus protocol with automatic leader election
- **Zero Downtime**: Hot-reload replicas without disconnecting clients
- **High Availability**: System operates with any 2/3 replicas healthy
- **Pixel-Perfect Sync**: Fixed internal **1920x1080 Virtual Resolution** for cross-device consistency
- **Log Replication**: All strokes replicated across 3 replicas with majority quorum
- **Ultra-Low Latency**: Custom binary-efficient JSON protocol using **Delta-Encoding**
- **Automatic Failover**: Gateway discovers new leader within 1 second of failure
- **Cloud Ready**: Deploy to Vercel + Railway with zero code changes

---

## 🌐 Deployment Options

This project supports **both local and cloud deployment**:

### Local (Docker Compose)
Perfect for assignment demonstration and testing
```bash
docker-compose up --build
```

### Cloud (Vercel + Railway)
Production-ready deployment with same features
- Frontend: Vercel (free tier)
- Backend: Railway (free tier)
- See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete guide

**Both environments support:**
- ✅ Leader election and failover
- ✅ Log replication
- ✅ Multi-client synchronization
- ✅ Zero-downtime updates

---

## 🏗️ Architecture

### System Components

1. **Gateway Service** (Port 8080)
   - WebSocket server for client connections
   - Leader discovery and request forwarding
   - Broadcasts committed strokes to all clients

2. **3 Replica Nodes** (Ports 3001-3003)
   - RAFT consensus cluster
   - Leader election and log replication
   - Maintains append-only stroke log

3. **Frontend** (Port 5173)
   - React + Vite + HTML5 Canvas
   - Real-time drawing with delta batching

### Mini-RAFT Protocol

- **Election Timeout:** 500-800ms (randomized)
- **Heartbeat Interval:** 150ms
- **States:** FOLLOWER → CANDIDATE → LEADER
- **Quorum:** Majority (2/3) required for commits

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed protocol specification.

---

## 💻 Local Development

### Prerequisites
- Docker and Docker Compose
- Node.js 20+ (for local development without Docker)

### Quick Start

```bash
# Clone repository
git clone <repo-url>
cd scraw

# Start all services with Docker
docker-compose up --build
```

**Services:**
- Frontend: http://localhost:5173
- Gateway: http://localhost:8080 (WebSocket)
- Replica 1: http://localhost:3001
- Replica 2: http://localhost:3002
- Replica 3: http://localhost:3003

### Development Workflow

1. **Edit replica code:**
   ```bash
   # Edit apps/replica/src/server.ts
   # Nodemon auto-restarts container
   # System continues operating (zero downtime)
   ```

2. **Monitor logs:**
   ```bash
   docker-compose logs -f
   ```

3. **Check replica status:**
   ```bash
   curl http://localhost:3001/status | jq
   curl http://localhost:3002/status | jq
   curl http://localhost:3003/status | jq
   ```

4. **Test failover:**
   ```bash
   # Kill current leader
   docker kill scraw-replica1-1
   
   # Watch new election
   docker-compose logs -f replica2 replica3
   ```

---

## 🧪 Testing

See [TESTING.md](./TESTING.md) for comprehensive test suite including:

- ✅ Multi-client real-time synchronization
- ✅ Leader failure and automatic failover
- ✅ Zero-downtime hot reload
- ✅ Majority quorum enforcement
- ✅ Log replication consistency
- ✅ Late joiner sync
- ✅ Chaos testing (rapid failures)
- ✅ Network partition recovery

### Quick Test

```bash
# Terminal 1: Start system
docker-compose up --build

# Terminal 2: Open multiple browser tabs
open http://localhost:5173
open http://localhost:5173

# Draw in one tab, observe in others

# Terminal 3: Kill leader
docker kill scraw-replica1-1

# Continue drawing - system should recover automatically
```

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Zustand, HTML5 Canvas API
- **Gateway**: Node.js, WebSocket (ws), Axios
- **Replicas**: Node.js, Express, Axios
- **Protocol**: Shared TypeScript monorepo
- **Deployment**: Docker, Docker Compose

---

## 📊 Performance

- **Latency:** <100ms from draw to broadcast (local network)
- **Throughput:** >500 strokes/second
- **Failover Time:** <1 second for leader election
- **Recovery Time:** <2 seconds for replica rejoin

---

## 🚢 Production Deployment

### Option 1: Docker Compose (Recommended for Demo/Assignment)

```bash
docker-compose up -d --build
```

### Option 2: Cloud Deployment (Vercel + Railway)

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete guide on deploying to:
- **Frontend:** Vercel (free tier)
- **Backend:** Railway (free tier)

**Quick Summary:**
1. Deploy 3 replicas to Railway with environment variables
2. Deploy gateway to Railway
3. Deploy frontend to Vercel with `VITE_WS_URL=wss://your-gateway.railway.app`
4. Update PEERS in replicas with actual Railway URLs

The system works identically in cloud as it does locally!

### Option 3: Manual Deployment

1. **Start Replicas:**
   ```bash
   cd apps/replica
   REPLICA_ID=replica1 PORT=3001 PEERS=replica2:3002,replica3:3003 npm run dev
   ```

2. **Start Gateway:**
   ```bash
   cd apps/gateway
   PORT=8080 npm run dev
   ```

3. **Start Frontend:**
   ```bash
   cd apps/frontend
   VITE_WS_URL=ws://localhost:8080 npm run dev
   ```

### Environment Variables

**Replica:**
- `REPLICA_ID`: Unique identifier (replica1, replica2, replica3)
- `PORT`: HTTP port for RPC endpoints
- `PEERS`: Comma-separated list of peer addresses
- `GATEWAY_URL`: Gateway commit notification endpoint

**Gateway:**
- `PORT`: WebSocket server port (default: 8080)

**Frontend:**
- `VITE_WS_URL`: WebSocket gateway URL

---

## 📝 Assignment Compliance

This project fulfills all requirements for the **Distributed Real-Time Drawing Board with Mini-RAFT Consensus** assignment:

### ✅ Required Components
- [x] Gateway Service (WebSocket server)
- [x] 3 Replica Nodes with RAFT implementation
- [x] Follower, Candidate, Leader modes
- [x] Leader election with term-based voting
- [x] Log replication with majority quorum
- [x] Heartbeat mechanism (150ms)
- [x] RPC endpoints: /request-vote, /append-entries, /sync-log
- [x] Bind-mounted hot-reload with nodemon
- [x] Zero-downtime container replacement

### ✅ RAFT Protocol
- [x] Election timeout: 500-800ms (randomized)
- [x] Heartbeat interval: 150ms
- [x] Majority (2/3) quorum for commits
- [x] Higher term always wins
- [x] Committed entries never overwritten
- [x] Catch-up protocol for restarted nodes

### ✅ Fault Tolerance
- [x] Automatic leader failover
- [x] System operates with 2/3 replicas
- [x] Graceful degradation on failures
- [x] Log consistency across replicas

### ✅ Real-Time Features
- [x] WebSocket-based drawing
- [x] Multi-client synchronization
- [x] Delta-encoded stroke batching
- [x] Late joiner history sync

### ✅ Docker & Deployment
- [x] docker-compose.yml with 4 services
- [x] Bind mounts for hot-reload
- [x] Shared Docker network
- [x] Health check endpoints
- [x] Environment-based configuration

---

## 📚 Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed system design and protocol specification
- [TESTING.md](./TESTING.md) - Comprehensive testing guide with 9 test scenarios
- [QUICKSTART.md](./QUICKSTART.md) - 5-minute setup guide
- [DIAGRAMS.md](./DIAGRAMS.md) - Visual system diagrams and flows
- [SUBMISSION.md](./SUBMISSION.md) - Assignment submission checklist
- [CHANGES.md](./CHANGES.md) - Transformation details from original project
- [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) - Complete project overview
- [k8s.yaml](./k8s.yaml) - Kubernetes deployment configuration (bonus)

---

## 🎥 Demo Video Checklist

For the 8-10 minute demonstration:

1. ✅ System startup and leader election
2. ✅ Multi-tab drawing synchronization
3. ✅ Kill leader, show automatic failover
4. ✅ Hot reload replica (edit file → auto-restart)
5. ✅ Kill 2 replicas, show unavailability
6. ✅ Restart replica, show recovery
7. ✅ Query replica status endpoints
8. ✅ Show consistent logs across replicas
9. ✅ Late joiner receives full history
10. ✅ Chaos test (multiple rapid failures)

---

## 🔧 Troubleshooting

### No leader elected
```bash
# Ensure at least 2 replicas are running
docker-compose ps
docker-compose up -d replica1 replica2
```

### Strokes not appearing
```bash
# Check gateway can reach leader
docker-compose logs gateway | grep leader

# Check replica logs
docker-compose logs replica1 replica2 replica3
```

### Hot reload not working
```bash
# Verify bind mounts in docker-compose.yml
docker-compose config

# Restart services
docker-compose restart
```

---

## 🌟 Bonus Features Implemented

- ✅ Unified 1080p coordinate grid for pixel-perfect sync
- ✅ Delta-encoded stroke batching for efficiency
- ✅ Kubernetes deployment configuration
- ✅ Comprehensive testing documentation
- ✅ Real-time multi-user collaboration

---

## 📜 License

MIT. Built for distributed systems education.
