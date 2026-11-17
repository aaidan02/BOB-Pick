"use strict";

const element = (id) => document.getElementById(id);
const button = element("pick-button");
const selectionStatus = element("selection-status");
let total = 0;
let previousId = null;
let currentRestaurant = null;
let map = null;
let marker = null;
let mapFailure = "";

function mapMessage(message, overlay = false) {
  element("map-status").textContent = message;
  element("map-overlay-text").textContent = message;
  element("map-overlay").hidden = !overlay;
}

function clearMarker() {
  if (marker) {
    marker.setMap(null);
    marker = null;
  }
}

function failMap(message) {
  mapFailure = message;
  clearMarker();
  mapMessage(message, true);
}

function loadMap(clientId) {
  window.navermap_authFailure = () => {
    window.clearTimeout(timeout);
    failMap(`지도 인증에 실패했습니다. Maps 콘솔에서 Client ID와 등록 URL(${window.location.origin})을 확인해 주세요.`);
  };
  const script = document.createElement("script");
  script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
  script.async = true;
  const timeout = window.setTimeout(() => {
    failMap("지도 로딩이 지연되고 있습니다. 네트워크 연결을 확인한 뒤 새로고침해 주세요.");
  }, 12000);
  script.onerror = () => {
    window.clearTimeout(timeout);
    failMap("네이버 지도를 불러오지 못했습니다. 음식점을 뽑은 뒤 ‘네이버 지도에서 확인’ 링크를 이용해 주세요.");
  };
  script.onload = () => {
    window.clearTimeout(timeout);
    if (mapFailure) return;
    if (!window.naver?.maps?.Map) {
      failMap("지도 API를 사용할 수 없습니다. Client ID와 Maps 콘솔의 등록 URL을 확인해 주세요.");
      return;
    }
    try {
      const maps = window.naver.maps;
      map = new maps.Map("map", {
        center: new maps.LatLng(36.3504, 127.3845),
        zoom: 14,
        zoomControl: true,
      });
      if (mapFailure) return;
      if (currentRestaurant) {
        showLocation(currentRestaurant);
      } else {
        mapMessage("음식점을 뽑으면 해당 위치에 마커가 표시됩니다.");
      }
    } catch {
      failMap("지도를 만들지 못했습니다. 새로고침하거나 ‘네이버 지도에서 확인’ 링크를 이용해 주세요.");
    }
  };
  document.head.append(script);
}

function showLocation(restaurant) {
  clearMarker();
  if (mapFailure) return;
  const { latitude, longitude } = restaurant;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    mapMessage("이 음식점의 좌표 정보가 없습니다. ‘네이버 지도에서 확인’ 링크로 검색해 주세요.", true);
    return;
  }
  if (!map) {
    mapMessage("네이버 지도를 불러오는 중입니다. 준비되면 선택한 음식점의 위치가 표시됩니다.", true);
    return;
  }
  try {
    const position = new window.naver.maps.LatLng(latitude, longitude);
    marker = new window.naver.maps.Marker({ map, position, title: restaurant.name });
    map.setCenter(position);
    map.setZoom(16);
    mapMessage(`${restaurant.name}의 위치를 표시했습니다.`);
  } catch {
    failMap("음식점 위치를 표시하지 못했습니다. ‘네이버 지도에서 확인’ 링크를 이용해 주세요.");
  }
}

function renderSelection(restaurant) {
  currentRestaurant = restaurant;
  element("empty-state").hidden = true;
  element("selection").hidden = false;
  element("menu-name").textContent = restaurant.menu?.trim() || "대표메뉴 정보가 없어요";
  element("restaurant-name").textContent = restaurant.name;
  element("address").textContent = [restaurant.address, restaurant.detailAddress].filter(Boolean).join(" ") || "주소 정보 없음";
  element("phone").textContent = restaurant.phone?.trim() || "전화번호 정보 없음";
  element("hours").textContent = restaurant.hours?.trim() || "운영시간 정보 없음";
  const search = [restaurant.address, restaurant.name].filter(Boolean).join(" ");
  element("naver-link").href = `https://map.naver.com/p/search/${encodeURIComponent(search)}`;

  const fields = document.createDocumentFragment();
  for (const [name, value] of Object.entries(restaurant.fields)) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = name;
    description.textContent = value || "—";
    row.append(term, description);
    fields.append(row);
  }
  element("record-fields").replaceChildren(fields);
  element("record-details").hidden = false;
  showLocation(restaurant);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

button.addEventListener("click", async () => {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  element("button-label").textContent = "고르는 중…";
  selectionStatus.classList.remove("error");
  selectionStatus.textContent = "오늘의 음식점을 고르고 있습니다.";
  try {
    const query = previousId === null ? "" : `?previous=${encodeURIComponent(previousId)}`;
    const { restaurant } = await getJson(`/api/pick${query}`);
    renderSelection(restaurant);
    previousId = restaurant.id;
    selectionStatus.textContent = total === 1
      ? "등록된 음식점이 한 곳이라 다른 곳을 뽑을 수 없습니다."
      : "다시 누르면 직전에 나온 음식점을 제외하고 골라요.";
  } catch {
    selectionStatus.classList.add("error");
    selectionStatus.textContent = "음식점을 불러오지 못했습니다. Java 서버가 실행 중인지 확인하고 다시 눌러 주세요.";
  } finally {
    button.removeAttribute("aria-busy");
    button.disabled = total === 1 && previousId !== null;
    element("button-label").textContent = button.disabled ? "추천 완료"
      : previousId === null ? "오늘의 메뉴 뽑기" : "다른 음식점 뽑기";
  }
});

async function initialize() {
  if (window.location.protocol === "file:") {
    element("dataset-count").textContent = "서버 실행 필요";
    selectionStatus.textContent = "start.bat을 실행한 뒤 http://localhost:8000/naver-map-test.html 에 접속해 주세요.";
    mapMessage("HTML을 직접 여는 대신 Java 서버를 통해 접속해 주세요.", true);
    return;
  }
  try {
    const info = await getJson("/api/info");
    if (!Number.isInteger(info.total) || info.total < 1) throw new Error("Empty dataset");
    total = info.total;
    element("dataset-count").textContent = `음식점 ${total.toLocaleString("ko-KR")}곳`;
    selectionStatus.textContent = "준비됐어요. 버튼을 눌러 오늘의 메뉴를 골라 보세요.";
    button.disabled = false;
    loadMap(info.mapsClientId);
  } catch {
    element("dataset-count").textContent = "연결 확인 필요";
    selectionStatus.classList.add("error");
    selectionStatus.textContent = "음식점 데이터를 불러오지 못했습니다. start.bat으로 Java 서버를 실행한 뒤 새로고침해 주세요.";
    mapMessage("Java 서버에 연결한 뒤 지도를 불러올 수 있습니다.", true);
  }
}

initialize();
