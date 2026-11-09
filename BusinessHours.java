import java.time.*;
import java.util.*;

public final class BusinessHours {
    public static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final List<String> DAYS = List.of("월", "화", "수", "목", "금", "토", "일");
    private record Window(int start, int end) {}
    private final Map<String, List<Window>> days = new HashMap<>();
    private final Map<String, List<String>> rules = new HashMap<>();

    private BusinessHours() {
        for (String day : DAYS) days.put(day, null);
    }

    public static BusinessHours parse(String text) {
        BusinessHours result = new BusinessHours();
        if (text == null || text.isBlank() || text.equals("미확인")) return result;
        try {
            for (String field : text.split("\\s*\\|\\s*")) {
                String[] pair = field.split("=", 2);
                if (pair.length != 2) throw new IllegalArgumentException();
                String key = pair[0].trim(), value = pair[1].trim();
                if (List.of("고정휴무", "정기휴무", "영업조건").contains(key)) {
                    for (String rule : value.split(",")) {
                        if (key.equals("고정휴무")) MonthDay.parse("--" + rule);
                        else if (!rule.matches("[월화수목금토일]#(?:[1-5]|마지막)")) throw new IllegalArgumentException();
                    }
                    result.rules.put(key, List.of(value.split(",")));
                } else if (DAYS.contains(key) || key.startsWith("공휴일")
                        || List.of("명절", "명절당일", "설날", "설날당일", "추석", "추석당일").contains(key)) {
                    result.days.put(key, parseWindows(value));
                } else throw new IllegalArgumentException();
            }
            return result;
        } catch (RuntimeException error) {
            return new BusinessHours();
        }
    }

    private static List<Window> parseWindows(String text) {
        if (text.equals("미확인")) return null;
        if (text.equals("휴무")) return List.of();
        List<Window> result = new ArrayList<>();
        for (String part : text.split(",")) {
            String[] pair = part.trim().split("~", 2);
            if (pair.length != 2) throw new IllegalArgumentException();
            int start = minute(pair[0].trim()), end = minute(pair[1].trim());
            if (end < start) end += 1440;
            if (end <= start || end - start > 1440) throw new IllegalArgumentException();
            result.add(new Window(start, end));
        }
        return result;
    }

    private static int minute(String text) {
        boolean next = text.startsWith("익일");
        if (next) text = text.substring(2);
        if (text.equals("24:00")) return (next ? 1440 : 0) + 1440;
        if (!text.matches("\\d{2}:\\d{2}")) throw new IllegalArgumentException();
        LocalTime time = LocalTime.parse(text);
        return (next ? 1440 : 0) + time.getHour() * 60 + time.getMinute();
    }

    public Boolean openAt(LocalDate day, LocalTime time) {
        int point = time.getHour() * 60 + time.getMinute();
        Boolean today = contains(windows(day), point);
        Boolean yesterday = contains(windows(day.minusDays(1)), point + 1440);
        if (Boolean.TRUE.equals(today) || Boolean.TRUE.equals(yesterday)) return true;
        return today == null || yesterday == null ? null : false;
    }

    private static Boolean contains(List<Window> windows, int point) {
        if (windows == null) return null;
        return windows.stream().anyMatch(window -> point >= window.start && point < window.end);
    }

    private boolean matches(LocalDate day, String rule) {
        String[] pair = rule.split("#", 2);
        if (pair.length != 2 || !DAYS.get(day.getDayOfWeek().getValue() - 1).equals(pair[0])) return false;
        if (pair[1].equals("마지막")) return day.plusWeeks(1).getMonth() != day.getMonth();
        return (day.getDayOfMonth() - 1) / 7 + 1 == Integer.parseInt(pair[1]);
    }

