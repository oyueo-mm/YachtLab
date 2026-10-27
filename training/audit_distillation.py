"""Audit fixed checkpoints and split artifacts after training; does not fit weights."""
import json,hashlib
from pathlib import Path
import torch
import numpy as np
from distill import Student,load_data,validate,ROOT,mix
OUT=ROOT/'training'
report=json.loads((OUT/'distillation-results.json').read_text())
data=json.loads((OUT/'distillation-data.json').read_text())
audit={'splitIntegrity':{},'fixedCheckpoints':{},'seedOverlap':{}}
for split in ['train','validation']:
    path=OUT/f'data/{split}.f32'
    actual=hashlib.sha256(path.read_bytes()).hexdigest()
    assert actual==data['splits'][split]['sha256']
    a=np.fromfile(path,dtype='<f4').reshape(-1,108);q=a[:,60:104]
    best=q.max(-1);ties=(best[:,None]-q<1e-4).sum(-1)
    audit['splitIntegrity'][split]={'rows':len(a),'sha256':actual,'tiedOptimalStates':int((ties>1).sum()),'allLegalMasks':bool(np.isfinite(q).any(-1).all()),'nearBonusStates':int(((a[:,106]>=50)&(a[:,106]<63)).sum())}
val=load_data('validation')
for name,path in [('Distilled Policy',f'bc-{report["selectedWidth"]}.pt'),('Distilled PPO','distilled-ppo.pt')]:
    m=Student(report['selectedWidth']);checkpoint=torch.load(OUT/'checkpoints'/path,weights_only=True);m.load_state_dict(checkpoint['model'])
    n=len(val[0]);same=0
    with torch.no_grad():
        for start in range(0,n,4096):
            s=slice(start,start+4096);d,_=m(val[0][s],val[2][s]);same+=(d.logits.argmax(-1)==val[1][s].argmax(-1)).sum().item()
    audit['fixedCheckpoints'][name]={**validate(m,val),'canonicalLowestIndexArgmaxAgreement':same/n,'actorParameters':sum(p.numel() for l in [m.layers[0],m.layers[2],m.actor] for p in l.parameters())}
train=set(mix(400000+i) for i in range(3600));validation=set(mix(500000+i) for i in range(400));selection=set(mix(600000+i) for i in range(160));final=set(mix(700000+i) for i in range(1000));old=set(mix(200000+i) for i in range(1000))
for name,left,right in [('train-validation',train,validation),('train-final',train,final),('validation-final',validation,final),('selection-final',selection,final),('v03-final',old,final)]:
    overlap=len(left&right);assert overlap==0;audit['seedOverlap'][name]=overlap
(OUT/'distillation-audit.json').write_text(json.dumps(audit,indent=2))
print(json.dumps(audit,indent=2))
