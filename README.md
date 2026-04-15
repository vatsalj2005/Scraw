# Scraw 🖌️ - Distributed Real-Time Drawing Board with RAFT Consensus

A high-performance, **fault-tolerant** real-time multiplayer drawing board. Built with **RAFT Consensus Protocol**, **Gateway Architecture**, and **Fixed Canvas Resolution** to guarantee synchronized drawing across all devices.

![React](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)
![Node](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-339933)
![Consensus](https://img.shields.io/badge/consensus-RAFT-blue)
![Architecture](https://img.shields.io/badge/architecture-Distributed%20Replicas-orange)

---

## 🚀 Key Features

- **Fault Tolerance**: RAFT consensus protocol with automatic leader election
- **Zero Downtime**: Hot-reload replicas without disconnecting clients
- **High Availability**: System operates with any 2/3 replicas healthy
- **Perfect Sync**: Fixed **1200x700 canvas** for consistent drawing across all devices
- **Log Replication**: All strokes replicated across 3 replicas with majority quorum
- **Ultra-Low Latency**: Optimistic updates with <100ms replication
- **Automatic Failover**: Gateway discovers new leader within 2 seconds of failure
- **Multi-Room Support**: Separate drawing rooms with persistent storage

---

## 🏗️ Architecture

### System Components

1. **Gateway Service** (Port 8080)
   - WebSocket server for client connections
   - Leader discovery and request forwarding
   - Broadcasts committed strokes to all clients in room

2. **3 Replica Nodes** (Ports 3001-3003)
   - RAFT consensus cluster
   - Leader election and log replication
   - Maintains append-only stroke log per room

3. **Frontend** (Port 5173)
   - React + Vite + HTML5 Canvas
   - Real-time drawing with absolute coordinates
   - Fixed 1200x700px canvas size

### RAFT Protocol

- **Election Timeout:** 500-800ms (randomized)
- **Heartbeat Interval:** 50ms (optimized for low latency)
- **States:** FOLLOWER → CANDIDATE → LEADER
- **Quorum:** Majority (2/3) required for commits
- **Optimistic Updates:** Leader broadcasts immediately, then replicates

---

## 💻 Local Development & Multi-Device Setup

### Prerequisites
- Docker Desktop installed
- All devices connected to same WiFi network

### Quick Start (Single Device)

```bash
# Clone repository
git clone <repo-url>
cd scraw

# Start all services
docker compose up --build
```

**Access:**
- Frontend: http://localhost:5173
- Gateway: http://localhost:8080

### Multi-Device Setup (Same WiFi Network)

**Steps:**

1. **Find your laptop's IP address:**
   ```bash
   # Windows
   ipconfig
   
   # Look for "IPv4 Address" under your WiFi adapter
   # Example: 172.17.230.168
   ```

2. **Update docker-compose.yml:**
   ```yaml
   frontend:
     environment:
       - VITE_WS_URL=ws://YOUR_IP_HERE:8080  # Replace with your IP
   ```

3. **Start containers:**
   ```bash
   docker compose up --build
   ```

4. **Access from any device on same WiFi:**
   ```
   http://YOUR_IP_HERE:5173
   ```

**Example:**
If your IP is `172.17.230.168`:
- Update `VITE_WS_URL=ws://172.17.230.168:8080`
- Access from phone/laptop: `http://172.17.230.168:5173`

---

## 🧪 Testing

### Test 1: Multi-Client Drawing
```bash
# Start system
docker compose up --build

# Open multiple browser tabs/devices
# Navigate to http://localhost:5173 (or http://YOUR_IP:5173)
# Draw in one tab, observe real-time sync in others
```

### Test 2: Leader Failover
```bash
# Find current leader
docker compose logs | grep "Became LEADER"

# Kill leader (example: replica3)
docker kill scraw-replica3-1

# Watch new election
docker compose logs -f replica1 replica2

# Continue drawing - system recovers automatically
```

### Test 3: Hot Reload
```bash
# Edit apps/replica/src/server.ts
# Save file
# Watch container auto-restart with nodemon
# System continues operating without downtime
```

### Test 4: Multi-Room Support
```bash
# Open browser, join "room1"
# Open another browser, join "room2"
# Draw in each - they remain separate
# Join "room1" from second browser - see first user's drawings
```

### Test 5: Persistence
```bash
# Draw something in a room
# Close all browser tabs
# Reopen and join same room
# Previous drawings are still there (stored in RAFT log)
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
- **Throughput:** Real-time drawing with immediate local feedback
- **Failover Time:** <2 seconds for leader election
- **Recovery Time:** <2 seconds for replica rejoin
- **Network:** Works on WiFi/LAN with multiple devices (laptop + phone)

---

## 🔧 Troubleshooting

### No leader elected
```bash
# Ensure at least 2 replicas are running
docker compose ps
docker compose up -d replica1 replica2
```

### Strokes not appearing
```bash
# Check gateway can reach leader
docker compose logs gateway | grep leader

# Check replica logs
docker compose logs replica1 replica2 replica3
```

### Hot reload not working
```bash
# Verify nodemon is watching files
docker compose logs replica1 | grep nodemon

# Restart services
docker compose restart
```

### Other devices can't connect

**Windows Firewall:**
Ensure ports 5173 and 8080 are allowed:
```bash
# Run as Administrator
netsh advfirewall firewall add rule name="Scraw Frontend" dir=in action=allow protocol=TCP localport=5173
netsh advfirewall firewall add rule name="Scraw Gateway" dir=in action=allow protocol=TCP localport=8080
```

**Check IP address:**
```bash
# Make sure you're using the correct IP
ipconfig

# Update docker-compose.yml with current IP
# Your IP may change when reconnecting to WiFi
```

**Test connectivity:**
```bash
# From phone/other device, try to ping your laptop
ping YOUR_IP

# If ping fails, it's a network/firewall issue
```

---

## 🎥 Demo Checklist

For demonstration:

1. ✅ System startup and leader election
2. ✅ Multi-tab drawing synchronization (same device)
3. ✅ Multi-device drawing (laptop + phone)
4. ✅ Kill leader, show automatic failover
5. ✅ Hot reload replica (edit file → auto-restart)
6. ✅ Multi-room support (different rooms, separate canvases)
7. ✅ Persistence (drawings remain after users leave)
8. ✅ Show consistent logs across replicas

---

## 🌟 Features Implemented

- ✅ Fixed 1200x700px canvas for perfect cross-device sync
- ✅ Absolute coordinate system (no delta accumulation errors)
- ✅ Real-time multi-user collaboration
- ✅ RAFT consensus protocol with optimistic updates
- ✅ Automatic leader election and failover
- ✅ Zero-downtime hot reload with nodemon
- ✅ Local network multi-device support (laptop + phone)
- ✅ Multi-room support with separate canvases
- ✅ Persistent drawing storage in RAFT log
- ✅ Client-side stroke filtering (no double drawing)

---

## 📁 Project Structure

```
scraw/
├── apps/
│   ├── frontend/          # React + Vite frontend
│   │   └── src/
│   │       ├── App.tsx    # Main app with room selector
│   │       ├── Canvas.tsx # Drawing canvas component
│   │       └── store.ts   # Zustand state management
│   ├── gateway/           # WebSocket gateway
│   │   └── src/
│   │       └── server.ts  # Gateway server
│   └── replica/           # RAFT replica nodes
│       └── src/
│           └── server.ts  # RAFT implementation
├── packages/
│   └── shared/            # Shared protocol definitions
│       └── protocol.ts    # Message types
├── docker-compose.yml     # Container orchestration
└── README.md             # This file
```

---

## 📜 License

MIT. Built for distributed systems education.

---

## 🙏 Acknowledgments

Built with RAFT consensus protocol for fault-tolerant distributed systems.