    private List<Window> windows(LocalDate day) {
        String weekday = DAYS.get(day.getDayOfWeek().getValue() - 1);
        if (rules.getOrDefault("고정휴무", List.of()).contains(day.toString().substring(5))) return List.of();
        try {
            for (String rule : rules.getOrDefault("정기휴무", List.of())) {
                if (matches(day, rule)) return List.of();
            }
            for (String rule : rules.getOrDefault("영업조건", List.of())) {
                if (rule.startsWith(weekday + "#") && !matches(day, rule)) return List.of();
            }
        } catch (RuntimeException error) {
            return null;
        }
        List<Window> normal = days.get(weekday);
        boolean hasSpecial = days.keySet().stream().anyMatch(key -> !DAYS.contains(key));
        if (!hasSpecial) return normal;
        if (day.getYear() < 2020 || day.getYear() > 2035) return null;
        String date = day.toString();
        String[] keys = {"추석당일", "설날당일", "명절당일", "추석", "설날", "명절"};
        List<Set<String>> sets = List.of(CHUSEOK_DAY, SEOLLAL_DAY, LUNAR_DAY, CHUSEOK, SEOLLAL, LUNAR);
        for (int i = 0; i < keys.length; i++) {
            if (days.containsKey(keys[i]) && sets.get(i).contains(date)) return days.get(keys[i]);
        }
        if (PUBLIC.contains(date)) {
            String key = days.containsKey("공휴일" + weekday) ? "공휴일" + weekday : "공휴일";
            List<Window> holiday = days.containsKey(key) ? days.get(key) : normal;
            if (normal != null && normal.isEmpty() && holiday != null && !holiday.isEmpty()) return null;
            return holiday;
        }
        return normal;
    }

