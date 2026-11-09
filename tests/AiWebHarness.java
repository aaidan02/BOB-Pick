import java.net.URI;

/** 로컬 Gemini HTTP 대역으로 실제 웹 서버의 AI 흐름을 검증합니다. */
public class AiWebHarness {
    public static void main(String[] args) throws Exception {
        FoodPickerWeb.ai = args.length > 3
                ? new GeminiFoodRecommender("unit-test-key", URI.create(args[2]), java.time.Duration.ofMillis(Long.parseLong(args[3])))
                : new GeminiFoodRecommender("unit-test-key", URI.create(args[2]));
        FoodPickerWeb.main(new String[]{args[0], args[1]});
    }
}
