"""Dependency: PyTorch. python training/train.py --steps 131072

44 actions: 0..31 hold masks by stable die ID, 32..43 score categories.
The environment automatically rolls at the beginning of each turn. Rewards are
score deltas (including bonus) / 100. The exported JSON is a browser-native MLP.
"""
import argparse
import json
import math
from pathlib import Path
import time
import torch
from torch import nn
from torch.distributions import Categorical

ROOT = Path(__file__).resolve().parents[1]
KEYS = ['aces', 'deuces', 'threes', 'fours', 'fives', 'sixes', 'choice', 'four', 'full', 'small', 'large', 'yacht']


def score(values, category):
    counts = [values.count(i) for i in range(1, 7)]
    if category < 6:
        return counts[category] * (category + 1)
    if category == 6:
        return sum(values)
    if category == 7:
        return sum(values) if max(counts) >= 4 else 0
    if category == 8:
        return sum(values) if 3 in counts and 2 in counts else 0
    if category == 9:
        return 15 if any(all(v in values for v in range(start, start + 4)) for start in [1, 2, 3]) else 0
    if category == 10:
        return 30 if any(all(v in values for v in range(start, start + 5)) for start in [1, 2]) else 0
    return 50 if max(counts) == 5 else 0


class YachtEnv:
    def __init__(self, seed=42):
        self.seed = seed
        self.reset()

    def rand(self):
        self.seed = (1664525 * self.seed + 1013904223) & 0xffffffff
        return 1 + math.floor(self.seed / 4294967296 * 6)

    def reset(self):
        self.card = [None] * 12
        self.dice = [self.rand() for _ in range(5)]
        self.rolls = 1
        return self.observe()

    def observe(self):
        one_hot = [int(value == face) for value in self.dice for face in range(1, 7)]
        upper = sum(value or 0 for value in self.card[:6])
        return one_hot + [int(self.rolls == n) for n in range(4)] + [int(v is not None) for v in self.card] + [(v or 0) / 50 for v in self.card] + [min(upper, 98) / 63, self.card.count(None) / 12]

    def mask(self):
        return [self.rolls < 3] * 32 + [v is None for v in self.card]

    def step(self, action):
        if not self.mask()[action]:
            raise ValueError('Illegal action')
        if action < 32:
            self.dice = [v if action & (1 << i) else self.rand() for i, v in enumerate(self.dice)]
            self.rolls += 1
            return self.observe(), 0., False
        category = action - 32
        upper = sum(v or 0 for v in self.card[:6])
        points = score(self.dice, category)
        self.card[category] = points
        after = sum(v or 0 for v in self.card[:6])
        reward = (points + (35 if upper < 63 <= after else 0)) / 100
        done = None not in self.card
        if not done:
            self.dice = [self.rand() for _ in range(5)]
            self.rolls = 1
        return self.observe(), reward, done


