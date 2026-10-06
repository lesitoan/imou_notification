import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { log, logError } from "./logger.js";

async function cleanupRoot(root: string, cutoff: number, activePath: string | null): Promise<number> {
  let deleted = 0;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      deleted += await cleanupRoot(fullPath, cutoff, activePath);
      try {
        const remaining = await readdir(fullPath);
        if (remaining.length === 0) await rm(fullPath, { recursive: false });
      } catch (error) {
        logError(`Cleanup directory failed (${fullPath})`, error);
      }
      continue;
    }
    if (!entry.isFile() || fullPath === activePath) continue;

    try {
      const info = await stat(fullPath);
      if (info.mtimeMs < cutoff) {
        await rm(fullPath);
        deleted += 1;
      }
    } catch (error) {
      logError(`Cleanup file failed (${fullPath})`, error);
    }
  }
  return deleted;
}

export async function runCleanup(activePath: string | null): Promise<void> {
  const cutoff = Date.now() - config.retention.days * 24 * 60 * 60 * 1000;
  try {
    const results = await Promise.all([
      cleanupRoot(config.recording.path, cutoff, activePath),
      cleanupRoot(config.recording.snapshotPath, cutoff, null),
    ]);
    log(`Cleanup complete: deleted ${results[0] + results[1]} old file(s)`);
  } catch (error) {
    logError("Cleanup failed", error);
  }
}
