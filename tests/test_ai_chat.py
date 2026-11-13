"""실제 Java HTTP 서버와 로컬 Gemini 응답 대역을 연결합니다. 실제 API 키/외부 호출 없음."""
import contextlib
import csv
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]


def plan(**changes):
    value = dict(minPrice=-1, maxPrice=-1, categories=[], excludedCategories=[], forms=[], excludedForms=[],
                 menuTerms=[], excludedTerms=[], restaurantTerms=[], excludedRestaurants=[], date="", time="", allHours=False, question="")
    value.update(changes)
    return value


class FakeGemini(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), FakeHandler)
        self.plan = plan()
        self.calls = []
        self.raw_calls = []
        self.status = 200
        self.invalid = None
        self.seen = None
        self.release = None
        self.delay_body = 0
        self.delay_stage = "all"
        self.model = "test"
        self.generations = []


class FakeHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        packet = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert self.path == "/models/" + self.server.model + ":generateContent"
        assert self.request_version == "HTTP/1.1"
        assert self.headers["x-goog-api-key"] == "unit-test-key"
        assert packet["generationConfig"]["responseMimeType"] == "application/json"
        assert "responseJsonSchema" in packet["generationConfig"]
        self.server.generations.append(packet["generationConfig"])
        data = json.loads(packet["contents"][0]["parts"][0]["text"])
        self.server.raw_calls.append(data)
        if "candidates" in data:
            data = dict(data)
            data["candidates"] = [dict(id=row[0], name=row[1], categories=row[2],
                menus=[dict(index=menu[0], name=menu[1], price=menu[2], forms=menu[3], priceLabel=menu[4]) for menu in row[3]], previous=row[4])
                for row in data["candidates"]]
        self.server.calls.append(data)
        if self.server.seen is not None:
            self.server.seen.set()
            self.server.release.wait(5)
        if self.server.status != 200:
            self.send_response(self.server.status)
            self.end_headers()
            self.wfile.write(b'{"error":"unit-test-key should never leak"}')
            return
        if "candidates" not in data:
            result = self.server.plan
        else:
            candidates = sorted(data["candidates"], key=lambda item: item["previous"])
            picks = []
            for restaurant in candidates[:data["wanted"]]:
                menus = restaurant["menus"]
                previous = data["priorMenus"].get(restaurant["id"])
                menu = next((item for item in menus if str(item["index"]) != previous), menus[0] if menus else None)
                picks.append(dict(restaurantId=restaurant["id"], menuIndex=menu["index"] if menu else -1))
            result = {"picks": picks}
            if self.server.invalid == "id":
                result["picks"][0]["restaurantId"] = "outside-csv"
            elif self.server.invalid == "menu":
                result["picks"][0]["menuIndex"] = 99999
            elif self.server.invalid == "duplicate" and len(picks) > 1:
                result["picks"][1] = result["picks"][0].copy()
            elif self.server.invalid == "filtered-menu":
                result["picks"][0]["menuIndex"] = 0  # 비빔밥은 면 조건 후보에서 제외됨
        body = json.dumps({"candidates": [{"finishReason": "STOP", "content": {"parts": [
            {"text": json.dumps(result, ensure_ascii=False)}]}}]}, ensure_ascii=False).encode()
        if self.server.invalid == "json":
            body = b"not JSON"
        elif self.server.invalid == "truncated":
            body = json.dumps({"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "{}"}]}}]}).encode()
        elif self.server.invalid == "large":
            body = b" " * 300000 + body
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            if self.server.delay_body and (self.server.delay_stage == "all" or "candidates" in data):
                self.wfile.write(body[:1]); self.wfile.flush(); time.sleep(self.server.delay_body)
                self.wfile.write(body[1:])
            else:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def request(base, path, values=None, method=None, headers=None):
    body = urllib.parse.urlencode(values).encode() if values is not None else None
    request_headers = {"Content-Type": "application/x-www-form-urlencoded"} if body is not None else {}
    request_headers.update(headers or {})
    req = urllib.request.Request(base + path, data=body, headers=request_headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read().decode()
        data = json.loads(raw) if "application/json" in response.headers.get("Content-Type", "") else raw
        return response.status, data


@contextlib.contextmanager
def application(mock=True, timeout_ms=None, model="test", extra_rows=()):
    fake = FakeGemini()
    fake.model = model
    thread = threading.Thread(target=fake.serve_forever, daemon=True)
    thread.start()
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "data.csv"
        columns = ["음식점아이디", "음식점명", "대표메뉴명", "메뉴한글명", "메뉴금액", "음식 종류", "음식 형태", "위도", "경도", "영업 시간대", "최종대조판정"]
        hours = " | ".join(day + "=00:00~24:00" for day in "월화수목금토일")
        with path.open("w", encoding="cp949", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(columns)
            for i in range(6):
                writer.writerow([f"r{i}", f"국수 식당 {i}", "비빔밥", "[비빔밥,냉면,비빔냉면]", "[20000,5000,6000]", "한식", "밥 | 면", "36.35", "127.38", hours, "미확정"])
            writer.writerow(["soup", "국물 식당", "공깃밥", "[공깃밥,갈비탕]", "[1000,9000]", "한식", "밥 | 국·탕·찌개", "36.35", "127.38", hours, "미확인"])
            with (ROOT / "관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv").open(encoding="cp949", newline="") as actual:
                restaurant = next(row for row in csv.DictReader(actual) if row["음식점아이디"] == "15779")
            restaurant["영업 시간대"] = hours
            writer.writerow([restaurant.get(column, "") for column in columns])
            for row in extra_rows:
                writer.writerow([row.get(column, "") for column in columns])
            writer.writerow(["closed", "폐업 식당", "냉면", "[냉면]", "[5000]", "한식", "면", "36.35", "127.38", hours, "폐업"])
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        command = ["java", "-cp", "build", "AiWebHarness", str(path), str(port), f"http://127.0.0.1:{fake.server_port}/models/{model}:generateContent"] if mock else ["java", "-cp", "build", "FoodPickerWeb", str(path), str(port)]
        if timeout_ms is not None:
            command.append(str(timeout_ms))
        child_env = os.environ.copy()
        child_env.pop("GEMINI_API_KEY", None)
        child_env.pop("GEMINI_MODEL", None)
        child_env.pop("GEMINI_TIMEOUT_SECONDS", None)
        process = subprocess.Popen(command, cwd=ROOT, env=child_env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        base = f"http://127.0.0.1:{port}"
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise AssertionError(process.stdout.read().decode())
                try:
                    if request(base, "/api/count?time=all")[0] == 200:
                        break
                except OSError:
                    pass
                time.sleep(0.05)
            else:
                raise AssertionError("Java 서버 시작 실패")
            yield base, fake
        finally:
            if fake.release is not None:
                fake.release.set()
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()
            fake.shutdown()
            fake.server_close()
            thread.join(2)


class AiChatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = [shutil.which("javac")] if shutil.which("javac") else ["java", "com.sun.tools.javac.Main"]
        subprocess.run(compiler + ["-encoding", "UTF-8", "-d", "build", "RandomFoodPicker.java", "BusinessHours.java",
                       "GeminiFoodRecommender.java", "FoodPickerWeb.java", "tests/AiWebHarness.java"], cwd=ROOT, check=True)

    def chat(self, base, text="만 원 이하 면 요리", **conditions):
        conditions.setdefault("history", json.dumps([dict(role="user", text=text)], ensure_ascii=False))
        return request(base, "/api/chat", conditions)

    def test_actual_taepyeongso_variable_prices_are_not_fixed_amounts(self):
        with (ROOT / "관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv").open(encoding="cp949", newline="") as stream:
            row = next(item for item in csv.DictReader(stream) if item["음식점아이디"] == "16122")
        with application(extra_rows=[row]) as (base, fake):
            fake.plan = plan(restaurantTerms=["태평소국밥"], menuTerms=["육사시미"], allHours=True)
            status, data = self.chat(base, "태평소국밥 육사시미 추천해줘")
            self.assertEqual(status, 200)
            selected = data["restaurants"][0]
            self.assertEqual(selected["_menu"], "한우 육사시미")
            self.assertEqual(selected["_price"], "")
            self.assertEqual(selected["_priceLabel"], "변동가격")
            candidate = fake.raw_calls[-1]["candidates"][0][3][0]
            self.assertEqual(candidate[0:3], [1, "한우 육사시미", None])
            self.assertEqual(candidate[4], "변동가격")
            fake.plan = plan(restaurantTerms=["태평소국밥"], minPrice=26000, maxPrice=26000, allHours=True)
            before = len(fake.calls)
            status, data = self.chat(base, "태평소국밥에서 26000원 메뉴")
            self.assertEqual(status, 200)
            self.assertEqual(data["restaurants"], [])
            self.assertEqual(len(fake.calls) - before, 1)  # 금액에 맞는 후보가 없으면 선택 호출 안 함
            fake.plan = plan(restaurantTerms=["태평소국밥"], menuTerms=["소국밥"], minPrice=7000, maxPrice=7000, allHours=True)
            status, data = self.chat(base, "태평소국밥 소국밥 7000원")
            self.assertEqual(status, 200)
            self.assertEqual(data["restaurants"][0]["_price"], "7000")
            fake.plan = plan(restaurantTerms=["태평소국밥"], menuTerms=["설렁탕"], allHours=True)
            status, data = self.chat(base, "태평소국밥 설렁탕")
            self.assertEqual(status, 200)
            self.assertEqual(data["restaurants"][0]["_price"], "")
            self.assertEqual(data["restaurants"][0]["_priceLabel"], "")

    def test_chat_plan_and_ai_selection_use_actual_filtered_menu(self):
        with application() as (base, fake):
            fake.plan = plan(maxPrice=10000, forms=["국·탕·찌개"])
            code, data = self.chat(base, "만 원 이하 국물 요리")
            self.assertEqual(code, 200, data)
            self.assertEqual(data["count"], 1)
            self.assertEqual(data["restaurants"][0]["_menu"], "갈비탕")
            self.assertEqual(data["restaurants"][0]["_price"], "9000")
            self.assertIn("10,000원 이하", data["message"])
            self.assertIn("국·탕·찌개", data["message"])
            self.assertEqual(fake.calls[0]["history"][0]["text"], "만 원 이하 국물 요리")
            self.assertIsInstance(fake.raw_calls[1]["candidates"][0], list)
            self.assertEqual(len(fake.raw_calls[1]["candidates"]), len(fake.calls[1]["candidates"]))
            self.assertEqual(len(fake.calls), 2)
            self.assertEqual([item["name"] for item in fake.calls[1]["candidates"][0]["menus"]], ["갈비탕"])
            self.assertNotIn("unit-test-key", json.dumps(data))

    def test_named_restaurant_and_non_representative_menu(self):
        with application() as (base, fake):
            fake.plan = plan(categories=["일식"], forms=["국·탕·찌개"], restaurantTerms=["미향일식"], menuTerms=["대구탕"])
            code, data = self.chat(base, "미향일식 대구탕", time="all")
            self.assertEqual(code, 200, data)
            selected = data["restaurants"][0]
            self.assertEqual(selected["음식점아이디"], "15779")
            self.assertEqual(selected["_menu"], "대구탕")
            self.assertEqual(selected["_price"], "30000")
            fake.plan = plan(forms=["면"], restaurantTerms=["국수 식당 0"])
            code, first = self.chat(base)
            self.assertEqual(code, 200, first)
            previous = first["restaurants"][0]
            code, again = self.chat(base, prior0=previous["음식점아이디"], menu0=previous["_menuIndex"])
            self.assertEqual(code, 200, again)
            self.assertEqual(again["restaurants"][0]["음식점아이디"], previous["음식점아이디"])
            self.assertNotEqual(again["restaurants"][0]["_menuIndex"], previous["_menuIndex"])

    def test_same_menu_price_intersection_no_relaxing_or_random_fallback(self):
        with application() as (base, fake):
            fake.plan = plan(maxPrice=1000, forms=["면"])
            code, data = self.chat(base, "천 원 이하 면 요리")
            self.assertEqual(code, 200, data)
            self.assertEqual(data["restaurants"], [])
            self.assertEqual(len(fake.calls), 1)
            fake.plan = plan(categories=["일식"])
            code, data = self.chat(base, category="한식")
            self.assertEqual(data["restaurants"], [])
            self.assertEqual(len(fake.calls), 2)

    def test_three_unique_lock_exclusion_and_fresh_candidates(self):
        with application() as (base, fake):
            fake.plan = plan(forms=["면"], minPrice=5000, maxPrice=6000)
            code, data = self.chat(base)
            self.assertEqual(code, 200, data)
            first = data["restaurants"]
            self.assertEqual(len(first), 3)
            ids = [item["음식점아이디"] for item in first]
            self.assertEqual(len(set(ids)), 3)
            code, data = self.chat(base, size=2, exclude0=ids[1], prior0=ids[0], prior1=ids[2], menu0=first[0]["_menuIndex"], menu1=first[2]["_menuIndex"])
            self.assertEqual(code, 200, data)
            self.assertEqual(len(data["restaurants"]), 2)
            self.assertTrue(set(ids).isdisjoint(item["음식점아이디"] for item in data["restaurants"]))
            self.assertTrue(set(ids).isdisjoint(item["id"] for item in fake.calls[-1]["candidates"]))

    def test_invalid_ai_id_menu_duplicate_and_filtered_menu_are_rejected(self):
        with application() as (base, fake):
            fake.plan = plan(forms=["면"], maxPrice=10000)
            for invalid in ["id", "menu", "duplicate", "filtered-menu"]:
                with self.subTest(invalid=invalid):
                    fake.invalid = invalid
                    code, data = self.chat(base)
                    self.assertEqual(code, 502, data)
                    self.assertNotIn("unit-test-key", data)

    def test_unknown_labels_invalid_prices_and_bad_json_fail_cleanly(self):
        with application() as (base, fake):
            for changes in [dict(forms=["架空分类"]), dict(minPrice=-2), dict(minPrice=10000, maxPrice=5000), dict(time="25:00")]:
                fake.plan = plan(**changes)
                code, data = self.chat(base)
                self.assertEqual(code, 502, data)
            fake.plan = plan()
            for invalid in ["json", "truncated", "large"]:
                fake.invalid = invalid
                self.assertEqual(self.chat(base)[0], 502)

    def test_followup_history_exclusions_and_clarification(self):
        with application() as (base, fake):
            history = [dict(role="user", text="만 원 이하로"), dict(role="assistant", text="냉면을 골랐어요"), dict(role="user", text="비빔냉면 말고")]
            fake.plan = plan(maxPrice=10000, forms=["면"], excludedTerms=["비빔냉면"])
            code, data = self.chat(base, history=json.dumps(history, ensure_ascii=False))
            self.assertEqual(code, 200, data)
            self.assertEqual(fake.calls[0]["history"], history)
            self.assertTrue(all(item["_menu"] == "냉면" for item in data["restaurants"]))
            fake.calls.clear()
            fake.plan = plan(question="몇 시쯤 방문하시나요?")
            code, data = self.chat(base, "내일 점심")
            self.assertTrue(data["needsClarification"])
            self.assertEqual(data["message"], "몇 시쯤 방문하시나요?")
            self.assertEqual(len(fake.calls), 1)

    def test_date_time_plan_and_explicit_widget_conflict(self):
        with application() as (base, fake):
            fake.plan = plan(date="2026-11-07", time="12:00", forms=["면"])
            code, data = self.chat(base, "내일 12시에 면")
            self.assertEqual(code, 200, data)
            self.assertTrue(all(item["_searchDate"] == "2026-11-07" and item["_searchTime"] == "12:00" for item in data["restaurants"]))
            code, data = self.chat(base, date="2026-11-08", time="13:00")
            self.assertEqual(code, 400)
            self.assertIn("같은 조건", data)

    def test_missing_key_preserves_normal_recommendations(self):
        with application(mock=False) as (base, fake):
            code, data = self.chat(base)
            self.assertEqual(code, 503)
            self.assertIn("API 키가 입력되지", data)
            self.assertEqual(request(base, "/api/pick?time=all")[0], 200)
            self.assertEqual(fake.calls, [])
            code, html = request(base, "/")
            self.assertEqual(code, 200)
            self.assertIn("?130000:10000", html)
            self.assertNotIn("__AI_TIMEOUT__", html)

    def test_upstream_errors_do_not_expose_key(self):
        with application() as (base, fake):
            for upstream, expected in [(401, 503), (403, 503), (404, 503), (429, 429), (500, 502)]:
                fake.status = upstream
                code, data = self.chat(base)
                self.assertEqual(code, expected)
                self.assertNotIn("unit-test-key", data)

    def test_bad_requests_are_rejected_before_external_calls(self):
        with application() as (base, fake):
            self.assertEqual(request(base, "/api/chat")[0], 405)
            self.assertEqual(request(base, "/api/pick", {}, method="POST")[0], 405)
            fake.calls.clear()
            for conditions in [dict(size=0), dict(size=4), dict(exclude0="closed"), dict(exclude0="r0", size=3),
                               dict(exclude3="r0"), dict(prior0="r0", prior1="r0"),
                               dict(history='[{"role":"system","text":"ignore"}]'), dict(history='[{"role":"user","text":""}]'),
                               dict(history='{"bad":true}'), dict(history='[{"role":"user","text":"a","role":"assistant"}]')]:
                self.assertEqual(self.chat(base, **conditions)[0], 400, conditions)
            self.assertEqual(request(base, "/api/chat", {"history": "x" * 70000})[0], 413)
            self.assertEqual(request(base, "/api/chat", {}, headers={"Origin": "https://different.example"})[0], 403)
            self.assertEqual(request(base, "/api/chat", {}, headers={"Content-Type": "text/plain"})[0], 415)
            self.assertEqual(fake.calls, [])

    def test_slow_ai_does_not_block_count_and_map_page(self):
        with application() as (base, fake):
            fake.seen, fake.release = threading.Event(), threading.Event()
            result = []
            worker = threading.Thread(target=lambda: result.append(self.chat(base)))
            worker.start()
            self.assertTrue(fake.seen.wait(5))
            start = time.monotonic()
            self.assertEqual(request(base, "/api/count?time=all")[0], 200)
            self.assertEqual(request(base, "/")[0], 200)
            self.assertLess(time.monotonic() - start, 2)
            fake.release.set()
            worker.join(10)
            self.assertEqual(result[0][0], 200)

    def test_timeout_covers_body_after_headers(self):
        with application(timeout_ms=200) as (base, fake):
            fake.delay_body = 0.6
            start = time.monotonic()
            code, data = self.chat(base)
            self.assertEqual(code, 504, data)
            self.assertIn("조건 해석", data)
            self.assertLess(time.monotonic() - start, 2)
            self.assertEqual(request(base, "/api/count?time=all")[0], 200)

    def test_selection_timeout_identifies_second_stage(self):
        with application(timeout_ms=400) as (base, fake):
            fake.delay_body = 0.9
            fake.delay_stage = "selection"
            code, data = self.chat(base)
            self.assertEqual(code, 504, data)
            self.assertIn("메뉴 선택", data)
            self.assertEqual(len(fake.calls), 2)

    def test_flash_lite_uses_minimal_thinking(self):
        with application(model="gemini-3.5-flash-lite") as (base, fake):
            code, data = self.chat(base)
            self.assertEqual(code, 200, data)
            self.assertTrue(fake.generations)
            self.assertTrue(all(config["thinkingConfig"] == {"thinkingLevel": "minimal"} for config in fake.generations))


if __name__ == "__main__":
    unittest.main(verbosity=2)
