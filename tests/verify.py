"""외부 Python 패키지 없이 CSV, 기존 CLI, 실제 HTTP API를 검증합니다."""
import contextlib
import csv
from datetime import datetime
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import sys
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv"
JAVA = shutil.which("java") or "java"
BUILD = ROOT / "build"
HEADERS = ["음식점아이디", "음식점명", "대표메뉴명", "주소", "위도", "경도"]


def fixture(path, rows, encoding="cp949"):
    with path.open("w", encoding=encoding, newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(HEADERS)
        writer.writerows(rows)
    return path


@contextlib.contextmanager
def server(path=DATA, encoding="MS949", web=False):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    main = "FoodPickerWeb" if web else "FoodPickerServer"
    arguments = [str(path), str(port)] if web else [str(path), encoding, str(port)]
    process = subprocess.Popen(
        [JAVA, "-cp", str(BUILD), main, *arguments],
        cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 10
        while True:
            if process.poll() is not None:
                raise AssertionError(process.stdout.read().decode("utf-8"))
            try:
                request(base, "/api/count" if web else "/api/info")
                break
            except (OSError, urllib.error.URLError):
                if time.monotonic() > deadline:
                    raise AssertionError("서버 시작 시간 초과")
                time.sleep(0.05)
        yield base
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stdout.close()


def request(base, path, method="GET"):
    req = urllib.request.Request(base + path, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read()
        result = json.loads(body) if "application/json" in response.headers.get("Content-Type", "") else body
        return response.status, result, response.headers


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        BUILD.mkdir(exist_ok=True)
        javac = shutil.which("javac")
        compiler = [javac] if javac else [JAVA, "com.sun.tools.javac.Main"]
        subprocess.run(compiler + ["-encoding", "UTF-8", "-d", str(BUILD),
                                  "RandomFoodPicker.java", "FoodPickerServer.java", "FoodPickerWeb.java", "BusinessHours.java", "GeminiFoodRecommender.java",
                                  "tests/ClosureFilterTest.java", "tests/BusinessHoursProbe.java"],
                       cwd=ROOT, check=True, timeout=30)

    def test_actual_dataset_and_non_repeating_selection(self):
        with DATA.open(encoding="cp949", newline="") as stream:
            expected = {row["음식점아이디"]: row for row in csv.DictReader(stream)}
        self.assertEqual(len(expected), 808)
        self.assertEqual(sum(r["최종대조판정"] == "미확정" for r in expected.values()), 425)
        self.assertFalse(any(r["최종대조판정"].strip() == "폐업" for r in expected.values()))
        with server() as base:
            code, info, _ = request(base, "/api/info")
            self.assertEqual(code, 200)
            self.assertEqual(info["total"], 808)
            previous = None
            for _ in range(150):
                query = "" if previous is None else "?" + urllib.parse.urlencode({"previous": previous})
                code, result, headers = request(base, "/api/pick" + query)
                self.assertEqual(code, 200)
                self.assertEqual(headers["Cache-Control"], "no-store")
                row = result["restaurant"]
                self.assertNotEqual(row["id"], previous)
                original = expected[row["id"]]
                self.assertEqual(row["name"], original["음식점명"])
                self.assertEqual(row["menu"], original["대표메뉴명"])
                self.assertEqual(row["latitude"], float(original["위도"]))
                self.assertEqual(row["longitude"], float(original["경도"]))
                self.assertEqual(row["fields"], original)
                previous = row["id"]

    def test_routes_and_invalid_requests(self):
        with server() as base:
            for path in ["/", "/naver-map-test.html", "/app.js", "/styles.css"]:
                self.assertEqual(request(base, path)[0], 200)
            for path in ["/FoodPickerServer.java", "/missing", "/" + urllib.parse.quote(DATA.name)]:
                self.assertEqual(request(base, path)[0], 404)
            self.assertEqual(request(base, "/api/pick?previous=unknown")[0], 400)
            self.assertEqual(request(base, "/api/pick", "POST")[0], 405)
            self.assertEqual(request(base, "/api/info")[0], 200)

    def test_only_confirmed_closures_are_filtered(self):
        result = subprocess.run([JAVA, "-cp", str(BUILD), "ClosureFilterTest"],
                                cwd=ROOT, capture_output=True, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_web_updates_csv_and_preserves_uncertain_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "web.csv"
            with path.open("w", encoding="cp949", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(HEADERS + ["최종대조판정", "LOCALDATA대조판정", "메모", "음식 종류", "음식 형태"])
                writer.writerows(row + ["한식", "밥"] for row in [
                    ['closed', '폐업 식당', '메뉴', '대전', '36.35', '127.38', '폐업', '폐업', '삭제'],
                    ['unknown', '미확정 식당', '국밥', '대전', '36.35', '127.38', '미확정', '폐업', '따옴표"와,\r\n줄바꿈'],
                    ['unchecked', '미확인 식당', '김밥', '대전', '36.35', '127.38', '미확인', '폐업', '유지'],
                    ['blank', '빈 판정 식당', '김밥', '대전', '36.35', '127.38', '', '폐업', '유지'],
                    ['uncertain', '폐업 미확정 식당', '김밥', '대전', '36.35', '127.38', '폐업 여부 미확인', '폐업', '유지'],
                ])
            with path.open(encoding="cp949", newline="") as stream:
                expected = [row for row in csv.DictReader(stream) if row["최종대조판정"] != "폐업"]
            with server(path, web=True) as base:
                self.assertEqual(request(base, "/api/count?time=all")[1], b"4")
                self.assertEqual(request(base, "/api/pick?previous=closed")[0], 400)
                with path.open(encoding="cp949", newline="") as stream:
                    self.assertEqual(list(csv.DictReader(stream)), expected)
                body = request(base, "/api/pick?time=all")[1].decode("utf-8")
                selected = {key: values[0] for key, values in urllib.parse.parse_qs(body, keep_blank_values=True).items()}
                original_fields = {key: selected[key] for key in expected[0]}
                self.assertIn(original_fields, expected)
            saved = path.read_bytes()
            with server(path, web=True):
                self.assertEqual(path.read_bytes(), saved)

    def test_web_removes_all_closed_records_and_keeps_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "closed.csv"
            columns = ["음식점아이디", "음식점명", "대표메뉴명", "최종대조판정", "음식 종류", "음식 형태"]
            with path.open("w", encoding="cp949", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(columns)
                writer.writerow(["1", "상호", "메뉴", "폐업", "한식", "밥"])
            result = subprocess.run([JAVA, "-cp", str(BUILD), "FoodPickerWeb", str(path)],
                                    cwd=ROOT, capture_output=True, encoding="utf-8", timeout=10)
            self.assertEqual(result.returncode, 1)
            with path.open(encoding="cp949", newline="") as stream:
                reader = csv.DictReader(stream)
                self.assertEqual(list(reader), [])
                self.assertEqual(reader.fieldnames, columns)

    def test_api_keeps_uncertain_rows_and_rejects_closed_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "states.csv"
            with path.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(HEADERS + ["최종대조판정", "LOCALDATA대조판정"])
                writer.writerows([
                    ['closed', '폐업 식당', '메뉴', '대전', '36.35', '127.38', '폐업', '폐업'],
                    ['unknown', '미확정 식당', '메뉴', '대전', '36.35', '127.38', '미확정', '폐업'],
                    ['unchecked', '미확인 식당', '메뉴', '대전', '36.35', '127.38', '미확인', '폐업'],
                ])
            with server(path, "UTF-8") as base:
                self.assertEqual(request(base, "/api/info")[1]["total"], 2)
                self.assertEqual(request(base, "/api/pick?previous=closed")[0], 400)
                first = request(base, "/api/pick")[1]["restaurant"]
                second = request(base, "/api/pick?previous=" + first["id"])[1]["restaurant"]
                self.assertEqual({first["id"], second["id"]}, {"unknown", "unchecked"})

    def test_all_confirmed_closed_is_not_drawn(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "closed.csv"
            path.write_text('음식점아이디,음식점명,대표메뉴명,최종대조판정\n1,상호,메뉴,폐업\n', encoding="utf-8")
            for main in ["RandomFoodPicker", "FoodPickerServer"]:
                with self.subTest(main=main):
                    result = subprocess.run([JAVA, "-cp", str(BUILD), main, str(path), "UTF-8"],
                                            cwd=ROOT, capture_output=True, encoding="utf-8", timeout=10)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn("추첨할 음식점 데이터가 없습니다", result.stderr)

    def test_csv_quotes_newlines_encoding_and_two_restaurants(self):
        with tempfile.TemporaryDirectory() as directory:
            path = fixture(Path(directory) / "sample.csv", [
                ['한글 & /?', '식당 "하나", 본점', '국밥\n정식', '대전 둔산동', '36.35', '127.38'],
                ['둘', '두 번째', '김밥', '대전', '36.36', '127.39'],
            ])
            with server(path) as base:
                previous = None
                seen = set()
                for _ in range(10):
                    query = "" if previous is None else "?" + urllib.parse.urlencode({"previous": previous})
                    _, result, _ = request(base, "/api/pick" + query)
                    row = result["restaurant"]
                    self.assertNotEqual(row["id"], previous)
                    seen.add(row["id"])
                    if row["id"].startswith("한글"):
                        self.assertEqual(row["name"], '식당 "하나", 본점')
                        self.assertEqual(row["menu"], '국밥\n정식')
                    previous = row["id"]
                self.assertEqual(len(seen), 2)

    def test_single_restaurant_invalid_coordinates_and_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            path = fixture(Path(directory) / "single.csv", [
                ['하나', '음식점', '', '', 'NaN', '999'],
            ], encoding="utf-8-sig")
            with server(path, "UTF-8") as base:
                _, result, _ = request(base, "/api/pick")
                self.assertIsNone(result["restaurant"]["latitude"])
                self.assertIsNone(result["restaurant"]["longitude"])
                self.assertEqual(result["restaurant"]["menu"], "")
                query = urllib.parse.urlencode({"previous": "하나"})
                self.assertEqual(request(base, "/api/pick?" + query)[1]["restaurant"]["id"], "하나")
            cli = subprocess.run([JAVA, "-cp", str(BUILD), "RandomFoodPicker", str(path), "UTF-8"],
                                 cwd=ROOT, input="q\n", capture_output=True, encoding="utf-8", timeout=10)
            self.assertEqual(cli.returncode, 0, cli.stderr)
            self.assertIn("음식점: 음식점", cli.stdout)
            self.assertIn("대표메뉴: (원본에 없음)", cli.stdout)

    def test_invalid_data_fails_clearly(self):
        for contents, expected in [
            ("", "비어"),
            ('음식점아이디,음식점명,대표메뉴명\n1,상호,"닫히지 않음', "닫히지"),
            ('음식점아이디,음식점명,대표메뉴명\n1,상호,메뉴\n1,중복,메뉴', "중복"),
            ('음식점명,대표메뉴명\n상호,메뉴', "필수 열"),
        ]:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "invalid.csv"
                path.write_text(contents, encoding="utf-8")
                result = subprocess.run([JAVA, "-cp", str(BUILD), "FoodPickerServer", str(path), "UTF-8"],
                                        cwd=ROOT, capture_output=True, encoding="utf-8", timeout=10)
                self.assertEqual(result.returncode, 1)
                self.assertIn(expected, result.stderr)

    @contextlib.contextmanager
    def filtered_server(self):
        cases = [
            ("noodle", "칼국수", "한식", "['공깃밥'; '칼국수'; '칼국수 특']", "[1000, 9000, 12000]"),
            ("rice", "비빔밥", "한식", "[비빔밥,공깃밥]", "[8000,1000]"),
            ("fried", "등심돈까스", "일식", "[등심돈까스,공깃밥]", '["12,000",1000]'),
            ("cafe", "아메리카노", "카페·디저트", "['아메리카노', '카페라떼']", "[4000,4500]"),
            ("dessert", "마카롱", "카페·디저트", "[마카롱]", "[2500]"),
            ("meat", "생삼겹살150g", "한식", "[생삼겹살150g]", "[15000.0]"),
            ("pizza", "치즈피자", "양식", "['치즈피자R'; '감자튀김']", "[16000,5000]"),
            ("soup", "갈비탕", "한식", "[갈비탕,공깃밥]", "[11000,1000]"),
            ("ambiguous", "모둠초밥", "일식", "['모둠초밥10p'; '모둠초밥12p']", "[12000,14000]"),
            ("missing", "특별메뉴", "기타", "", ""),
            ("tteok", "떡볶이", "분식", "[떡볶이]", "[5000]"),
            ("sweet", "흑설탕라떼", "카페·디저트", "[흑설탕라떼]", "[4500]"),
            ("tangsuyuk", "탕수육", "중식", "[탕수육]", "[20000]"),
            ("raw", "육회", "한식", "[육회]", "[18000]"),
            ("jokbal", "족발", "한식", "[족발]", "[30000]"),
            ("bossam", "보쌈", "한식", "[보쌈]", "[25000]"),
            ("lunch", "불백도시락", "한식", "[불백도시락]", "[7000]"),
            ("asian", "쌀국수", "아시안", "[쌀국수]", "[8500]"),
            ("chicken", "후라이드치킨", "치킨", "[후라이드치킨]", "[19000]"),
            ("parentheses", "하얀전골(1인,2인이상)", "한식",
             "[하얀전골(1인,2인이상),빨간전골(1인,2인이상)]", "[13000,14000]"),
            ("mismatch", "특제돈까스", "일식", "[특제돈까스,우동]", "[9000]"),
        ]
        tags = {
            "noodle": ("한식", "면 | 밥"), "rice": ("한식", "밥"),
            "fried": ("일식", "튀김"), "cafe": ("카페", "음료"),
            "dessert": ("디저트", "디저트"), "meat": ("한식 | 고기", "구이"),
            "pizza": ("양식 | 피자", "빵"), "soup": ("한식 | 찜·탕", "국·탕·찌개"),
            "ambiguous": ("일식", "밥 | 회·생식"), "missing": ("기타", "미분류"),
            "tteok": ("분식", "볶음"), "sweet": ("카페", "음료"),
            "tangsuyuk": ("중식", "튀김"), "raw": ("한식 | 고기", "회·생식"),
            "jokbal": ("한식 | 족발", "찜·삶음"), "bossam": ("한식 | 보쌈", "찜·삶음"),
            "lunch": ("한식 | 도시락", "밥"), "asian": ("아시안", "면"),
            "chicken": ("치킨", "튀김"), "parentheses": ("한식 | 찜·탕", "국·탕·찌개"),
            "mismatch": ("일식", "튀김"),
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "filter.csv"
            with path.open("w", encoding="cp949", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(HEADERS + ["업종정보", "메뉴한글명", "메뉴금액", "최종대조판정", "음식 종류", "음식 형태"])
                for index, (id_, menu, industry, names, prices) in enumerate(cases):
                    writer.writerow([id_, id_ + " 식당", menu, "대전", "36.35", "127.38",
                                     industry, names, prices, "미확정" if index % 2 else "미확인", *tags[id_]])
                writer.writerow(["closed", "폐업 식당", "칼국수", "대전", "36.35", "127.38",
                                 "한식", "[칼국수]", "[1000]", "폐업", "한식", "면"])
            with server(path, web=True) as base:
                yield base, cases

    def filter_count(self, base, **conditions):
        conditions.setdefault("time", "all")
        code, result, _ = request(base, "/api/count?" + urllib.parse.urlencode(conditions))
        self.assertEqual(code, 200, result)
        return int(result)

    def filter_pick(self, base, **conditions):
        conditions.setdefault("time", "all")
        code, body, _ = request(base, "/api/pick?" + urllib.parse.urlencode(conditions))
        self.assertEqual(code, 200, body)
        return {key: values[0] for key, values in urllib.parse.parse_qs(
            body.decode("utf-8"), keep_blank_values=True).items()}

    def test_filter_defaults_and_unknown_prices(self):
        with self.filtered_server() as (base, cases):
            self.assertEqual(self.filter_count(base), len(cases))
            self.assertEqual(self.filter_count(base, category="", form="", min="", max=""), len(cases))
            self.assertEqual(self.filter_count(base, min=1), len(cases) - 1)
            self.assertEqual(self.filter_count(base, max=0), 0)
            self.assertEqual(self.filter_count(base, min=8000, max=9000), 4)
            self.assertEqual(request(base, "/api/pick?previous=closed")[0], 400)

    def batch_pick(self, base, **conditions):
        conditions.setdefault("time", "all")
        code, data, headers = request(base, "/api/picks?" + urllib.parse.urlencode(conditions))
        self.assertEqual(code, 200, data)
        self.assertEqual(headers["Cache-Control"], "no-store")
        ids = [row["음식점아이디"] for row in data["restaurants"]]
        self.assertEqual(len(ids), len(set(ids)))
        return data

    def test_three_restaurants_share_menu_and_filter_rules(self):
        with self.filtered_server() as (base, _):
            data = self.batch_pick(base, category="한식", min=1000, max=15000)
            self.assertEqual(len(data["restaurants"]), 3)
            for row in data["restaurants"]:
                self.assertIn("한식", row["_categories"])
                self.assertTrue(1000 <= int(row["_price"]) <= 15000)
                self.assertIn({"name": row["_menu"], "price": int(row["_price"])}, json.loads(row["_matchedMenus"]))
            limited = self.batch_pick(base, category="한식", form="면", min=9000, max=9000)
            self.assertEqual(len(limited["restaurants"]), 1)
            self.assertEqual(limited["restaurants"][0]["_menu"], "칼국수")
            self.assertEqual(self.batch_pick(base, form="면", max=1000)["restaurants"], [])

    def test_batch_excludes_locked_and_prefers_new_restaurants(self):
        with self.filtered_server() as (base, _):
            first = self.batch_pick(base, min=1)["restaurants"]
            ids = [row["음식점아이디"] for row in first]
            again = self.batch_pick(base, min=1, size=2, exclude0=ids[1], prior0=ids[0], prior1=ids[2])
            self.assertEqual(len(again["restaurants"]), 2)
            self.assertTrue(set(ids).isdisjoint(row["음식점아이디"] for row in again["restaurants"]))
            last = self.batch_pick(base, min=1, size=1, exclude0=ids[0], exclude1=ids[1], prior0=ids[2])
            self.assertEqual(len(last["restaurants"]), 1)
            self.assertNotIn(last["restaurants"][0]["음식점아이디"], ids)

    def test_batch_small_pool_and_same_restaurant_other_menu(self):
        with self.filtered_server() as (base, _):
            first = self.batch_pick(base, category="한식", form="면")["restaurants"][0]
            again = self.batch_pick(base, category="한식", form="면", prior0=first["음식점아이디"], menu0=first["_menuIndex"])
            self.assertEqual(again["count"], 1)
            self.assertEqual(again["restaurants"][0]["음식점아이디"], first["음식점아이디"])
            self.assertNotEqual(again["restaurants"][0]["_menuIndex"], first["_menuIndex"])
            locked = self.batch_pick(base, category="한식", form="면", size=2, exclude0=first["음식점아이디"])
            self.assertEqual(locked["count"], 1)
            self.assertEqual(locked["available"], 0)
            self.assertEqual(locked["restaurants"], [])

    def test_batch_rejects_invalid_lock_and_size_requests(self):
        with self.filtered_server() as (base, _):
            for params in [dict(size=0), dict(size=4), dict(size="bad"), dict(exclude0="closed"),
                           dict(prior0="missing-id"), dict(exclude0="rice", exclude1="rice", size=1),
                           dict(exclude0="rice", prior0="rice", size=2), dict(exclude0="rice", size=3),
                           dict(exclude3="rice"), dict(prior0="rice", prior1="rice")]:
                with self.subTest(params=params):
                    code, _, _ = request(base, "/api/picks?" + urllib.parse.urlencode(params))
                    self.assertEqual(code, 400)
            self.assertEqual(request(base, "/api/picks", "POST")[0], 405)

    def test_form_and_price_must_match_the_same_menu(self):
        with self.filtered_server() as (base, _):
            conditions = dict(category="한식", form="면", min=5000, max=10000)
            self.assertEqual(self.filter_count(base, **conditions), 1)
            row = self.filter_pick(base, **conditions)
            self.assertEqual(row["음식점아이디"], "noodle")
            self.assertEqual(row["_price"], "9000")
            self.assertEqual(row["_priceMenu"], "칼국수")
            self.assertEqual(row["_menu"], "칼국수")
            # 같은 가게의 1,000원 공깃밥으로 면 메뉴 가격을 대신 판단하지 않습니다.
            self.assertEqual(self.filter_count(base, category="한식", form="면", max=1000), 0)
            # 국숫집의 밥 메뉴는 1,000원으로 8,000~9,000원 밥 조건에 일치하지 않습니다.
            self.assertEqual(self.filter_count(base, category="한식", form="밥", min=8000, max=9000), 1)
            cheap = self.filter_pick(base, category="한식", form="밥", min=1000, max=1000)
            self.assertEqual(cheap["_menu"], "공깃밥")
            self.assertEqual(cheap["_price"], "1000")

    def test_menu_prices_support_quotes_semicolons_and_parentheses(self):
        with self.filtered_server() as (base, _):
            fried = self.filter_pick(base, category="일식", form="튀김", min=12000, max=12000)
            self.assertEqual(fried["_price"], "12000")
            pizza = self.filter_pick(base, category="피자", min=16000, max=16000)
            self.assertEqual(pizza["_price"], "16000")
            self.assertEqual(pizza["_priceMenu"], "치즈피자R")
            soup = self.filter_pick(base, min=13000, max=13000, category="찜·탕")
            self.assertEqual(soup["음식점아이디"], "parentheses")
            self.assertEqual(soup["_price"], "13000")
            meat = self.filter_pick(base, category="고기", form="구이")
            self.assertEqual(meat["_price"], "15000")
            # 사이즈별 실제 메뉴·가격으로 비교하므로 대표메뉴가 모호해도 추천합니다.
            sushi = self.filter_pick(base, category="일식", form="밥", min=14000, max=14000)
            self.assertEqual(sushi["_menu"], "모둠초밥12p")
            self.assertEqual(sushi["_price"], "14000")
            mismatch = self.filter_pick(base, category="일식", form="튀김", previous="fried")
            self.assertEqual(mismatch["음식점아이디"], "mismatch")
            self.assertEqual(mismatch["_price"], "9000")

    def test_entire_menu_prices_display_and_rerolls(self):
        special = '냉면 "특"\n한정'
        names = ["삼겹살", "냉면", "비빔냉면", "공깃밥", "물냉면", "우동", special, "냉면"]
        prices = [12000, 5000, 5500, 1000, 0, "변동", 6000, 5000]
        names_text = "[" + ",".join("'" + name + "'" for name in names) + "]"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "all-menus.csv"
            with path.open("w", encoding="cp949", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(["음식점아이디", "음식점명", "대표메뉴명", "음식 종류", "음식 형태", "메뉴한글명", "메뉴금액"])
                writer.writerow(["grill", "고깃집", "표시하면 안 되는 대표메뉴", "한식", "면 | 밥 | 구이", names_text, repr(prices)])
            saved = path.read_bytes()
            with server(path, web=True) as base:
                self.assertEqual(self.filter_count(base, category="한식", form="면", min=5000, max=6000), 1)
                previous_menu = None
                for _ in range(12):
                    conditions = dict(category="한식", form="면", min=5000, max=6000)
                    if previous_menu is not None:
                        conditions.update(previous="grill", previousMenu=previous_menu)
                    result = self.filter_pick(base, **conditions)
                    matches = json.loads(result["_matchedMenus"])
                    self.assertEqual(matches, [{"name":"냉면", "price":5000}, {"name":"비빔냉면", "price":5500}, {"name":special, "price":6000}])
                    self.assertEqual(result["_matchedMenuCount"], "3")
                    self.assertIn({"name":result["_menu"], "price":int(result["_price"])}, matches)
                    self.assertEqual(result["_priceMenu"], result["_menu"])
                    self.assertNotEqual(result["_menuIndex"], previous_menu)
                    previous_menu = result["_menuIndex"]
                self.assertEqual(self.filter_count(base, form="면", max=1000), 0)
                self.assertEqual(self.filter_pick(base, max=1000)["_menu"], "공깃밥")
                self.assertEqual(self.filter_pick(base, min=12000)["_menu"], "삼겹살")
                menus = json.loads(self.filter_pick(base, form="면")["_matchedMenus"])
                self.assertIn({"name":"물냉면", "price":None}, menus)
                self.assertIn({"name":"우동", "price":None, "priceLabel":"변동가격"}, menus)
                self.assertEqual(len(menus), 5)
                self.assertEqual(path.read_bytes(), saved)

    def test_annotated_and_variable_menu_prices(self):
        names = ["설명국밥", "문의우동", "변동냉면", "변동칼국수", "비빔밥", "인원국수", "범위국수", "음수국수", "소수국수", "지수국수"]
        prices = ["가격 7,000원", "업주문의8500", "변동가격(업주문의)26000", "변동가격", "무료10000", "2인 26000", "7000~8000", "-7000", "7000.5", "2.6E4원"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "annotated-prices.csv"
            with path.open("w", encoding="cp949", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(["음식점아이디", "음식점명", "대표메뉴명", "음식 종류", "음식 형태", "메뉴한글명", "메뉴금액"])
                writer.writerow(["prices", "가격 검증 식당", "대표 메뉴", "한식", "밥 | 면 | 국·탕·찌개", repr(names), repr(prices)])
            saved = path.read_bytes()
            with server(path, web=True) as base:
                menus = {menu["name"]: menu for menu in json.loads(self.filter_pick(base)["_matchedMenus"])}
                for name, amount in [("설명국밥", 7000), ("문의우동", 8500), ("비빔밥", 10000), ("지수국수", 26000)]:
                    self.assertEqual(menus[name], {"name": name, "price": amount})
                for name in ["변동냉면", "변동칼국수"]:
                    self.assertEqual(menus[name], {"name": name, "price": None, "priceLabel": "변동가격"})
                for name in ["인원국수", "범위국수", "음수국수", "소수국수"]:
                    self.assertEqual(menus[name], {"name": name, "price": None})
                self.assertEqual(self.filter_pick(base, min=7000, max=7000)["_menu"], "설명국밥")
                bounded = json.loads(self.filter_pick(base, min=0)["_matchedMenus"])
                self.assertEqual({menu["name"] for menu in bounded}, {"설명국밥", "문의우동", "비빔밥", "지수국수"})
                self.assertEqual(path.read_bytes(), saved)

    def test_actual_taepyeongso_prices_pair_from_front_and_leave_tail_empty(self):
        with DATA.open(encoding="cp949", newline="") as stream:
            actual = next(row for row in csv.DictReader(stream) if row["음식점아이디"] == "16122")
        self.assertEqual(actual["메뉴금액"], "[7000, 변동가격(업주문의)26000, 변동가격(업주문의)8500, 7000, 17000]")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "taepyeongso.csv"
            with path.open("w", encoding="cp949", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(actual))
                writer.writeheader()
                writer.writerow(actual)
            with server(path, web=True) as base:
                result = self.filter_pick(base)
                menus = json.loads(result["_matchedMenus"])
                self.assertEqual(len(menus), 7)
                self.assertEqual(menus, [
                    {"name": "소국밥", "price": 7000},
                    {"name": "한우 육사시미", "price": None, "priceLabel": "변동가격"},
                    {"name": "매운소갈비찜 중", "price": None, "priceLabel": "변동가격"},
                    {"name": "한우 육회", "price": 7000},
                    {"name": "특 내장탕", "price": 17000},
                    {"name": "한우 설렁탕", "price": None},
                    {"name": "소머리수육", "price": None},
                ])
                self.assertEqual(self.filter_count(base, min=0), 1)
                self.assertEqual(self.filter_count(base, min=26000, max=26000), 0)
                self.assertEqual(self.filter_pick(base, form="국·탕·찌개", min=7000, max=7000)["_menu"], "소국밥")
                self.assertEqual(self.filter_pick(base, form="국·탕·찌개", min=17000, max=17000)["_menu"], "특 내장탕")

    def test_csv_form_gate_and_missing_full_menu(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "gates.csv"
            with path.open("w", encoding="cp949", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(["음식점아이디", "음식점명", "대표메뉴명", "음식 종류", "음식 형태", "메뉴한글명", "메뉴금액"])
                writer.writerows([
                    ["grill", "식당1", "냉면", "한식", "구이", "[삼겹살,냉면]", "[12000,5000]"],
                    ["noodle", "식당2", "짬뽕", "중식", "면", "[짬뽕]", "[7000]"],
                    ["empty", "식당3", "김밥", "일식", "밥", "", "[1000]"],
                    ["single", "식당4", "비빔밥", "양식", "밥", "[칼국수]", "[8000]"],
                ])
            with server(path, web=True) as base:
                self.assertEqual(self.filter_count(base, category="한식", form="면"), 0)
                self.assertEqual(self.filter_count(base, category="한식", max=5000), 1)
                self.assertEqual(self.filter_count(base, category="일식", form="밥"), 0)
                self.assertEqual(self.filter_count(base, category="일식", max=1000), 0)
                empty = self.filter_pick(base, category="일식")
                self.assertEqual(empty["_menu"], "")
                self.assertEqual(empty["_matchedMenus"], "[]")
                self.assertEqual(empty["대표메뉴명"], "김밥")
                # 메뉴가 하나여도 가게의 밥 태그를 칼국수 메뉴에 붙이지 않습니다.
                self.assertEqual(self.filter_count(base, category="양식", form="밥"), 0)
                single = self.filter_pick(base, category="양식", min=8000, max=8000)
                self.assertEqual(single["_menu"], "칼국수")
                self.assertEqual(single["_categories"], "양식")
                self.assertEqual(single["_menuForms"], "")

    def test_csv_tags_match_as_registered(self):
        with self.filtered_server() as (base, _):
            self.assertEqual(self.filter_count(base, category="디저트"), 1)
            self.assertEqual(self.filter_count(base, form="디저트"), 1)
            self.assertEqual(self.filter_count(base, category="카페"), 2)
            self.assertEqual(self.filter_count(base, form="국·탕·찌개"), 2)
            self.assertEqual(self.filter_count(base, category="찜·탕"), 2)
            self.assertEqual(self.filter_count(base, form="구이"), 1)
            self.assertEqual(self.filter_pick(base, category="보쌈")["음식점아이디"], "bossam")
            self.assertEqual(self.filter_pick(base, category="족발")["음식점아이디"], "jokbal")
            self.assertEqual(self.filter_pick(base, category="도시락")["음식점아이디"], "lunch")
            self.assertEqual(self.filter_pick(base, category="아시안")["음식점아이디"], "asian")

    def test_filtered_rerolls_empty_results_and_invalid_conditions(self):
        with self.filtered_server() as (base, cases):
            first = self.filter_pick(base, form="면")
            second = self.filter_pick(base, form="면", previous=first["음식점아이디"])
            self.assertNotEqual(first["음식점아이디"], second["음식점아이디"])
            # 이전 추천이 현재 필터 밖에 있어도 새 필터에 맞게 추첨합니다.
            self.assertEqual(self.filter_pick(base, category="카페", previous="meat")["업종정보"], "카페·디저트")
            self.assertEqual(self.filter_count(base, category="중식", form="음료"), 0)
            self.assertEqual(request(base, "/api/pick?" + urllib.parse.urlencode(
                dict(category="중식", form="음료")))[0], 404)
            for query in ["min=-1", "min=1.5", "max=abc", "min=10000&max=1000",
                          "category=invalid", "form=invalid", "min=1&min=2",
                          "max=2147483648"]:
                with self.subTest(query=query):
                    self.assertEqual(request(base, "/api/count?" + query)[0], 400)
                    self.assertEqual(request(base, "/api/pick?" + query)[0], 400)
            self.assertEqual(self.filter_count(base), len(cases))

    def test_columns_override_menu_words_and_populate_options(self):
        unsafe = '<img src=x onerror="alert(1)">'
        cases = [
            ["custom", "고깃집", "삼겹살", "한식", "양식 | 퓨전 | 양식", " 면 | 밥 | 면 "],
            ["atomic", "국숫집", "칼국수", "한식", "카페·디저트", "국·탕·찌개"],
            ["empty", "카페", "케이크", "카페·디저트", "", ""],
            ["new", "새 분류", "아메리카노", "카페·디저트", "한식", "죽"],
            ["escaped", "등록값 확인", "메뉴", "기타", unsafe, "미분류"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "columns.csv"
            with path.open("w", encoding="cp949", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(["음식점아이디", "음식점명", "대표메뉴명", "업종정보", "음식 종류", "음식 형태", "메뉴한글명", "메뉴금액"])
                for row in cases:
                    # 종류는 가게 컬럼을 따르고 형태는 전체 메뉴의 실제 항목에 연결합니다.
                    menus = {"custom": ["칼국수", "비빔밥"], "atomic": ["갈비탕"]}.get(row[0], [row[2]])
                    writer.writerow(row + [json.dumps(menus, ensure_ascii=False), json.dumps([8000] * len(menus))])
            saved = path.read_bytes()
            with server(path, web=True) as base:
                self.assertEqual(self.filter_count(base), len(cases))
                self.assertEqual(self.filter_count(base, category="한식"), 1)
                self.assertEqual(self.filter_count(base, category="양식", form="밥"), 1)
                row = self.filter_pick(base, category="퓨전", form="면")
                self.assertEqual(row["음식점아이디"], "custom")
                self.assertEqual(row["_categories"], "양식 · 퓨전")
                self.assertEqual(row["_forms"], "면 · 밥")
                self.assertEqual(self.filter_pick(base, category="카페·디저트")["음식점아이디"], "atomic")
                self.assertEqual(self.filter_pick(base, form="국·탕·찌개")["음식점아이디"], "atomic")
                self.assertEqual(self.filter_count(base, form="죽"), 0)
                self.assertEqual(self.filter_pick(base, category="한식")["_menu"], "아메리카노")
                self.assertEqual(self.filter_pick(base, category=unsafe)["음식점아이디"], "escaped")
                for condition in [{"category": "카페"}, {"category": "고기"}, {"form": "구이"}, {"form": "국"}, {"form": "디저트"}]:
                    self.assertEqual(request(base, "/api/count?" + urllib.parse.urlencode(condition))[0], 400)
                page = request(base, "/")[1].decode("utf-8")
                self.assertIn('<option value="퓨전">퓨전</option>', page)
                self.assertIn('<option value="죽">죽</option>', page)
                self.assertNotIn(unsafe, page)
                self.assertIn('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;', page)
                self.assertEqual(path.read_bytes(), saved)

    def test_missing_tag_column_fails_without_rewriting_csv(self):
        for missing in ["음식 종류", "음식 형태"]:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "missing.csv"
                columns = [name for name in ["음식점아이디", "음식점명", "대표메뉴명", "음식 종류", "음식 형태"] if name != missing]
                with path.open("w", encoding="cp949", newline="") as stream:
                    writer = csv.writer(stream)
                    writer.writerow(columns)
                    writer.writerow(["식당"] * len(columns))
                saved = path.read_bytes()
                result = subprocess.run([JAVA, "-cp", str(BUILD), "FoodPickerWeb", str(path)],
                                        cwd=ROOT, capture_output=True, encoding="utf-8", timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("필수 열 누락: " + missing, result.stderr)
                self.assertEqual(path.read_bytes(), saved)

    def test_actual_column_membership_and_options(self):
        with DATA.open(encoding="cp949", newline="") as stream:
            records = list(csv.DictReader(stream))
        tags = lambda row, column: {tag.strip() for tag in row[column].split("|") if tag.strip()}
        with server(web=True) as base:
            self.assertEqual(self.filter_count(base), 808)
            page = request(base, "/")[1].decode("utf-8")
            for column, parameter in [("음식 종류", "category"), ("음식 형태", "form")]:
                for label in {tag for row in records for tag in tags(row, column)}:
                    with self.subTest(column=column, label=label):
                        registered = sum(label in tags(row, column) for row in records)
                        count = self.filter_count(base, **{parameter: label})
                        if parameter == "category":
                            self.assertEqual(count, registered)
                        else:
                            # 등록 형태로 거른 뒤 해당하는 개별 메뉴가 있는 가게로 제한합니다.
                            self.assertLessEqual(count, registered)
                        if count:
                            result = self.filter_pick(base, **{parameter: label})
                            original = next(row for row in records if row["음식점아이디"] == result["음식점아이디"])
                            self.assertIn(label, tags(original, column))
                            menus = json.loads(result["_matchedMenus"])
                            if menus:
                                selected = {"name": result["_menu"], "price": int(result["_price"]) if result["_price"] else None}
                                if result["_priceLabel"]:
                                    selected["priceLabel"] = result["_priceLabel"]
                                self.assertIn(selected, menus)
                            if parameter == "form":
                                self.assertIn(label, result["_menuForms"].split(" · "))
                        self.assertIn('<option value="' + label + '">' + label + '</option>', page)
            expected = sum("한식" in tags(row, "음식 종류") and "밥" in tags(row, "음식 형태") for row in records)
            self.assertLessEqual(self.filter_count(base, category="한식", form="밥"), expected)

    def test_exact_time_default_manual_and_previous_day(self):
        full = " | ".join(day + "=00:00~24:00" for day in "월화수목금토일")
        overnight = " | ".join(day + ("=17:00~익일02:00" if day == "월" else "=휴무") for day in "월화수목금토일")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "exact.csv"
            with path.open("w", encoding="cp949", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(HEADERS + ["업종정보", "메뉴한글명", "메뉴금액", "최종대조판정", "영업 시간대", "음식 종류", "음식 형태"])
                for id_, hours in [("always", full), ("overnight", overnight), ("unknown", "미확인")]:
                    writer.writerow([id_, id_+" 식당", "비빔밥", "대전", "36.35", "127.38",
                                     "한식", "[비빔밥]", "[8000]", "미확정", hours, "한식", "밥"])
            with server(path, web=True) as base:
                self.assertEqual(self.filter_count(base, time="all"), 3)
                self.assertEqual(self.filter_count(base, date="2026-11-03", time="01:59"), 2)
                self.assertEqual(self.filter_count(base, date="2026-11-03", time="02:00"), 1)
                self.assertEqual(self.filter_count(base, date="2026-11-03", time="17:30"), 1)
                self.assertEqual(self.filter_count(base, date="2026-11-02", time="17:30", form="밥", max=8000), 2)
                first = self.filter_pick(base, date="2026-11-03", time="01:00")
                second = self.filter_pick(base, date="2026-11-03", time="01:00", previous=first["음식점아이디"])
                self.assertEqual({first["음식점아이디"], second["음식점아이디"]}, {"always", "overnight"})
                code, body, _ = request(base, "/api/pick")
                self.assertEqual(code, 200)
                row = {key: values[0] for key, values in urllib.parse.parse_qs(body.decode(), keep_blank_values=True).items()}
                self.assertEqual(row["_timeApplied"], "true")
                self.assertNotEqual(row["음식점아이디"], "unknown")
                sys.path.insert(0, str(ROOT))
                from add_business_hours import KST
                now = datetime.now(KST)
                self.assertEqual(row["_searchDate"], now.date().isoformat())
                self.assertLessEqual(abs((datetime.fromisoformat(row["_searchDate"]+"T"+row["_searchTime"]).replace(tzinfo=KST)-now).total_seconds()), 65)
                for conditions in [{"time":"25:00"}, {"time":"12:60"}, {"time":"9:00"}, {"date":"invalid"}]:
                    self.assertEqual(request(base, "/api/count?"+urllib.parse.urlencode(conditions))[0], 400)

    def test_weekly_time_matching_parity(self):
        sys.path.insert(0, str(ROOT))
        from add_business_hours import is_open_at
        with DATA.open(encoding="cp949", newline="") as stream:
            rows = list(csv.DictReader(stream))
        dates = ["2026-11-02", "2026-11-03", "2026-11-07", "2026-11-09", "2026-11-29", "2026-05-05", "2026-02-17"]
        times = ["00:00", "01:00", "02:00", "10:30", "12:00", "14:30", "15:30", "17:30", "20:30", "23:30"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "oracle.csv"
            with path.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(["id", "date", "time", "expected"])
                for row in rows:
                    for day in dates:
                        for clock in times:
                            actual = is_open_at(row["영업 시간대"], datetime.fromisoformat(day+"T"+clock))
                            writer.writerow([row["음식점아이디"], day, clock, "null" if actual is None else str(actual).lower()])
            result = subprocess.run([JAVA, "-cp", str(BUILD), "BusinessHoursProbe", str(DATA), str(path)],
                                    cwd=ROOT, capture_output=True, encoding="utf-8", timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
