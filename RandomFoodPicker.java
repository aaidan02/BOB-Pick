import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.io.PushbackReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;

public class RandomFoodPicker {
    static final Path CSV_PATH = Path.of("관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv");

    // 이번 첨부 파일은 UTF-8이 아니라 CP949입니다.
    static final Charset CSV_ENCODING = Charset.forName("MS949");

    public static void main(String[] args) {
        System.setOut(new PrintStream(System.out, true, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(System.err, true, StandardCharsets.UTF_8));

        try {
            run(args);
        } catch (Exception error) {
            System.err.println("FAIL: " + error);
            System.exit(1);
        }
    }

    private static void run(String[] args) throws IOException {
        if (args.length > 2) {
            throw new IllegalArgumentException(
                    "Usage: RandomFoodPicker [CSV_PATH [ENCODING]]");
        }
        Path path = args.length > 0 ? Path.of(args[0]) : CSV_PATH;
        Charset encoding = args.length > 1
                ? Charset.forName(args[1])
                : CSV_ENCODING;

        List<List<String>> records = readCsv(path, encoding);
        if (records.isEmpty()) {
            throw new IOException("CSV 파일이 비어 있습니다.");
        }

        List<String> headers = records.get(0);
        List<List<String>> rows = records.subList(1, records.size());
        validate(headers, rows);

        System.out.printf("불러온 음식점: %d개 / 열: %d개%n",
                rows.size(), headers.size());
        System.out.println("추첨 단위: 음식점 1곳 / 폐업 확정 제외 / 미확정·미확인 유지");

        Random random = new Random();
        int previousIndex = -1;
        int round = 0;

        try (BufferedReader input = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            while (true) {
                int index = pickNextIndex(rows.size(), previousIndex, random);
                previousIndex = index;
                printSelection(headers, rows.get(index), ++round);

                if (rows.size() == 1) {
                    System.out.println("음식점이 1개여서 다른 곳을 뽑을 수 없습니다.");
                    return;
                }

                // Enter 한 번마다 재추첨. 그 외 입력은 추첨하지 않습니다.
                while (true) {
                    System.out.print("\n[Enter] 다른 음식점 뽑기 / [q + Enter] 종료: ");
                    System.out.flush();
                    String command = input.readLine();

                    if (command == null || command.trim().equalsIgnoreCase("q")) {
                        System.out.println("\n종료합니다.");
                        return;
                    }
                    if (command.isEmpty()) {
                        // 터미널 화면을 지우고 커서를 맨 위로 이동
                        System.out.print("\u001B[2J\u001B[H");
                        System.out.flush();
                        break;
                    }
                    System.out.println("Enter만 누르거나 q를 입력하세요.");
                }
            }
        }
    }

    // 처음에는 전체에서 균등 추첨, 이후에는 직전 한 곳을 제외하고 균등 추첨.
    // A → B → A는 허용하지만 A → A는 허용하지 않습니다.
    static int pickNextIndex(int size, int previous, Random random) {
        if (size < 1 || previous < -1 || previous >= size) {
            throw new IllegalArgumentException("추첨 대상 또는 이전 번호가 잘못됐습니다.");
        }
        if (size == 1) {
            return 0;
        }
        if (previous == -1) {
            return random.nextInt(size);
        }

        int next = random.nextInt(size - 1);
        return next >= previous ? next + 1 : next;
    }

    private static void printSelection(
            List<String> headers, List<String> row, int round) {
        System.out.println("\n" + "=".repeat(60));
        System.out.printf("랜덤 추천 %d%n", round);
        System.out.println("음식점: " + row.get(headers.indexOf("음식점명")));
        String menu = row.get(headers.indexOf("대표메뉴명"));
        System.out.println("대표메뉴: " + (menu.isBlank() ? "(원본에 없음)" : menu));
        System.out.println("-".repeat(60));

        // 기존 출력처럼 선택한 음식점의 모든 열을 출력합니다.
        for (int column = 0; column < headers.size(); column++) {
            System.out.println(headers.get(column) + ": " + row.get(column));
        }
    }

    static void validate(
            List<String> headers, List<List<String>> rows) throws IOException {
        if (headers.stream().anyMatch(String::isBlank)
                || new HashSet<>(headers).size() != headers.size()) {
            throw new IOException("CSV 헤더가 비어 있거나 중복됩니다.");
        }
        for (String field : List.of("음식점아이디", "음식점명", "대표메뉴명")) {
            if (!headers.contains(field)) {
                throw new IOException("필수 열이 없습니다: " + field);
            }
        }
        if (rows.isEmpty()) {
            throw new IOException("추첨할 음식점 데이터가 없습니다.");
        }

        int idColumn = headers.indexOf("음식점아이디");
        int nameColumn = headers.indexOf("음식점명");
        HashSet<String> ids = new HashSet<>();

        for (int index = 0; index < rows.size(); index++) {
            List<String> row = rows.get(index);
            if (row.size() != headers.size()) {
                throw new IOException("레코드 " + (index + 2) + ": 열 개수 불일치");
            }
            String id = row.get(idColumn);
            if (id.isBlank() || row.get(nameColumn).isBlank() || !ids.add(id)) {
                throw new IOException("레코드 " + (index + 2)
                        + ": 음식점 ID·이름 누락 또는 ID 중복");
            }
        }
    }

    // 따옴표 안의 쉼표·줄바꿈과 이중 따옴표를 CSV 규칙에 맞게 처리합니다.
    static List<List<String>> readCsv(Path path, Charset encoding) throws IOException {
        List<List<String>> records = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        // 0: 필드 시작, 1: 일반 값, 2: 따옴표 내부, 3: 닫는 따옴표 이후
        int state = 0;
        boolean first = true;

        try (PushbackReader reader = new PushbackReader(
                Files.newBufferedReader(path, encoding), 1)) {
            int value;
            while ((value = reader.read()) != -1) {
                char character = (char) value;
                if (first) {
                    first = false;
                    if (character == '\uFEFF') {
                        continue;
                    }
                }
                if (state == 2) {
                    if (character == '"') {
                        state = 3;
                    } else {
                        field.append(character);
                    }
                    continue;
                }
                if (state == 3 && character == '"') {
                    field.append('"');
                    state = 2;
                    continue;
                }
                if (character == ',') {
                    row.add(field.toString());
                    field.setLength(0);
                    state = 0;
                    continue;
                }
                if (character == '\n' || character == '\r') {
                    row.add(field.toString());
                    records.add(row);
                    row = new ArrayList<>();
                    field.setLength(0);
                    state = 0;
                    if (character == '\r') {
                        int next = reader.read();
                        if (next != -1 && next != '\n') {
                            reader.unread(next);
                        }
                    }
                    continue;
                }
                if (state == 3) {
                    throw new IOException("닫는 따옴표 뒤에 잘못된 문자가 있습니다.");
                }
                if (character == '"') {
                    if (state != 0) {
                        throw new IOException("일반 값 중간에 잘못된 따옴표가 있습니다.");
                    }
                    state = 2;
                } else {
                    field.append(character);
                    state = 1;
                }
            }
        }
        if (state == 2) {
            throw new IOException("닫히지 않은 따옴표가 있습니다.");
        }
        if (state != 0 || !row.isEmpty()) {
            row.add(field.toString());
            records.add(row);
        }
        // BOB_PICK_EXCLUDE_CONFIRMED_CLOSED
        int statusColumn = records.isEmpty()
                ? -1 : records.get(0).indexOf("최종대조판정");
        if (statusColumn >= 0) {
            for (int i = records.size() - 1; i >= 1; i--) {
                List<String> values = records.get(i);
                if (values.size() > statusColumn
                        && "폐업".equals(values.get(statusColumn).trim())) {
                    records.remove(i);
                }
            }
        }
        return records;
    }
}
