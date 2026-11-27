"""Recorded illustrative fixtures. Loading and replay require no network or inference."""

from pathlib import Path

from app.schemas import ReplayFixture

FIXTURE_IDS = ("auth_sqli_pr", "logic_edge_pr", "clean_small_pr")


def load_fixture(identity: str) -> ReplayFixture:
    if identity not in FIXTURE_IDS:
        raise KeyError(identity)
    return ReplayFixture.model_validate_json(
        (Path(__file__).parent / "replays" / f"{identity}.json").read_text()
    )
