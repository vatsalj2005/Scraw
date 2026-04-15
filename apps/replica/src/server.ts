import express from 'express';
import axios from 'axios';

const REPLICA_ID = process.env.REPLICA_ID || 'replica1';
const PORT = parseInt(process.env.PORT || '3001');
const PEERS = (process.env.PEERS || '').split(',').filter(p => p && p.trim());
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:8081';

// Enable CORS for cloud deployment
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

type State = 'FOLLOWER' | 'CANDIDATE' | 'LEADER';

interface LogEntry {
  term: number;
  roomId: string;
  stroke: any[];
  index: number;
}

class RaftNode {
  private state: State = 'FOLLOWER';
  private currentTerm = 0;
  private votedFor: string | null = null;
  private log: LogEntry[] = [];
  private commitIndex = 0;
  private lastApplied = 0;
  
  private electionTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  
  private votesReceived = 0;
  private nextIndex: Map<string, number> = new Map();
  private matchIndex: Map<string, number> = new Map();

  constructor() {
    console.log(`[${REPLICA_ID}] Starting as FOLLOWER`);
    this.resetElectionTimeout();
  }

  getState() {
    return {
      id: REPLICA_ID,
      state: this.state,
      term: this.currentTerm,
      logLength: this.log.length,
      commitIndex: this.commitIndex
    };
  }

  private resetElectionTimeout() {
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    const timeout = 500 + Math.random() * 300; // 500-800ms
    this.electionTimeout = setTimeout(() => this.startElection(), timeout);
  }

  private startElection() {
    this.state = 'CANDIDATE';
    this.currentTerm++;
    this.votedFor = REPLICA_ID;
    this.votesReceived = 1; // Vote for self
    
    console.log(`[${REPLICA_ID}] Starting election for term ${this.currentTerm}`);
    
    this.resetElectionTimeout();
    
    // Request votes from peers
    PEERS.forEach(peer => this.requestVote(peer));
  }

  private async requestVote(peer: string) {
    try {
      const lastLogIndex = this.log.length - 1;
      const lastLogTerm = this.log.length > 0 ? this.log[lastLogIndex].term : 0;
      
      const res = await axios.post(`http://${peer}/request-vote`, {
        term: this.currentTerm,
        candidateId: REPLICA_ID,
        lastLogIndex,
        lastLogTerm
      }, { timeout: 300 });

      if (res.data.voteGranted && this.state === 'CANDIDATE') {
        this.votesReceived++;
        console.log(`[${REPLICA_ID}] Received vote from ${peer} (${this.votesReceived}/${PEERS.length + 1})`);
        
        // Majority check
        if (this.votesReceived > (PEERS.length + 1) / 2) {
          this.becomeLeader();
        }
      } else if (res.data.term > this.currentTerm) {
        this.stepDown(res.data.term);
      }
    } catch (e) {
      // Peer unreachable
    }
  }

  private becomeLeader() {
    console.log(`[${REPLICA_ID}] Became LEADER for term ${this.currentTerm}`);
    this.state = 'LEADER';
    
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    
    // Initialize leader state
    PEERS.forEach(peer => {
      this.nextIndex.set(peer, this.log.length);
      this.matchIndex.set(peer, 0);
    });
    
    // Start sending heartbeats
    this.sendHeartbeats();
    this.heartbeatInterval = setInterval(() => this.sendHeartbeats(), 150);
  }

