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

/** Données internes Merlin (non affichées à l'utilisateur). */
export interface MerlinAppPayload {
  tool?: {
    name: string;
    args?: Record<string, unknown>;
  };
}

export interface ParsedAgentTurn {
  reply: string | null;
  toolCall: ToolCallPayload | null;
  app: MerlinAppPayload | null;
  isStructured: boolean;
}

function normalizeToolArgsFromUnknown(args?: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!args) return normalized;
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (typeof value === 'object') {
      normalized[key] = JSON.stringify(value);
    } else {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

function toolPayloadFromRoot(parsed: Record<string, unknown>): ToolCallPayload | null {
  if (parsed.action === 'tool' && typeof parsed.name === 'string' && parsed.name.trim()) {
    return {
      action: 'tool',
      name: parsed.name.trim(),
      args: normalizeToolArgsFromUnknown(
        (parsed.args as Record<string, unknown> | undefined) ?? undefined,
      ),
    };
  }
  return null;
}

/**
 * Parse une réponse Merlin : texte utilisateur + bloc app optionnel (outil, etc.).
 * Rétrocompatible avec l'ancien JSON outil seul `{"action":"tool",...}`.
 */
export function parseAgentTurn(text: string): ParsedAgentTurn {
  const trimmed = text.trim();
  if (!trimmed) {
    return { reply: null, toolCall: null, app: null, isStructured: false };
  }

  const parsed = parseJsonFromAi<Record<string, unknown>>(trimmed);
  if (parsed && typeof parsed === 'object') {
    const replyRaw = parsed.message ?? parsed.reply;
    const reply =
      typeof replyRaw === 'string' && replyRaw.trim() ? replyRaw.trim() : null;

    const app = (parsed.app as MerlinAppPayload | undefined) ?? null;
    let toolCall: ToolCallPayload | null = null;

    if (app?.tool?.name?.trim()) {
      toolCall = {
        action: 'tool',
        name: app.tool.name.trim(),
        args: normalizeToolArgsFromUnknown(app.tool.args),
      };
    } else {
      toolCall = toolPayloadFromRoot(parsed);
    }

    if (reply || toolCall || app) {
      return { reply, toolCall, app, isStructured: true };
    }
  }

  const legacyParsed = parseJsonFromAi<Record<string, unknown>>(trimmed);
  const legacyTool = legacyParsed ? toolPayloadFromRoot(legacyParsed) : null;
  if (legacyTool) {
    return { reply: null, toolCall: legacyTool, app: null, isStructured: true };
  }

  return { reply: trimmed, toolCall: null, app: null, isStructured: false };
}

export function parseToolCall(text: string): ToolCallPayload | null {
  return parseAgentTurn(text).toolCall;
}

const TOOL_USER_HINTS: Record<string, string> = {
  create_space: 'Je prépare l’espace dans Galerie…',
  update_space: 'Je mets à jour l’espace…',
  show_space: 'Je consulte l’espace…',
  list_spaces: 'Je parcours vos espaces…',
  web_search: 'Je recherche sur le web…',
  fetch_page: 'Je lis la page…',
  create_list: 'Je crée la liste…',
  add_list_item: 'J’ajoute à la liste…',
  create_reminder: 'Je crée le rappel…',
  read_journal: 'Je consulte le journal…',
  search_journal: 'Je cherche dans le journal…',
};

/**
 * Texte à afficher ou sauvegarder pour l'utilisateur (jamais le JSON brut d'outil).
 */
export function formatAgentReplyForUser(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const turn = parseAgentTurn(trimmed);
  if (turn.reply) return turn.reply;

  if (turn.toolCall) {
    return TOOL_USER_HINTS[turn.toolCall.name] ?? 'Je traite votre demande…';
  }

  if (turn.isStructured && trimmed.startsWith('{')) {
    return 'Je traite votre demande…';
  }

  return trimmed;
}
