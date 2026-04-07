# Scraw 🖌️

A high-performance, **zero-downtime** real-time multiplayer drawing board. Built with a **Stateless Architecture** and **Unified 1080p Coordinate Grid** to guarantee pixel-perfect synchronization across any device—from mobile phones to 4K monitors.

![React](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)
![Node](https://img.shields.io/badge/backend-Node.js%20%2B%20WS-339933)
![State](https://img.shields.io/badge/state-Redis-red)
![Architecture](https://img.shields.io/badge/architecture-Monorepo%20%2B%20Web%20Engine-orange)

---

## 🚀 Key Features

- **Pixel-Perfect Sync**: Uses a fixed internal **1920x1080 Virtual Resolution**. Whether you're on a phone or ultra-wide monitor, every stroke aligns perfectly.
- **High Availability (HA)**: Stateless backend design. If a server pod restarts or hot-reloads, the drawing board recovers instantly.
- **Redis Persistence**: Every stroke is persisted to Redis. Rooms maintain history even if the server is wiped or updated.
- **Ultra-Low Latency**: Custom binary-efficient JSON protocol using **Delta-Encoding** to minimize network packets.
- **Smart Room Management**: Automatic room creation and cleanup. When the last player leaves, the room and its Redis history are wiped.

---

## 🏗️ Architecture & Protocol

### 1. Unified Resolve Grid
Scraw doesn't communicate in screen pixels. It uses an internal **1080p virtual canvas**.
- **Input Scaling**: Mouse coordinates are mapped: `(MousePos / CSSSize) * 1920`.
- **Output Scaling**: Received coordinates are mapped: `(InternalPos / 1920) * LocalScreenSize`.
*This eliminates all "Shifting" or "Stretching" bugs typical in many multiplayer canvas apps.*

### 2. Multi-User Delta Engine
Strokes are batched and sent as deltas (`dx`, `dy`) rather than absolute points. Each packet includes a `playerId` to prevent line-contamination between concurrent drawers. 

### 3. Stateless Room Lifecycle
- **Stateless Backend**: Backend replicas handle logic but keep long-term state in **Redis**.
- **Sync Snapshots**: Late-joiners receive a single **SYNC** packet containing the entire board history as a single burst, preventing frame-drop during room entry.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Zustand, HTML5 Canvas API.
- **Backend**: Node.js, `ws` (WebSockets), `ioredis`.
- **Packages**: Shared TypeScript monorepo for protocol typing.
- **Hosting**: Recommended **Vercel** (Frontend) + **Railway/Render** (Backend + Redis).

---

## 💻 Local Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start with Docker (Recommended for Redis)**:
   ```bash
   docker-compose up --build
   ```
   *Frontend: http://localhost:5173 | Backend: http://localhost:8080*

3. **Start Manually**:
   ```bash
   # Terminal 1: Backend (Needs REDIS_URL)
   npm run dev --workspace=backend
   
   # Terminal 2: Frontend
   npm run dev --workspace=frontend
   ```

---

## 🚢 Production Deployment

### 1. Redis (Railway/Managed)
Deploy a Redis instance and copy the `REDIS_URL`.

### 2. Backend (Railway/Render)
- Deploy the monorepo root.
- Set **Health Check Path** to `/health`.
- Set Environment Variable: `REDIS_URL` = (Your Redis URL).
- Set Environment Variable: `PORT` = `8080`.

### 3. Frontend (Vercel)
- **Root Directory**: `apps/frontend`.
- **Build Command**: `cd ../.. && npm install && npm run build --workspace=frontend`.
- **Environment Variable**: `VITE_WS_URL` = `wss://your-backend-url.com`.
- Enable "Include source files from outside root directory" in Vercel settings.

---

## 📜 License
MIT. Built with ❤️ for the real-time graphics community.
