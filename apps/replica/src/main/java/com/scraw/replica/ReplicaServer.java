package com.scraw.replica;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public final class ReplicaServer {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String REPLICA_ID = envOrDefault("REPLICA_ID", "replica1");
    private static final int PORT = parseInt(envOrDefault("PORT", "3001"), 3001);
    private static final String GATEWAY_URL = envOrDefault("GATEWAY_URL", "http://gateway:8081");

    public static void main(String[] args) throws Exception {
        List<String> peers = parsePeers(System.getenv("PEERS"));
        RaftNode node = new RaftNode(REPLICA_ID, peers, GATEWAY_URL);

        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/", exchange -> handleRequest(exchange, node));
        server.start();

        System.out.println("[" + REPLICA_ID + "] Listening on port " + PORT);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            node.shutdown();
            server.stop(0);
        }));
    }

    private static void handleRequest(HttpExchange exchange, RaftNode node) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String method = exchange.getRequestMethod();

        try {
            if ("GET".equalsIgnoreCase(method) && "/health".equals(path)) {
                sendText(exchange, 200, "OK");
                return;
            }

            if ("GET".equalsIgnoreCase(method) && "/status".equals(path)) {
                sendJson(exchange, 200, node.getState());
                return;
            }

            if ("POST".equalsIgnoreCase(method) && "/request-vote".equals(path)) {
                Map<String, Object> body = readJsonMap(exchange.getRequestBody());
                sendJson(exchange, 200, node.handleRequestVote(body));
                return;
            }

            if ("POST".equalsIgnoreCase(method) && "/append-entries".equals(path)) {
                Map<String, Object> body = readJsonMap(exchange.getRequestBody());
                sendJson(exchange, 200, node.handleAppendEntries(body));
                return;
            }

            if ("POST".equalsIgnoreCase(method) && "/client-stroke".equals(path)) {
                Map<String, Object> body = readJsonMap(exchange.getRequestBody());
                String roomId = body.get("roomId") == null ? "default" : body.get("roomId").toString();

                @SuppressWarnings("unchecked")
                List<Object> stroke = (List<Object>) body.get("stroke");

                try {
                    node.handleClientStroke(roomId, stroke);
                    sendJson(exchange, 200, Map.of("success", true));
                } catch (IllegalStateException e) {
                    sendJson(exchange, 503, Map.of("error", e.getMessage()));
                }
                return;
            }

            if ("GET".equalsIgnoreCase(method) && path.startsWith("/room-log/")) {
                String roomIdEncoded = path.substring("/room-log/".length());
                String roomId = URLDecoder.decode(roomIdEncoded, StandardCharsets.UTF_8);
                sendJson(exchange, 200, Map.of("log", node.getRoomLog(roomId)));
                return;
            }

            sendText(exchange, 404, "Not found");
        } catch (Exception e) {
            sendText(exchange, 500, "Internal error: " + e.getMessage());
        }
    }

    private static Map<String, Object> readJsonMap(InputStream inputStream) throws IOException {
        String body = new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        if (body.isBlank()) {
            return new HashMap<>();
        }
        return MAPPER.readValue(body, new TypeReference<>() {
        });
    }

    private static void sendJson(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] payload = MAPPER.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, payload.length);
        exchange.getResponseBody().write(payload);
        exchange.close();
    }

    private static void sendText(HttpExchange exchange, int status, String body) throws IOException {
        byte[] payload = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.sendResponseHeaders(status, payload.length);
        exchange.getResponseBody().write(payload);
        exchange.close();
    }

    private static List<String> parsePeers(String rawPeers) {
        if (rawPeers == null || rawPeers.isBlank()) {
            return List.of();
        }

        List<String> peers = new ArrayList<>();
        for (String value : rawPeers.split(",")) {
            String peer = value.trim();
            if (!peer.isEmpty()) {
                peers.add(peer);
            }
        }
        return peers;
    }

    private static String envOrDefault(String key, String defaultValue) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private static int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(value);
        } catch (Exception e) {
            return fallback;
        }
    }

    private enum State {
        FOLLOWER,
        CANDIDATE,
        LEADER
    }

    private static final class LogEntry {
        private final int term;
        private final String roomId;
        private final List<Object> stroke;
        private final int index;

        private LogEntry(int term, String roomId, List<Object> stroke, int index) {
            this.term = term;
            this.roomId = roomId;
            this.stroke = stroke;
            this.index = index;
        }
    }

    private static final class AppendEntriesResponse {
        private final int term;
        private final boolean success;
        private final Integer logLength;

        private AppendEntriesResponse(int term, boolean success, Integer logLength) {
            this.term = term;
            this.success = success;
            this.logLength = logLength;
        }
    }

    private static final class RaftNode {
        private final String replicaId;
        private final List<String> peers;
        private final String gatewayUrl;

        private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);
        private final ExecutorService networkExecutor = Executors.newCachedThreadPool();
        private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(500))
            .build();
        private final Random random = new Random();

        private final Map<String, Boolean> peerReachable = new ConcurrentHashMap<>();
        private final Map<String, Integer> nextIndex = new ConcurrentHashMap<>();
        private final Map<String, Integer> matchIndex = new ConcurrentHashMap<>();

        private State state = State.FOLLOWER;
        private int currentTerm = 0;
        private String votedFor;
        private List<LogEntry> log = new ArrayList<>();
        private int commitIndex = -1;
        private int lastApplied = -1;

        private ScheduledFuture<?> electionTimeoutFuture;
        private ScheduledFuture<?> heartbeatFuture;

        private int votesReceived = 0;
        private boolean applyRunning = false;

        private RaftNode(String replicaId, List<String> peers, String gatewayUrl) {
            this.replicaId = replicaId;
            this.peers = peers;
            this.gatewayUrl = gatewayUrl;

            for (String peer : peers) {
                peerReachable.put(peer, true);
            }

            System.out.println("[" + replicaId + "] Node started - joining cluster as FOLLOWER");
            resetElectionTimeout();
        }

        private void shutdown() {
            synchronized (this) {
                if (electionTimeoutFuture != null) {
                    electionTimeoutFuture.cancel(true);
                }
                if (heartbeatFuture != null) {
                    heartbeatFuture.cancel(true);
                }
            }
            scheduler.shutdownNow();
            networkExecutor.shutdownNow();
        }

        private synchronized Map<String, Object> getState() {
            return Map.of(
                "id", replicaId,
                "state", state.name(),
                "term", currentTerm,
                "logLength", log.size(),
                "commitIndex", commitIndex
            );
        }

        private synchronized void resetElectionTimeout() {
            if (electionTimeoutFuture != null) {
                electionTimeoutFuture.cancel(false);
            }
            long timeoutMs = 500L + random.nextInt(301);
            electionTimeoutFuture = scheduler.schedule(this::startElection, timeoutMs, TimeUnit.MILLISECONDS);
        }

        private synchronized void startElection() {
            state = State.CANDIDATE;
            currentTerm++;
            votedFor = replicaId;
            votesReceived = 1;

            System.out.println("[" + replicaId + "] Starting election for term " + currentTerm);
            resetElectionTimeout();

            for (String peer : peers) {
                networkExecutor.submit(() -> requestVote(peer));
            }
        }

        private void requestVote(String peer) {
            int requestTerm;
            int lastLogIndex;
            int lastLogTerm;

            synchronized (this) {
                requestTerm = currentTerm;
                lastLogIndex = log.size() - 1;
                lastLogTerm = log.isEmpty() ? 0 : log.get(lastLogIndex).term;
            }

            Map<String, Object> payload = Map.of(
                "term", requestTerm,
                "candidateId", replicaId,
                "lastLogIndex", lastLogIndex,
                "lastLogTerm", lastLogTerm
            );

            Map<String, Object> response = postJson("http://" + peer + "/request-vote", payload, 300);
            if (response == null) {
                onPeerUnreachable(peer);
                return;
            }

            onPeerReachable(peer);
            boolean voteGranted = boolValue(response.get("voteGranted"));
            int responseTerm = intValue(response.get("term"));

            synchronized (this) {
                if (responseTerm > currentTerm) {
                    stepDownLocked(responseTerm);
                    return;
                }

                if (voteGranted && state == State.CANDIDATE && requestTerm == currentTerm) {
                    votesReceived++;
                    System.out.println("[" + replicaId + "] Received vote from " + peer + " (" + votesReceived + "/" + (peers.size() + 1) + ")");
                    if (votesReceived > (peers.size() + 1) / 2) {
                        becomeLeaderLocked();
                    }
                }
            }
        }

        private synchronized void becomeLeaderLocked() {
            if (state != State.CANDIDATE) {
                return;
            }

            System.out.println("[" + replicaId + "] Became LEADER for term " + currentTerm);
            state = State.LEADER;

            if (electionTimeoutFuture != null) {
                electionTimeoutFuture.cancel(false);
                electionTimeoutFuture = null;
            }

            for (String peer : peers) {
                nextIndex.put(peer, log.size());
                matchIndex.put(peer, -1);
            }

            sendHeartbeats();

            if (heartbeatFuture != null) {
                heartbeatFuture.cancel(false);
            }
            heartbeatFuture = scheduler.scheduleAtFixedRate(this::sendHeartbeats, 150, 150, TimeUnit.MILLISECONDS);
        }

        private synchronized void stepDownLocked(int newTerm) {
            state = State.FOLLOWER;
            currentTerm = newTerm;
            votedFor = null;

            if (heartbeatFuture != null) {
                heartbeatFuture.cancel(false);
                heartbeatFuture = null;
            }

            resetElectionTimeout();
        }

        private void sendHeartbeats() {
            List<String> peersSnapshot;
            synchronized (this) {
                if (state != State.LEADER) {
                    return;
                }
                peersSnapshot = new ArrayList<>(peers);
            }

            for (String peer : peersSnapshot) {
                networkExecutor.submit(() -> sendAppendEntries(peer));
            }
        }

        private void sendAppendEntries(String peer) {
            AppendRequest snapshot;

            synchronized (this) {
                if (state != State.LEADER) {
                    return;
                }

                int nextIdx = nextIndex.getOrDefault(peer, log.size());
                int prevLogIndex = nextIdx - 1;
                int prevLogTerm = (prevLogIndex >= 0 && prevLogIndex < log.size()) ? log.get(prevLogIndex).term : 0;

                int maxEntriesPerBatch = 100;
                int endExclusive = Math.min(log.size(), nextIdx + maxEntriesPerBatch);
                List<LogEntry> batchEntries = new ArrayList<>(log.subList(nextIdx, endExclusive));
                boolean hasMore = endExclusive < log.size();

                snapshot = new AppendRequest(currentTerm, nextIdx, prevLogIndex, prevLogTerm, commitIndex, batchEntries, hasMore);
            }

            List<Map<String, Object>> serializedEntries = new ArrayList<>();
            for (LogEntry entry : snapshot.entries) {
                serializedEntries.add(Map.of(
                    "term", entry.term,
                    "roomId", entry.roomId,
                    "stroke", entry.stroke,
                    "index", entry.index
                ));
            }

            Map<String, Object> payload = Map.of(
                "term", snapshot.term,
                "leaderId", replicaId,
                "prevLogIndex", snapshot.prevLogIndex,
                "prevLogTerm", snapshot.prevLogTerm,
                "entries", serializedEntries,
                "leaderCommit", snapshot.leaderCommit
            );

            Map<String, Object> responseMap = postJson("http://" + peer + "/append-entries", payload, 500);
            if (responseMap == null) {
                onPeerUnreachable(peer);
                return;
            }

            onPeerReachable(peer);
            AppendEntriesResponse response = new AppendEntriesResponse(
                intValue(responseMap.get("term")),
                boolValue(responseMap.get("success")),
                responseMap.get("logLength") == null ? null : intValue(responseMap.get("logLength"))
            );

            synchronized (this) {
                if (response.term > currentTerm) {
                    stepDownLocked(response.term);
                    return;
                }

                if (state != State.LEADER || snapshot.term != currentTerm) {
                    return;
                }

                if (response.success) {
                    if (!snapshot.entries.isEmpty()) {
                        int newMatch = snapshot.nextIdx + snapshot.entries.size() - 1;
                        nextIndex.put(peer, snapshot.nextIdx + snapshot.entries.size());
                        matchIndex.put(peer, newMatch);
                        updateCommitIndexLocked();

                        if (snapshot.hasMore) {
                            networkExecutor.submit(() -> sendAppendEntries(peer));
                        }
                    }
                } else {
                    if (response.logLength != null) {
                        nextIndex.put(peer, Math.max(0, response.logLength));
                    } else {
                        nextIndex.put(peer, Math.max(0, snapshot.nextIdx - 1));
                    }
                }
            }
        }

        private synchronized void updateCommitIndexLocked() {
            for (int n = log.size() - 1; n > commitIndex; n--) {
                if (log.get(n).term != currentTerm) {
                    continue;
                }

                int count = 1;
                for (String peer : peers) {
                    if (matchIndex.getOrDefault(peer, -1) >= n) {
                        count++;
                    }
                }

                if (count > (peers.size() + 1) / 2) {
                    System.out.println("[" + replicaId + "] Committing entries up to index " + n);
                    commitIndex = n;
                    triggerApplyCommittedLocked();
                    break;
                }
            }
        }

        private synchronized void triggerApplyCommittedLocked() {
            if (applyRunning) {
                return;
            }
            applyRunning = true;
            networkExecutor.submit(this::applyCommittedLoop);
        }

        private void applyCommittedLoop() {
            try {
                while (true) {
                    LogEntry entry;
                    int entryIndex;

                    synchronized (this) {
                        if (lastApplied >= commitIndex) {
                            applyRunning = false;
                            return;
                        }

                        lastApplied++;
                        entryIndex = lastApplied;
                        if (entryIndex < 0 || entryIndex >= log.size()) {
                            continue;
                        }
                        entry = log.get(entryIndex);
                    }

                    System.out.println("[" + replicaId + "] Applying log[" + entryIndex + "] to gateway (room: " + entry.roomId + ")");

                    Map<String, Object> payload = Map.of(
                        "roomId", entry.roomId,
                        "stroke", entry.stroke
                    );

                    Map<String, Object> response = postJson(gatewayUrl + "/commit", payload, 5000);
                    if (response == null) {
                        System.err.println("[" + replicaId + "] Failed to notify gateway for index " + entryIndex);
                    }
                }
            } finally {
                synchronized (this) {
                    applyRunning = false;
                    if (lastApplied < commitIndex) {
                        triggerApplyCommittedLocked();
                    }
                }
            }
        }

        private synchronized Map<String, Object> handleRequestVote(Map<String, Object> request) {
            int term = intValue(request.get("term"));
            String candidateId = stringValue(request.get("candidateId"));
            int lastLogIndex = intValue(request.get("lastLogIndex"));
            int lastLogTerm = intValue(request.get("lastLogTerm"));

            if (term > currentTerm) {
                stepDownLocked(term);
            }

            boolean voteGranted = false;

            if (term >= currentTerm && (votedFor == null || votedFor.equals(candidateId))) {
                int myLastIndex = log.size() - 1;
                int myLastTerm = log.isEmpty() ? 0 : log.get(myLastIndex).term;

                if (lastLogTerm > myLastTerm || (lastLogTerm == myLastTerm && lastLogIndex >= myLastIndex)) {
                    voteGranted = true;
                    votedFor = candidateId;
                    resetElectionTimeout();
                    System.out.println("[" + replicaId + "] Voted for " + candidateId + " in term " + term);
                }
            }

            return Map.of(
                "term", currentTerm,
                "voteGranted", voteGranted
            );
        }

        private synchronized Map<String, Object> handleAppendEntries(Map<String, Object> request) {
            int term = intValue(request.get("term"));
            int prevLogIndex = intValue(request.get("prevLogIndex"));
            int prevLogTerm = intValue(request.get("prevLogTerm"));
            int leaderCommit = intValue(request.get("leaderCommit"));
            String leaderId = stringValue(request.get("leaderId"));

            if (term > currentTerm) {
                stepDownLocked(term);
            }

            if (term < currentTerm) {
                return Map.of(
                    "term", currentTerm,
                    "success", false,
                    "logLength", log.size()
                );
            }

            resetElectionTimeout();

            if (state != State.FOLLOWER) {
                stepDownLocked(term);
            }

            if (prevLogIndex >= 0) {
                if (prevLogIndex >= log.size() || log.get(prevLogIndex).term != prevLogTerm) {
                    System.out.println("[" + replicaId + "] Log inconsistency: prevLogIndex=" + prevLogIndex + ", myLogLength=" + log.size());
                    return Map.of(
                        "term", currentTerm,
                        "success", false,
                        "logLength", log.size()
                    );
                }
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> entries = (List<Map<String, Object>>) request.get("entries");

            if (entries != null && !entries.isEmpty()) {
                List<LogEntry> newLog = new ArrayList<>(log.subList(0, prevLogIndex + 1));
                for (Map<String, Object> entry : entries) {
                    @SuppressWarnings("unchecked")
                    List<Object> stroke = (List<Object>) entry.get("stroke");
                    newLog.add(new LogEntry(
                        intValue(entry.get("term")),
                        stringValue(entry.get("roomId")),
                        stroke,
                        intValue(entry.get("index"))
                    ));
                }
                log = newLog;
                System.out.println("[" + replicaId + "] Appended " + entries.size() + " entries from leader " + leaderId);
            }

            if (leaderCommit > commitIndex) {
                commitIndex = Math.min(leaderCommit, log.size() - 1);
                triggerApplyCommittedLocked();
            }

            return Map.of(
                "term", currentTerm,
                "success", true
            );
        }

        private synchronized void handleClientStroke(String roomId, List<Object> stroke) {
            if (state != State.LEADER) {
                throw new IllegalStateException("Not leader");
            }

            LogEntry entry = new LogEntry(currentTerm, roomId, stroke, log.size());
            log.add(entry);
            System.out.println("[" + replicaId + "] Appended stroke to log (index " + entry.index + ")");
            sendHeartbeats();
        }

        private synchronized List<List<Object>> getRoomLog(String roomId) {
            List<List<Object>> strokes = new ArrayList<>();
            for (LogEntry entry : log) {
                if (entry.index <= commitIndex && roomId.equals(entry.roomId)) {
                    strokes.add(entry.stroke);
                }
            }
            return strokes;
        }

        private void onPeerReachable(String peer) {
            Boolean previous = peerReachable.put(peer, true);
            if (Boolean.FALSE.equals(previous)) {
                System.out.println("[" + replicaId + "] Peer " + peer + " is back online");
            }
        }

        private void onPeerUnreachable(String peer) {
            Boolean previous = peerReachable.put(peer, false);
            if (!Boolean.FALSE.equals(previous)) {
                System.out.println("[" + replicaId + "] Peer " + peer + " is unreachable (may be down)");
            }
        }

        private Map<String, Object> postJson(String url, Object payload, int timeoutMs) {
            try {
                String json = MAPPER.writeValueAsString(payload);
                HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofMillis(timeoutMs))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();

                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    return null;
                }

                String body = response.body();
                if (body == null || body.isBlank()) {
                    return new HashMap<>();
                }

                return MAPPER.readValue(body, new TypeReference<>() {
                });
            } catch (Exception e) {
                return null;
            }
        }

        private static int intValue(Object value) {
            if (value == null) {
                return 0;
            }
            if (value instanceof Number number) {
                return number.intValue();
            }
            try {
                return Integer.parseInt(value.toString());
            } catch (Exception e) {
                return 0;
            }
        }

        private static String stringValue(Object value) {
            return value == null ? "" : value.toString();
        }

        private static boolean boolValue(Object value) {
            if (value instanceof Boolean bool) {
                return bool;
            }
            return value != null && Boolean.parseBoolean(value.toString());
        }

        private static final class AppendRequest {
            private final int term;
            private final int nextIdx;
            private final int prevLogIndex;
            private final int prevLogTerm;
            private final int leaderCommit;
            private final List<LogEntry> entries;
            private final boolean hasMore;

            private AppendRequest(
                int term,
                int nextIdx,
                int prevLogIndex,
                int prevLogTerm,
                int leaderCommit,
                List<LogEntry> entries,
                boolean hasMore
            ) {
                this.term = term;
                this.nextIdx = nextIdx;
                this.prevLogIndex = prevLogIndex;
                this.prevLogTerm = prevLogTerm;
                this.leaderCommit = leaderCommit;
                this.entries = entries;
                this.hasMore = hasMore;
            }
        }
    }
}
