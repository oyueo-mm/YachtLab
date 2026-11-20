# 논문·기술 출처 및 적용 경계

이 문서는 **알고리즘을 연구할 근거**를 제공한다. 논문 속의 성능 수치가 YachtLab 12카테고리 규칙에서 검증됐다는 뜻은 아니다. 가능한 경우 저자/학회 원 출처를 우선한다.

## 요트다이스·Yahtzee 확률 최적화

1. **Jakub Pawlewicz (2011)**, *Towards Optimal Play in Multi-Player Yahtzee*, ICGA Journal. https://doi.org/10.3233/ICG-2011-34103
   - 기대 총점을 최대화하는 전략과 다인전 승리 확률 최대화가 다르다는 출발점. 앞설 때 보수적/뒤질 때 공격적인 선택의 이론적 중요성.
   - 2010년 프리프린트: https://www.mimuw.edu.pl/~pan/papers/yahtzee.pdf
2. **James Glenn (2006)**, *An Optimal Strategy for Yahtzee*. https://gunpowder.cs.loyola.edu/~jglenn/research/optimal_yahtzee.pdf
   - 전체 게임 동적 계획법/벨만 최적화의 기본 아이디어. **미국식 규칙**의 카테고리·보너스를 Nintendo Yacht로 직접 가져오지 말 것.
3. **Nicholas A. Pape** (arXiv:2601.00007), *Yahtzee: Reinforcement Learning Techniques for Stochastic Combinatorial Games*. https://arxiv.org/abs/2601.00007
   - REINFORCE/A2C/PPO 등 강화학습 비교. 규칙 차이와 평가 기준을 확인한 뒤 재현.
4. **YachtLab 직접 구현**: [점수판](../../src/engine.ts), [DP Bellman 상세](../../training/dp/README.md), [실험 요약](./RESULTS.md).

## 확률 강화학습·가치 분포

5. **Dabney et al. (2018)**, *Distributional Reinforcement Learning with Quantile Regression (QR-DQN)*, AAAI. https://ojs.aaai.org/index.php/AAAI/article/view/11791
6. **Dabney et al. (2018)**, *Implicit Quantile Networks for Distributional Reinforcement Learning*, ICML/PMLR. https://proceedings.mlr.press/v80/dabney18a.html
7. **Rainbow**: Hessel et al., *Rainbow: Combining Improvements in Deep Reinforcement Learning*, AAAI 2018. https://arxiv.org/abs/1710.02298
8. **PPO**: Schulman et al., *Proximal Policy Optimization Algorithms*. https://arxiv.org/abs/1707.06347
9. **DQN / Double / Dueling**: https://arxiv.org/abs/1312.5602 , https://arxiv.org/abs/1509.06461 , https://arxiv.org/abs/1511.06581

## 확률 탐색·계획·자기 대국

10. **Antonoglou et al. (2022)**, *Planning in Stochastic Environments with a Learned Model (Stochastic MuZero)*, ICLR. https://mlanthology.org/iclr/2022/antonoglou2022iclr-planning/
    - 백개먼 같은 주사위 게임에서 확률 전이를 반영해 계획을 세우는 방법론. YachtLab은 **확률 모델을 이미 정확히 알기 때문에** 학습된 환경 모델이 반드시 필요하지 않음.
11. **Silver et al. (2017)**, *Mastering the Game of Go without Human Knowledge (AlphaGo Zero)*. https://www.nature.com/articles/nature24270
    - 자기 대국 + 가치/정책망 + MCTS의 개념. Go는 결정론적 게임, 주사위 chance node가 추가로 필요.
12. **Lanctot et al. (2017)**, *A Unified Game-Theoretic Approach to Multiagent Reinforcement Learning (PSRO)*. https://mlanctot.info/files/papers/nips17-psro.pdf
13. **Bighashdel et al. (2024)**, *Policy Space Response Oracles: A Survey*, IJCAI. https://ijcai.org/proceedings/2024/880
    - 여러 상대 정책에 대한 최적 대응/균형 접근. YachtLab에서 자체적으로 입증된 방법은 아님.

## 실험·공정성

- 연구 대상은 **Nintendo-like 12-category Yacht Dice**. 미국식 Yahtzee의 13개 항목·추가 Yahtzee 100점/Joker를 혼용하지 않는다.
- 승률 우위는 같은 상대 정책 및 동일한 컴퓨팅 예산에서의 독립 실험을 통해 측정해야 한다.
- 위 논문 중 다수는 다른 게임과 다른 학습 보상을 사용한다. **문헌에서 강했다고 해서 YachtLab에서도 강한 것은 아니다.**
