# Scraw — Distributed Real-Time Drawing Board

> A collaborative whiteboard backed by a fault-tolerant RAFT consensus cluster.  
> Built for the Cloud Computing course assignment — PES University, Section K  
> Guide: **Dr. Jenny Jijo**

---

## Team

| Name | SRN |
|---|---|
| Varun Rathod | PES2UG23CS679 |
| Vatsal Jain | PES2UG23CS681 |
| Vedanta Barman | PES2UG23CS682 |
| Vrishabh S. Hiremath | PES2UG23CS709 |

---

## Table of Contents

1. [What is this project?](#1-what-is-this-project)
2. [How it works — Big Picture](#2-how-it-works--big-picture)
3. [Project Structure](#3-project-structure)
4. [Running the Project](#4-running-the-project)
5. [Component Deep Dives](#5-component-deep-dives)
   - [Frontend](#51-frontend)
   - [Gateway](#52-gateway)
   - [Replica (RAFT Node)](#53-replica-raft-node)
   - [Shared Protocol](#54-shared-protocol)
6. [RAFT Consensus — Plain English](#6-raft-consensus--plain-english)
7. [Message Flow Walkthrough](#7-message-flow-walkthrough)
8. [Failure Scenarios & How We Handle Them](#8-failure-scenarios--how-we-handle-them)
9. [Docker & Hot Reload](#9-docker--hot-reload)
10. [API Reference](#10-api-reference)
11. [Team Contributions](#11-team-contributions)
12. [Viva Q&A Prep](#12-viva-qa-prep)

---

## 1. What is this project?

Scraw is a **real-time collaborative drawing board**. Multiple users open it in their browsers, pick a room name, and draw together. Every stroke one person draws appears instantly on everyone else's screen.

The interesting part is the **backend**. Instead of a single server (which would be a single point of failure), we run **three replica servers** that agree on every stroke using a protocol called **RAFT**. If any one of them crashes or restarts, the other two keep the system running without users noticing anything.

Think of it like a group of three judges who must agree (majority = 2 out of 3) before a stroke is officially "committed" and shown to everyone.

---

## 2. How it works — Big Picture

```
 Browser Tab 1 ──┐
 Browser Tab 2 ──┤──► GATEWAY (port 8080) ──► RAFT LEADER ──► Followers
 Browser Tab 3 ──┘         ▲                       │
                            └───────────────────────┘
                              committed stroke broadcast
```

**Step by step:**

1. User draws a line → browser sends the stroke over WebSocket to the **Gateway**
2. Gateway forwards it to whichever replica is currently the **Leader**
3. Leader writes it to its log and asks the other two replicas (**Followers**) to do the same
4. Once 2 out of 3 replicas confirm → stroke is **committed**
5. Leader tells the Gateway: "this stroke is committed"
6. Gateway broadcasts it to **all connected browsers**
7. Every browser draws the stroke on their canvas

---

## 3. Project Structure

```
scraw/
├── apps/
│   ├── frontend/          # React drawing app (Vite + TypeScript)
│   ├── gateway/           # WebSocket server (Node.js)
│   ├── replica/           # Base replica template (shared package.json etc.)
│   ├── replica1/src/      # Replica 1's actual code (hot-reloadable)
│   ├── replica2/src/      # Replica 2's actual code (hot-reloadable)
│   └── replica3/src/      # Replica 3's actual code (hot-reloadable)
├── packages/
│   └── shared/            # Shared message type enum (used by all services)
├── docker-compose.yml     # Spins up all 5 containers
└── package.json           # Root workspace config
```

**Why replica1/2/3 have separate src folders:**  
Each replica mounts its own `src/` folder into Docker. When you edit `replica1/src/server.ts`, only replica1's container restarts. Replica2 and replica3 stay alive — keeping quorum (majority) intact. This is how we achieve **zero-downtime hot reload**.

---

## 4. Running the Project

### Prerequisites
- Docker Desktop installed and running
- That's it.

### Start everything

```bash
docker-compose up --build
```

This builds and starts 5 containers: gateway, replica1, replica2, replica3, frontend.

### Open the app

Go to `http://localhost:5173` in your browser.

### Stop everything

```bash
docker-compose down
```

### Hot reload a replica (edit code without downtime)

Just edit any file inside `apps/replica1/src/` — the container auto-restarts via nodemon. The other two replicas hold the cluster alive during the restart.

### Simulate a leader crash

```bash
docker-compose stop replica1
```

Watch the logs — replica2 or replica3 will elect a new leader within ~800ms.

```bash
docker-compose start replica1
```

Replica1 rejoins as a follower and catches up on any missed strokes.

---

## 5. Component Deep Dives

### 5.1 Frontend

**Location:** `apps/frontend/src/`  
**Tech:** React 18, Vite, Zustand, TypeScript  
**Port:** 5173

**What it does:**
- Renders a fixed 1200×700 canvas
- Captures mouse/touch pointer events
- Sends draw events to the Gateway over WebSocket
- Receives and renders remote strokes from other users

**Key files:**

`store.ts` — the brain of the frontend. Manages:
- The WebSocket connection
- A unique `playerId` per browser session (random string like `player_x7k2m`)
- A `remoteStrokesQueue` — incoming strokes waiting to be drawn
- `connect(roomId)` — opens WebSocket, sends JOIN_ROOM, receives SYNC history
- `sendBatch(msg)` — sends a draw event to the gateway

`Canvas.tsx` — the drawing surface:
- Pointer down → starts a stroke locally AND sends `DRAW_START` to gateway
- Pointer move → continues stroke locally AND sends `DRAW_MOVE` to gateway
- A `requestAnimationFrame` loop drains `remoteStrokesQueue` and draws remote strokes
- Filters out own strokes (matched by `playerId`) to avoid drawing twice

`App.tsx` — the UI shell with the room input and Join button.

**Why Zustand?** It's a lightweight state manager. The canvas render loop reads state directly via `useStore.getState()` without React re-renders, which keeps drawing smooth.

---

### 5.2 Gateway

**Location:** `apps/gateway/src/server.ts`  
**Tech:** Node.js, `ws` library, `axios`, TypeScript  
**Ports:** 8080 (WebSocket), 8081 (HTTP commit listener)

**What it does:**

The Gateway is the middleman between browsers and the RAFT cluster. It never stores state itself — it just routes messages.

**Two servers in one process:**

1. **WebSocket server (port 8080)** — browsers connect here
2. **HTTP server (port 8081)** — replicas POST committed strokes here

**Key behaviors:**

*Leader discovery:* Every 2 seconds, the gateway polls all three replicas at `GET /status`. Whichever one says `"state": "LEADER"` becomes the cached `currentLeader`. If the leader changes, the gateway automatically starts routing to the new one.

*Forwarding strokes:* When a browser sends a draw event, the gateway appends the `playerId` and POSTs it to `http://<currentLeader>/client-stroke`. If that fails (leader crashed), it retries up to 3 times, re-discovering the leader each time.

*Room sync on join:* When a browser sends `JOIN_ROOM`, the gateway fetches the full stroke history from `GET /room-log/:roomId` on the leader and sends it back as a `SYNC` message. This is how late-joining users see the existing canvas.

*Broadcasting commits:* When a replica POSTs to `/commit` on port 8081, the gateway sends that stroke to every WebSocket client in that room.

---

### 5.3 Replica (RAFT Node)

**Location:** `apps/replica1/src/server.ts` (same code in replica2, replica3)  
**Tech:** Node.js, Express, `axios`, TypeScript  
**Ports:** 3001, 3002, 3003

This is the most complex part. Each replica is a full RAFT node.

**State machine — a replica is always in one of three states:**

```
FOLLOWER ──(timeout)──► CANDIDATE ──(majority votes)──► LEADER
    ▲                        │                              │
    └────────────────────────┘◄─────────────────────────────┘
         (higher term seen)           (higher term seen)
```

**Key data structures:**

```typescript
log: LogEntry[]        // append-only list of strokes
currentTerm: number    // monotonically increasing election counter
commitIndex: number    // highest log index confirmed by majority
lastApplied: number    // highest log index sent to gateway
nextIndex: Map         // leader tracks: next log index to send each follower
matchIndex: Map        // leader tracks: highest confirmed index per follower
```

**Election flow:**
1. Follower's election timer fires (500–800ms random)
2. Becomes CANDIDATE, increments term, votes for itself
3. Sends `POST /request-vote` to both peers
4. If it gets ≥2 votes total → becomes LEADER
5. Immediately sends heartbeats every 150ms to suppress other elections

**Log replication flow (on receiving a client stroke):**
1. Leader appends entry to its own log
2. Sends `POST /append-entries` to both followers with the new entry
3. Followers append it and respond `success: true`
4. Leader counts acknowledgments — when majority (2/3) confirm, increments `commitIndex`
5. Leader calls `applyCommitted()` which POSTs to `GATEWAY_URL/commit`

**Fast catch-up:** When a follower's log is behind, it returns its current `logLength` in the AppendEntries response. The leader uses this to jump directly to the right index instead of decrementing one by one.

---

### 5.4 Shared Protocol

**Location:** `packages/shared/protocol.ts`

```typescript
enum MsgType {
  JOIN_ROOM  = 0,   // browser → gateway: "I want to join room X"
  DRAW_START = 3,   // stroke begins (x, y, color, width)
  DRAW_MOVE  = 4,   // stroke continues (x, y)
  DRAW_END   = 5,   // stroke ends
  SYNC       = 9,   // gateway → browser: full history on join
}
```

Messages are JSON arrays for minimal overhead: `[MsgType, ...args]`

Example: `[3, 450, 200, "#ff0055", 3]` = DRAW_START at (450,200), red, 3px wide.

---

## 6. RAFT Consensus — Plain English

### What problem does RAFT solve?

Imagine 3 people (replicas) need to agree on a shared list (the stroke log). Any one of them might crash at any time. RAFT ensures they always agree on what's in the list, even during failures.

### The three rules

**Rule 1 — One leader at a time.**  
Only the leader accepts new entries. Followers just copy what the leader says.

**Rule 2 — Majority wins.**  
An entry is only "committed" (permanent) once the majority (2 out of 3) have it in their logs. A crashed node can't block progress.

**Rule 3 — Terms are like epochs.**  
Every election increments a "term" number. If a node ever sees a higher term than its own, it immediately steps down to follower. This prevents stale leaders from causing confusion.

### Election in plain English

- Every follower has a countdown timer (500–800ms, randomized so they don't all fire at once)
- If the timer hits zero without hearing from a leader → "I'll run for leader"
- It asks the other two: "Will you vote for me for term 5?"
- They say yes if they haven't voted yet this term and the candidate's log is at least as up-to-date as theirs
- First one to get 2 votes wins and starts sending heartbeats

### Why random timeouts?

If all three timers were the same, all three would call an election simultaneously and split the votes (1 each). Random timeouts mean one node almost always fires first and wins before the others even start.

### Log replication in plain English

Leader gets a stroke → writes it to its own list → tells followers "add this to your list too" → followers confirm → leader says "ok, it's official" → tells gateway to broadcast it.

If a follower is behind (just restarted), the leader sends it everything it missed in one shot.

---

## 7. Message Flow Walkthrough

### User draws a stroke

```
1. Mouse down on canvas
   → Canvas.tsx fires handlePointerDown
   → Draws locally (immediate feedback)
   → store.sendBatch([DRAW_START, x, y, color, width])

2. WebSocket sends [3, 450, 200, "#ff0055", 3] to Gateway:8080

3. Gateway.handleConnection receives message
   → Appends playerId: [3, 450, 200, "#ff0055", 3, "player_x7k2m"]
   → axios.post("http://replica2:3002/client-stroke", { stroke, roomId })

4. Replica2 (Leader) handleClientStroke
   → Appends LogEntry { term:3, roomId:"room1", stroke:[...], index:7 }
   → Optimistically POSTs to gateway:8081/commit (low latency)
   → Sends AppendEntries to replica1 and replica3

5. Replica1 & Replica3 handleAppendEntries
   → Append entry to their logs
   → Return { success: true }

6. Leader updateCommitIndex
   → matchIndex for both followers now >= 7
   → count = 3 > 1.5 → commit!
   → applyCommitted() → POST gateway:8081/commit { roomId, stroke }

7. Gateway /commit handler
   → broadcastToRoom("room1", stroke)
   → Sends to all WebSocket clients in room1

8. Other browsers receive the stroke
   → store.onmessage pushes to remoteStrokesQueue
   → Canvas renderLoop draws it (filtered: not own playerId)
```

### New user joins a room

```
1. Browser opens ws://gateway:8080
2. Sends [JOIN_ROOM, "room1", "player_abc"]
3. Gateway fetches GET http://replica2:3002/room-log/room1
4. Leader returns all committed strokes for room1
5. Gateway sends [SYNC, [...all strokes]] to the new browser
6. Browser's store pushes all history into remoteStrokesQueue
7. Canvas renderLoop replays entire history → canvas is up to date
```

---

## 8. Failure Scenarios & How We Handle Them

### Scenario 1: Leader crashes mid-stroke

- Gateway's forward to leader fails
- Gateway retries up to 3 times, calling `discoverLeader()` each time
- Meanwhile, replica1 and replica3 notice missing heartbeats
- One of them wins election (within 800ms)
- Gateway discovers new leader on next poll (within 2s) or immediately on retry
- Stroke is re-sent to new leader
- Users see a brief pause (~1s) but no disconnect

### Scenario 2: Follower crashes

- Leader keeps sending AppendEntries to the two remaining nodes
- Majority is still 2 (leader + 1 follower) → commits continue normally
- Users notice nothing
- When follower restarts, it comes back as FOLLOWER with empty log
- Leader's next AppendEntries fails the `prevLogIndex` check
- Follower returns its `logLength` (0)
- Leader sets `nextIndex[follower] = 0` and sends all entries from the beginning
- Follower catches up completely

### Scenario 3: Hot reload (file edit)

- Developer edits `apps/replica1/src/server.ts`
- nodemon detects change, gracefully restarts the Node process
- Container is briefly unavailable (~2–3s)
- Replica2 and Replica3 maintain quorum (2 nodes = majority of 3)
- Replica1 restarts, starts as FOLLOWER, catches up via AppendEntries
- Zero client disconnections

### Scenario 4: Two replicas crash (total loss of quorum)

- Only 1 replica remains — cannot reach majority
- New strokes cannot be committed (leader can't get 2 confirmations)
- System becomes unavailable for writes
- Existing clients keep their WebSocket connections
- When a second replica comes back, quorum is restored and commits resume
- This is expected behavior — RAFT requires majority availability

### Scenario 5: Network split (split brain)

- If replica1 can't talk to replica2/3, it might think they're dead and call an election
- But replica2 and replica3 still have each other → they also elect a leader
- Now two "leaders" exist — but only the one with the majority (2 nodes) can commit
- The lone replica1 can't get majority votes → its elections fail
- When the network heals, replica1 sees a higher term and steps down immediately

---

## 9. Docker & Hot Reload

### How the Dockerfiles work

All three replica Dockerfiles follow the same pattern:

```dockerfile
# 1. Copy base replica's package.json and install dependencies
COPY apps/replica/package.json ./apps/replica/
RUN npm install

# 2. Copy the base replica code
COPY apps/replica ./apps/replica

# 3. Override src/ with THIS replica's source
COPY apps/replica1/src ./apps/replica/src

# 4. Run from the base replica directory
WORKDIR /app/apps/replica
CMD ["npm", "run", "dev"]   # nodemon watches src/
```

### How bind mounts enable hot reload

In `docker-compose.yml`:

```yaml
replica1:
  volumes:
    - ./apps/replica1/src:/app/apps/replica/src   # your edits → container
    - ./packages:/app/packages
```

When you save a file on your host machine, Docker instantly reflects it inside the container. nodemon sees the change and restarts the Node process. The other two replicas are unaffected.

### Why this matters for RAFT

Restarting one replica = losing one node. With 3 nodes, losing 1 still leaves 2 = majority. The cluster keeps committing. When the restarted node comes back, it catches up. This is exactly how production systems do rolling deployments.

---

## 10. API Reference

### Gateway

| Method | Path | Description |
|---|---|---|
| WS | `ws://gateway:8080` | Browser WebSocket connection |
| POST | `/commit` (port 8081) | Replica → Gateway: broadcast committed stroke |
| GET | `/health` | Health check |

### Replica

| Method | Path | Description |
|---|---|---|
| GET | `/status` | Returns `{ id, state, term, logLength, commitIndex }` |
| GET | `/health` | Health check |
| POST | `/request-vote` | RAFT: candidate requests vote |
| POST | `/append-entries` | RAFT: leader replicates log entries |
| POST | `/heartbeat` | RAFT: leader heartbeat (empty AppendEntries) |
| POST | `/client-stroke` | Gateway → Leader: submit new stroke |
| GET | `/room-log/:roomId` | Gateway → Leader: get committed history for room |
| GET | `/sync-log?fromIndex=N` | Catch-up: get all entries from index N onward |

### WebSocket Message Format

All messages are JSON arrays: `[MsgType, ...payload]`

| Message | Direction | Format |
|---|---|---|
| JOIN_ROOM | Browser → Gateway | `[0, roomId, playerId]` |
| DRAW_START | Browser → Gateway | `[3, x, y, color, lineWidth]` |
| DRAW_MOVE | Browser → Gateway | `[4, x, y]` |
| DRAW_END | Browser → Gateway | `[5]` |
| SYNC | Gateway → Browser | `[9, [[stroke1], [stroke2], ...]]` |
| DRAW_START (broadcast) | Gateway → Browser | `[3, x, y, color, width, playerId]` |

---

## 11. Team Contributions

### Varun Rathod — PES2UG23CS679
**Role: RAFT Core & Consensus Protocol**
- Designed and implemented the full RAFT state machine (`RaftNode` class)
- Implemented leader election, vote request/grant logic, and term management
- Implemented `AppendEntries` RPC with log consistency checks
- Implemented fast catch-up using `logLength` in failure responses
- Wrote `updateCommitIndex` majority quorum logic
- Tested election correctness under split-vote and simultaneous failure scenarios

### Vatsal Jain — PES2UG23CS681
**Role: Frontend, Real-Time Canvas & Shared Protocol**
- Built the React canvas drawing interface
- Implemented pointer event handling with coordinate normalization across all screen sizes
- Built the Zustand store with WebSocket lifecycle management (connect, reconnect, room switching)
- Implemented the `requestAnimationFrame` render loop for smooth remote stroke rendering
- Implemented own-stroke filtering via `playerId` to prevent double-drawing
- Designed and maintained the `@scraw/shared` protocol package — the `MsgType` enum used by all services
- Ensured consistent message format (JSON arrays) across frontend, gateway, and replicas
- Ensured smooth drawing with no flicker during leader failovers

### Vedanta Barman — PES2UG23CS682
**Role: Gateway & System Integration**
- Built the Gateway WebSocket server handling all browser connections
- Implemented leader discovery polling (every 2s via `GET /status`) and failover retry logic (3 attempts)
- Implemented the `/commit` HTTP listener on port 8081 and per-room broadcast to clients
- Integrated room history sync — `JOIN_ROOM` triggers `GET /room-log/:roomId` → `SYNC` message to browser
- Wired up the full message pipeline: browser stroke → gateway → leader → commit → broadcast
- Debugged and resolved race conditions in leader re-routing during rapid failovers
- Validated end-to-end correctness across multi-client, multi-room scenarios

### Vrishabh S. Hiremath — PES2UG23CS709
**Role: Docker, DevOps & Hot Reload**
- Designed the multi-stage Dockerfile strategy for replicas
- Configured `docker-compose.yml` with bind mounts, networks, and env vars
- Set up nodemon hot-reload for all backend services
- Implemented the separate `replica1/src`, `replica2/src`, `replica3/src` folder strategy
- Managed the shared `packages/shared` protocol package and workspace config
- Tested zero-downtime rolling reload scenarios

---

## 12. Viva Q&A Prep

**Q: What is RAFT and why did you use it?**  
RAFT is a consensus algorithm that ensures multiple servers agree on a shared log of events. We used it so that if any replica crashes, the others still have the correct stroke history and can continue serving users. It's simpler to understand than Paxos but provides the same guarantees.

**Q: What happens when the leader crashes?**  
The followers stop receiving heartbeats. After their election timeout (500–800ms), one of them starts an election, gets votes from the other, and becomes the new leader. The gateway detects the new leader within 2 seconds (or immediately on a failed forward retry) and starts routing to it.

**Q: How do you prevent two leaders at the same time?**  
Terms. Every election increments the term number. A node only votes once per term. To win, a candidate needs majority votes. In a 3-node cluster, you can't have two nodes each get 2 votes — there aren't enough votes. If a stale leader ever sees a message with a higher term, it immediately steps down.

**Q: What is "committed" vs "appended"?**  
Appended means the entry is in the log but not yet safe — it could be overwritten if the leader crashes before replicating. Committed means a majority of nodes have it, so it will survive any single failure. Only committed strokes are broadcast to clients.

**Q: How does a restarted replica catch up?**  
It starts with an empty log. The leader sends it an AppendEntries. The `prevLogIndex` check fails (follower has nothing). The follower returns its log length (0). The leader sets `nextIndex[follower] = 0` and sends all committed entries. The follower appends them all and is now in sync.

**Q: Why are there separate replica1/2/3 source folders?**  
So you can edit one replica's code and only that container restarts. The other two stay alive, maintaining quorum. If all three shared one source folder, editing it would restart all three simultaneously — losing quorum and causing downtime.

**Q: How does the frontend avoid drawing its own strokes twice?**  
Each browser session generates a random `playerId`. Every stroke sent to the gateway gets the `playerId` appended. When the gateway broadcasts the stroke back to all clients (including the sender), the sender checks if the `playerId` matches its own and skips drawing it — because it already drew it locally.

**Q: What is the heartbeat for?**  
Two purposes: (1) tells followers "the leader is still alive, don't start an election" and (2) carries any pending log entries to keep followers in sync. It fires every 150ms, which is well within the 500ms minimum election timeout.

**Q: What happens if only 1 replica is running?**  
It cannot commit anything — it needs 2 out of 3 confirmations. The system accepts new strokes from clients but they never get committed or broadcast. As soon as a second replica comes back online, the leader can reach majority again and commits resume.

**Q: How is this similar to real cloud systems?**  
Kubernetes uses etcd (which runs RAFT) to store all cluster state. CockroachDB uses RAFT for each data range. Our system is a miniature version of the same pattern: a consensus-backed log that drives a state machine (the canvas), with a gateway (like a load balancer) routing to the current leader.

**Q: What is the role of the Gateway?**  
The Gateway is a stateless router. It holds WebSocket connections from browsers (so browsers don't need to know about replicas), discovers which replica is the leader, forwards strokes to it, and broadcasts committed strokes back to all browsers. It never stores any drawing state itself.

**Q: What does "zero-downtime deployment" mean here?**  
When you edit a replica's code, only that one container restarts (~2–3 seconds). The other two replicas keep the cluster running. No client disconnects. When the restarted replica comes back, it rejoins as a follower and catches up. From the user's perspective, nothing happened.

---

*Built with Node.js, React, TypeScript, Docker, and a healthy respect for distributed systems.*
