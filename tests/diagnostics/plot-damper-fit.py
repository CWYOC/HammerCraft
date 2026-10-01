"""Plot legacy and fitted WASM outputs against the guide (numpy/matplotlib).
python tests/diagnostics/plot-damper-fit.py legacy.json fitted.json output.png
"""
import json
import sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
legacy, fitted = [json.loads(Path(p).read_text()) for p in sys.argv[1:3]]
guide = json.loads((Path(__file__).resolve().parents[1] / 'fixtures/sonion-2356-design-example.json').read_text())
def values(report, name):
    points = report['undamped'] if name == 'undamped' else next(s for s in report['scenarios'] if s['assumed_damper_distance_mm'] == 8.25)['damped']
    return np.array([p['db'] for p in points])
f = np.array([p['frequency'] for p in fitted['undamped']])
g = {name: np.interp(np.log(f), np.log([p['frequency'] for p in guide[name]]), [p['db'] for p in guide[name]]) for name in ['damped', 'undamped']}
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10})
fig, axes = plt.subplots(2, 1, figsize=(10.5, 8), sharex=True)
fig.patch.set_facecolor('#faf9f6')
axes[0].plot(f, g['undamped'], color='#717a83', label='Guide: undamped', lw=2)
axes[0].plot(f, g['damped'], color='#dc642e', label='Guide: 1500 Ω', lw=2.4)
axes[0].plot(f, values(fitted,'undamped'), color='#7b90a1', label='Model: undamped', ls=':', lw=2)
axes[0].plot(f, values(fitted,'damped'), color='#176593', label='Model: 1500 Ω (fitted)', ls='--', lw=2)
axes[0].plot(f, values(legacy,'damped'), color='#b15769', label='Previous model: 1500 Ω', ls='--', alpha=.7)
axes[0].set_ylim(90,122); axes[0].set_ylabel('SPL (dB)')
axes[0].legend(ncol=2, fontsize=8.5, loc='lower left', frameon=False)
axes[0].set_title('Published curves and predictions — no display smoothing or gain adjustment', loc='left', fontsize=10)
axes[1].plot(f, g['damped']-g['undamped'], color='#dc642e', lw=2.4, label='Guide damping change')
for report,color,label in [(fitted,'#176593','New fitted source + side-branch 711'),(legacy,'#b15769','Previous constant source + simplified 711')]:
    axes[1].plot(f,values(report,'damped')-values(report,'undamped'),color=color,ls='--',lw=2,label=label)
axes[1].set_ylim(-14,1);axes[1].set_ylabel('Damped − undamped (dB)');axes[1].set_xlabel('Frequency (Hz)')
axes[1].legend(fontsize=8.5,loc='lower left',frameon=False)
axes[1].set_title('Remaining mismatch is visible near 4.9 kHz',loc='left',fontsize=10)
for ax in axes:
    ax.set_xscale('log');ax.set_xlim(100,8000);ax.set_facecolor('#faf9f6');ax.grid(True,alpha=.25)
    ax.spines[['top','right']].set_visible(False)
axes[1].set_xticks([100,200,500,1000,2000,5000,8000],['100','200','500','1,000','2,000','5,000','8,000'])
fig.suptitle('Sonion 2356 · damper model update',x=.09,y=.97,ha='left',fontsize=18,weight='bold')
fig.text(.09,.925,'1500 acoustic Ω · 7 × 1.5 + 2.5 × 2.1 + 3 × 2.5 mm tubing · assumed position 8.25 mm',fontsize=10)
fig.text(.09,.03,'Source fitted to these magnitude curves: agreement here is a fit residual, not independent validation.\nDigitized Sonion Doc304 p.12; actual damper position and drive voltage unknown. Engine 0.25.0.',fontsize=8.5,color='#555')
fig.subplots_adjust(left=.09,right=.97,top=.86,bottom=.13,hspace=.25)
fig.savefig(sys.argv[3],dpi=150,facecolor=fig.get_facecolor())
