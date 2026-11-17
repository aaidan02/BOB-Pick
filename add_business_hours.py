"""요일·분 단위 검색용 영업시간을 CSV 한 열에 저장합니다."""
import argparse
import copy
import csv
from datetime import date, datetime, time, timedelta
from functools import lru_cache
import json
from pathlib import Path
import re
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DEFAULT = Path("관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv")
DAYS = list("월화수목금토일")
KST = ZoneInfo("Asia/Seoul")
PERIODS = "오전|오후|새벽|아침|저녁|낮|밤|AM|PM"
TIME = rf"(?:(?:익일|다음\s*날)\s*)?(?:(?:{PERIODS})\s*)?\d{{1,2}}\s*(?::\s*\d{{2}}|시(?:\s*\d{{1,2}}\s*분)?)"
RANGE = re.compile(rf"(?P<start>{TIME})\s*(?:~|～|〜|–|—|-|부터)\s*(?P<end>{TIME})", re.I)
PART = re.compile(
    rf"(?:(?P<next>익일|다음\s*날)\s*)?(?P<period>{PERIODS})?\s*"
    r"(?P<hour>\d{1,2})\s*(?::\s*(?P<minute>\d{2})|시(?:\s*(?P<kminute>\d{1,2})\s*분)?)", re.I)
FULL_DAY = r"(?:공휴일|국경일|매일|평일|주중|주말|[월화수목금토일]요일)"
DAY_EXPR = re.compile(rf"{FULL_DAY}(?:\s*[,·ㆍ/]\s*{FULL_DAY})*")
SHORT_DAY = r"(?:공휴일|국경일|매일|평일|주중|주말|[월화수목금토일](?:요일)?)"
CLOSED = re.compile(
    rf"(?P<days>{SHORT_DAY}(?:\s*[,·ㆍ/]\s*{SHORT_DAY})*)\s*(?:은|는)?\s*(?:정기\s*)?(?:휴무|휴일|쉽니다)")
COMPLEX = re.compile(
    r"break|브레이크|휴게|휴식|재료\s*준비|쉬는\s*시간|b\.?\s*t\.?|last\s*order|라스트\s*오더|"
    r"주문\s*마감|첫째|둘째|셋째|넷째|마지막|[1-5],[1-5]째|예약제|백화점\s*휴무|야간\s*휴무", re.I)
SPECIAL_FLAGS = {
    "공휴일": "public", "명절": "lunar", "명절당일": "lunar_day",
    "설날": "seollal", "설날당일": "seollal_day",
    "추석": "chuseok", "추석당일": "chuseok_day",
}


def empty_schedule(reason=""):
    return {"days": {day: None for day in DAYS}, "special": {}, "rules": {}, "reason": reason}


def minute(text):
    match = PART.fullmatch(text.strip())
    if match is None:
        raise ValueError("시간 표기 확인 필요")
    hour = int(match["hour"])
    value = int(match["minute"] or match["kminute"] or 0)
    period = (match["period"] or "").upper()
    if hour > 24 or value >= 60 or (hour == 24 and value):
        raise ValueError("시간 범위 오류")
    if hour <= 12:
        if period in ("오후", "PM", "낮"):
            hour = hour % 12 + 12
        elif period in ("오전", "AM", "새벽", "아침"):
            hour %= 12
        elif period == "저녁":
            hour = 0 if hour == 12 else hour + 12
        elif period == "밤":
            hour = 0 if hour == 12 else hour if hour <= 5 else hour + 12
    return hour * 60 + value + (1440 if match["next"] else 0)


def day_group(text):
    selected = set()
    priority = 2
    for match in re.finditer(SHORT_DAY, text):
        token = match.group()
        if token == "매일":
            selected.update(DAYS)
            priority = min(priority, 0)
        elif token in ("평일", "주중"):
            selected.update(DAYS[:5])
            priority = min(priority, 1)
        elif token == "주말":
            selected.update(DAYS[5:])
            priority = min(priority, 1)
        elif token in ("공휴일", "국경일"):
            selected.add("공휴일")
        else:
            selected.add(token[0])
    return selected, priority


