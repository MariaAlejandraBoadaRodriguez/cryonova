"""Reference implementation of the Cryonova trend method in Python.

This mirrors the Databricks reference approach (xarray/statsmodels): a
cosine-latitude weighted regional mean per month, calendar-year means of
complete years, and an OLS trend with Newey-West HAC uncertainty (1 lag).
The TypeScript engine in src/analytics must match these numbers.
"""
from __future__ import annotations

import math
import struct
from dataclasses import dataclass

import numpy as np
import statsmodels.api as sm
from scipy import stats
from statsmodels.stats.multitest import multipletests


def weighted_mean(values: np.ndarray, lats: np.ndarray, fill: float) -> tuple[float | None, int]:
    """Cos-latitude weighted mean over valid cells of a [lat, lon] array."""
    weights = np.cos(np.deg2rad(lats))[:, None] * np.ones_like(values)
    valid = np.isfinite(values) & (np.abs(values) < 1e14) & (np.abs(values - fill) > abs(fill) * 1e-6)
    if not valid.any():
        return None, 0
    return float(np.sum(values[valid] * weights[valid]) / np.sum(weights[valid])), int(valid.sum())


def annual_means(months: list[str], values: list[float | None], min_months: int = 12) -> list[tuple[int, float]]:
    """Calendar-year means of years with at least `min_months` valid months."""
    by_year: dict[int, list[float]] = {}
    for month, value in zip(months, values):
        if value is not None:
            by_year.setdefault(int(month[:4]), []).append(value)
    return [(year, float(np.mean(v))) for year, v in sorted(by_year.items()) if len(v) >= min_months]


@dataclass
class Trend:
    slope: float
    intercept: float
    se_slope: float
    p_value: float
    ci_low: float
    ci_high: float
    n: int


def trend_ols_hac(years: list[float], values: list[float], maxlags: int = 1) -> Trend:
    """statsmodels OLS with HAC covariance, using statsmodels defaults."""
    x = sm.add_constant(np.asarray(years, dtype=float))
    fit = sm.OLS(np.asarray(values, dtype=float), x).fit(cov_type="HAC", cov_kwds={"maxlags": maxlags})
    ci = fit.conf_int(alpha=0.05)
    return Trend(
        slope=float(fit.params[1]),
        intercept=float(fit.params[0]),
        se_slope=float(fit.bse[1]),
        p_value=float(fit.pvalues[1]),
        ci_low=float(ci[1][0]),
        ci_high=float(ci[1][1]),
        n=int(fit.nobs),
    )


def welch(a: list[float], b: list[float]) -> tuple[float, float]:
    """Welch t-test of mean(b) - mean(a): returns (t, two-sided p)."""
    result = stats.ttest_ind(b, a, equal_var=False)
    return float(result.statistic), float(result.pvalue)


def benjamini_hochberg(p_values: list[float]) -> list[float]:
    return [float(q) for q in multipletests(p_values, method="fdr_bh")[1]]


def decode_simple_dods(path: str) -> dict[str, np.ndarray]:
    """Decode a .dods response made of Float64/Float32/Int32 arrays and grids.

    Supports exactly the layout of tests/fixtures/opendap (top-level lon and
    lat arrays followed by one Grid with time/lat/lon maps).
    """
    raw = open(path, "rb").read()
    split = raw.index(b"\nData:\n")
    dds = raw[:split].decode()
    body = raw[split + 7 :]
    decls: list[tuple[str, str, int]] = []
    import re

    for match in re.finditer(r"(Float64|Float32|Int32) ([\w/]+)((?:\[\w+ = \d+\])+);", dds):
        size = math.prod(int(n) for n in re.findall(r"= (\d+)", match.group(3)))
        decls.append((match.group(1), match.group(2), size))
    out: dict[str, np.ndarray] = {}
    offset = 0
    grid_prefix = ""
    for kind, name, size in decls:
        count = struct.unpack(">I", body[offset : offset + 4])[0]
        offset += 8
        assert count == size, (name, count, size)
        fmt, width = {"Float64": ("d", 8), "Float32": ("f", 4), "Int32": ("i", 4)}[kind]
        values = np.array(struct.unpack(f">{count}{fmt}", body[offset : offset + count * width]))
        offset += count * width
        if kind == "Float32":
            grid_prefix = name
        key = f"{grid_prefix}.{name}" if grid_prefix and name in ("time", "lat", "lon") else name
        out[key] = values
    assert offset == len(body)
    return out
