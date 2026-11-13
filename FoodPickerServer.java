import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.PrintStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/** 외부 라이브러리 없이 기존 CSV 추첨 코드를 웹 화면과 연결합니다. */
public class FoodPickerServer {
    private static final String DEFAULT_MAPS_CLIENT_ID = "uf476ngdwu";

    public static void main(String[] args) {
        System.setOut(new PrintStream(System.out, true, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(System.err, true, StandardCharsets.UTF_8));
        try {
            start(args);
        } catch (Exception error) {
            System.err.println("실행 실패: " + error.getMessage());
            System.exit(1);
        }
    }

    private static void start(String[] args) throws IOException {
        if (args.length > 3) {
            throw new IllegalArgumentException(
                    "사용법: java FoodPickerServer [CSV_PATH [ENCODING [PORT]]]");
        }
        Path csv = args.length > 0 ? Path.of(args[0]) : RandomFoodPicker.CSV_PATH;
        Charset encoding = args.length > 1
                ? Charset.forName(args[1]) : RandomFoodPicker.CSV_ENCODING;
        int port = args.length > 2 ? Integer.parseInt(args[2]) : 8000;
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("포트는 1~65535 사이여야 합니다.");
        }
        if (!Files.isRegularFile(csv)) {
            throw new IOException("CSV를 찾을 수 없습니다. 실행 폴더에 넣어 주세요: " + csv);
        }

        List<List<String>> records = RandomFoodPicker.readCsv(csv, encoding);
        if (records.isEmpty()) {
            throw new IOException("CSV 파일이 비어 있습니다.");
        }
        List<String> headers = records.get(0);
        List<List<String>> rows = records.subList(1, records.size());
        RandomFoodPicker.validate(headers, rows);
        List<Map<String, Object>> restaurants = new ArrayList<>();
        Map<String, Integer> indexes = new LinkedHashMap<>();
        for (List<String> row : rows) {
            Map<String, String> fields = new LinkedHashMap<>();
            for (int i = 0; i < headers.size(); i++) {
                fields.put(headers.get(i), row.get(i));
            }
            indexes.put(fields.get("음식점아이디"), restaurants.size());
            restaurants.add(restaurant(fields));
        }

        // CSV나 Java 소스를 정적 파일로 공개하지 않도록 허용한 파일만 제공합니다.
        Map<String, byte[]> assets = new LinkedHashMap<>();
        for (String name : List.of("naver-map-test.html", "app.js", "styles.css")) {
            assets.put("/" + name, Files.readAllBytes(Path.of(name)));
        }
        String configuredId = System.getenv("NAVER_MAP_CLIENT_ID");
        String clientId = configuredId == null || configuredId.isBlank()
                ? DEFAULT_MAPS_CLIENT_ID : configuredId.trim();
        byte[] info = json(Map.of("total", restaurants.size(), "mapsClientId", clientId))
                .getBytes(StandardCharsets.UTF_8);

        // 개인 PC에서 실행하는 용도입니다. 같은 PC의 브라우저로 접속합니다.
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", exchange -> {
            try (exchange) {
                if (!exchange.getRequestMethod().equals("GET")) {
                    exchange.getResponseHeaders().set("Allow", "GET");
                    sendJson(exchange, 405, Map.of("error", "GET 요청만 지원합니다."));
                    return;
                }
                String path = exchange.getRequestURI().getPath();
                if (path.equals("/api/info")) {
                    send(exchange, 200, "application/json", info);
                } else if (path.equals("/api/pick")) {
                    Map<String, String> query;
                    try {
                        query = query(exchange.getRequestURI().getRawQuery());
                    } catch (IllegalArgumentException error) {
                        sendJson(exchange, 400, Map.of("error", "쿼리 문자열이 잘못됐습니다."));
                        return;
                    }
                    String previousId = query.get("previous");
                    if (previousId != null && !indexes.containsKey(previousId)) {
                        sendJson(exchange, 400, Map.of("error", "이전 음식점 ID가 잘못됐습니다."));
                        return;
                    }
                    int previous = previousId == null ? -1 : indexes.get(previousId);
                    int index = RandomFoodPicker.pickNextIndex(
                            restaurants.size(), previous, ThreadLocalRandom.current());
                    sendJson(exchange, 200, Map.of("restaurant", restaurants.get(index)));
                } else {
                    if (path.equals("/")) {
                        path = "/naver-map-test.html";
                    }
                    byte[] asset = assets.get(path);
                    if (asset == null) {
                        sendJson(exchange, 404, Map.of("error", "페이지를 찾을 수 없습니다."));
                        return;
                    }
                    String type = path.endsWith(".html") ? "text/html"
                            : path.endsWith(".js") ? "text/javascript" : "text/css";
                    send(exchange, 200, type, asset);
                }
            } catch (IOException error) {
                System.err.println("응답 전송 실패: " + error.getMessage());
            }
        });
        server.start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(0)));
        System.out.printf("불러온 음식점: %,d곳 / 인코딩: %s%n", restaurants.size(), encoding);
        System.out.println("브라우저에서 접속: http://localhost:" + port + "/naver-map-test.html");
        System.out.println("추첨 단위: 음식점 1곳 / 직전 음식점 연속 중복 방지 / 폐업 확정 제외 / 미확정·미확인 유지");
        System.out.println("서버를 종료하려면 Ctrl+C를 누르세요.");
    }

    private static Map<String, Object> restaurant(Map<String, String> fields) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", fields.get("음식점아이디"));
        result.put("name", fields.get("음식점명"));
        result.put("menu", fields.get("대표메뉴명"));
        result.put("address", fields.getOrDefault("주소", ""));
        result.put("detailAddress", fields.getOrDefault("상세주소", ""));
        result.put("phone", fields.getOrDefault("전화번호", ""));
        result.put("hours", fields.getOrDefault("운영시간정보", ""));
        result.put("businessStatus", fields.getOrDefault("최종대조판정", "미확정"));
        Double latitude = coordinate(fields.get("위도"), 90);
        Double longitude = coordinate(fields.get("경도"), 180);
        boolean hasPosition = latitude != null && longitude != null;
        result.put("latitude", hasPosition ? latitude : null);
        result.put("longitude", hasPosition ? longitude : null);
        result.put("fields", fields);
        return result;
    }

    private static Double coordinate(String value, double limit) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            double number = Double.parseDouble(value.trim());
            return Double.isFinite(number) && Math.abs(number) <= limit ? number : null;
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> values = new LinkedHashMap<>();
        if (raw != null) {
            for (String part : raw.split("&")) {
                String[] pair = part.split("=", 2);
                values.put(URLDecoder.decode(pair[0], StandardCharsets.UTF_8),
                        pair.length == 2 ? URLDecoder.decode(pair[1], StandardCharsets.UTF_8) : "");
            }
        }
        return values;
    }

    private static void sendJson(HttpExchange exchange, int status, Object value)
            throws IOException {
        send(exchange, status, "application/json", json(value).getBytes(StandardCharsets.UTF_8));
    }

    private static void send(HttpExchange exchange, int status, String type, byte[] body)
            throws IOException {
        exchange.getResponseHeaders().set("Content-Type", type + "; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(status, body.length);
        exchange.getResponseBody().write(body);
    }

    // 응답에 쓰는 Map, 문자열, 숫자, null만 직렬화합니다. CSV 값을 HTML로 삽입하지 않습니다.
    private static String json(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof Map<?, ?> map) {
            List<String> entries = new ArrayList<>();
            map.forEach((key, item) -> entries.add(json(key.toString()) + ":" + json(item)));
            return "{" + String.join(",", entries) + "}";
        }
        if (value instanceof Number) {
            return value.toString();
        }
        StringBuilder result = new StringBuilder("\"");
        for (char character : value.toString().toCharArray()) {
            switch (character) {
                case '"' -> result.append("\\\"");
                case '\\' -> result.append("\\\\");
                case '\n' -> result.append("\\n");
                case '\r' -> result.append("\\r");
                case '\t' -> result.append("\\t");
                default -> {
                    if (character < 0x20) {
                        result.append(String.format("\\u%04x", (int) character));
                    } else {
                        result.append(character);
                    }
                }
            }
        }
        return result.append('"').toString();
    }
}
