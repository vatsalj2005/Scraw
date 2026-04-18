import express from 'express';
import axios from 'axios';

const REPLICA_ID = process.env.REPLICA_ID || 'replica1';
const PORT = parseInt(process.env.PORT || '3001');
const PEERS = (process.env.PEERS || '').split(',').filter(p => p && p.trim());
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:8081';

type State = 'FOLLOWER' | 'CANDIDATE' | 'LEADER';

interface LogEntry {
  term: number;
  roomId: string;
  stroke: any[];
  index: number;
}

// Response from AppendEntries / Heartbeat — includes logLength for fast catch-up
interface AppendEntriesResponse {
  term: number;
  success: boolean;
  logLength?: number; // Follower's current log length, used by leader for fast catch-up
}

class RaftNode {
  private state: State = 'FOLLOWER';
  private currentTerm = 0;
  private votedFor: string | null = null;
  private log: LogEntry[] = [];
  private commitIndex = -1;  // -1 = nothing committed yet (log is 0-indexed)
  private lastApplied = -1;  // -1 = nothing applied yet

  private electionTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  private votesReceived = 0;
  private nextIndex: Map<string, number> = new Map();
  private matchIndex: Map<string, number> = new Map();

  // Re-entrancy guard for applyCommitted
  private applyRunning = false;

  // Per-peer reachability tracking (leader perspective)
  private peerReachable: Map<string, boolean> = new Map(PEERS.map(p => [p, true]));

  constructor() {
    console.log(`\n[${REPLICA_ID}] Node started — joining cluster as FOLLOWER\n`);
    this.resetElectionTimeout();
    this.registerShutdownHooks();
  }

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  private registerShutdownHooks() {
    const shutdown = (signal: string) => {
      console.log(`\n[${REPLICA_ID}] Node stopping (${signal}) — leaving cluster\n`);
      process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  }

  // ─── Peer reachability tracking ───────────────────────────────────────────

  private onPeerReachable(peer: string) {
    if (this.peerReachable.get(peer) === false) {
      console.log(`\n[${REPLICA_ID}] Peer ${peer} is back online\n`);
      this.peerReachable.set(peer, true);
    }
  }

  private onPeerUnreachable(peer: string) {
    if (this.peerReachable.get(peer) !== false) {
      console.log(`\n[${REPLICA_ID}] Peer ${peer} is unreachable (may be down)\n`);
      this.peerReachable.set(peer, false);
    }
  }

  // ─── Public status ────────────────────────────────────────────────────────

  getState() {
    return {
      id: REPLICA_ID,
      state: this.state,
      term: this.currentTerm,
      logLength: this.log.length,
      commitIndex: this.commitIndex,
    };
  }

  // ─── Election timeout ─────────────────────────────────────────────────────

  private resetElectionTimeout() {
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    const timeout = 500 + Math.random() * 300; // 500–800 ms per spec
    this.electionTimeout = setTimeout(() => this.startElection(), timeout);
  }

  // ─── Election ─────────────────────────────────────────────────────────────

  private startElection() {
    this.state = 'CANDIDATE';
    this.currentTerm++;
    this.votedFor = REPLICA_ID;
    this.votesReceived = 1; // vote for self

    console.log(`\n[${REPLICA_ID}] Starting election for term ${this.currentTerm}\n`);

    this.resetElectionTimeout(); // restart timer in case of split vote

    PEERS.forEach(peer => this.requestVote(peer));
  }

  private async requestVote(peer: string) {
    try {
      const lastLogIndex = this.log.length - 1;
      const lastLogTerm = this.log.length > 0 ? this.log[lastLogIndex].term : 0;

      const res = await axios.post(
        `http://${peer}/request-vote`,
        { term: this.currentTerm, candidateId: REPLICA_ID, lastLogIndex, lastLogTerm },
        { timeout: 300 }
      );

      this.onPeerReachable(peer);

      if (res.data.voteGranted && this.state === 'CANDIDATE') {
        this.votesReceived++;
        console.log(
          `[${REPLICA_ID}] Received vote from ${peer} (${this.votesReceived}/${PEERS.length + 1})`
        );
        if (this.votesReceived > (PEERS.length + 1) / 2) {
          this.becomeLeader();
        }
      } else if (res.data.term > this.currentTerm) {
        this.stepDown(res.data.term);
      }
    } catch (_) {
      this.onPeerUnreachable(peer);
    }
  }

  private becomeLeader() {
    if (this.state !== 'CANDIDATE') return; // guard against duplicate calls
    console.log(`\n[${REPLICA_ID}] Became LEADER for term ${this.currentTerm}\n`);
    this.state = 'LEADER';

    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
      this.electionTimeout = null;
    }

    // nextIndex starts at end of our log; matchIndex starts at -1 (nothing confirmed)
    PEERS.forEach(peer => {
      this.nextIndex.set(peer, this.log.length);
      this.matchIndex.set(peer, -1);
    });

    // Send immediate heartbeat then start interval — 150 ms per spec
    this.sendHeartbeats();
    this.heartbeatInterval = setInterval(() => this.sendHeartbeats(), 150);
  }

