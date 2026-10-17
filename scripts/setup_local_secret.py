from pathlib import Path
import os
import sys

APP_DIR = Path(__file__).resolve().parents[1]
COURSE_DIR = APP_DIR.parent
SOURCE_ENV = COURSE_DIR / ".env"
DESTINATION = APP_DIR / ".dev.vars"

if DESTINATION.exists():
    print("기존 .dev.vars가 있어 덮어쓰지 않았습니다.")
    sys.exit(0)

if not SOURCE_ENV.is_file():
    print("상위 lecture04_spatial_data_analysis 폴더에서 .env를 찾지 못했습니다.")
    sys.exit(1)

api_key = os.environ.get("SEOUL_API_KEY", "")
if not api_key:
    for line in SOURCE_ENV.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("SEOUL_API_KEY="):
            api_key = stripped.split("=", 1)[1].strip().strip('"').strip("'")
            break

if not api_key:
    print(".env에 SEOUL_API_KEY가 설정되어 있지 않습니다.")
    sys.exit(1)

DESTINATION.write_text('SEOUL_API_KEY="' + api_key.replace('"', '\\"') + '"\n', encoding="utf-8")
os.chmod(DESTINATION, 0o600)
print("로컬 Worker secret 파일을 만들었습니다. 키 값은 표시하지 않았습니다.")

