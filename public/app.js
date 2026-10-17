const PAGE_SIZE = 1000;
const PAGE_CONCURRENCY = 3;
const GU_LABELS = {
  "11110": "종로구", "11140": "중구", "11170": "용산구", "11200": "성동구",
  "11215": "광진구", "11230": "동대문구", "11260": "중랑구", "11290": "성북구",
  "11305": "강북구", "11320": "도봉구", "11350": "노원구", "11380": "은평구",
  "11410": "서대문구", "11440": "마포구", "11470": "양천구", "11500": "강서구",
  "11530": "구로구", "11545": "금천구", "11560": "영등포구", "11590": "동작구",
  "11620": "관악구", "11650": "서초구", "11680": "강남구", "11710": "송파구",
  "11740": "강동구"
};

const yearSelect = document.getElementById("yearSelect");
const guSelect = document.getElementById("guSelect");
const buildingSelect = document.getElementById("buildingSelect");
const rateInput = document.getElementById("rateInput");
const loadButton = document.getElementById("loadButton");
const statusNode = document.getElementById("status");
let sourceRows = [];
let loadTimestamp = "";
let dongBoundaryFeatures = [];
let savedSnapshot = null;
let refreshInProgress = false;

function setStatus(message) {
  statusNode.textContent = message;
}

function addYearOptions() {
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= currentYear - 2; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = year + "년";
    yearSelect.appendChild(option);
  }
}