  private stepDown(newTerm: number) {
    console.log(`\n[${REPLICA_ID}] Stepping down to FOLLOWER (term ${newTerm})\n`);
    this.state = 'FOLLOWER';
    this.currentTerm = newTerm;
    this.votedFor = null;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.resetElectionTimeout();
  }

  private async sendHeartbeats() {
    if (this.state !== 'LEADER') return;
    PEERS.forEach(peer => this.sendAppendEntries(peer));
  }

  // ─── Log replication ──────────────────────────────────────────────────────

  private async sendAppendEntries(peer: string) {
    const nextIdx = this.nextIndex.get(peer) ?? this.log.length;
    const prevLogIndex = nextIdx - 1;
    const prevLogTerm = prevLogIndex >= 0 && this.log[prevLogIndex]
      ? this.log[prevLogIndex].term
      : 0;
    
    // Chunk large catch-ups to avoid payload size issues (max 100 entries per batch)
    const MAX_ENTRIES_PER_BATCH = 100;
    const allEntries = this.log.slice(nextIdx);
    const entries = allEntries.slice(0, MAX_ENTRIES_PER_BATCH);

    try {
      const res = await axios.post<AppendEntriesResponse>(
        `http://${peer}/append-entries`,
        {
          term: this.currentTerm,
          leaderId: REPLICA_ID,
          prevLogIndex,
          prevLogTerm,
          entries,
          leaderCommit: this.commitIndex,
        },
        { timeout: 500, maxBodyLength: 50 * 1024 * 1024 }
      );

      this.onPeerReachable(peer);

      if (res.data.success) {
        if (entries.length > 0) {
          const newMatchIndex = nextIdx + entries.length - 1;
          this.nextIndex.set(peer, nextIdx + entries.length);
          this.matchIndex.set(peer, newMatchIndex);
          this.updateCommitIndex();
          
          // If there are more entries to send, send them immediately
          if (allEntries.length > MAX_ENTRIES_PER_BATCH) {
            setImmediate(() => this.sendAppendEntries(peer));
          }
        }
      } else {
        if (res.data.term > this.currentTerm) {
          this.stepDown(res.data.term);
        } else {
          // Fast catch-up: if follower returned its log length, jump directly
          if (typeof res.data.logLength === 'number') {
            this.nextIndex.set(peer, Math.max(0, res.data.logLength));
          } else {
            // Fallback: decrement one step
            this.nextIndex.set(peer, Math.max(0, nextIdx - 1));
          }
        }
      }
    } catch (_) {
      this.onPeerUnreachable(peer);
    }
  }

  // ─── Commit ───────────────────────────────────────────────────────────────

  private updateCommitIndex() {
    for (let n = this.log.length - 1; n > this.commitIndex; n--) {
      if (this.log[n].term !== this.currentTerm) continue;

      let count = 1; // self
      PEERS.forEach(peer => {
        if ((this.matchIndex.get(peer) ?? -1) >= n) count++;
      });

      if (count > (PEERS.length + 1) / 2) {
        console.log(`[${REPLICA_ID}] Committing entries up to index ${n}`);
        this.commitIndex = n;
        this.applyCommitted();
        break;
      }
    }
  }

