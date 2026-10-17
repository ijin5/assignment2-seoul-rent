from pathlib import Path

import geopandas as gpd


PROJECT_DIR = Path(__file__).resolve().parents[1]
COURSE_ROOT = Path(__file__).resolve().parents[4]
SOURCE_PATH = (
    COURSE_ROOT
    / "downloaded data"
    / "6주차"
    / "LSMD_ADM_SECT_UMD_서울"
    / "LSMD_ADM_SECT_UMD_11_202609.shp"
)
OUTPUT_PATH = PROJECT_DIR / "public" / "seoul_legaldong.geojson"

GU_NAMES = {
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
    "11740": "강동구",
}


def main():
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"법정동 경계 원본을 찾을 수 없습니다: {SOURCE_PATH}")

    boundaries = gpd.read_file(SOURCE_PATH, encoding="cp949")
    boundaries["SIGUNGU_CD"] = boundaries["COL_ADM_SE"].astype(str).str.zfill(5)
    boundaries = boundaries[boundaries["SIGUNGU_CD"].isin(GU_NAMES)].copy()

    # Simplify in the source's meter-based CRS before exporting lightweight web geometry.
    boundaries["geometry"] = boundaries.geometry.simplify(
        tolerance=15,
        preserve_topology=True,
    )
    boundaries["SIGUNGU_NM"] = boundaries["SIGUNGU_CD"].map(GU_NAMES)
    boundaries["LEGAL_DONG_CD"] = boundaries["EMD_CD"].astype(str).str.zfill(8)
    boundaries["LEGAL_DONG_NM"] = boundaries["EMD_NM"].astype(str).str.strip()

    web_boundaries = boundaries[
        ["SIGUNGU_CD", "SIGUNGU_NM", "LEGAL_DONG_CD", "LEGAL_DONG_NM", "geometry"]
    ].to_crs("EPSG:4326")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    web_boundaries.to_file(OUTPUT_PATH, driver="GeoJSON", encoding="utf-8")

    print(
        f"서울 법정동 {len(web_boundaries):,}개를 "
        f"{OUTPUT_PATH.relative_to(PROJECT_DIR)}에 저장했습니다."
    )


if __name__ == "__main__":
    main()
