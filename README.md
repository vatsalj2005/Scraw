# Scraw

Scraw is a collaborative real-time drawing board backed by a fault-tolerant RAFT cluster.

## Current Stack

- Frontend: React + Vite (JavaScript)
- Gateway: Java WebSocket/HTTP service (Maven)
- Replicas: Java RAFT nodes (Maven)
- Shared protocol constants: JavaScript
- Orchestration: Docker Compose

## Architecture

- Browsers connect to the gateway over WebSocket on port 8080.
- The gateway forwards strokes to the current RAFT leader.
- The leader replicates log entries to followers.
- After majority commit, replicas notify the gateway on port 8081.
- The gateway broadcasts committed strokes to all room clients.

## Repository Layout

```text
scraw/
  apps/
    frontend/
      src/                    # React app (JS/JSX)
      Dockerfile
      package.json
    gateway/
      src/main/java/com/scraw/gateway/GatewayServer.java
      pom.xml
      Dockerfile
    replica/
      src/main/java/com/scraw/replica/ReplicaServer.java
      pom.xml
    replica1/
      Dockerfile
    replica2/
      Dockerfile
    replica3/
      Dockerfile
  packages/
    shared/
      protocol.js
      index.js
  docker-compose.yml
  package.json
```

## Message Protocol

Messages are JSON arrays:

- JOIN_ROOM: [0, roomId, playerId]
- STROKE from client: [6, color, width, [[x,y], ...]]
- STROKE broadcast: [6, color, width, [[x,y], ...], playerId]
- SYNC history: [9, [[stroke1], [stroke2], ...]]

Constants live in:

- packages/shared/protocol.js
- apps/frontend/src/protocol.js

## Run With Docker (Recommended)

Prerequisites:

- Docker Desktop installed and running

On Windows PowerShell, set HOST_IP once per shell:

```powershell
$env:HOST_IP = "127.0.0.1"
```

Start all services:

```bash
docker compose up --build
```

Open:

- http://localhost:5173

Stop services:

```bash
docker compose down
```

## Local Build Checks (Java)

Build gateway:

```bash
mvn -f apps/gateway/pom.xml -DskipTests package
```

Build replica:

```bash
mvn -f apps/replica/pom.xml -DskipTests package
```

## Service Endpoints

Gateway:

- WS ws://localhost:8080
- POST http://localhost:8081/commit

Replicas:

- GET http://localhost:3001/status (similarly 3002, 3003)
- POST /request-vote
- POST /append-entries
- POST /client-stroke
- GET /room-log/:roomId

## Notes

- Java services target Java 17 in Maven configuration.
- Replica images currently run on Temurin 21 JRE, which is compatible with Java 17 bytecode.
- If Docker is not running, container smoke tests will fail until the daemon is available.
