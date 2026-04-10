import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function appendApplyLog(filePath, entry) {
  mkdirSync(dirname(filePath), { recursive: true });
  const record = {
    timestamp: new Date().toISOString(),
    url: entry.url,
    company: entry.company ?? null,
    role: entry.role ?? null,
    language: entry.language ?? null,
    final_status: entry.finalStatus,
    gif_path: entry.gifPath ?? null,
    duration_ms: entry.durationMs ?? null,
    errors: entry.errors ?? [],
    notes: entry.notes ?? null,
  };
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}
