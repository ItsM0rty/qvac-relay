/** Bounded native-startup diagnostics, without dumping arbitrary SDK request payloads. */
export function errorDetails(value: unknown, depth = 0): unknown {
  if (!(value instanceof Error)) return String(value).slice(0, 2000);
  const extra = value as Error & { code?: unknown; workerExited?: unknown; exitCode?: unknown; exitSignal?: unknown; stderrTail?: unknown };
  return {
    name: value.name, message: value.message.slice(0, 4000), code: extra.code,
    workerExited: extra.workerExited, exitCode: extra.exitCode, exitSignal: extra.exitSignal,
    ...(typeof extra.stderrTail === 'string' ? { stderrTail: extra.stderrTail.slice(-8192) } : {}),
    ...(depth < 3 && value.cause !== undefined ? { cause: errorDetails(value.cause, depth + 1) } : {}),
  };
}