  private stepDown(newTerm: number) {
    console.log(`[${REPLICA_ID}] Stepping down to FOLLOWER (term ${newTerm})`);
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

  private async sendAppendEntries(peer: string) {
    const nextIdx = this.nextIndex.get(peer) || 0;
    const prevLogIndex = nextIdx - 1;
    const prevLogTerm = prevLogIndex >= 0 ? this.log[prevLogIndex]?.term || 0 : 0;
    const entries = this.log.slice(nextIdx);

    try {
      const res = await axios.post(`http://${peer}/append-entries`, {
        term: this.currentTerm,
        leaderId: REPLICA_ID,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: this.commitIndex
      }, { timeout: 300 });

      if (res.data.success) {
        if (entries.length > 0) {
          this.nextIndex.set(peer, nextIdx + entries.length);
          this.matchIndex.set(peer, nextIdx + entries.length - 1);
          this.updateCommitIndex();
        }
      } else {
        // Log inconsistency, decrement nextIndex
        if (res.data.term > this.currentTerm) {
          this.stepDown(res.data.term);
        } else {
          this.nextIndex.set(peer, Math.max(0, nextIdx - 1));
        }
      }
    } catch (e) {
      // Peer unreachable
    }
  }

  private updateCommitIndex() {
    // Find highest N where majority has replicated
    for (let n = this.log.length - 1; n > this.commitIndex; n--) {
      if (this.log[n].term !== this.currentTerm) continue;
      
      let replicaCount = 1; // Self
      PEERS.forEach(peer => {
        if ((this.matchIndex.get(peer) || 0) >= n) replicaCount++;
      });
      
      if (replicaCount > (PEERS.length + 1) / 2) {
        console.log(`[${REPLICA_ID}] Committing entries up to index ${n}`);
        this.commitIndex = n;
        this.applyCommitted();
        break;
      }
    }
  }

  private async applyCommitted() {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const entry = this.log[this.lastApplied];
      
      // Notify gateway of committed stroke
      try {
        await axios.post(`${GATEWAY_URL}/commit`, {
          roomId: entry.roomId,
          stroke: entry.stroke
        }, { timeout: 500 });
      } catch (e) {
        console.error(`[${REPLICA_ID}] Failed to notify gateway:`, e);
      }
    }
  }

  handleRequestVote(req: any): any {
    const { term, candidateId, lastLogIndex, lastLogTerm } = req;
    
    if (term > this.currentTerm) {
      this.stepDown(term);
    }
    
    let voteGranted = false;
    
    if (term < this.currentTerm) {
      voteGranted = false;
    } else if (this.votedFor === null || this.votedFor === candidateId) {
      // Check log up-to-date
      const myLastIndex = this.log.length - 1;
      const myLastTerm = this.log.length > 0 ? this.log[myLastIndex].term : 0;
      
      if (lastLogTerm > myLastTerm || (lastLogTerm === myLastTerm && lastLogIndex >= myLastIndex)) {
        voteGranted = true;
        this.votedFor = candidateId;
        this.resetElectionTimeout();
        console.log(`[${REPLICA_ID}] Voted for ${candidateId} in term ${term}`);
      }
    }
    
    return { term: this.currentTerm, voteGranted };
  }

  handleAppendEntries(req: any): any {
    const { term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit } = req;
    
    if (term > this.currentTerm) {
      this.stepDown(term);
    }
    
    if (term < this.currentTerm) {
      return { term: this.currentTerm, success: false };
    }
    
    // Valid leader, reset election timeout
    this.resetElectionTimeout();
    
    if (this.state !== 'FOLLOWER') {
      this.stepDown(term);
    }
    
    // Check log consistency
    if (prevLogIndex >= 0) {
      if (prevLogIndex >= this.log.length || this.log[prevLogIndex].term !== prevLogTerm) {
        return { term: this.currentTerm, success: false };
      }
    }
    
    // Append entries
    if (entries && entries.length > 0) {
      this.log = this.log.slice(0, prevLogIndex + 1);
      this.log.push(...entries);
      console.log(`[${REPLICA_ID}] Appended ${entries.length} entries from ${leaderId}`);
    }
    
    // Update commit index
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
      index: this.log.length
    };
    
    this.log.push(entry);
    console.log(`[${REPLICA_ID}] Appended stroke to log (index ${entry.index})`);
    
    // Immediately replicate
    this.sendHeartbeats();
  }

  getRoomLog(roomId: string): any[] {
    return this.log
      .filter(entry => entry.roomId === roomId && entry.index <= this.commitIndex)
      .map(entry => entry.stroke);
  }

  getSyncLog(fromIndex: number): LogEntry[] {
    return this.log.slice(fromIndex);
  }
}

const app = express();

// CORS middleware for cloud deployment
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

const node = new RaftNode();

app.get('/health', (req, res) => res.send('OK'));

app.get('/status', (req, res) => {
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
    const { stroke } = req.body;
    const roomId = 'default'; // Extract from stroke if needed
    node.handleClientStroke(roomId, stroke);
    res.json({ success: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get('/room-log/:roomId', (req, res) => {
  const log = node.getRoomLog(req.params.roomId);
  res.json({ log });
});

app.get('/sync-log', (req, res) => {
  const fromIndex = parseInt(req.query.fromIndex as string) || 0;
  const entries = node.getSyncLog(fromIndex);
  res.json({ entries });
});

app.listen(PORT, () => {
  console.log(`[${REPLICA_ID}] Listening on port ${PORT}`);
});
