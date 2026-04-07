# Scraw 🖌️

A high-performance, real-time multiplayer drawing and guessing game MVP built with a focus on ultra-low latency and production-grade architecture.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)
![Node](https://img.shields.io/badge/backend-Node.js%20%2B%20WS-339933)
![Latency](https://img.shields.io/badge/latency-%3C50ms-brightgreen)

## 🚀 Overview

Scraw is a scalable, "Scribble.io-style" multiplayer application. Unlike standard drawing apps, Scraw is architected like a distributed system to ensure that mouse strokes are propagated to all participants in less than 50ms, creating a "zero-lag" drawing experience.

### Key Features
- **Ultra-Low Latency**: Uses delta-encoding and frame-batching to minimize network overhead.
- **Persistent Room State**: Drawings stay in the room even if all users disconnect.
- **Optimistic Rendering**: Local strokes are rendered instantly while remote strokes are interpolated.
- **Production Ready**: Fully Dockerized and Kubernetes-ready (handles sticky sessions/consistent hashing).

---

## 🏗️ Architecture

The project is organized as a Modern Monorepo using `npm workspaces`:

```text
/apps
  /frontend     # React (Vite) + Canvas API + Zustand
  /backend      # Node.js + WebSocket (ws) + Room Manager
/packages
  /shared       # Shared types, MsgTypes, and Protocol definitions
```

### Protocol Efficiency
Scraw uses a **Tuple-based JSON Protocol** to strip away redundant keys and minimize packet size:
- **Draw Event**: `[MsgType.DRAW_MOVE, [dx1, dy1, dx2, dy2, ...]]`
- This ensures that hundreds of points per second don't saturate the TCP buffer.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite 8, Zustand (State), Native Canvas API.
- **Backend**: Node.js, `ws` (WebSocket Library), `ts-node-dev`.
- **Infrastructure**: Docker, Docker Compose, Kubernetes (Ingress NGINX).

---

## 💻 Local Development

### Prerequisites
- Node.js 20+
- Docker Desktop (Optional, for containerized dev)

### Setup
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Start the dev environment locally:
   ```bash
   # Terminal 1: Backend
   npm run dev --workspace=backend

   # Terminal 2: Frontend
   npm run dev --workspace=frontend
   ```
   *Frontend loads at: http://localhost:5173*

### Running with Docker
```bash
docker-compose up --build
```

---

## 🚢 Deployment

Scraw uses a **Hybrid Deployment Strategy**:

1. **Frontend (Vercel)**:
   - Deploy `apps/frontend`.
   - Set `VITE_WS_URL` env variable to your backend's `wss://` URI.
   - Enable "Include Source Files from Outside the Root Directory".

2. **Backend (Railway / Render / Fly.io)**:
   - Deploy the monorepo root.
   - Set start command to `npm install && npm run start --workspace=backend`.
   - Expose port `8080`.

---

## ⚡ Performance Optimization Tips

- **Canvas Scaling**: The engine automatically handles `DevicePixelRatio` for high-DPI (Retina) screens.
- **Interpolation**: Remote strokes use a `requestAnimationFrame` queue to smooth out network jitter.
- **Stateless Backend**: While the rooms are in-memory for speed, the RoomManager is designed to be easily backed by Redis if horizontal scaling is required.

---

## 📜 License

MIT License. Designed with ❤️ for realtime graphics specialists.
