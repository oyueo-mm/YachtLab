"""Real DP behavior cloning, architecture selection and masked PPO fine tuning.
Run node scripts/distill-data.mjs first; then python training/distill.py.
Large datasets/checkpoints stay local. The old PPO artifact is never overwritten.
"""
import json, math, time, hashlib
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical
from train import YachtEnv, KEYS

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'training'
torch.set_num_threads(2)
torch.manual_seed(404)
np.random.seed(404)
START=time.perf_counter()

def mix(x):
    x=(x^(x>>16))&0xffffffff;x=x*0x85ebca6b&0xffffffff
    x=(x^(x>>13))*0xc2b2ae35&0xffffffff
    return (x^(x>>16))&0xffffffff

class CanonicalEnv(YachtEnv):
    def observe(self):
        dice=self.dice
        self.dice=sorted(dice)
        obs=super().observe()
        self.dice=dice
        return obs
    def step(self,action):
        if action<32:
            order=sorted(range(5),key=lambda i:(self.dice[i],i))
            action=sum(1<<order[i] for i in range(5) if action&(1<<i))
        return super().step(action)

class Student(nn.Module):
    def __init__(self,width):
        super().__init__();self.width=width
        self.layers=nn.Sequential(nn.Linear(60,width),nn.Tanh(),nn.Linear(width,width),nn.Tanh())
        self.actor=nn.Linear(width,44);self.critic=nn.Linear(width,1)
    def forward(self,obs,mask):
        h=self.layers(obs);logits=self.actor(h).masked_fill(~mask,-1e9)
        return Categorical(logits=logits),self.critic(h).squeeze(-1)

def load_data(split):
    a=np.fromfile(OUT/f'data/{split}.f32',dtype='<f4').reshape(-1,108)
    obs=torch.from_numpy(a[:,:60].copy());q=torch.from_numpy(a[:,60:104].copy())
    mask=q.isfinite();best=q.max(-1).values;opt=mask&((best[:,None]-q)<1e-4)
    soft=torch.softmax(q/1.5,-1)
    return obs,q,mask,opt,soft

def bc_loss(dist,opt,soft):
    # All symmetric/tied optimal actions are accepted, avoiding arbitrary ID labels.
    best_set=-torch.logsumexp(dist.logits.masked_fill(~opt,-1e9),-1).mean()
    return best_set+.1*(-soft*dist.logits).sum(-1).mean()

def validate(model,data):
    obs,q,mask,opt,_=data;n=len(obs);hits=top3=regret=0.
    with torch.no_grad():
        for start in range(0,n,4096):
            s=slice(start,start+4096);dist,_=model(obs[s],mask[s]);a=dist.logits.argmax(-1)
            hits+=opt[s].gather(1,a[:,None]).sum().item()
            top3+=opt[s].gather(1,dist.logits.topk(3,-1).indices).any(-1).sum().item()
            regret+=(q[s].max(-1).values-q[s].gather(1,a[:,None]).squeeze(1)).sum().item()
    return {'states':n,'top1Equivalent':hits/n,'top3Equivalent':top3/n,'meanDPRegret':regret/n}

def games_eval(model,n=160):
    scores=[]
    with torch.no_grad():
        for i in range(n):
            env=CanonicalEnv(mix(600000+i))
            while True:
                dist,_=model(torch.tensor([env.observe()],dtype=torch.float32),torch.tensor([env.mask()]))
                _,_,done=env.step(dist.logits.argmax(-1).item())
                if done:
                    scores.append(sum(env.card)+(35 if sum(env.card[:6])>=63 else 0));break
    return {'games':n,'seedStart':600000,'mean':float(np.mean(scores)),'scores':scores}

