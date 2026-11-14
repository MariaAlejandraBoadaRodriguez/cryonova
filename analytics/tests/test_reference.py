"""pytest checks for the Python reference and the committed parity fixture."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "analytics"))
sys.path.insert(0, str(ROOT / "analytics" / "parity"))

from cryonova_reference import annual_means, decode_simple_dods, trend_ols_hac, weighted_mean  # noqa: E402
from generate_fixture import build  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "parity" / "statsmodels_reference.json"


def test_committed_fixture_is_reproducible():
    committed = json.loads(FIXTURE.read_text())
    regenerated = json.loads(json.dumps(build()))
    assert len(committed["trend"]) == len(regenerated["trend"])
    for got, want in zip(committed["trend"], regenerated["trend"]):
        assert got["x"] == want["x"] and got["maxlags"] == want["maxlags"]
        assert got["y"] == pytest.approx(want["y"], rel=1e-15)
        for key, value in want["expected"].items():
            assert got["expected"][key] == pytest.approx(value, rel=1e-12, abs=1e-15)


def test_weighted_mean_of_live_colombia_response():
    arrays = decode_simple_dods(str(ROOT / "tests" / "fixtures" / "opendap" / "merra2_slv_200501_colombia_t2m.dods"))
    t2m = arrays["T2M"].reshape(34, 20)
    value, valid = weighted_mean(t2m, arrays["T2M.lat"], 9.99999987e14)
    assert valid == 680
    assert value == pytest.approx(298.373, abs=5e-4)


def test_annual_means_keep_complete_years_only():
    months = [f"2001-{m:02d}" for m in range(1, 13)] + [f"2002-{m:02d}" for m in range(1, 13)]
    values: list[float | None] = [1.0] * 12 + [2.0] * 11 + [None]
    assert annual_means(months, values) == [(2001, 1.0)]
    assert annual_means(months, values, min_months=11) == [(2001, 1.0), (2002, 2.0)]


def test_trend_recovers_known_slope():
    years = list(range(1990, 2020))
    values = [0.03 * (y - 1990) + 0.01 * np.sin(y) for y in years]
    tr = trend_ols_hac(years, values)
    assert tr.slope == pytest.approx(0.03, abs=1e-3)
    assert tr.ci_low < tr.slope < tr.ci_high
