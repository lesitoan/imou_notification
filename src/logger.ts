function formatError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export function logError(context: string, error: unknown): void {
  console.error(`[${new Date().toISOString()}] ${context}: ${formatError(error)}`);
}
