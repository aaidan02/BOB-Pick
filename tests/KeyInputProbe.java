import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/** 입력 계약만 검사합니다. 실제 AI 서비스는 호출하지 않습니다. */
public class KeyInputProbe {
    public static void main(String[] args) throws Exception {
        System.setOut(new PrintStream(System.out, true, StandardCharsets.UTF_8));
        String value = GeminiFoodRecommender.readStartupKey();
        String expected = args.length == 0 ? "" : args[0];
        if (!expected.equals(value)) throw new AssertionError("시작 시 입력한 값과 다릅니다.");
        System.out.println("PASS: 시작 입력 확인");
    }
}