function numberValue(value) {
  const parsed = Number(String(value == null ? "" : value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatNumber(value, digits) {
  return Number(value).toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function outerRings(feature) {
  const geometry = feature.geometry || {};
  if (geometry.type === "Polygon") return geometry.coordinates.length ? [geometry.coordinates[0]] : [];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map(function(polygon) { return polygon[0]; }).filter(Boolean);
  return [];
}

function renderLegalDongMap(rows, aggregateStats) {
  const svg = document.getElementById("dongMap");
  const empty = document.getElementById("mapEmpty");
  const coverage = document.getElementById("mapCoverage");
  svg.replaceChildren();
  if (!rows.length && !aggregateStats) {
    coverage.textContent = "";
    empty.textContent = "자료를 불러오면 법정동별 지도가 표시됩니다.";
    empty.hidden = false;
    return;
  }
  if (!dongBoundaryFeatures.length) {
    coverage.textContent = "";
    empty.textContent = "법정동 경계 자료를 불러오지 못했습니다.";
    empty.hidden = false;
    return;
  }

  const statsByDong = new Map();
  if (aggregateStats) {
    aggregateStats.forEach(function(stats) {
      statsByDong.set(stats.guName + "|" + stats.dongName, {
        value: stats.value,
        count: stats.count
      });
    });
  } else {
    const byDong = new Map();
    rows.forEach(function(row) {
      if (!row.guName || !row.dongName) return;
      const key = row.guName + "|" + row.dongName;
      if (!byDong.has(key)) byDong.set(key, []);
      byDong.get(key).push(row.perSquareMeter);
    });
    byDong.forEach(function(values, key) {
      statsByDong.set(key, {
        value: median(values),
        count: values.length
      });
    });
  }
  const boundaryKeys = new Set(dongBoundaryFeatures.map(function(feature) {
    const properties = feature.properties || {};
    return String(properties.SIGUNGU_NM || "").trim() + "|" +
      String(properties.LEGAL_DONG_NM || "").trim();
  }));
  const mappedStats = Array.from(statsByDong.entries())
    .filter(function(entry) { return boundaryKeys.has(entry[0]); })
    .map(function(entry) { return entry[1]; });
  const values = mappedStats.map(function(stats) { return stats.value; });
  if (!values.length) {
    coverage.textContent = "API 거래 지역명과 법정동 경계가 연결되지 않았습니다.";
    empty.textContent = "지도에 표시할 법정동 거래가 없습니다.";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const matchedDongCount = mappedStats.length;
  const unmatchedDongCount = statsByDong.size - matchedDongCount;
  coverage.textContent =
    "거래가 있는 법정동 " + matchedDongCount.toLocaleString("ko-KR") + " / " +
    dongBoundaryFeatures.length.toLocaleString("ko-KR") + "개" +
    (unmatchedDongCount ? " · 경계 미연결 지역 " + unmatchedDongCount.toLocaleString("ko-KR") + "개" : "") +
    " · 동에 마우스를 올리면 거래 수치를 볼 수 있습니다.";
  const minValue = Math.min.apply(null, values);
  const maxValue = Math.max.apply(null, values);
  const allPoints = [];
  dongBoundaryFeatures.forEach(function(feature) {
    outerRings(feature).forEach(function(ring) {
      ring.forEach(function(point) { allPoints.push(point); });
    });
  });
  if (!allPoints.length) {
    empty.textContent = "법정동 경계 좌표를 읽지 못했습니다.";
    empty.hidden = false;
    return;
  }

  const longitudes = allPoints.map(function(point) { return point[0]; });
  const latitudes = allPoints.map(function(point) { return point[1]; });
  const minLon = Math.min.apply(null, longitudes);
  const maxLon = Math.max.apply(null, longitudes);
  const minLat = Math.min.apply(null, latitudes);
  const maxLat = Math.max.apply(null, latitudes);
  const averageLat = (minLat + maxLat) / 2 * Math.PI / 180;
  const longitudeFactor = Math.cos(averageLat);
  const width = 680;
  const height = 700;
  const padding = 18;
  const xExtent = (maxLon - minLon) * longitudeFactor;
  const yExtent = maxLat - minLat;
  const scale = Math.min((width - padding * 2) / xExtent, (height - padding * 2) / yExtent);
  const drawnWidth = xExtent * scale;
  const drawnHeight = yExtent * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;
  const startColor = [224, 242, 233];
  const endColor = [16, 87, 68];
  const svgNamespace = "http://www.w3.org/2000/svg";

  function fillColor(value) {
    const ratio = maxValue === minValue ? 0.55 : (value - minValue) / (maxValue - minValue);
    const channels = startColor.map(function(start, index) {
      return Math.round(start + (endColor[index] - start) * ratio);
    });
    return "rgb(" + channels.join(",") + ")";
  }

  dongBoundaryFeatures.forEach(function(feature) {
    const properties = feature.properties || {};
    const guName = String(properties.SIGUNGU_NM || "").trim();
    const dongName = String(properties.LEGAL_DONG_NM || "").trim();
    if (!guName || !dongName) return;
    const stats = statsByDong.get(guName + "|" + dongName);
    outerRings(feature).forEach(function(ring) {
      const commands = ring.map(function(point, index) {
        const x = offsetX + ((point[0] - minLon) * longitudeFactor) * scale;
        const y = height - offsetY - (point[1] - minLat) * scale;
        return (index === 0 ? "M " : "L ") + x.toFixed(2) + " " + y.toFixed(2);
      }).join(" ") + " Z";
      const path = document.createElementNS(svgNamespace, "path");
      path.setAttribute("d", commands);
      path.setAttribute("class", "dong-shape");
      path.setAttribute("fill", stats ? fillColor(stats.value) : "#edf1ef");
      const title = document.createElementNS(svgNamespace, "title");
      title.textContent = guName + " " + dongName +
        (stats
          ? ": " + formatNumber(stats.value, 1) + "만원/㎡ · " +
            stats.count.toLocaleString("ko-KR") + "건"
          : ": 자료 없음");
      path.appendChild(title);
      svg.appendChild(path);
    });
  });
}

async function loadBoundaries() {
  try {
    const response = await fetch("/seoul_legaldong.geojson");
    if (!response.ok) throw new Error("경계 자료 요청 실패");
    const geojson = await response.json();
    dongBoundaryFeatures = Array.isArray(geojson.features) ? geojson.features : [];
    if (sourceRows.length || savedSnapshot) render();
  } catch (_error) {
    document.getElementById("mapEmpty").textContent = "법정동 경계 자료를 불러오지 못했습니다.";
  }
}

async function fetchPage(year, guCode, start) {
  const query = new URLSearchParams({
    year: String(year),
    guCode: guCode,
    start: String(start)
  });
  const response = await fetch("/api/rent-page?" + query.toString());
  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    throw new Error("서버 응답을 읽지 못했습니다.");
  }
  if (!response.ok) throw new Error(payload.error || "자료를 불러오지 못했습니다.");
  return payload;
}

function normalizeRow(row, selectedGu) {
  const rentType = String(row.rentSe || "").trim();
  const deposit = numberValue(row.grfe);
  const monthlyRent = numberValue(row.rtfe);
  const area = numberValue(row.rentArea);
  const rate = numberValue(rateInput.value) / 100;
  const convertedDeposit = deposit + (rentType.indexOf("월세") >= 0 && rate > 0 ? monthlyRent * 12 / rate : 0);
  const dateDigits = String(row.ctrtDay || "").replace(/\D/g, "");
  const month = dateDigits.length >= 6 ? dateDigits.slice(0, 4) + "-" + dateDigits.slice(4, 6) : "";
  const guName = row.cggNm || (selectedGu === "ALL" ? "" : GU_LABELS[selectedGu] || "");
  const dongName = String(row.stdgNm || "").trim();
  // The Seoul API gives deposits and rents in 만원, so dividing by area keeps 만원/㎡.
  return {
    guName: String(guName).trim(),
    dongName: dongName,
    region: (guName ? guName + " " : "") + (dongName || "법정동 미상"),
    rentType: rentType,
    buildingUse: String(row.bldgUsg || "").trim(),
    area: area,
    convertedDeposit: convertedDeposit,
    perSquareMeter: area > 0 ? convertedDeposit / area : 0,
    month: month
  };
}

function selectedRows() {
  const selectedUse = buildingSelect.value;
  return sourceRows.map(function(row) {
    return normalizeRow(row, guSelect.value);
  }).filter(function(row) {
    const useMatches = selectedUse === "전체" || row.buildingUse === selectedUse;
    return useMatches && row.area > 0 && row.perSquareMeter > 0;
  });
}

function renderBars(groups) {
  const root = document.getElementById("regionBars");
  root.replaceChildren();
  const topGroups = groups.slice(0, 20);
  if (!topGroups.length) {
    root.innerHTML = '<p class="empty-state">선택한 조건에 해당하는 거래가 없습니다.</p>';
    return;
  }
  const maxValue = topGroups[0].value;
  topGroups.forEach(function(group, index) {
    const row = document.createElement("div");
    row.className = "bar-row";
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = group.label;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = Math.max(2, group.value / maxValue * 100) + "%";
    if (index === 0) fill.style.background = "linear-gradient(90deg, #efbd76, #dc8b36)";
    track.appendChild(fill);
    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = formatNumber(group.value, 1);
    row.append(label, track, value);
    root.appendChild(row);
  });
}

function drawTrend(rows) {
  const svg = document.getElementById("trendChart");
  const labels = document.getElementById("trendLabels");
  const empty = document.getElementById("trendEmpty");
  svg.replaceChildren();
  labels.replaceChildren();

  const byMonth = new Map();
  rows.forEach(function(row) {
    if (!row.month) return;
    if (!byMonth.has(row.month)) byMonth.set(row.month, []);
    byMonth.get(row.month).push(row.perSquareMeter);
  });
  const points = Array.from(byMonth.entries())
    .sort(function(a, b) { return a[0].localeCompare(b[0]); })
    .map(function(entry) { return { month: entry[0], value: median(entry[1]) }; });

  if (!points.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const width = 900;
  const height = 250;
  const left = 48;
  const right = 18;
  const top = 18;
  const bottom = 20;
  const minValue = Math.min.apply(null, points.map(function(point) { return point.value; }));
  const maxValue = Math.max.apply(null, points.map(function(point) { return point.value; }));
  const spread = Math.max(1, maxValue - minValue);
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  [0, 0.5, 1].forEach(function(fraction) {
    const y = top + plotHeight * fraction;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", left);
    line.setAttribute("x2", width - right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("class", "chart-grid-line");
    svg.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const shownValue = maxValue - spread * fraction;
    label.setAttribute("x", left - 7);
    label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "chart-y-label");
    label.textContent = formatNumber(shownValue, 0);
    svg.appendChild(label);
  });

  const coordinates = points.map(function(point, index) {
    const x = points.length === 1 ? left + plotWidth / 2 : left + plotWidth * index / (points.length - 1);
    const y = top + plotHeight * (maxValue - point.value) / spread;
    return { x: x, y: y, month: point.month, value: point.value };
  });
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", coordinates.map(function(point) { return point.x + "," + point.y; }).join(" "));
  polyline.setAttribute("class", "chart-line");
  svg.appendChild(polyline);

  coordinates.forEach(function(point) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", point.x);
    circle.setAttribute("cy", point.y);
    circle.setAttribute("r", 5);
    circle.setAttribute("class", "chart-dot");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = point.month + ": " + formatNumber(point.value, 1) + "만원/㎡";
    circle.appendChild(title);
    svg.appendChild(circle);
  });

  const firstLabel = document.createElement("span");
  firstLabel.textContent = points[0].month;
  const lastLabel = document.createElement("span");
  lastLabel.textContent = points[points.length - 1].month;
  labels.append(firstLabel, lastLabel);
}

function renderSnapshot() {
  const key = guSelect.value + "|" + buildingSelect.value;
  const view = savedSnapshot.views[key];
  const countNode = document.getElementById("countValue");
  const medianNode = document.getElementById("medianValue");
  const topNode = document.getElementById("topAreaValue");
  const topUnit = document.getElementById("topAreaUnit");
  const groups = view ? view.groups : [];
  countNode.textContent = view ? view.count.toLocaleString("ko-KR") : "—";
  medianNode.textContent = view ? formatNumber(view.median, 1) : "—";
  if (groups.length) {
    topNode.textContent = groups[0].label;
    topUnit.textContent = formatNumber(groups[0].value, 1) + " 만원/㎡";
  } else {
    topNode.textContent = "—";
    topUnit.textContent = "만원/㎡";
  }
  renderLegalDongMap([], view ? view.map : []);
  renderBars(groups);
  drawTrend(view ? view.trend.map(function(point) {
    return { month: point.month, perSquareMeter: point.value };
  }) : []);

  const snapshotDate = new Date(savedSnapshot.collectedAt).toLocaleString("ko-KR");
  const rateMatches = Math.abs(numberValue(rateInput.value) - savedSnapshot.conversionRate) < 0.001;
  const rateLabel = rateMatches
    ? "전환율 " + savedSnapshot.conversionRate.toFixed(1) + "%"
    : "요약본 기준 전환율 " + savedSnapshot.conversionRate.toFixed(1) + "%";
  setStatus("저장된 요약 자료 표시 중 · " + savedSnapshot.year + "년 기준 " + snapshotDate + " 수집 · " + rateLabel +
    (refreshInProgress ? " · 최신 API 자료 갱신 중" : ""));
}

function render() {
  if (!sourceRows.length && savedSnapshot && Number(yearSelect.value) === savedSnapshot.year) {
    renderSnapshot();
    return;
  }
  const rows = selectedRows();
  const countNode = document.getElementById("countValue");
  const medianNode = document.getElementById("medianValue");
  const topNode = document.getElementById("topAreaValue");
  const topUnit = document.getElementById("topAreaUnit");
  countNode.textContent = rows.length.toLocaleString("ko-KR");
  medianNode.textContent = rows.length ? formatNumber(median(rows.map(function(row) { return row.perSquareMeter; })), 1) : "—";

  const grouped = new Map();
  rows.forEach(function(row) {
    if (!grouped.has(row.region)) grouped.set(row.region, []);
    grouped.get(row.region).push(row.perSquareMeter);
  });
  const groups = Array.from(grouped.entries()).map(function(entry) {
    return { label: entry[0], value: median(entry[1]) };
  }).sort(function(a, b) { return b.value - a.value; });

  if (groups.length) {
    topNode.textContent = groups[0].label;
    topUnit.textContent = formatNumber(groups[0].value, 1) + " 만원/㎡";
  } else {
    topNode.textContent = "—";
    topUnit.textContent = "만원/㎡";
  }
  renderLegalDongMap(rows);
  renderBars(groups);
  drawTrend(rows);

  if (sourceRows.length) {
    const useLabel = buildingSelect.value === "전체" ? "전체 용도" : buildingSelect.value;
    const timestampLabel = loadTimestamp ? " · 조회 시각 " + loadTimestamp : "";
    setStatus(sourceRows.length.toLocaleString("ko-KR") + "건을 불러왔습니다. 현재 " + rows.length.toLocaleString("ko-KR") + "건 분석 · " + useLabel + " · 전환율 " + Number(rateInput.value).toFixed(1) + "%" + timestampLabel + (refreshInProgress ? " · 최신 자료 갱신 중" : ""));
  }
}

async function loadData(options) {
  if (refreshInProgress) return;
  const background = Boolean(options && options.background);
  loadButton.disabled = true;
  refreshInProgress = true;
  const year = Number(yearSelect.value);
  const guCode = guSelect.value;
  const collectedRows = [];
  try {
    setStatus(savedSnapshot && year === savedSnapshot.year
      ? "저장된 요약 지도를 표시했습니다. 서울시 API 최신 자료를 확인하고 있습니다."
      : "첫 페이지를 요청하고 있습니다.");
    const firstPage = await fetchPage(year, guCode, 1);
    const totalCount = firstPage.totalCount;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    (firstPage.rows || []).forEach(function(row) { collectedRows.push(row); });
    setStatus((savedSnapshot && year === savedSnapshot.year ? "저장 요약 표시 중 · " : "") + "1 / " + Math.max(1, totalPages) + " 페이지 수신 · " + collectedRows.length.toLocaleString("ko-KR") + "건");

    const starts = [];
    for (let page = 1; page < totalPages; page += 1) starts.push(page * PAGE_SIZE + 1);
    for (let index = 0; index < starts.length; index += PAGE_CONCURRENCY) {
      const batchStarts = starts.slice(index, index + PAGE_CONCURRENCY);
      const batch = await Promise.all(batchStarts.map(function(start) {
        return fetchPage(year, guCode, start);
      }));
      batch.forEach(function(page) {
        (page.rows || []).forEach(function(row) { collectedRows.push(row); });
      });
      const receivedPages = Math.min(1 + index + batch.length, totalPages);
      setStatus((savedSnapshot && year === savedSnapshot.year ? "저장 요약 표시 중 · " : "") + receivedPages + " / " + Math.max(1, totalPages) + " 페이지 수신 · " + collectedRows.length.toLocaleString("ko-KR") + " / " + totalCount.toLocaleString("ko-KR") + "건");
    }
    if (!collectedRows.length) {
      sourceRows = [];
      render();
      setStatus("선택한 조건에 해당하는 거래가 없습니다.");
      return;
    }
    sourceRows = collectedRows;
    loadTimestamp = new Date().toLocaleString("ko-KR");
    refreshInProgress = false;
    render();
  } catch (error) {
    refreshInProgress = false;
    render();
    const fallbackMessage = savedSnapshot && year === savedSnapshot.year
      ? "저장 요약 자료는 표시 중입니다. API 갱신에 실패했습니다: "
      : "자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ";
    setStatus(fallbackMessage + (error.message || "요청 오류"));
  } finally {
    refreshInProgress = false;
    loadButton.disabled = false;
  }
}

async function loadSavedSnapshot() {
  try {
    const response = await fetch("/rent_snapshot_2026.json");
    if (!response.ok) throw new Error("저장 요약 자료 요청 실패");
    savedSnapshot = await response.json();
    render();
    if (Number(yearSelect.value) === savedSnapshot.year) {
      loadData({ background: true });
    }
  } catch (_error) {
    setStatus("저장 요약 자료를 불러오지 못했습니다. 자료 불러오기 버튼으로 API를 조회해 주세요.");
  }
}

addYearOptions();
loadBoundaries();
loadSavedSnapshot();
loadButton.addEventListener("click", function() { loadData({ background: false }); });
buildingSelect.addEventListener("change", render);
rateInput.addEventListener("input", render);
guSelect.addEventListener("change", function() {
  sourceRows = [];
  loadTimestamp = "";
  render();
  if (!savedSnapshot || Number(yearSelect.value) !== savedSnapshot.year) {
    setStatus("선택한 지역 자료를 보려면 서울시 자료 다시 불러오기를 눌러 주세요.");
  }
});
yearSelect.addEventListener("change", function() {
  sourceRows = [];
  loadTimestamp = "";
  render();
  if (!savedSnapshot || Number(yearSelect.value) !== savedSnapshot.year) {
    setStatus("선택한 연도 자료를 보려면 서울시 자료 불러오기를 눌러 주세요.");
  }
});

