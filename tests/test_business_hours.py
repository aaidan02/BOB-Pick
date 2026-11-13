import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from add_business_hours import (
    DAYS, KST, add_column, deserialize, is_open_at, parse_hours, serialize
)


class BusinessHoursTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reviewed = json.loads((ROOT / "business_hours_overrides.json").read_text(encoding="utf-8"))
        cls.by_name = {item["name"]: item for item in cls.reviewed.values()}

    def value(self, name):
        return serialize(self.by_name[name])

    def at(self, value, text):
        return is_open_at(value, datetime.fromisoformat(text))

    def test_current_clock_default_and_unknown(self):
        full = serialize(parse_hours("매일 00:00~24:00"))
        self.assertIs(is_open_at(full), True)
        self.assertIsNone(is_open_at("미확인"))
        self.assertIs(self.at(full, "2026-11-03T00:00"), True)

    def test_weekday_and_break_boundaries(self):
        value = self.value("도군샤부")
        for stamp, expected in [
            ("2026-11-02T12:00", False),
            ("2026-11-03T10:59", False),
            ("2026-11-03T11:00", True),
            ("2026-11-03T14:59", True),
            ("2026-11-03T15:00", False),
            ("2026-11-03T16:59", False),
            ("2026-11-03T17:00", True),
            ("2026-11-03T21:00", False),
        ]:
            with self.subTest(stamp=stamp):
                self.assertIs(self.at(value, stamp), expected)

    def test_weekend_breaks_are_not_weekday_breaks(self):
        value = self.value("대손관 둔산DV점")
        self.assertIs(self.at(value, "2026-11-03T15:30"), False)
        self.assertIs(self.at(value, "2026-11-07T15:30"), True)
        self.assertIs(self.at(value, "2026-11-07T16:30"), False)
        self.assertIs(self.at(value, "2026-11-07T17:00"), True)

    def test_previous_day_overnight_even_when_today_is_closed(self):
        schedule = {
            "days": {day: [] for day in DAYS},
            "special": {}, "rules": {},
        }
        schedule["days"]["월"] = [[1020, 1560]]
        value = serialize(schedule)
        self.assertIn("월=17:00~익일02:00", value)
        self.assertIs(self.at(value, "2026-11-03T00:30"), True)
        self.assertIs(self.at(value, "2026-11-03T01:59"), True)
        self.assertIs(self.at(value, "2026-11-03T02:00"), False)
        self.assertIs(self.at(value, "2026-11-03T17:00"), False)

    def test_last_order_is_used_for_new_recommendations(self):
        self.assertIs(self.at(self.value("동백카츠"), "2026-11-03T20:29"), True)
        self.assertIs(self.at(self.value("동백카츠"), "2026-11-03T20:30"), False)
        self.assertIs(self.at(self.value("시라스시"), "2026-11-03T13:59"), True)
        self.assertIs(self.at(self.value("시라스시"), "2026-11-03T14:00"), False)
        self.assertIs(self.at(self.value("시라스시"), "2026-11-03T17:09"), False)
        self.assertIs(self.at(self.value("시라스시"), "2026-11-03T17:10"), True)

    def test_holidays_and_monthly_rules(self):
        indy = self.value("INDY")
        self.assertIs(self.at(indy, "2026-11-03T16:00"), False)
        self.assertIs(self.at(indy, "2026-05-05T16:00"), True)
        self.assertIsNone(self.at(indy, "2040-05-05T16:00"))
        self.assertIs(self.at(self.value("시라스시"), "2026-02-17T12:00"), False)
        mirak = self.value("미락 둔산본점")
        self.assertIs(self.at(mirak, "2026-11-02T12:00"), False)
        self.assertIs(self.at(mirak, "2026-11-09T12:00"), True)
        self.assertIs(self.at(mirak, "2026-11-16T12:00"), False)
        cafe = self.value("겟베러")
        self.assertIs(self.at(cafe, "2026-11-22T13:00"), False)
        self.assertIs(self.at(cafe, "2026-11-29T13:00"), True)
        self.assertIs(self.at(cafe, "2026-11-07T19:00"), False)

    def test_seoul_timezone(self):
        value = self.value("도군샤부")
        self.assertIs(is_open_at(value, datetime(2026, 11, 3, 8, 30, tzinfo=timezone.utc)), True)
        self.assertIs(is_open_at(value, datetime(2026, 11, 3, 6, 30, tzinfo=timezone.utc)), False)

    def test_generic_days_and_unknown_are_not_guessed(self):
        value = serialize(parse_hours("평일 09:00~18:00 | 일요일 휴무 | 공휴일 휴무"))
        self.assertIs(self.at(value, "2026-11-03T12:00"), True)
        self.assertIs(self.at(value, "2026-05-05T12:00"), False)
        self.assertIsNone(self.at(value, "2026-11-07T12:00"))
        full = serialize(parse_hours("매일 24시간 운영 | 일요일 휴무"))
        self.assertIs(self.at(full, "2026-11-07T12:00"), True)
        self.assertIs(self.at(full, "2026-11-08T12:00"), False)
        for text in ["", "매일 11:00~10:00", "토요일 점심3시까지",
                     "매일 11:00~21:00 브레이크타임 오후3시"]:
            with self.subTest(text=text):
                self.assertIsNone(self.at(serialize(parse_hours(text)), "2026-11-03T12:00"))

    def test_column_replacement_preserves_other_47_columns(self):
        columns = ["음식점아이디", "음식점명", "운영시간정보", "최종대조판정",
                   "음식 종류", "음식 형태", "영업 시간대", "메모"]
        rows = [
            ["test1", "음식점", "매일 11:00~21:00", "미확정", "한식", "면 | 밥", "점심 | 저녁", '쉼표,따옴표"와\r\n줄바꿈'],
            ["test2", "다른곳", "", "미확인", "기타", "미분류", "미확인", "보존"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "hours.csv"
            with source.open("w", encoding="cp949", newline="") as stream:
                writer = csv.writer(stream); writer.writerow(columns); writer.writerows(rows)
            add_column(source, source)
            with source.open(encoding="cp949", newline="") as stream:
                reader = csv.DictReader(stream); output = list(reader)
                self.assertEqual(reader.fieldnames, columns)
            retained = [key for key in columns if key != "영업 시간대"]
            expected = [dict(zip(columns, row)) for row in rows]
            self.assertEqual(
                [{key: row[key] for key in retained} for row in output],
                [{key: row[key] for key in retained} for row in expected])
            self.assertIs(self.at(output[0]["영업 시간대"], "2026-11-03T12:00"), True)
            first = source.read_bytes()
            add_column(source, source)
            self.assertEqual(source.read_bytes(), first)


if __name__ == "__main__":
    unittest.main(verbosity=2)
