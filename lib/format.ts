/** Human-readable byte size. Safe to import from both server and client. */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return i === 0 ? `${value} ${units[i]}` : `${value.toFixed(1)} ${units[i]}`;
}
