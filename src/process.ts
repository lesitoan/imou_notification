import { spawn } from "node:child_process";

export async function runProcess(command: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(stdout);
    };
    const abort = () => { child.kill("SIGKILL"); finish(new Error(`${command} aborted`)); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error(`${command} timed out`)); }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", chunk => { if (stdout.length < 128_000) stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once("error", error => finish(error));
    child.once("close", code => finish(code === 0 ? undefined : new Error(`${command} exited ${code}: ${stderr}`)));
  });
}
