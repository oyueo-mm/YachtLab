"""Render actual recorded training logs, with no interpolation or synthetic samples."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1]
read=lambda p:json.loads((ROOT/p).read_text())
fig,ax=plt.subplots(2,2,figsize=(12,8),layout='constrained')
for width,color in [(64,'#d93636'),(128,'#315878')]:
    log=read(f'training/bc-{width}-log.json');epochs=[x['epoch'] for x in log]
    ax[0,0].plot(epochs,[100*x['top1Equivalent'] for x in log],label=f'{width} x {width}',color=color)
    ax[0,1].plot(epochs,[x['meanDPRegret'] for x in log],label=f'{width} x {width}',color=color)
report=read('training/distillation-results.json')
for name,color,label in [('distilled-ppo','#d93636','BC initialized PPO'),('random-init-ppo','#315878','Random initialized PPO')]:
    log=read(f'training/{name}-log.json');check=[x for x in log if 'validationMean' in x]
    ax[1,0].plot([x['steps'] for x in check],[x['validationMean'] for x in check],marker='o',label=label,color=color)
    ax[1,1].plot([x['steps'] for x in log],[x['entropy'] for x in log],label=label,color=color)
ax[1,0].axhline(report['before']['games']['mean'],linestyle='--',color='#555',label='BC checkpoint')
for a,title,x,y in [(ax[0,0],'Held-out teacher actions','BC epoch','Equivalent optimal action accuracy (%)'),(ax[0,1],'Held-out DP regret','BC epoch','Mean DP value loss (points)'),(ax[1,0],'Independent validation games (n=160)','Environment steps','Mean final score'),(ax[1,1],'Masked policy entropy','Environment steps','Entropy (nats)')]:
    a.set(title=title,xlabel=x,ylabel=y);a.grid(alpha=.2);a.legend(fontsize=8)
fig.suptitle('YachtLab v0.4 | actual training and validation logs | seed 404')
for suffix in ['svg','png']:fig.savefig(ROOT/f'benchmarks/v04/learning-curves.{suffix}',dpi=160)
