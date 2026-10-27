import { spawn } from "node:child_process";
for (const algorithm of [
  "DP Expert",
  "Random",
  "Greedy",
  "Expectimax",
  "MCTS",
  "PPO",
]) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/benchmark-ai.mjs", algorithm, "1000"],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) throw Error(`Benchmark failed: ${algorithm}`);
}