  private async applyCommitted() {
    if (this.applyRunning) return;
    this.applyRunning = true;
    try {
      while (this.lastApplied < this.commitIndex) {
        this.lastApplied++;
        const entry = this.log[this.lastApplied];
        if (!entry) break;

        console.log(
          `[${REPLICA_ID}] Applying log[${this.lastApplied}] to gateway (room: ${entry.roomId})`
        );

        try {
          await axios.post(
            `${GATEWAY_URL}/commit`,
            { roomId: entry.roomId, stroke: entry.stroke },
            { timeout: 200 }
          );
        } catch (e) {
          console.error(`[${REPLICA_ID}] Failed to notify gateway for index ${this.lastApplied}:`, e);
        }
      }
    } finally {
      this.applyRunning = false;
    }
  }

  // ─── RPC handlers ─────────────────────────────────────────────────────────

  handleRequestVote(req: any): any {
    const { term, candidateId, lastLogIndex, lastLogTerm } = req;

    if (term > this.currentTerm) {
      this.stepDown(term);
    }

    let voteGranted = false;

    if (term < this.currentTerm) {
      voteGranted = false;
    } else if (this.votedFor === null || this.votedFor === candidateId) {
      const myLastIndex = this.log.length - 1;
      const myLastTerm = this.log.length > 0 ? this.log[myLastIndex].term : 0;

      if (
        lastLogTerm > myLastTerm ||
        (lastLogTerm === myLastTerm && lastLogIndex >= myLastIndex)
      ) {
        voteGranted = true;
        this.votedFor = candidateId;
        this.resetElectionTimeout();
        console.log(`[${REPLICA_ID}] Voted for ${candidateId} in term ${term}`);
      }
    }

    return { term: this.currentTerm, voteGranted };
  }

  handleAppendEntries(req: any): AppendEntriesResponse {
    const { term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit } = req;

    if (term > this.currentTerm) {
      this.stepDown(term);
    }

    if (term < this.currentTerm) {
      return { term: this.currentTerm, success: false, logLength: this.log.length };
    }

    // Valid leader — reset election timeout
    this.resetElectionTimeout();

    // If we're somehow still a candidate or leader for the same term, step down
    if (this.state !== 'FOLLOWER') {
      this.stepDown(term);
    }

    // Log consistency check
    if (prevLogIndex >= 0) {
      if (
        prevLogIndex >= this.log.length ||
        this.log[prevLogIndex].term !== prevLogTerm
      ) {
        console.log(
          `[${REPLICA_ID}] Log inconsistency: prevLogIndex=${prevLogIndex}, myLogLength=${this.log.length}`
        );
        return { term: this.currentTerm, success: false, logLength: this.log.length };
      }
    }

    // Append new entries (truncate any conflicting suffix first)
    if (entries && entries.length > 0) {
      this.log = this.log.slice(0, prevLogIndex + 1);
      this.log.push(...entries);
      console.log(`[${REPLICA_ID}] Appended ${entries.length} entries from leader ${leaderId}`);
    }

    // Advance commit index
    if (leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(leaderCommit, this.log.length - 1);
      this.applyCommitted();
    }

    return { term: this.currentTerm, success: true };
  }

  handleClientStroke(roomId: string, stroke: any[]) {
    if (this.state !== 'LEADER') {
      throw new Error('Not leader');
    }

    const entry: LogEntry = {
      term: this.currentTerm,
      roomId,
      stroke,
      index: this.log.length,
    };

    this.log.push(entry);
    console.log(`[${REPLICA_ID}] Appended stroke to log (index ${entry.index})`);

    // Replicate to followers
    this.sendHeartbeats();
  }

  getRoomLog(roomId: string): any[] {
    return this.log
      .filter(entry => entry.roomId === roomId && entry.index <= this.commitIndex)
      .map(entry => entry.stroke);
  }
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '50mb' }));

const node = new RaftNode();

app.get('/health', (_req, res) => res.send('OK'));

app.get('/status', (_req, res) => {
  res.json(node.getState());
});

app.post('/request-vote', (req, res) => {
  const result = node.handleRequestVote(req.body);
  res.json(result);
});

app.post('/append-entries', (req, res) => {
  const result = node.handleAppendEntries(req.body);
  res.json(result);
});

app.post('/client-stroke', (req, res) => {
  try {
    const { stroke, roomId } = req.body;
    node.handleClientStroke(roomId || 'default', stroke);
    res.json({ success: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get('/room-log/:roomId', (req, res) => {
  const log = node.getRoomLog(req.params.roomId);
  res.json({ log });
});

app.listen(PORT, () => {
  console.log(`[${REPLICA_ID}] Listening on port ${PORT}`);
});
