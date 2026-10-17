#!/usr/bin/env python3
"""Build a compact, public summary snapshot through the local Worker API."""

from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


PAGE_SIZE = 1000
PAGE_CONCURRENCY = 3
CONVERSION_RATE = 5.0
BUILDING_USES = ("전체", "아파트", "연립다세대", "단독다가구", "오피스텔")
GU_NAMES = {
    "11110": "종로구", "11140": "중구", "11170": "용산구", "11200": "성동구",
    "11215": "광진구", "11230": "동대문구", "11260": "중랑구", "11290": "성북구",
    "11305": "강북구", "11320": "도봉구", "11350": "노원구", "11380": "은평구",
    "11410": "서대문구", "11440": "마포구", "11470": "양천구", "11500": "강서구",
    "11530": "구로구", "11545": "금천구", "11560": "영등포구", "11590": "동작구",
    "11620": "관악구", "11650": "서초구", "11680": "강남구", "11710": "송파구",
    "11740": "강동구",
}
GU_CODES = {name: code for code, name in GU_NAMES.items()}


def number(value: object) -> float:
    try:
        parsed = float(str(value or "").replace(",", "").strip())
        return parsed if parsed == parsed else 0.0
    except (TypeError, ValueError):
        return 0.0


def request_page(base_url: str, year: int, start: int) -> dict:
    url = f"{base_url.rstrip('/')}/api/rent-page?year={year}&guCode=ALL&start={start}"
    request = Request(url, headers={"Accept": "application/json"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=120) as response:
                payload = json.loads(response.read())
            if "error" in payload:
                raise RuntimeError(payload["error"])
            return payload
        except (URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            if attempt == 2:
                raise RuntimeError(f"{start}행 페이지 요청 실패: {error}") from error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{start}행 페이지 요청 실패")


def update_stats(views: dict, key: str, row: dict, value: float, month: str) -> None:
    view = views[key]
    view["values"].append(value)
    label = f"{row['guName']} {row['dongName']}"
    view["groups"][label].append(value)
    view["map"][(row["guName"], row["dongName"])].append(value)
    if month:
        view["trend"][month].append(value)


def add_rows(views: dict, rows: list[dict]) -> None:
    for source in rows:
        gu_name = str(source.get("cggNm") or "").strip()
        dong_name = str(source.get("stdgNm") or "").strip()
        gu_code = GU_CODES.get(gu_name)
        area = number(source.get("rentArea"))
        if not gu_code or not dong_name or area <= 0:
            continue

        rent_type = str(source.get("rentSe") or "")
        deposit = number(source.get("grfe"))
        monthly_rent = number(source.get("rtfe"))
        converted_deposit = deposit
        if "월세" in rent_type:
            converted_deposit += monthly_rent * 12 / (CONVERSION_RATE / 100)
        value = converted_deposit / area
        building_use = str(source.get("bldgUsg") or "").strip()
        date_digits = re.sub(r"\D", "", str(source.get("ctrtDay") or ""))
        month = date_digits[:4] + "-" + date_digits[4:6] if len(date_digits) >= 6 else ""
        normalized = {"guName": gu_name, "dongName": dong_name}

        selected_uses = {"전체"}
        if building_use in BUILDING_USES:
            selected_uses.add(building_use)
        selected_gu_codes = {"ALL", gu_code}
        for selected_gu in selected_gu_codes:
            for selected_use in selected_uses:
                update_stats(views, f"{selected_gu}|{selected_use}", normalized, value, month)


def summarize_views(views: dict) -> dict:
    summarized = {}
    for key, view in views.items():
        groups = [
            {"label": label, "value": statistics.median(values), "count": len(values)}
            for label, values in view["groups"].items()
        ]
        groups.sort(key=lambda item: (-item["value"], item["label"]))
        map_stats = [
            {"guName": gu_name, "dongName": dong_name, "value": statistics.median(values), "count": len(values)}
            for (gu_name, dong_name), values in view["map"].items()
        ]
        map_stats.sort(key=lambda item: (item["guName"], item["dongName"]))
        trend = [
            {"month": month, "value": statistics.median(values), "count": len(values)}
            for month, values in view["trend"].items()
        ]
        trend.sort(key=lambda item: item["month"])
        summarized[key] = {
            "count": len(view["values"]),
            "median": statistics.median(view["values"]) if view["values"] else 0,
            "groups": groups,
            "map": map_stats,
            "trend": trend,
        }
    return summarized


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public" / "rent_snapshot_2026.json",
    )
    args = parser.parse_args()

    print(f"{args.year}년 서울 전체 API 첫 페이지 조회 중")
    first_page = request_page(args.base_url, args.year, 1)
    total_count = int(first_page.get("totalCount") or 0)
    total_pages = (total_count + PAGE_SIZE - 1) // PAGE_SIZE
    if not total_count or not first_page.get("rows"):
        raise SystemExit("API 응답에 거래 자료가 없습니다.")

    views = defaultdict(lambda: {
        "values": [], "groups": defaultdict(list), "map": defaultdict(list), "trend": defaultdict(list)
    })
    add_rows(views, first_page["rows"])
    starts = list(range(PAGE_SIZE + 1, total_count + 1, PAGE_SIZE))
    completed_pages = 1
    with ThreadPoolExecutor(max_workers=PAGE_CONCURRENCY) as executor:
        futures = {executor.submit(request_page, args.base_url, args.year, start): start for start in starts}
        for future in as_completed(futures):
            payload = future.result()
            add_rows(views, payload.get("rows") or [])
            completed_pages += 1
            if completed_pages % 20 == 0 or completed_pages == total_pages:
                print(f"{completed_pages}/{total_pages} 페이지 처리 · {min(completed_pages * PAGE_SIZE, total_count):,}/{total_count:,}건")

    now_kst = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
    snapshot = {
        "year": args.year,
        "conversionRate": CONVERSION_RATE,
        "rowCount": total_count,
        "collectedAt": now_kst,
        "source": "서울 열린데이터광장 tbLnOpendataRentV",
        "views": summarize_views(views),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"요약 저장 완료: {args.output}")
    print(f"수집 {total_count:,}건 · 화면 조건 조합 {len(snapshot['views'])}개")


if __name__ == "__main__":
    main()
