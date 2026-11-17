/* 실행: python3 tests/verify.py 다음 node tests/browser.cjs (Playwright 필요) */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const sdkPattern = "https://oapi.map.naver.com/**";
const sdk = `
window.__mapCalls = { markers: [], centers: [] };
window.naver = { maps: {
  LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } },
  Map: class {
    constructor() { document.getElementById("map").style.background = "#e4ecdf"; }
    setCenter(position) { window.__mapCalls.centers.push(position); }
    setZoom() {}
  },
  Marker: class {
    constructor(options) { this.call = { position: options.position, title: options.title, removed: false }; window.__mapCalls.markers.push(this.call); }
    setMap(value) { this.call.removed = value === null; }
  }
}};`;

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function main() {
  const port = await freePort();
  const server = spawn("java", ["-cp", "build", "FoodPickerServer",
    "관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv", "MS949", String(port)], { cwd: root });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  const url = `http://127.0.0.1:${port}`;
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(serverOutput);
      try { ready = (await fetch(`${url}/api/info`)).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(ready, `서버 시작 실패: ${serverOutput}`);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    async function pageWith(mode = "ok", viewport = { width: 1280, height: 1000 }) {
      const page = await browser.newPage({ viewport });
      page.on("pageerror", (error) => { throw error; });
      await page.route(sdkPattern, (route) => mode === "fail" ? route.abort()
        : route.fulfill({ contentType: "text/javascript", body: sdk + (mode === "auth" ? "window.navermap_authFailure();" : "") }));
      return page;
    }
    async function pick(page) {
      const response = page.waitForResponse((r) => r.url().includes("/api/pick"));
      await page.locator("#pick-button").click();
      const payload = await (await response).json();
      await page.waitForFunction((name) => document.getElementById("restaurant-name").textContent === name, payload.restaurant.name);
      return payload.restaurant;
    }

    const desktop = await pageWith();
    await desktop.goto(url);
    await desktop.waitForFunction(() => window.__mapCalls);
    const first = await pick(desktop);
    let markers = await desktop.evaluate(() => window.__mapCalls.markers);
    assert.equal(markers.at(-1).title, first.name);
    assert.equal(markers.at(-1).position.lat, first.latitude);
    assert.equal(markers.at(-1).position.lng, first.longitude);
    assert.equal(await desktop.locator("#menu-name").textContent(), first.menu.trim() || "대표메뉴 정보가 없어요");
    const second = await pick(desktop);
    assert.notEqual(first.id, second.id);
    markers = await desktop.evaluate(() => window.__mapCalls.markers);
    assert.equal(markers.filter((marker) => !marker.removed).length, 1);
    assert.equal(markers.at(-1).title, second.name);
    assert(markers[0].removed);
    await desktop.locator("#record-details summary").click();
    assert.equal(await desktop.locator("#record-fields > div").count(), Object.keys(second.fields).length);
    await desktop.locator("#record-details summary").click();
    await desktop.screenshot({ path: path.join(root, "build", "preview-desktop.png"), fullPage: true });
    console.log("PASS: 실제 음식점·메뉴·좌표 일치, 재추첨, 마커 교체, 원본의 모든 열");

    const mobile = await pageWith("ok", { width: 390, height: 844 });
    await mobile.goto(url);
    await pick(mobile);
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await mobile.screenshot({ path: path.join(root, "build", "preview-mobile.png"), fullPage: true });
    console.log("PASS: 모바일 화면 가로 넘침 없음");

    for (const mode of ["fail", "auth"]) {
      const page = await pageWith(mode);
      await page.goto(url);
      await page.waitForFunction(() => document.getElementById("map-status").textContent.includes("실패") || document.getElementById("map-status").textContent.includes("불러오지 못"));
      await pick(page);
      assert(await page.locator("#naver-link").getAttribute("href"));
      assert.equal(await page.locator("#pick-button").isEnabled(), true);
      assert.equal(await page.locator("#map-overlay").isVisible(), true);
      await page.close();
    }
    console.log("PASS: 지도 로딩·인증 실패 시에도 추천 및 검색 링크 유지");

    const missing = await pageWith();
    const fixture = { id: "1", name: '<img src=x onerror="alert(1)">', menu: "국밥", address: "대전", detailAddress: "", phone: "", hours: "", businessStatus: "미확인", latitude: 36.35, longitude: 127.38, fields: { 이름: "<b>문자열</b>" } };
    await missing.route("**/api/info", (route) => route.fulfill({ json: { total: 2, mapsClientId: "test" } }));
    let round = 0;
    await missing.route("**/api/pick*", (route) => route.fulfill({ json: { restaurant: round++ === 0 ? fixture : { ...fixture, id: "2", menu: "", latitude: null, longitude: null } } }));
    await missing.goto(url);
    await missing.waitForFunction(() => window.__mapCalls);
    await pick(missing);
    await pick(missing);
    assert.equal(await missing.locator("#menu-name").textContent(), "대표메뉴 정보가 없어요");
    assert.equal(await missing.locator("#restaurant-name img").count(), 0);
    assert.equal(await missing.locator("#business-status").count(), 0);
    assert.equal(await missing.locator("#record-fields b").count(), 0);
    assert((await missing.locator("#map-status").textContent()).includes("좌표 정보가 없습니다"));
    assert((await missing.evaluate(() => window.__mapCalls.markers)).every((marker) => marker.removed));
    console.log("PASS: 메뉴·좌표 누락, 이전 마커 제거, 상태 표시 제거, CSV 문자열 표시");

    const single = await pageWith();
    await single.route("**/api/info", (route) => route.fulfill({ json: { total: 1, mapsClientId: "test" } }));
    await single.route("**/api/pick*", (route) => route.fulfill({ json: { restaurant: fixture } }));
    await single.goto(url);
    await pick(single);
    assert.equal(await single.locator("#pick-button").isDisabled(), true);
    console.log("PASS: 음식점 1곳일 때 재추첨 제한");

    const disconnected = await pageWith();
    await disconnected.route("**/api/info", (route) => route.abort());
    await disconnected.goto(url);
    await disconnected.waitForFunction(() => document.getElementById("dataset-count").textContent === "연결 확인 필요");
    assert.equal(await disconnected.locator("#pick-button").isDisabled(), true);
    await desktop.route("**/api/pick*", (route) => route.abort());
    await desktop.locator("#pick-button").click();
    await desktop.waitForFunction(() => document.getElementById("selection-status").classList.contains("error"));
    assert.equal(await desktop.locator("#pick-button").isEnabled(), true);
    assert.equal(await desktop.locator("#restaurant-name").textContent(), second.name);
    console.log("PASS: 초기 서버 연결 실패와 재추첨 실패 복구");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