def merged(intervals):
    if intervals is None:
        return None
    output = []
    for start, end in sorted(intervals):
        if output and start <= output[-1][1]:
            output[-1][1] = max(output[-1][1], end)
        else:
            output.append([start, end])
    return output


def parse_hours(text, override=None):
    text = text.strip()
    if override and override["source"] == text:
        return copy.deepcopy(override)
    result = empty_schedule()
    if not text:
        result["reason"] = "운영시간정보 없음"
        return result
    if COMPLEX.search(text):
        result["reason"] = "요일별 휴게시간·예외일정 검토 필요"
        return result
    matches = list(RANGE.finditer(text))
    if not matches and re.search(r"24\s*시간", text):
        result["days"] = {day: [[0, 1440]] for day in DAYS}
        result["reason"] = "24시간 운영 명시"
    priorities = {day: -1 for day in DAYS + ["공휴일"]}
    inherited, inherited_priority = set(DAYS), 0
    previous_end = 0
    for match in matches:
        prefix = text[previous_end:match.start()]
        groups = list(DAY_EXPR.finditer(prefix))
        if groups:
            inherited, inherited_priority = day_group(groups[-1].group())
        try:
            start, end = minute(match["start"]), minute(match["end"])
            if end == start:
                raise ValueError("동일 시작·종료 시각")
            wrapped = end < start
            if wrapped:
                end += 1440
            if end - start > 1440 or (wrapped and end - start > 1080 and "익일" not in match["end"]):
                raise ValueError("오전·오후 누락 가능")
            interval = [[start, end]]
        except ValueError:
            interval = None
        for day in inherited:
            target = result["special"] if day == "공휴일" else result["days"]
            if inherited_priority > priorities[day]:
                target[day] = copy.deepcopy(interval)
                priorities[day] = inherited_priority
            elif inherited_priority == priorities[day]:
                if target.get(day) is None or interval is None:
                    target[day] = None
                else:
                    target[day].extend(interval)
        previous_end = match.end()
    for match in CLOSED.finditer(text):
        if re.match(r"\s*(?:없|아님)", text[match.end():]):
            continue
        selected, _ = day_group(match["days"])
        for day in selected:
            target = result["special"] if day == "공휴일" else result["days"]
            target[day] = []
    if re.search(r"명절\s*(?:당일\s*)?(?:만\s*)?휴무|명절\s*당일\s*휴무", text):
        result["special"]["명절당일" if "당일" in text else "명절"] = []
    result["days"] = {day: merged(value) for day, value in result["days"].items()}
    result["special"] = {day: merged(value) for day, value in result["special"].items()}
    result["reason"] = "원문의 요일별 정규 영업시간"
    return result


def clock(value):
    if value == 1440:
        return "24:00"
    prefix = "익일" if value >= 1440 else ""
    hour, minute_value = divmod(value % 1440, 60)
    return f"{prefix}{hour:02d}:{minute_value:02d}"


def state_text(intervals):
    if intervals is None:
        return "미확인"
    if not intervals:
        return "휴무"
    return ",".join(f"{clock(start)}~{clock(end)}" for start, end in merged(intervals))


def serialize(schedule):
    if all(value is None for value in schedule["days"].values()) and not schedule["special"] and not schedule["rules"]:
        return "미확인"
    fields = [f"{day}={state_text(schedule['days'][day])}" for day in DAYS]
    fields.extend(f"{key}={state_text(value)}" for key, value in schedule["special"].items())
    fields.extend(f"{key}={','.join(value)}" for key, value in schedule["rules"].items())
    return " | ".join(fields)


def parse_state(text):
    if text == "미확인":
        return None
    if text == "휴무":
        return []
    result = []
    for interval in text.split(","):
        start, end = interval.split("~")
        a, b = minute(start), minute(end)
        if b < a:
            b += 1440
        if b <= a or b - a > 1440:
            raise ValueError("영업 구간 오류")
        result.append([a, b])
    return result