    // 아래 달력은 python-holidays에서 생성한 한국 공휴일 자료입니다.
    // 공휴일 조건이 있는 일정은 지원 연도 밖에서 미확인으로 처리합니다.
    private static final Set<String> PUBLIC = Set.of(("2020-01-01 2020-01-24 2020-01-25 2020-01-26 2020-01-27 2020-03-01 2020-04-15 2020-04-30 2020-05-05 2020-06-06 2020-08-15 2020-08-17 2020-09-30 2020-10-01 2020-10-02 2020-10-03 2020-10-09 2020-12-25 2021-01-01 2021-02-11 2021-02-12 2021-02-13 2021-03-01 2021-05-05 2021-05-19 2021-06-06 2021-08-15 2021-08-16 2021-09-20 2021-09-21 2021-09-22 2021-10-03 2021-10-04 2021-10-09 2021-10-11 2021-12-25 2022-01-01 2022-01-31 2022-02-01 2022-02-02 2022-03-01 2022-03-09 2022-05-05 2022-05-08 2022-06-01 2022-06-06 2022-08-15 2022-09-09 2022-09-10 2022-09-11 2022-09-12 2022-10-03 2022-10-09 2022-10-10 2022-12-25 2023-01-01 2023-01-21 2023-01-22 2023-01-23 2023-01-24 2023-03-01 2023-05-05 2023-05-27 2023-05-29 2023-06-06 2023-08-15 2023-09-28 2023-09-29 2023-09-30 2023-10-02 2023-10-03 2023-10-09 2023-12-25 2024-01-01 2024-02-09 2024-02-10 2024-02-11 2024-02-12 2024-03-01 2024-04-10 2024-05-05 2024-05-06 2024-05-15 2024-06-06 2024-08-15 2024-09-16 2024-09-17 2024-09-18 2024-10-01 2024-10-03 2024-10-09 2024-12-25 2025-01-01 2025-01-27 2025-01-28 2025-01-29 2025-01-30 2025-03-01 2025-03-03 2025-05-05 2025-05-06 2025-06-03 2025-06-06 2025-08-15 2025-10-03 2025-10-05 2025-10-06 2025-10-07 2025-10-08 2025-10-09 2025-12-25 2026-01-01 2026-02-16 2026-02-17 2026-02-18 2026-03-01 2026-03-02 2026-05-01 2026-05-05 2026-05-24 2026-05-25 2026-06-03 2026-06-06 2026-07-17 2026-08-15 2026-08-17 2026-09-24 2026-09-25 2026-09-26 2026-10-03 2026-10-05 2026-10-09 2026-12-25 2027-01-01 2027-02-06 2027-02-07 2027-02-08 2027-02-09 2027-03-01 2027-05-01 2027-05-03 2027-05-05 2027-05-13 2027-06-06 2027-07-17 2027-07-19 2027-08-15 2027-08-16 2027-09-14 2027-09-15 2027-09-16 2027-10-03 2027-10-04 2027-10-09 2027-10-11 2027-12-25 2027-12-27 2028-01-01 2028-01-26 2028-01-27 2028-01-28 2028-03-01 2028-04-12 2028-05-01 2028-05-02 2028-05-05 2028-06-06 2028-07-17 2028-08-15 2028-10-02 2028-10-03 2028-10-04 2028-10-05 2028-10-09 2028-12-25 2029-01-01 2029-02-12 2029-02-13 2029-02-14 2029-03-01 2029-05-01 2029-05-05 2029-05-07 2029-05-20 2029-05-21 2029-06-06 2029-07-17 2029-08-15 2029-09-21 2029-09-22 2029-09-23 2029-09-24 2029-10-03 2029-10-09 2029-12-25 2030-01-01 2030-02-02 2030-02-03 2030-02-04 2030-02-05 2030-03-01 2030-04-03 2030-05-01 2030-05-05 2030-05-06 2030-05-09 2030-06-06 2030-06-12 2030-07-17 2030-08-15 2030-09-11 2030-09-12 2030-09-13 2030-10-03 2030-10-09 2030-12-25 2031-01-01 2031-01-22 2031-01-23 2031-01-24 2031-03-01 2031-03-03 2031-05-01 2031-05-05 2031-05-28 2031-06-06 2031-07-17 2031-08-15 2031-09-30 2031-10-01 2031-10-02 2031-10-03 2031-10-09 2031-12-25 2032-01-01 2032-02-10 2032-02-11 2032-02-12 2032-03-01 2032-04-14 2032-05-01 2032-05-03 2032-05-05 2032-05-16 2032-05-17 2032-06-06 2032-07-17 2032-07-19 2032-08-15 2032-08-16 2032-09-18 2032-09-19 2032-09-20 2032-09-21 2032-10-03 2032-10-04 2032-10-09 2032-10-11 2032-12-25 2032-12-27 2033-01-01 2033-01-30 2033-01-31 2033-02-01 2033-02-02 2033-03-01 2033-05-01 2033-05-02 2033-05-05 2033-05-06 2033-06-06 2033-07-17 2033-07-18 2033-08-15 2033-09-07 2033-09-08 2033-09-09 2033-10-03 2033-10-09 2033-10-10 2033-12-25 2033-12-26 2034-01-01 2034-02-18 2034-02-19 2034-02-20 2034-02-21 2034-03-01 2034-05-01 2034-05-05 2034-05-25 2034-06-06 2034-06-14 2034-07-17 2034-08-15 2034-09-26 2034-09-27 2034-09-28 2034-10-03 2034-10-09 2034-12-25 2035-01-01 2035-02-07 2035-02-08 2035-02-09 2035-03-01 2035-04-04 2035-05-01 2035-05-05 2035-05-07 2035-05-15 2035-06-06 2035-07-17 2035-08-15 2035-09-15 2035-09-16 2035-09-17 2035-09-18 2035-10-03 2035-10-09 2035-12-25").split(" "));
    private static final Set<String> LUNAR = Set.of(("2020-01-24 2020-01-25 2020-01-26 2020-01-27 2020-09-30 2020-10-01 2020-10-02 2021-02-11 2021-02-12 2021-02-13 2021-09-20 2021-09-21 2021-09-22 2022-01-31 2022-02-01 2022-02-02 2022-09-09 2022-09-10 2022-09-11 2022-09-12 2023-01-21 2023-01-22 2023-01-23 2023-01-24 2023-09-28 2023-09-29 2023-09-30 2024-02-09 2024-02-10 2024-02-11 2024-02-12 2024-09-16 2024-09-17 2024-09-18 2025-01-28 2025-01-29 2025-01-30 2025-10-05 2025-10-06 2025-10-07 2025-10-08 2026-02-16 2026-02-17 2026-02-18 2026-09-24 2026-09-25 2026-09-26 2027-02-06 2027-02-07 2027-02-08 2027-02-09 2027-09-14 2027-09-15 2027-09-16 2028-01-26 2028-01-27 2028-01-28 2028-10-02 2028-10-03 2028-10-04 2028-10-05 2029-02-12 2029-02-13 2029-02-14 2029-09-21 2029-09-22 2029-09-23 2029-09-24 2030-02-02 2030-02-03 2030-02-04 2030-02-05 2030-09-11 2030-09-12 2030-09-13 2031-01-22 2031-01-23 2031-01-24 2031-09-30 2031-10-01 2031-10-02 2032-02-10 2032-02-11 2032-02-12 2032-09-18 2032-09-19 2032-09-20 2032-09-21 2033-01-30 2033-01-31 2033-02-01 2033-02-02 2033-09-07 2033-09-08 2033-09-09 2034-02-18 2034-02-19 2034-02-20 2034-02-21 2034-09-26 2034-09-27 2034-09-28 2035-02-07 2035-02-08 2035-02-09 2035-09-15 2035-09-16 2035-09-17 2035-09-18").split(" "));
    private static final Set<String> LUNAR_DAY = Set.of(("2020-01-25 2020-10-01 2021-02-12 2021-09-21 2022-02-01 2022-09-10 2023-01-22 2023-09-29 2024-02-10 2024-09-17 2025-01-29 2025-10-06 2026-02-17 2026-09-25 2027-02-07 2027-09-15 2028-01-27 2029-02-13 2029-09-22 2030-02-03 2030-09-12 2031-01-23 2031-10-01 2032-02-11 2032-09-19 2033-01-31 2033-09-08 2034-02-19 2034-09-27 2035-02-08 2035-09-16").split(" "));
    private static final Set<String> SEOLLAL = Set.of(("2020-01-24 2020-01-25 2020-01-26 2020-01-27 2021-02-11 2021-02-12 2021-02-13 2022-01-31 2022-02-01 2022-02-02 2023-01-21 2023-01-22 2023-01-23 2023-01-24 2024-02-09 2024-02-10 2024-02-11 2024-02-12 2025-01-28 2025-01-29 2025-01-30 2026-02-16 2026-02-17 2026-02-18 2027-02-06 2027-02-07 2027-02-08 2027-02-09 2028-01-26 2028-01-27 2028-01-28 2029-02-12 2029-02-13 2029-02-14 2030-02-02 2030-02-03 2030-02-04 2030-02-05 2031-01-22 2031-01-23 2031-01-24 2032-02-10 2032-02-11 2032-02-12 2033-01-30 2033-01-31 2033-02-01 2033-02-02 2034-02-18 2034-02-19 2034-02-20 2034-02-21 2035-02-07 2035-02-08 2035-02-09").split(" "));
    private static final Set<String> SEOLLAL_DAY = Set.of(("2020-01-25 2021-02-12 2022-02-01 2023-01-22 2024-02-10 2025-01-29 2026-02-17 2027-02-07 2028-01-27 2029-02-13 2030-02-03 2031-01-23 2032-02-11 2033-01-31 2034-02-19 2035-02-08").split(" "));
    private static final Set<String> CHUSEOK = Set.of(("2020-09-30 2020-10-01 2020-10-02 2021-09-20 2021-09-21 2021-09-22 2022-09-09 2022-09-10 2022-09-11 2022-09-12 2023-09-28 2023-09-29 2023-09-30 2024-09-16 2024-09-17 2024-09-18 2025-10-05 2025-10-06 2025-10-07 2025-10-08 2026-09-24 2026-09-25 2026-09-26 2027-09-14 2027-09-15 2027-09-16 2028-10-02 2028-10-03 2028-10-04 2028-10-05 2029-09-21 2029-09-22 2029-09-23 2029-09-24 2030-09-11 2030-09-12 2030-09-13 2031-09-30 2031-10-01 2031-10-02 2032-09-18 2032-09-19 2032-09-20 2032-09-21 2033-09-07 2033-09-08 2033-09-09 2034-09-26 2034-09-27 2034-09-28 2035-09-15 2035-09-16 2035-09-17 2035-09-18").split(" "));
    private static final Set<String> CHUSEOK_DAY = Set.of(("2020-10-01 2021-09-21 2022-09-10 2023-09-29 2024-09-17 2025-10-06 2026-09-25 2027-09-15 2029-09-22 2030-09-12 2031-10-01 2032-09-19 2033-09-08 2034-09-27 2035-09-16").split(" "));
}
