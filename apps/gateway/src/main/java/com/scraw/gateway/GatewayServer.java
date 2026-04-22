package com.scraw.gateway;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class GatewayServer extends WebSocketServer {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final int MSG_JOIN_ROOM = 0;
    private static final int MSG_STROKE = 6;
    private static final int MSG_SYNC = 9;

    private final List<String> replicas;
    private final HttpClient httpClient;
    private final ScheduledExecutorService scheduler;

    private final Map<WebSocket, ClientSession> sessionBySocket = new ConcurrentHashMap<>();
    private final Set<ClientSession> clients = ConcurrentHashMap.newKeySet();
    private final Map<String, Boolean> replicaReachable = new ConcurrentHashMap<>();

    private volatile String currentLeader;
    private volatile boolean quorumLost;
    private HttpServer commitListener;

    public GatewayServer(int wsPort, List<String> replicas) {
        super(new InetSocketAddress(wsPort));
        this.replicas = replicas;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(1))
            .build();
        this.scheduler = Executors.newSingleThreadScheduledExecutor();

        for (String replica : replicas) {
            replicaReachable.put(replica, true);
        }
    }

    public void startServices() throws IOException {
        startCommitListener(8081);
        scheduler.scheduleAtFixedRate(this::safeDiscoverLeader, 0, 2, TimeUnit.SECONDS);
        start();
        System.out.println("[GATEWAY] WebSocket server started on port " + getPort());
    }

    public void stopServices() {
        try {
            if (commitListener != null) {
                commitListener.stop(0);
            }
        } finally {
            scheduler.shutdownNow();
            try {
                stop(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void safeDiscoverLeader() {
        try {
            discoverLeader();
        } catch (Exception e) {
            System.err.println("[GATEWAY] Leader discovery error: " + e.getMessage());
        }
    }

    private void markReachable(String replica) {
        Boolean wasReachable = replicaReachable.put(replica, true);
        if (Boolean.FALSE.equals(wasReachable)) {
            System.out.println("[GATEWAY] Replica " + replica + " is back online");
            checkQuorum();
        }
    }

    private void markUnreachable(String replica) {
        Boolean wasReachable = replicaReachable.put(replica, false);
        if (!Boolean.FALSE.equals(wasReachable)) {
            System.out.println("[GATEWAY] Replica " + replica + " appears to be DOWN");
            checkQuorum();
        }
    }

    private void checkQuorum() {
        int upCount = 0;
        for (Boolean reachable : replicaReachable.values()) {
            if (Boolean.TRUE.equals(reachable)) {
                upCount++;
            }
        }

        int total = replicas.size();
        int majority = (total / 2) + 1;

        if (upCount < majority && !quorumLost) {
            quorumLost = true;
            System.out.println("[GATEWAY] QUORUM LOST - only " + upCount + "/" + total + " replicas reachable");
        } else if (upCount >= majority && quorumLost) {
            quorumLost = false;
            System.out.println("[GATEWAY] QUORUM RESTORED - " + upCount + "/" + total + " replicas reachable");
        }
    }

    private synchronized void discoverLeader() {
        boolean leaderFound = false;

        for (String replica : replicas) {
            try {
                HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("http://" + replica + "/status"))
                    .timeout(Duration.ofMillis(1000))
                    .GET()
                    .build();

                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    markUnreachable(replica);
                    continue;
                }

                markReachable(replica);

                JsonNode node = MAPPER.readTree(response.body());
                if ("LEADER".equals(node.path("state").asText())) {
                    if (!Objects.equals(currentLeader, replica)) {
                        currentLeader = replica;
                        System.out.println("[GATEWAY] New leader discovered: " + replica);
                    }
                    leaderFound = true;
                }
            } catch (Exception e) {
                markUnreachable(replica);
            }
        }

        if (!leaderFound) {
            currentLeader = null;
            if (!quorumLost) {
                System.out.println("[GATEWAY] No leader found among reachable replicas");
            }
        }
    }

    private boolean forwardToLeader(List<Object> strokeMessage, String roomId) {
        if (quorumLost) {
            System.out.println("[GATEWAY] Cannot forward stroke - quorum lost");
            return false;
        }

        for (int attempt = 0; attempt < 5; attempt++) {
            String leader = currentLeader;

            if (leader == null) {
                discoverLeader();
                leader = currentLeader;
                if (leader == null) {
                    if (quorumLost) {
                        return false;
                    }
                    long delayMs = attempt < 2 ? 200 : 400;
                    sleep(delayMs);
                    continue;
                }
            }

            try {
                String payload = MAPPER.writeValueAsString(Map.of(
                    "stroke", strokeMessage,
                    "roomId", roomId
                ));

                HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("http://" + leader + "/client-stroke"))
                    .timeout(Duration.ofMillis(500))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();

                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() >= 200 && response.statusCode() < 300) {
                    return true;
                }

                currentLeader = null;
            } catch (Exception e) {
                currentLeader = null;
            }
        }

        System.err.println("[GATEWAY] Failed to forward stroke after 5 attempts");
        return false;
    }

    private List<List<Object>> syncRoomHistory(String roomId) {
        String leader = currentLeader;
        if (leader == null) {
            discoverLeader();
            leader = currentLeader;
            if (leader == null) {
                return List.of();
            }
        }

        try {
            String encodedRoom = URLEncoder.encode(roomId, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://" + leader + "/room-log/" + encodedRoom))
                .timeout(Duration.ofMillis(1000))
                .GET()
                .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return List.of();
            }

            JsonNode root = MAPPER.readTree(response.body());
            JsonNode logNode = root.path("log");
            if (!logNode.isArray()) {
                return List.of();
            }

            List<List<Object>> history = new ArrayList<>();
            for (JsonNode entry : logNode) {
                history.add(MAPPER.convertValue(entry, new TypeReference<>() {
                }));
            }
            return history;
        } catch (Exception e) {
            return List.of();
        }
    }

    private void broadcastToRoom(String roomId, List<Object> strokeMessage) {
        try {
            String payload = MAPPER.writeValueAsString(strokeMessage);
            int sentCount = 0;
            for (ClientSession client : clients) {
                if (client.roomId.equals(roomId) && client.socket.isOpen()) {
                    client.socket.send(payload);
                    sentCount++;
                }
            }
            System.out.println("[GATEWAY] Broadcast to " + sentCount + " clients in room " + roomId);
        } catch (Exception e) {
            System.err.println("[GATEWAY] Broadcast error: " + e.getMessage());
        }
    }

    private void startCommitListener(int port) throws IOException {
        commitListener = HttpServer.create(new InetSocketAddress(port), 0);
        commitListener.createContext("/commit", new CommitHandler());
        commitListener.setExecutor(Executors.newCachedThreadPool());
        commitListener.start();
        System.out.println("[GATEWAY] Commit listener started on port " + port);
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        // No-op until JOIN_ROOM arrives.
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        ClientSession session = sessionBySocket.remove(conn);
        if (session != null) {
            clients.remove(session);
            System.out.println("[GATEWAY] Client " + session.playerId + " disconnected from room " + session.roomId);
        }
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        try {
            JsonNode msg = MAPPER.readTree(message);
            if (!msg.isArray() || msg.size() == 0 || !msg.get(0).isInt()) {
                System.err.println("[GATEWAY] Invalid message format");
                return;
            }

            int type = msg.get(0).asInt();

            if (type == MSG_JOIN_ROOM) {
                String roomId = msg.path(1).asText();
                String playerId = msg.path(2).asText();

                ClientSession existing = sessionBySocket.get(conn);
                if (existing != null) {
                    clients.remove(existing);
                }

                ClientSession session = new ClientSession(conn, roomId, playerId);
                sessionBySocket.put(conn, session);
                clients.add(session);

                System.out.println("[GATEWAY] Client " + playerId + " joined room " + roomId + ". Total clients: " + clients.size());

                List<List<Object>> history = syncRoomHistory(roomId);
                if (!history.isEmpty()) {
                    conn.send(MAPPER.writeValueAsString(List.of(MSG_SYNC, history)));
                    System.out.println("[GATEWAY] Sent " + history.size() + " history strokes to " + playerId);
                }
                return;
            }

            if (type == MSG_STROKE) {
                ClientSession session = sessionBySocket.get(conn);
                if (session == null) {
                    return;
                }

                List<Object> stroke = MAPPER.convertValue(msg, new TypeReference<>() {
                });
                stroke.add(session.playerId);

                boolean forwarded = forwardToLeader(stroke, session.roomId);
                if (!forwarded && quorumLost) {
                    System.out.println("[GATEWAY] Stroke from " + session.playerId + " dropped - cluster unavailable");
                }
            }
        } catch (Exception e) {
            System.err.println("[GATEWAY] Error handling message: " + e.getMessage());
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        System.err.println("[GATEWAY] WebSocket error: " + ex.getMessage());
    }

    @Override
    public void onStart() {
        // No-op.
    }

    private static void sleep(long delayMs) {
        try {
            Thread.sleep(delayMs);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private static String readBody(InputStream inputStream) throws IOException {
        return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
    }

    private final class CommitHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(404, -1);
                exchange.close();
                return;
            }

            try {
                String body = readBody(exchange.getRequestBody());
                JsonNode root = MAPPER.readTree(body);
                String roomId = root.path("roomId").asText(null);
                JsonNode strokeNode = root.get("stroke");

                if (roomId == null || strokeNode == null) {
                    byte[] response = "Missing roomId or stroke".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(400, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                    return;
                }

                List<Object> stroke = MAPPER.convertValue(strokeNode, new TypeReference<>() {
                });
                broadcastToRoom(roomId, stroke);

                byte[] response = "OK".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
                exchange.close();
            } catch (Exception e) {
                byte[] response = "Bad Request".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(400, response.length);
                exchange.getResponseBody().write(response);
                exchange.close();
            }
        }
    }

    private static final class ClientSession {
        private final WebSocket socket;
        private final String roomId;
        private final String playerId;

        private ClientSession(WebSocket socket, String roomId, String playerId) {
            this.socket = socket;
            this.roomId = roomId;
            this.playerId = playerId;
        }
    }

    public static void main(String[] args) throws Exception {
        int wsPort = parseInt(System.getenv("PORT"), 8080);

        List<String> replicas = List.of(
            "replica1:3001",
            "replica2:3002",
            "replica3:3003"
        );

        GatewayServer gateway = new GatewayServer(wsPort, replicas);
        gateway.startServices();

        Runtime.getRuntime().addShutdownHook(new Thread(gateway::stopServices));
    }

    private static int parseInt(String value, int fallback) {
        try {
            return value == null ? fallback : Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
