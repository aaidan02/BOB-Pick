import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.*;

public class BusinessHoursProbe {
    public static void main(String[] args) throws Exception {
        List<List<String>> records = RandomFoodPicker.readCsv(Path.of(args[0]), Charset.forName("MS949"));
        int id = records.get(0).indexOf("음식점아이디");
        int hours = records.get(0).indexOf("영업 시간대");
        Map<String, BusinessHours> schedules = new HashMap<>();
        for (List<String> row : records.subList(1, records.size())) {
            schedules.put(row.get(id), BusinessHours.parse(row.get(hours)));
        }
        List<List<String>> cases = RandomFoodPicker.readCsv(Path.of(args[1]), StandardCharsets.UTF_8);
        for (List<String> row : cases.subList(1, cases.size())) {
            Boolean actual = schedules.get(row.get(0)).openAt(LocalDate.parse(row.get(1)), LocalTime.parse(row.get(2)));
            if (!String.valueOf(actual).equals(row.get(3))) {
                throw new AssertionError(row + " actual=" + actual);
            }
        }
        System.out.println("PASS: Java/Python matching for " + (cases.size() - 1) + " weekday/time cases");
    }
}
