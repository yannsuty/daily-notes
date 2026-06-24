export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE_URL);

function normalizeApiBase(raw?: string): string {
  const trimmed = raw?.trim().replace(/\/$/, '') ?? '';
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function apiUrl(path: string): string {
  if (API_BASE) return `${API_BASE}${path}`;
  return path;
}
