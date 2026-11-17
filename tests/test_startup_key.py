"""시작 입력·재실행·키 비저장·터미널 숨김 입력을 검사합니다. 실제 API는 호출하지 않습니다."""
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StartupKeyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = [shutil.which("javac")] if shutil.which("javac") else ["java", "com.sun.tools.javac.Main"]
        subprocess.run(compiler + ["-encoding", "UTF-8", "-d", "build", "GeminiFoodRecommender.java", "tests/KeyInputProbe.java"], cwd=ROOT, check=True)

    def probe(self, text, expected, directory):
        child_env = os.environ.copy()
        child_env["GEMINI_API_KEY"] = "preloaded-key-must-be-ignored"
        result = subprocess.run(["java", "-cp", str(ROOT / "build"), "KeyInputProbe", expected],
                                cwd=directory, env=child_env, input=text, capture_output=True, text=True, encoding="utf-8", timeout=8)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Gemini API 키 입력", result.stdout)
        self.assertIn("PASS", result.stdout)
        self.assertNotIn("preloaded-key-must-be-ignored", result.stdout + result.stderr)
        if expected:
            self.assertNotIn(expected, result.stdout + result.stderr)
            self.assertIn("API 키 입력 완료.", result.stdout)
        else:
            self.assertIn("API 키 미입력: 수동 검색만 사용합니다.", result.stdout)

    def test_each_launch_reads_new_key_without_writing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            self.probe("first-launch-test-key\n", "first-launch-test-key", directory)
            self.probe("second-launch-test-key\n", "second-launch-test-key", directory)
            self.probe("\n", "", directory)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_eof_ignores_preexisting_environment_key(self):
        with tempfile.TemporaryDirectory() as directory:
            self.probe("", "", directory)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_plain_and_bracketed_paste_keep_only_the_key(self):
        with tempfile.TemporaryDirectory() as directory:
            value = "clipboard-pasted-test-key"
            self.probe(value + "\n", value, directory)
            self.probe("\x1b[200~" + value + "\x1b[201~\n", value, directory)
            self.probe("  \x1b[200~  " + value + "  \x1b[201~  \n", value, directory)
            self.assertEqual(list(Path(directory).iterdir()), [])

    @unittest.skipIf(os.name == "nt", "POSIX 가상 터미널 테스트")
    def test_interactive_terminal_accepts_pasted_text_without_echo(self):
        import pty
        master, slave = pty.openpty()
        value = "terminal-only-test-key"
        process = subprocess.Popen(["java", "-cp", str(ROOT / "build"), "KeyInputProbe", value],
                                   stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        try:
            deadline = time.monotonic() + 8
            while b"Gemini API" not in output and time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    output.extend(os.read(master, 4096))
            self.assertIn(b"Gemini API", output)
            os.write(master, (value + "\n").encode())
            while process.poll() is None and time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        output.extend(os.read(master, 4096))
                    except OSError:
                        break
            process.wait(timeout=2)
            while select.select([master], [], [], 0)[0]:
                try:
                    chunk = os.read(master, 4096)
                    if not chunk:
                        break
                    output.extend(chunk)
                except OSError:
                    break
            self.assertEqual(process.returncode, 0, output.decode(errors="replace"))
            self.assertIn(b"PASS", output)
            self.assertIn("API 키 입력 완료.".encode(), output)
            self.assertNotIn(value.encode(), output)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            os.close(master)


if __name__ == "__main__":
    unittest.main(verbosity=2)
