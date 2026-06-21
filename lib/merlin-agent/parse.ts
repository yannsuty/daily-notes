export function parseJsonFromAi<T>(raw: string): T | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim()) as T;
      } catch {
        return null;
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export interface ToolCallPayload {
  action: 'tool';
  name: string;
  args?: Record<string, string>;
}

export function parseToolCall(text: string): ToolCallPayload | null {
  const parsed = parseJsonFromAi<ToolCallPayload>(text);
  if (parsed?.action === 'tool' && parsed.name) {
    return parsed;
  }
  return null;
}