class Network(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(nn.Linear(60, 64), nn.Tanh(), nn.Linear(64, 64), nn.Tanh())
        self.actor = nn.Linear(64, 44)
        self.critic = nn.Linear(64, 1)

    def forward(self, obs, mask):
        h = self.layers(obs)
        logits = self.actor(h).masked_fill(~mask, -1e9)
        return Categorical(logits=logits), self.critic(h).squeeze(-1)


def evaluate(model, games=100):
    scores, bonuses, yachts = [], [], []
    for game in range(games):
        env = YachtEnv(100000 + game)
        while True:
            with torch.no_grad():
                dist, _ = model(torch.tensor([env.observe()], dtype=torch.float32), torch.tensor([env.mask()]))
                action = dist.logits.argmax(-1).item()
            _, _, done = env.step(action)
            if done:
                upper = sum(env.card[:6])
                scores.append(sum(env.card) + (35 if upper >= 63 else 0))
                bonuses.append(upper >= 63)
                yachts.append(env.card[-1] == 50)
                break
    return {'games': games, 'seedStart': 100000, 'mean': sum(scores) / games, 'min': min(scores), 'max': max(scores), 'bonusRate': sum(bonuses) / games, 'yachtRate': sum(yachts) / games, 'scores': scores}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--steps', type=int, default=131072)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    torch.set_num_threads(2)
    torch.manual_seed(args.seed)
    model = Network()
    optimizer = torch.optim.Adam(model.parameters(), lr=3e-4)
    envs = [YachtEnv(args.seed + i * 1009) for i in range(64)]
    horizon, n = 64, 64
    start = time.perf_counter()
    steps = 0
    for update in range(max(1, math.ceil(args.steps / (horizon * n)))):
        observations, masks, actions, logs, values, rewards, dones = [], [], [], [], [], [], []
        with torch.no_grad():
            for _ in range(horizon):
                obs = torch.tensor([e.observe() for e in envs], dtype=torch.float32)
                mask = torch.tensor([e.mask() for e in envs])
                dist, value = model(obs, mask)
                action = dist.sample()
                batch = [e.step(a) for e, a in zip(envs, action.tolist())]
                observations.append(obs); masks.append(mask); actions.append(action)
                logs.append(dist.log_prob(action)); values.append(value)
                rewards.append(torch.tensor([b[1] for b in batch])); dones.append(torch.tensor([b[2] for b in batch]))
                for e, b in zip(envs, batch):
                    if b[2]:
                        e.reset()
            _, next_value = model(torch.tensor([e.observe() for e in envs], dtype=torch.float32), torch.tensor([e.mask() for e in envs]))
        advantage = torch.zeros(n)
        advantages = []
        for t in reversed(range(horizon)):
            live = (~dones[t]).float()
            delta = rewards[t] + next_value * live - values[t]
            advantage = delta + .95 * live * advantage  # gamma=1, lambda=.95
            advantages.insert(0, advantage)
            next_value = values[t]
        obs = torch.cat(observations); mask = torch.cat(masks); action = torch.cat(actions)
        old_logs = torch.cat(logs); old_value = torch.cat(values)
        adv = torch.cat(advantages); returns = adv + old_value
        adv = (adv - adv.mean()) / (adv.std() + 1e-8)
        for _ in range(4):
            permutation = torch.randperm(horizon * n)
            for indices in permutation.split(256):
                dist, predicted = model(obs[indices], mask[indices])
                ratio = (dist.log_prob(action[indices]) - old_logs[indices]).exp()
                policy_loss = -torch.minimum(ratio * adv[indices], ratio.clamp(.8, 1.2) * adv[indices]).mean()
                loss = policy_loss + .5 * (predicted - returns[indices]).square().mean() - .01 * dist.entropy().mean()
                optimizer.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), .5); optimizer.step()
        steps += horizon * n
        if (update + 1) % 4 == 0:
            print(f'PPO steps={steps} elapsed={time.perf_counter() - start:.1f}s', flush=True)
    checkpoint = ROOT / 'training/checkpoints'
    checkpoint.mkdir(exist_ok=True)
    torch.save({'model': model.state_dict(), 'optimizer': optimizer.state_dict(), 'steps': steps, 'seed': args.seed}, checkpoint / 'ppo.pt')
    layers = [model.layers[0], model.layers[2], model.actor]
    fixture_env = YachtEnv(123)
    with torch.no_grad():
        dist, _ = model(torch.tensor([fixture_env.observe()], dtype=torch.float32), torch.tensor([fixture_env.mask()]))
    export = {'format': 1, 'algorithm': 'PPO', 'steps': steps, 'seed': args.seed, 'observationSize': 60, 'actionSize': 44, 'layers': [{'weight': l.weight.detach().tolist(), 'bias': l.bias.detach().tolist()} for l in layers], 'fixture': {'dice': fixture_env.dice, 'rolls': fixture_env.rolls, 'card': {}, 'probabilities': dist.probs[0].tolist()}}
    (ROOT / 'src/ppo-model.json').write_text(json.dumps(export, separators=(',', ':')), encoding='utf-8')
    metrics = evaluate(model)
    metrics.update({'steps': steps, 'trainingSeed': args.seed, 'trainingSeconds': time.perf_counter() - start, 'note': 'Early training baseline; no claim of superiority. Deterministic argmax evaluation.'})
    (ROOT / 'training/evaluation.json').write_text(json.dumps(metrics, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in metrics.items() if k != 'scores'}), flush=True)


if __name__ == '__main__':
    main()
