"""Run Stage 0 against an offline PRSource JSON fixture."""

import argparse
from pathlib import Path

from app.config import get_settings
from app.pipeline.stage0 import Stage0
from app.schemas import PRSource


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    args = parser.parse_args()
    source = PRSource.model_validate_json(args.fixture.read_text(encoding="utf-8"))
    bundle = Stage0(get_settings()).assemble(source)
    print(bundle.model_dump_json(indent=2))
    if bundle.sast_status != "completed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
