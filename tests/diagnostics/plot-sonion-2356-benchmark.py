"""Plot the benchmark JSON; requires matplotlib and numpy, outside the app runtime.

python plot-sonion-2356-benchmark.py benchmark.json output.png
"""
import json
from pathlib import Path
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

report = json.loads(Path(sys.argv[1]).read_text())
example = json.loads((Path(__file__).resolve().parent.parent / "fixtures/sonion-2356-design-example.json").read_text())
frequencies = np.array([p["frequency"] for p in report["undamped"]])
undamped = np.array([p["db"] for p in report["undamped"]])
scenarios = report["scenarios"]
selected = next(s for s in scenarios if s["assumed_damper_distance_mm"] == 8.25)
damped = np.array([p["db"] for p in selected["damped"]])
all_damped = np.array([[p["db"] for p in s["damped"]] for s in scenarios])

def sampled(name):
    curve = example[name]
    return np.interp(np.log10(frequencies), np.log10([p["frequency"] for p in curve]), [p["db"] for p in curve])

guide_undamped, guide_damped = sampled("undamped"), sampled("damped")
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
fig, axes = plt.subplots(2, 1, figsize=(10.8, 8.2), sharex=True, gridspec_kw={"height_ratios": [1.15, 1]})
fig.patch.set_facecolor("#faf9f6")
guide_color, model_color = "#d45427", "#22679b"
axes[0].plot(frequencies, guide_undamped, color="#494c51", lw=2, label="Sonion guide · undamped")
axes[0].plot(frequencies, guide_damped, color=guide_color, lw=2.5, label="Sonion guide · 1500 Ω")
axes[0].plot(frequencies, undamped, color="#697fa0", lw=1.8, ls="--", label="Current model · undamped")
axes[0].plot(frequencies, damped, color=model_color, lw=2.2, ls="--", label="Current model · 1500 Ω at 8.25 mm (assumed)")
axes[0].set_ylabel("SPL (dB)")
axes[0].set_title("Absolute level: no gain fit or normalization", loc="left", fontsize=11, pad=10)
axes[0].legend(loc="lower left", ncol=2, fontsize=8.5, frameon=False)
axes[0].set_ylim(92, 123)
axes[1].plot(frequencies, guide_damped - guide_undamped, color=guide_color, lw=2.5, label="Sonion guide · damping change")
axes[1].plot(frequencies, damped - undamped, color=model_color, lw=2.2, ls="--", label="Current model · damping change at 8.25 mm")
axes[1].fill_between(frequencies, all_damped.min(axis=0) - undamped, all_damped.max(axis=0) - undamped,
                     color=model_color, alpha=.14, label="Range across four assumed positions: 7–12.5 mm")
axes[1].axhline(0, color="#777777", lw=.8)
axes[1].set_ylabel("Damped − undamped (dB)")
axes[1].set_title("Damping effect: the model misses the stronger peak reduction", loc="left", fontsize=11, pad=10)
axes[1].legend(loc="lower left", fontsize=8.5, frameon=False)
axes[1].set_ylim(-16, 1)
axes[1].set_xlabel("Frequency (Hz)")
for ax in axes:
    ax.set_xscale("log")
    ax.set_xlim(100, 8000)
    ax.set_facecolor("#faf9f6")
    ax.grid(True, which="major", color="#d6d7d7", lw=.6)
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["bottom", "left"]].set_color("#aaaaaa")
axes[1].set_xticks([100, 200, 500, 1000, 2000, 5000, 8000], ["100", "200", "500", "1,000", "2,000", "5,000", "8,000"])
fig.suptitle("Sonion 2356: current model vs published example", x=.085, y=.975, ha="left", fontsize=17, weight="bold")
fig.text(.085, .934, "Tubes: 7 × 1.5 + 2.5 × 2.1 + 3 × 2.5 mm (length × ID)  |  Damper: 1500 CGS acoustic Ω", fontsize=10)
fig.text(.085, .029, "Guide curves digitized from Sonion Doc 304, p.12; approximate, magnitude only. Exact damper position and drive level unknown.\nModel: WASM 0.18.0, estimated receiver resistance + simplified 711. This comparison does not establish physical calibration.", fontsize=8, color="#555555", linespacing=1.5)
fig.subplots_adjust(left=.085, right=.965, top=.872, bottom=.115, hspace=.30)
fig.savefig(sys.argv[2], dpi=160, facecolor=fig.get_facecolor())
