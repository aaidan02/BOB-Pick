import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** 최종 판정만 사용하고, 남기는 행의 값과 순서를 모두 보존하는지 검증합니다. */
public class ClosureFilterTest {
    public static void main(String[] args) throws Exception {
        Path file = Files.createTempFile("closure-filter-", ".csv");
        try {
            List<String> statuses = List.of("폐업", "미확정", "미확인", "영업/정상", "",
                    "폐업 여부 미확인", "폐업 미확정", " 폐업 ");
            StringBuilder csv = new StringBuilder(
                    "음식점아이디,음식점명,대표메뉴명,최종대조판정,LOCALDATA대조판정,메모\r\n");
            List<List<String>> expected = new ArrayList<>();
            expected.add(List.of("음식점아이디", "음식점명", "대표메뉴명", "최종대조판정",
                    "LOCALDATA대조판정", "메모"));
            for (int i = 0; i < statuses.size(); i++) {
                csv.append(i).append(",음식점,메뉴,").append(statuses.get(i))
                        .append(",폐업,\"쉼표,따옴표\"\"와\r\n줄바꿈\"\r\n");
                if (i != 0 && i != statuses.size() - 1) {
                    expected.add(List.of("" + i, "음식점", "메뉴", statuses.get(i), "폐업",
                            "쉼표,따옴표\"와\r\n줄바꿈"));
                }
            }
            Files.writeString(file, csv, StandardCharsets.UTF_8);
            List<List<String>> actual = RandomFoodPicker.readCsv(file, StandardCharsets.UTF_8);
            if (!actual.equals(expected)) {
                throw new AssertionError("미확정·미확인 또는 다른 열의 값·행 순서가 변경됐습니다: " + actual);
            }
            Files.writeString(file, "음식점아이디,음식점명,대표메뉴명\n1,상호,메뉴\n",
                    StandardCharsets.UTF_8);
            if (RandomFoodPicker.readCsv(file, StandardCharsets.UTF_8).size() != 2) {
                throw new AssertionError("최종대조판정 열이 없을 때 데이터가 삭제됐습니다.");
            }
            System.out.println("PASS: 폐업 확정만 제외, 미확정·미확인·빈 값·다른 열·행 순서 보존");
        } finally {
            Files.deleteIfExists(file);
        }
    }
}
