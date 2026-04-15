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

## 💻 Local Development & Multi-Laptop Setup

### Prerequisites
- Docker Desktop installed
- All laptops connected to same WiFi network

### Quick Start (Single Laptop)

```bash
# Clone repository
git clone <repo-url>
cd scraw

# Start all services
docker-compose up --build
```

**Access:**
- Frontend: http://localhost:5173
- Gateway: http://localhost:8080

### Multi-Laptop Setup (Same WiFi Network)

See **[LOCAL_NETWORK_SETUP.md](./LOCAL_NETWORK_SETUP.md)** for detailed instructions.

**Quick Steps:**
1. Find host laptop IP address: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
2. Update `docker-compose.yml` → `VITE_WS_URL` with your IP
3. Start containers: `docker-compose up --build`
4. Access from other laptops: `http://YOUR_IP:5173`

**Example:**
```yaml
# In docker-compose.yml
environment:
  - VITE_WS_URL=ws://192.168.1.100:8080  # Replace with your IP
```

Then access from any laptop on same WiFi:
```
http://192.168.1.100:5173
```

---

## 🧪 Testing

### Test 1: Multi-Client Drawing (Same Laptop)
```bash
# Start system
docker-compose up --build

# Open multiple browser tabs
# Navigate to http://localhost:5173
# Draw in one tab, observe in others
```

### Test 2: Leader Failover
```bash
# Find current leader
docker-compose logs | grep "Became LEADER"

# Kill leader
docker kill scraw-replica1-1

# Watch new election
docker-compose logs -f replica2 replica3

# Continue drawing - system recovers automatically
```

### Test 3: Hot Reload
```bash
# Edit apps/replica/src/server.ts
# Save file
# Watch container auto-restart
# System continues operating
```

### Test 4: Multi-Laptop Setup
See [LOCAL_NETWORK_SETUP.md](./LOCAL_NETWORK_SETUP.md) for:
- Connecting multiple laptops on same WiFi
- Accessing from different devices
- Troubleshooting network issues

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
- **Network:** Works on WiFi/LAN with multiple devices

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

### Other laptops can't connect
See [LOCAL_NETWORK_SETUP.md](./LOCAL_NETWORK_SETUP.md) troubleshooting section for:
- Firewall configuration
- Network connectivity issues
- IP address problems

---

## 📚 Documentation

- [LOCAL_NETWORK_SETUP.md](./LOCAL_NETWORK_SETUP.md) - Multi-laptop setup guide
- [docker-compose.yml](./docker-compose.yml) - Container configuration

---

## 🎥 Demo Checklist

For assignment demonstration:

1. ✅ System startup and leader election
2. ✅ Multi-tab drawing synchronization (same laptop)
3. ✅ Multi-laptop drawing (different devices)
4. ✅ Kill leader, show automatic failover
5. ✅ Hot reload replica (edit file → auto-restart)
6. ✅ Query replica status endpoints
7. ✅ Show consistent logs across replicas

---

## 🌟 Features Implemented

- ✅ Unified 1080p coordinate grid for pixel-perfect sync
- ✅ Delta-encoded stroke batching for efficiency
- ✅ Real-time multi-user collaboration
- ✅ RAFT consensus protocol
- ✅ Automatic leader election
- ✅ Zero-downtime hot reload
- ✅ Local network multi-device support

---

## 📜 License

MIT. Built for distributed systems education.
