"""Shared matplotlib style for the figures (evaluate.py and the results notebook). Colors are the
first three validated categorical slots (all-pairs safe); at most three series share a panel, and
families are shown as small multiples instead of more colors. Aqua is below 3:1 on the surface, so
every figure carries a legend and the numbers are also in metrics.json and the notebook tables."""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SURFACE = "#fcfcfb"
TEXT = "#0b0b0b"
TEXT_2 = "#52514e"
GRID = "#e4e3df"
SERIES = ("#2a78d6", "#eb6834", "#1baf7a")   # blue, orange, aqua


def style() -> None:
    plt.rcParams.update({
        "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
        "axes.edgecolor": GRID, "axes.labelcolor": TEXT_2, "axes.titlecolor": TEXT, "axes.titlesize": 11,
        "axes.titleweight": "bold", "axes.labelsize": 9, "xtick.color": TEXT_2, "ytick.color": TEXT_2,
        "xtick.labelsize": 8, "ytick.labelsize": 8, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8,
        "grid.linestyle": "-", "axes.spines.top": False, "axes.spines.right": False, "lines.linewidth": 2,
        "lines.solid_capstyle": "round", "lines.solid_joinstyle": "round", "legend.frameon": False,
        "legend.fontsize": 8, "legend.labelcolor": TEXT, "font.size": 9, "figure.dpi": 110,
    })
