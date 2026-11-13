import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.net.http.HttpConnectTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/** Gemini 통신과 JSON 처리. 입력한 키는 이 프로세스의 메모리에서만 사용합니다. */
final class GeminiFoodRecommender {
    private final String key;
    private final URI endpoint;
    private final HttpClient client;
    private final Duration timeout;

    static GeminiFoodRecommender fromKey(String key) {
        String model = System.getenv().getOrDefault("GEMINI_MODEL", "gemini-3.5-flash-lite").trim();
        if (!model.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}")) {
            throw new IllegalArgumentException("GEMINI_MODEL의 모델 ID를 확인해 주세요.");
        }
        int seconds;
        try { seconds = Integer.parseInt(System.getenv().getOrDefault("GEMINI_TIMEOUT_SECONDS", "60")); }
        catch (NumberFormatException error) { throw new IllegalArgumentException("GEMINI_TIMEOUT_SECONDS는 15~120초로 설정해 주세요."); }
        if (seconds < 15 || seconds > 120) throw new IllegalArgumentException("GEMINI_TIMEOUT_SECONDS는 15~120초로 설정해 주세요.");
        return new GeminiFoodRecommender(key, URI.create("https://generativelanguage.googleapis.com/v1beta/models/"
                + model + ":generateContent"), Duration.ofSeconds(seconds));
    }

    static GeminiFoodRecommender requestKeyAtStartup() throws IOException {
        return fromKey(readStartupKey());
    }

    static String readStartupKey() throws IOException {
        System.out.println("키 입력 안내가 나오면 Ctrl+Shift+V 또는 터미널의 붙여넣기를 사용한 뒤 Enter를 누르세요.");
        String prompt = "Gemini API 키 입력 (Enter: 수동 검색만 사용): ";
        char[] entered;
        if (System.console() != null) entered = System.console().readPassword("%s", prompt);
        else {
            System.out.print(prompt); System.out.flush();
            String line = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
            entered = line == null ? null : line.toCharArray();
        }
        try {
            String value = entered == null ? "" : new String(entered).strip();
            // 일부 터미널의 bracketed paste 제어 문자는 API 키에 포함하지 않습니다.
            String start = "\033[200~", end = "\033[201~";
            if (value.startsWith(start) && value.endsWith(end)) value = value.substring(start.length(), value.length() - end.length());
            value = value.trim();
            System.out.println(value.isEmpty() ? "API 키 미입력: 수동 검색만 사용합니다." : "API 키 입력 완료.");
            return value;
        }
        finally { if (entered != null) Arrays.fill(entered, '\0'); }
    }

    // 테스트는 이 생성자로 로컬 Gemini 응답 대역을 주입합니다. 제품 설정에는 별도 URL을 받지 않습니다.
    GeminiFoodRecommender(String key, URI endpoint) {
        this(key, endpoint, Duration.ofSeconds(60));
    }

    GeminiFoodRecommender(String key, URI endpoint, Duration timeout) {
        this.key = key;
        this.endpoint = endpoint;
        this.timeout = timeout;
        this.client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
                .version(HttpClient.Version.HTTP_1_1).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    Map<String, Object> generate(String instruction, Object data, Object schema) throws AiException {
        return generate("추천", instruction, data, schema);
    }

    String modelName() { String path = endpoint.getPath(); return path.substring(path.lastIndexOf('/') + 1).replace(":generateContent", ""); }
    long requestBudgetMillis() { return timeout.toMillis() * 2 + 10000; }

    Map<String, Object> generate(String stage, String instruction, Object data, Object schema) throws AiException {
        if (key.isBlank()) throw new AiException(503, "API 키가 입력되지 않았습니다. 프로그램을 다시 실행해 키를 입력해 주세요.");
        Map<String, Object> generation = new LinkedHashMap<>();
        generation.put("responseMimeType", "application/json"); generation.put("responseJsonSchema", schema);
        generation.put("maxOutputTokens", 4096);
        if (modelName().startsWith("gemini-2.5")) generation.put("thinkingConfig", Map.of("thinkingBudget", modelName().contains("pro") ? 128 : 0));
        else generation.put("thinkingConfig", Map.of("thinkingLevel", modelName().contains("flash-lite") ? "minimal" : "low"));
        Map<String, Object> body = Map.of(
                "systemInstruction", Map.of("parts", List.of(Map.of("text", instruction))),
                "contents", List.of(Map.of("role", "user", "parts", List.of(Map.of("text", Json.write(data))))),
                "generationConfig", generation);
        String payload = Json.write(body);
        long started = System.nanoTime();
        System.out.printf(Locale.ROOT, "[AI] 단계=%s 모델=%s 요청=%dbytes 제한=%d초%n", stage, modelName(), payload.getBytes(StandardCharsets.UTF_8).length, timeout.toSeconds());
        HttpRequest request = HttpRequest.newBuilder(endpoint).timeout(timeout)
                .header("Content-Type", "application/json; charset=utf-8").header("x-goog-api-key", key)
                .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8)).build();
        CompletableFuture<HttpResponse<byte[]>> pending = client.sendAsync(request, ignored -> new LimitedBody());
        try {
            HttpResponse<byte[]> response = pending.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            System.out.printf(Locale.ROOT, "[AI] 단계=%s HTTP=%d 소요=%.1f초%n", stage, response.statusCode(), (System.nanoTime()-started)/1e9);
            if (response.statusCode() == 401 || response.statusCode() == 403)
                throw new AiException(503, "Gemini API 키와 사용 권한을 확인해 주세요.");
            if (response.statusCode() == 404)
                throw new AiException(503, "사용 가능한 Gemini 모델 ID를 GEMINI_MODEL에 설정해 주세요.");
            if (response.statusCode() == 429)
                throw new AiException(429, "AI 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.");
            if (response.statusCode() == 400)
                throw new AiException(502, "Gemini 모델 또는 요청 설정이 맞지 않습니다. 연결 확인을 실행해 주세요.");
            if (response.statusCode() != 200)
                throw new AiException(502, "AI 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.");
            byte[] bytes = response.body();
            Map<String, Object> envelope = Json.object(Json.read(new String(bytes, StandardCharsets.UTF_8)));
            List<?> candidates = Json.array(envelope.get("candidates"));
            if (candidates.isEmpty()) throw new IllegalArgumentException();
            Map<String, Object> candidate = Json.object(candidates.get(0));
            if (!"STOP".equals(candidate.get("finishReason"))) throw new IllegalArgumentException();
            StringBuilder output = new StringBuilder();
            for (Object value : Json.array(Json.object(candidate.get("content")).get("parts"))) {
                Map<String, Object> part = Json.object(value);
                if (!Boolean.TRUE.equals(part.get("thought")) && part.get("text") instanceof String text) output.append(text);
            }
            return Json.object(Json.read(output.toString()));
        } catch (InterruptedException error) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new AiException(503, "AI 요청이 중단됐습니다. 다시 시도해 주세요.");
        } catch (TimeoutException error) {
            pending.cancel(true);
            System.out.printf(Locale.ROOT, "[AI] 단계=%s 응답 시간 초과 %.1f초%n", stage, (System.nanoTime()-started)/1e9);
            throw new AiException(504, "AI " + stage + " 응답 시간이 초과됐습니다. 연결 확인 후 다시 시도해 주세요.");
        } catch (ExecutionException error) {
            System.out.printf(Locale.ROOT, "[AI] 단계=%s 연결 실패 유형=%s 소요=%.1f초%n", stage,
                    error.getCause().getClass().getSimpleName(), (System.nanoTime()-started)/1e9);
            if (hasCause(error, java.net.UnknownHostException.class))
                throw new AiException(502, "Gemini 서버 주소를 찾을 수 없습니다. 인터넷 연결을 확인해 주세요.");
            if (hasCause(error, javax.net.ssl.SSLException.class))
                throw new AiException(502, "Gemini 보안 연결에 실패했습니다. PC의 인증서·네트워크 설정을 확인해 주세요.");
            if (hasCause(error, HttpConnectTimeoutException.class))
                throw new AiException(504, "Gemini 서버에 연결하지 못했습니다. 인터넷·프록시 설정을 확인해 주세요.");
            if (error.getCause() instanceof HttpTimeoutException)
                throw new AiException(504, "AI " + stage + " 응답 시간이 초과됐습니다. 연결 확인 후 다시 시도해 주세요.");
            throw new AiException(502, "AI 연결 또는 응답에 문제가 있습니다. 다시 시도해 주세요.");
        } catch (IllegalArgumentException error) {
            throw new AiException(502, "AI 응답을 확인하지 못했습니다. 다시 시도해 주세요.");
        }
    }

    private static boolean hasCause(Throwable error, Class<? extends Throwable> kind) {
        for (int i=0; error!=null && i<12; i++,error=error.getCause()) if (kind.isInstance(error)) return true;
        return false;
    }

    public static void main(String[] args) {
        System.setOut(new java.io.PrintStream(System.out, true, StandardCharsets.UTF_8));
        try {
            GeminiFoodRecommender connection = requestKeyAtStartup();
            System.out.println("Gemini 연결 확인 / 모델: " + connection.modelName());
            Map<String, Object> result = connection.generate("연결 확인", "연결 확인이다. ok를 true로 응답하라.", Map.of("check", true),
                    Json.read("{\"type\":\"object\",\"properties\":{\"ok\":{\"type\":\"boolean\"}},\"required\":[\"ok\"]}"));
            if (!Boolean.TRUE.equals(result.get("ok"))) throw new AiException(502, "정상 확인 응답을 받지 못했습니다.");
            System.out.println("Gemini 연결 성공");
        } catch (AiException error) { System.out.println("Gemini 연결 실패: " + error.getMessage()); System.exit(1); }
        catch (IOException error) { System.out.println("키 입력을 받지 못했습니다. 터미널에서 다시 실행해 주세요."); System.exit(1); }
        catch (IllegalArgumentException error) { System.out.println(error.getMessage()); System.exit(1); }
    }

    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        public CompletionStage<byte[]> getBody() { return result; }
        public void onSubscribe(Flow.Subscription value) { subscription = value; value.request(1); }
        public void onNext(List<ByteBuffer> buffers) {
            for (ByteBuffer buffer : buffers) {
                if (bytes.size() + buffer.remaining() > 262144) {
                    subscription.cancel(); result.completeExceptionally(new IOException("AI 응답 크기 초과")); return;
                }
                byte[] part = new byte[buffer.remaining()]; buffer.get(part); bytes.writeBytes(part);
            }
            subscription.request(1);
        }
        public void onError(Throwable error) { result.completeExceptionally(error); }
        public void onComplete() { result.complete(bytes.toByteArray()); }
    }

    static final class AiException extends Exception {
        final int status;
        AiException(int status, String message) { super(message); this.status = status; }
    }

    /** 외부 의존성 없이 구조화 응답을 읽습니다. 중복 키·뒤에 붙은 내용·잘못된 숫자는 거부합니다. */
    static final class Json {
        private final String text;
        private int position;
        private Json(String text) { this.text = text; }
        static Object read(String text) {
            Json parser = new Json(text);
            Object result = parser.value(0);
            parser.space();
            if (parser.position != text.length()) throw new IllegalArgumentException("잘못된 JSON입니다.");
            return result;
        }
        static Map<String, Object> object(Object value) {
            if (!(value instanceof Map<?, ?> map)) throw new IllegalArgumentException("JSON 객체가 필요합니다.");
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, item) -> { if (!(key instanceof String)) throw new IllegalArgumentException(); result.put((String) key, item); });
            return result;
        }
        static List<?> array(Object value) {
            if (!(value instanceof List<?> list)) throw new IllegalArgumentException("JSON 목록이 필요합니다.");
            return list;
        }
        static int integer(Object value) {
            if (!(value instanceof Number number)) throw new IllegalArgumentException("정수가 필요합니다.");
            try { return new BigDecimal(number.toString()).intValueExact(); }
            catch (ArithmeticException error) { throw new IllegalArgumentException("정수 범위를 벗어났습니다."); }
        }
        static String string(Object value, int max) {
            if (!(value instanceof String s) || s.length() > max) throw new IllegalArgumentException("문자열을 확인해 주세요.");
            return s;
        }
        private void space() { while (position < text.length() && " \r\n\t".indexOf(text.charAt(position)) >= 0) position++; }
        private boolean take(char c) {
            space();
            if (position < text.length() && text.charAt(position) == c) { position++; return true; }
            return false;
        }
        private Object value(int depth) {
            if (depth > 32) throw new IllegalArgumentException();
            space();
            if (position >= text.length()) throw new IllegalArgumentException();
            char c = text.charAt(position);
            if (c == '"') return quoted();
            if (take('{')) {
                Map<String, Object> result = new LinkedHashMap<>();
                if (take('}')) return result;
                do {
                    space(); String key = quoted();
                    if (!take(':') || result.containsKey(key)) throw new IllegalArgumentException();
                    result.put(key, value(depth + 1));
                } while (take(','));
                if (!take('}')) throw new IllegalArgumentException();
                return result;
            }
            if (take('[')) {
                List<Object> result = new ArrayList<>();
                if (take(']')) return result;
                do { result.add(value(depth + 1)); } while (take(','));
                if (!take(']')) throw new IllegalArgumentException();
                return result;
            }
            for (String literal : List.of("true", "false", "null")) {
                if (text.startsWith(literal, position)) {
                    position += literal.length();
                    return literal.equals("null") ? null : Boolean.valueOf(literal);
                }
            }
            int start = position;
            while (position < text.length() && "-+0123456789.eE".indexOf(text.charAt(position)) >= 0) position++;
            String token = text.substring(start, position);
            if (!token.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")) throw new IllegalArgumentException();
            return new BigDecimal(token);
        }
        private String quoted() {
            if (position >= text.length() || text.charAt(position++) != '"') throw new IllegalArgumentException();
            StringBuilder result = new StringBuilder();
            while (position < text.length()) {
                char c = text.charAt(position++);
                if (c == '"') return result.toString();
                if (c < 32) throw new IllegalArgumentException();
                if (c == '\\') {
                    if (position >= text.length()) throw new IllegalArgumentException();
                    char escape = text.charAt(position++);
                    if (escape == 'u') {
                        if (position + 4 > text.length()) throw new IllegalArgumentException();
                        result.append((char) Integer.parseInt(text.substring(position, position + 4), 16)); position += 4;
                    } else {
                        int index = "\"\\/bfnrt".indexOf(escape);
                        if (index < 0) throw new IllegalArgumentException();
                        result.append("\"\\/\b\f\n\r\t".charAt(index));
                    }
                } else result.append(c);
            }
            throw new IllegalArgumentException();
        }
        static String write(Object value) {
            if (value == null) return "null";
            if (value instanceof String text) {
                StringBuilder result = new StringBuilder("\"");
                for (char c : text.toCharArray()) {
                    if (c == '"' || c == '\\') result.append('\\').append(c);
                    else if (c < 32) result.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    else result.append(c);
                }
                return result.append('"').toString();
            }
            if (value instanceof Boolean || value instanceof Number) return value.toString();
            if (value instanceof Map<?, ?> map) {
                List<String> items = new ArrayList<>();
                map.forEach((key, item) -> items.add(write(key.toString()) + ":" + write(item)));
                return "{" + String.join(",", items) + "}";
            }
            if (value instanceof Collection<?> list) return "[" + String.join(",", list.stream().map(Json::write).toList()) + "]";
            throw new IllegalArgumentException("JSON으로 저장할 수 없습니다.");
        }
    }
}