def deserialize(text):
    schedule = empty_schedule()
    if text == "미확인" or not text.strip():
        return schedule
    for field in text.split(" | "):
        key, value = field.split("=", 1)
        if key in DAYS:
            schedule["days"][key] = parse_state(value)
        elif key in ("고정휴무", "정기휴무", "영업조건"):
            schedule["rules"][key] = value.split(",")
        elif key in SPECIAL_FLAGS or key.startswith("공휴일"):
            schedule["special"][key] = parse_state(value)
        else:
            raise ValueError("알 수 없는 영업시간 항목")
    return schedule


@lru_cache(maxsize=1)
def calendar():
    result = json.loads((ROOT / "korean_holidays.json").read_text(encoding="utf-8"))
    result["sets"] = {key: set(values) for key, values in result["sets"].items()}
    return result


def matches_rule(day, rule):
    name, number = rule.split("#")
    if DAYS[day.weekday()] != name:
        return False
    return ((day + timedelta(days=7)).month != day.month if number == "마지막"
            else (day.day - 1) // 7 + 1 == int(number))


def business_windows(schedule, day):
    rules = schedule["rules"]
    if day.strftime("%m-%d") in rules.get("고정휴무", []):
        return []
    if any(matches_rule(day, rule) for rule in rules.get("정기휴무", [])):
        return []
    for rule in rules.get("영업조건", []):
        if DAYS[day.weekday()] == rule.split("#")[0] and not matches_rule(day, rule):
            return []
    normal = schedule["days"][DAYS[day.weekday()]]
    special = schedule["special"]
    if special:
        cal = calendar()
        if not cal["start_year"] <= day.year <= cal["end_year"]:
            return None
        value = day.isoformat()
        for key in ["추석당일", "설날당일", "명절당일", "추석", "설날", "명절"]:
            if key in special and value in cal["sets"][SPECIAL_FLAGS[key]]:
                return special[key]
        if value in cal["sets"]["public"]:
            key = "공휴일" + DAYS[day.weekday()]
            holiday = special.get(key, special.get("공휴일", normal))
            if normal == [] and holiday:
                return None
            return holiday
    return normal


def is_open_at(value, when=None):
    if when is None:
        when = datetime.now(KST)
    elif isinstance(when, str):
        when = datetime.combine(datetime.now(KST).date(), time.fromisoformat(when), KST)
    elif when.tzinfo is None:
        when = when.replace(tzinfo=KST)
    else:
        when = when.astimezone(KST)
    schedule = deserialize(value) if isinstance(value, str) else value
    point = when.hour * 60 + when.minute
    states = []
    for day, minute_value in [(when.date(), point), (when.date() - timedelta(days=1), point + 1440)]:
        windows = business_windows(schedule, day)
        states.append(None if windows is None else any(start <= minute_value < end for start, end in windows))
    if True in states:
        return True
    return None if None in states else False


def add_column(source, destination):
    with source.open(encoding="cp949", newline="") as stream:
        reader = csv.DictReader(stream)
        headers, rows = reader.fieldnames, list(reader)
    if not headers or "운영시간정보" not in headers or len(set(headers)) != len(headers):
        raise ValueError("운영시간정보 열 또는 CSV 헤더를 확인해 주세요.")
    overrides = json.loads((ROOT / "business_hours_overrides.json").read_text(encoding="utf-8"))
    fields = headers if "영업 시간대" in headers else headers + ["영업 시간대"]
    report = []
    for row in rows:
        schedule = parse_hours(row["운영시간정보"], overrides.get(row.get("음식점아이디", "")))
        row["영업 시간대"] = serialize(schedule)
        report.append((row.get("음식점아이디", ""), row.get("음식점명", ""), row["영업 시간대"], schedule["reason"]))
    temporary = destination.with_name(destination.name + ".tmp")
    try:
        with temporary.open("w", encoding="cp949", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\r\n")
            writer.writeheader()
            writer.writerows(rows)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", nargs="?", type=Path, default=DEFAULT)
    parser.add_argument("destination", nargs="?", type=Path)
    args = parser.parse_args()
    report = add_column(args.source, args.destination or args.source)
    print(f"요일별 영업시간 작성: {len(report)}행 / 전체 미확인 {sum(value == '미확인' for _, _, value, _ in report)}행")
