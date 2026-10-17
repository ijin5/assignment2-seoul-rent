const GU_NAMES = {
  "11110": "종로구",
  "11140": "중구",
  "11170": "용산구",
  "11200": "성동구",
  "11215": "광진구",
  "11230": "동대문구",
  "11260": "중랑구",
  "11290": "성북구",
  "11305": "강북구",
  "11320": "도봉구",
  "11350": "노원구",
  "11380": "은평구",
  "11410": "서대문구",
  "11440": "마포구",
  "11470": "양천구",
  "11500": "강서구",
  "11530": "구로구",
  "11545": "금천구",
  "11560": "영등포구",
  "11590": "동작구",
  "11620": "관악구",
  "11650": "서초구",
  "11680": "강남구",
  "11710": "송파구",
  "11740": "강동구"
};

function jsonResponse(body, status, cacheControl) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl || "no-store"
    }
  });
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return "";
}

function compactRow(row) {
  return {
    cggNm: pick(row, ["CGG_NM", "SIGUNGU_NM"]),
    stdgNm: pick(row, ["STDG_NM", "LEGAL_DONG_NM"]),
    ctrtDay: pick(row, ["CTRT_DAY", "CTRCT_DAY", "CNTRCT_DE"]),
    rentSe: pick(row, ["RENT_SE", "RENT_TYPE"]),
    rentArea: pick(row, ["RENT_AREA", "AREA"]),
    grfe: pick(row, ["GRFE", "DEPOSIT"]),
    rtfe: pick(row, ["RTFE", "MONTHLY_RENT"]),
    bldgUsg: pick(row, ["BLDG_USG", "BUILDING_USE"])
  };
}

async function handleRentPage(request, env) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "GET 요청만 지원합니다." }, 405);
  }
  if (!env.SEOUL_API_KEY) {
    return jsonResponse({ error: "서버에 서울시 API 키가 설정되지 않았습니다." }, 503);
  }

  const params = new URL(request.url).searchParams;
  const year = Number(params.get("year"));
  const guCode = params.get("guCode") || "ALL";
  const start = Number(params.get("start") || "1");
  const currentYear = new Date().getUTCFullYear();

  if (!Number.isInteger(year) || year < currentYear - 2 || year > currentYear) {
    return jsonResponse({ error: "최근 3개 접수연도만 조회할 수 있습니다." }, 400);
  }
  if (!Number.isInteger(start) || start < 1 || (start - 1) % 1000 !== 0) {
    return jsonResponse({ error: "조회 시작값이 올바르지 않습니다." }, 400);
  }
  if (guCode !== "ALL" && !GU_NAMES[guCode]) {
    return jsonResponse({ error: "서울시 자치구를 선택해 주세요." }, 400);
  }

  // The source dataset is updated daily. Keep successful pages at the edge for
  // one day so repeat visitors do not trigger another full Seoul-wide crawl.
  const cacheUrl = new URL(request.url);
  cacheUrl.search = new URLSearchParams({
    year: String(year),
    guCode: guCode,
    start: String(start)
  }).toString();
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const requestHost = cacheUrl.hostname;
  const isLocalDev = requestHost === "localhost" || requestHost === "127.0.0.1";
  const edgeCache = !isLocalDev && typeof caches !== "undefined" ? caches.default : null;
  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;
    } catch (_error) {
      // Continue to the source API if edge caching is unavailable.
    }
  }

  const end = start + 999;
  const encodedKey = encodeURIComponent(env.SEOUL_API_KEY);
  let upstreamUrl =
    "http://openapi.seoul.go.kr:8088/" +
    encodedKey +
    "/json/tbLnOpendataRentV/" +
    start +
    "/" +
    end +
    "/" +
    year +
    "/";
  if (guCode !== "ALL") {
    upstreamUrl += guCode + "/" + encodeURIComponent(GU_NAMES[guCode]) + "/";
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, { method: "GET" });
  } catch (_error) {
    return jsonResponse({ error: "서울시 API에 연결하지 못했습니다." }, 502);
  }
  if (!upstream.ok) {
    return jsonResponse({ error: "서울시 API가 요청을 처리하지 못했습니다." }, 502);
  }

  let payload;
  let responseText = "";
  try {
    responseText = await upstream.text();
    payload = JSON.parse(responseText);
  } catch (_error) {
    console.error("서울시 API가 JSON이 아닌 응답을 반환했습니다.", {
      status: upstream.status,
      contentType: upstream.headers.get("content-type") || "",
      apiCode: (responseText.match(/<CODE>([^<]*)<\/CODE>/i) || [])[1] || "",
      bodyLength: responseText.length
    });
    return jsonResponse({ error: "서울시 API 응답을 읽지 못했습니다." }, 502);
  }

  const block = payload.tbLnOpendataRentV || {};
  const result = block.RESULT || {};
  const rows = Array.isArray(block.row) ? block.row : [];
  const totalCount = Number(block.list_total_count || 0);

  if (!rows.length && result.CODE && result.CODE !== "INFO-200") {
    return jsonResponse({ error: "서울시 API에서 데이터 조회 오류를 반환했습니다." }, 502);
  }

  const response = jsonResponse({
    year: year,
    guCode: guCode,
    guName: guCode === "ALL" ? "서울 전체" : GU_NAMES[guCode],
    start: start,
    totalCount: totalCount,
    rows: rows.map(compactRow)
  }, 200, "public, max-age=86400");
  if (edgeCache) {
    try {
      await edgeCache.put(cacheKey, response.clone());
    } catch (_error) {
      // The API response remains usable if edge-cache writes fail.
    }
  }
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/rent-page") {
      return handleRentPage(request, env);
    }
    return jsonResponse({ error: "요청한 경로를 찾을 수 없습니다." }, 404);
  }
};

