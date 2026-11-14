"""Generate the statsmodels/scipy parity fixture for the TypeScript engine.

Usage: python analytics/parity/generate_fixture.py [output.json]
Deterministic (fixed seed). The fixture is committed and checked in CI.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy import special, stats

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cryonova_reference import benjamini_hochberg, trend_ols_hac, welch  # noqa: E402

DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "parity" / "statsmodels_reference.json"


def build() -> dict:
    rng = np.random.default_rng(20261114)
    trend_cases = []
    for i in range(24):
        n = int(rng.integers(10, 46))
        start = int(rng.integers(1980, 2000))
        years = list(range(start, start + n))
        slope = float(rng.normal(0, 0.05))
        phi = float(rng.uniform(-0.3, 0.8))
        noise = np.zeros(n)
        for t in range(n):
            noise[t] = (phi * noise[t - 1] if t else 0.0) + rng.normal(0, 0.3)
        level = float(rng.choice([25.0, 1013.0, 0.25, 290.0]))
        values = [level + slope * (y - start) + float(e) for y, e in zip(years, noise)]
        lags = 1 if i < 20 else int(rng.integers(2, 4))
        tr = trend_ols_hac(years, values, maxlags=lags)
        trend_cases.append({"name": f"case-{i}", "maxlags": lags, "x": years, "y": values, "expected": tr.__dict__})

    welch_cases = []
    for i in range(8):
        a = list(rng.normal(10, 1.0, int(rng.integers(5, 25))))
        b = list(rng.normal(10.4, 1.5, int(rng.integers(5, 25))))
        t, p = welch(a, b)
        welch_cases.append({"a": a, "b": b, "t": t, "p": p})

    p_values = [float(p) for p in rng.uniform(0, 0.2, 15)] + [0.0001, 0.049, 0.5, 1.0]
    tail_points = [0.0, 0.1, 0.5, 1.0, 1.5, 1.96, 2.4, 2.6, 3.0, 4.5, 6.0, 8.0]
    return {
        "generator": "analytics/parity/generate_fixture.py",
        "seed": 20261114,
        "trend": trend_cases,
        "welch": welch_cases,
        "bh": {"p": p_values, "q": benjamini_hochberg(p_values)},
        "erfc": [{"x": x, "erfc": float(special.erfc(x))} for x in tail_points],
        "t_two_sided": [{"t": t, "df": df, "p": float(2 * stats.t.sf(abs(t), df))} for t, df in [(0.5, 3), (2.1, 7.5), (-3.3, 12), (1.0, 40), (5.0, 2.2)]],
    }


if __name__ == "__main__":
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build(), indent=1) + "\n")
    print(f"wrote {output}")
