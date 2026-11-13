import java.io.IOException;
import java.io.PrintStream;
import java.lang.reflect.Method;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.*;

public class AddFoodColumns {
    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        System.setOut(new PrintStream(System.out, true, StandardCharsets.UTF_8));
        Path input = Path.of(args.length > 0 ? args[0]
                : "관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv");
        Path output = args.length > 1 ? Path.of(args[1]) : input;
        Charset encoding = Charset.forName("MS949");
        List<List<String>> records = RandomFoodPicker.readCsv(input, encoding);
        if (records.isEmpty()) throw new IOException("CSV 헤더가 없습니다.");
        List<String> sourceHeaders = records.get(0);
        int menuColumn = sourceHeaders.indexOf("메뉴한글명");
        int representativeColumn = sourceHeaders.indexOf("대표메뉴명");
        if (menuColumn < 0) throw new IOException("메뉴한글명 열이 없습니다.");

        // CSV 작성 시에만 메뉴 형태를 추론합니다.
        Method split = FoodPickerWeb.class.getDeclaredMethod("listValues", String.class);
        Method infer = FoodPickerWeb.class.getDeclaredMethod("inferForms", String.class);
        split.setAccessible(true);
        infer.setAccessible(true);

        List<String> outputHeaders = new ArrayList<>(sourceHeaders);
        int industryColumn = sourceHeaders.indexOf("업종정보");
        if (industryColumn < 0) throw new IOException("업종정보 열이 없습니다.");
        int categoryColumn = outputHeaders.indexOf("음식 종류");
        if (categoryColumn < 0) {
            categoryColumn = outputHeaders.size();
            outputHeaders.add("음식 종류");
        }
        int formColumn = outputHeaders.indexOf("음식 형태");
        if (formColumn < 0) {
            formColumn = outputHeaders.size();
            outputHeaders.add("음식 형태");
        }
        List<List<String>> result = new ArrayList<>();
        result.add(outputHeaders);
        int unknown = 0;
        for (int i = 1; i < records.size(); i++) {
            List<String> source = records.get(i);
            if (source.size() != sourceHeaders.size()) {
                throw new IOException("열 개수 불일치: " + (i + 1));
            }
            List<String> menus = (List<String>) split.invoke(null, source.get(menuColumn));
            if (menus.isEmpty() && representativeColumn >= 0
                    && !source.get(representativeColumn).isBlank()) {
                menus = List.of(source.get(representativeColumn));
            }
            Set<String> allForms = new HashSet<>();
            for (String menu : menus) {
                allForms.addAll((Set<String>) infer.invoke(null, menu));
            }
            List<String> ordered = new ArrayList<>();
            for (String form : FoodPickerWeb.FORMS) {
                if (allForms.contains(form)) ordered.add(form);
            }
            String value = ordered.isEmpty() ? "미분류" : String.join(" | ", ordered);
            if (ordered.isEmpty()) unknown++;
            List<String> row = new ArrayList<>(source);
            while (row.size() < outputHeaders.size()) row.add("");
            String industry = source.get(industryColumn);
            row.set(categoryColumn, industry.isBlank() ? "미분류" : industry);
            row.set(formColumn, value);
            result.add(row);
        }
        StringBuilder csv = new StringBuilder();
        for (List<String> row : result) {
            StringJoiner line = new StringJoiner(",");
            for (String value : row) line.add("\"" + value.replace("\"", "\"\"") + "\"");
            csv.append(line).append("\r\n");
        }
        Path absolute = output.toAbsolutePath();
        Path temporary = Files.createTempFile(absolute.getParent(), "food-forms-", ".csv.tmp");
        try {
            Files.writeString(temporary, csv, encoding);
            Files.move(temporary, absolute, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
        System.out.println("음식 종류·음식 형태 열 추가: " + (result.size() - 1) + "행 / "
                + outputHeaders.size() + "열 / 미분류 " + unknown + "행");
        System.out.println("저장: " + absolute);
    }
}
