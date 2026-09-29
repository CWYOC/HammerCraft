"""Plot audit curves without modifying the simulations. Requires numpy/matplotlib.
Usage: python plot-all-driver-audit.py deployed-engine-results.json output.png
"""
import json
from pathlib import Path
import sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

report = json.loads(Path(sys.argv[1]).read_text())
fig, axes = plt.subplots(5, 2, figsize=(13, 16.5))
fig.patch.set_facecolor("#faf9f6")
for ax, driver in zip(axes.flat, report["drivers"]):
    points = driver["curves"]
    f = [p["frequency_hz"] for p in points]
    ax.semilogx(f, [p["datasheet_db"] for p in points], color="#868686", ls=":", lw=1.4, label="Datasheet: original fixture")
    ax.semilogx(f, [p["undamped_db"] for p in points], color="#276e9d", lw=1.8, label="12 × 2 mm: undamped")
    ax.semilogx(f, [p["damped_1500_midpoint_db"] for p in points], color="#cc572c", lw=1.8, label="Same tube: 1500 Ω at midpoint")
    lo, hi = driver["fr_range_hz"]
    if lo > 20: ax.axvspan(20, lo, color="#999999", alpha=.15)
    if hi < 20000: ax.axvspan(hi, 20000, color="#999999", alpha=.15)
    ax.set_xlim(20, 20000)
    ax.set_title(driver["name"], loc="left", fontsize=12, fontweight="bold", pad=8)
    ax.set_ylabel("SPL (dB)")
    ax.set_xticks([20, 100, 1000, 10000, 20000], ["20", "100", "1k", "10k", "20k"])
    ax.set_xlabel("Frequency (Hz)")
    ax.grid(alpha=.2)
    ax.set_facecolor("#faf9f6")
    ax.spines[["top", "right"]].set_visible(False)
handles, labels = axes[0,0].get_legend_handles_labels()
fig.suptitle("IEM Designer: all 10 library drivers", x=.075, y=.988, ha="left", fontsize=21, fontweight="bold")
fig.text(.075, .965, "Deployed WASM 0.18.0 · 29 September 2026 · numerical examples, not validated physical predictions", fontsize=11)
fig.legend(handles, labels, loc="upper left", bbox_to_anchor=(.068, .953), ncol=3, frameon=False, fontsize=10)
fig.text(.075, .02, "Each driver uses its reference load: simplified 711, or a 2 cc cavity for 28UAP01. Source resistance is estimated.\nGrey shading is outside the available FR range; the application holds the endpoint value there.\nLevels retain each curve's measurement voltage. 17A003 and 28UAP01 need gain correction for comparison at 0.10 V.", fontsize=9, color="#555555", linespacing=1.5)
fig.subplots_adjust(left=.075, right=.975, bottom=.085, top=.918, hspace=.49, wspace=.19)
fig.savefig(sys.argv[2], dpi=150, facecolor=fig.get_facecolor())