def export(model,name,steps,metrics):
    env=CanonicalEnv(123)
    with torch.no_grad():d,_=model(torch.tensor([env.observe()],dtype=torch.float32),torch.tensor([env.mask()]))
    layers=[model.layers[0],model.layers[2],model.actor]
    artifact={'format':2,'algorithm':name,'observationVersion':'canonical-sorted-v2','observationSize':60,'actionSize':44,'width':model.width,'steps':steps,'seed':404,'layers':[{'weight':l.weight.detach().tolist(),'bias':l.bias.detach().tolist()} for l in layers], 'fixture':{'dice':env.dice,'rolls':env.rolls,'card':{},'probabilities':d.probs[0].tolist()},'validation':metrics}
    path=ROOT/'src'/('distilled-policy.json' if name=='Distilled Policy' else 'distilled-ppo.json')
    path.write_text(json.dumps(artifact,separators=(',',':')),encoding='utf-8')
    return {'file':path.relative_to(ROOT).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

def ppo(model,steps,label,anchor=None):
    envs=[CanonicalEnv(mix(900000+i)) for i in range(64)]
    optimizer=torch.optim.Adam(model.parameters(),lr=1e-4 if anchor else 3e-4)
    logs=[];best=-math.inf;checkpoint=None;n=64;horizon=64;steps_done=0
    for update in range(math.ceil(steps/(n*horizon))):
        observations=[];masks=[];actions=[];logps=[];values=[];rewards=[];dones=[]
        with torch.no_grad():
            for _ in range(horizon):
                obs=torch.tensor([e.observe() for e in envs],dtype=torch.float32);mask=torch.tensor([e.mask() for e in envs])
                dist,v=model(obs,mask);a=dist.sample();batch=[e.step(x) for e,x in zip(envs,a.tolist())]
                observations.append(obs);masks.append(mask);actions.append(a);logps.append(dist.log_prob(a));values.append(v)
                rewards.append(torch.tensor([b[1] for b in batch]));dones.append(torch.tensor([b[2] for b in batch]))
                for e,b in zip(envs,batch):
                    if b[2]:e.reset()
            _,next_v=model(torch.tensor([e.observe() for e in envs],dtype=torch.float32),torch.tensor([e.mask() for e in envs]))
        adv=torch.zeros(n);advantages=[]
        for t in reversed(range(horizon)):
            live=(~dones[t]).float();delta=rewards[t]+live*next_v-values[t]
            adv=delta+.95*live*adv;advantages.insert(0,adv);next_v=values[t]
        obs=torch.cat(observations);mask=torch.cat(masks);action=torch.cat(actions);old=torch.cat(logps)
        advantages=torch.cat(advantages);returns=advantages+torch.cat(values)
        advantages=(advantages-advantages.mean())/(advantages.std()+1e-8)
        pg_total=v_total=entropy_total=count=0
        for _ in range(4):
            for ix in torch.randperm(n*horizon).split(256):
                dist,v=model(obs[ix],mask[ix]);ratio=(dist.log_prob(action[ix])-old[ix]).exp()
                pg=-torch.minimum(ratio*advantages[ix],ratio.clamp(.8,1.2)*advantages[ix]).mean()
                vl=(v-returns[ix]).square().mean();ent=dist.entropy().mean()
                loss=pg+.5*vl-.003*ent
                if anchor:
                    idx=torch.randint(len(anchor[0]),(256,));ad,_=model(anchor[0][idx],anchor[2][idx])
                    loss+=.05*bc_loss(ad,anchor[3][idx],anchor[4][idx])
                optimizer.zero_grad();loss.backward();nn.utils.clip_grad_norm_(model.parameters(),.5);optimizer.step()
                pg_total+=pg.item();v_total+=vl.item();entropy_total+=ent.item();count+=1
        steps_done+=n*horizon
        row={'steps':steps_done,'policyLoss':pg_total/count,'valueLoss':v_total/count,'entropy':entropy_total/count,'seconds':time.perf_counter()-START}
        if (update+1)%8==0:
            ev=games_eval(model);row['validationMean']=ev['mean']
            if ev['mean']>best:best=ev['mean'];checkpoint={k:v.clone() for k,v in model.state_dict().items()};best_steps=steps_done
            print(label,steps_done,ev['mean'],flush=True)
        logs.append(row)
        (OUT/f'{label}-log.json').write_text(json.dumps(logs,indent=2))
    if checkpoint:model.load_state_dict(checkpoint)
    torch.save({'model':model.state_dict(),'steps':best_steps,'optimizer':optimizer.state_dict()},OUT/f'checkpoints/{label}.pt')
    return best_steps,logs

def main():
    (OUT/'checkpoints').mkdir(exist_ok=True)
    train=load_data('train');val=load_data('validation');results=[];winner=None;best=math.inf
    for width in [64,128]:
        model=Student(width);optimizer=torch.optim.Adam(model.parameters(),lr=1e-3)
        logs=[];minimum=math.inf;patience=0;best_model=None
        for epoch in range(1,36):
            running=0.;count=0
            for idx in torch.randperm(len(train[0])).split(1024):
                d,_=model(train[0][idx],train[2][idx]);loss=bc_loss(d,train[3][idx],train[4][idx])
                optimizer.zero_grad();loss.backward();nn.utils.clip_grad_norm_(model.parameters(),1);optimizer.step()
                running+=loss.item()*len(idx);count+=len(idx)
            metric=validate(model,val);metric.update({'epoch':epoch,'loss':running/count,'seconds':time.perf_counter()-START});logs.append(metric)
            print('BC',width,epoch,round(metric['meanDPRegret'],3),round(metric['top1Equivalent'],3),flush=True)
            if metric['meanDPRegret']<minimum-.001:
                minimum=metric['meanDPRegret'];patience=0;best_model={k:v.clone() for k,v in model.state_dict().items()};best_epoch=epoch
            else:patience+=1
            (OUT/f'bc-{width}-log.json').write_text(json.dumps(logs,indent=2))
            if patience>=6:break
        model.load_state_dict(best_model);metric=validate(model,val);evaluation=games_eval(model)
        results.append({'width':width,'bestEpoch':best_epoch,'epochs':len(logs),'validation':metric,'validationGames':evaluation})
        torch.save({'model':best_model,'width':width,'epoch':best_epoch},OUT/f'checkpoints/bc-{width}.pt')
        if minimum<best:best=minimum;winner=model
    student=winner;before=validate(student,val);before['games']=games_eval(student)
    selected=next(r for r in results if r['width']==student.width)
    bc_updates=selected['bestEpoch']*math.ceil(len(train[0])/1024)
    artifacts={'policy':export(student,'Distilled Policy',bc_updates,before)}
    steps,logs=ppo(student,262144,'distilled-ppo',train)
    after=validate(student,val);after['games']=games_eval(student)
    artifacts['ppo']=export(student,'Distilled PPO',steps,after)
    control=Student(student.width);control_steps,_=ppo(control,262144,'random-init-ppo')
    report={'seed':404,'architectures':results,'selectedWidth':student.width,'selection':'minimum validation DP regret; PPO checkpoint chosen by 160 validation games, never final-test data','behaviorCloning':{'temperature':1.5,'optimalTolerance':1e-4,'epochsMax':35,'earlyStopPatience':6,'batchSize':1024,'learningRate':.001,'loss':'negative log mass of all equivalent DP optima + 0.1 soft-target cross entropy'},'ppo':{'stepsExecuted':262144,'checkpointSteps':steps,'environments':64,'horizon':64,'epochs':4,'minibatch':256,'gamma':1,'gaeLambda':.95,'clip':.2,'entropy':.003,'gradientClip':.5,'learningRate':.0001,'teacherRegularizer':.05,'reward':'real score and upper bonus delta /100'},'before':before,'after':after,'randomInitControl':{'stepsExecuted':262144,'checkpointSteps':control_steps,'learningRate':.0003,'teacherRegularizer':0,'validation':validate(control,val),'games':games_eval(control)},'artifacts':artifacts,'seconds':time.perf_counter()-START}
    (OUT/'distillation-results.json').write_text(json.dumps(report,indent=2))
    print('DONE',report['seconds'],before['games']['mean'],after['games']['mean'],flush=True)

if __name__=='__main__':main()
