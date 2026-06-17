import { chatCompletion, parseJsonFromAi, type ChatMessage } from './ai-provider';
import {
  appendMerlinMessage,
  getMerlinConversation,
  getMerlinFacts,
  saveMerlinFact,
  saveMerlinFacts,
  updateMerlinConversationSummary,
} from './db';
import type { MerlinFact, MerlinMessage } from './types';

const MAX_CONTEXT_MESSAGES = 24;
const COMPRESS_THRESHOLD = 40;
const MESSAGES_TO_COMPRESS = 16;
const FACT_EXTRACTION_INTERVAL = 4;

const MERLIN_PERSONA = `Tu es Merlin, l'assistant personnel de l'utilisateur.
Inspiré de l'intelligence et de la discrétion de Jarvis, tu es :
- Concis et naturel en français
- Tu tutoies l'utilisateur sauf indication contraire dans tes faits mémorisés
- Tu exécutes des actions via tes outils plutôt que d'inventer du contenu du journal
- Si tu n'as pas l'information, dis-le honnêtement
- Tu peux aider avec le journal, les pensées, et la conversation générale`;

let messagesSinceFactExtraction = 0;

export function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function buildSystemPrompt(): Promise<string> {
  const facts = await getMerlinFacts();
  const conv = await getMerlinConversation();

  let prompt = MERLIN_PERSONA;

  if (facts.length > 0) {
    const factsBlock = facts
      .map((f) => `- ${f.key} : ${f.value}`)
      .join('\n');
    prompt += `\n\nFaits mémorisés sur l'utilisateur :\n${factsBlock}`;
  }

  if (conv.summary.trim()) {
    prompt += `\n\nRésumé des échanges précédents :\n${conv.summary.trim()}`;
  }

  prompt += `\n\nOutils disponibles (utilise-les quand l'utilisateur demande des infos sur son journal) :
- read_journal(date) — lire la note d'un jour (format AAAA-MM-JJ)
- search_journal(query) — chercher dans toutes les notes
- summarize_period(from, to) — lister les notes d'une période

Pour utiliser un outil, réponds UNIQUEMENT avec ce JSON :
{"action":"tool","name":"nom_outil","args":{"clé":"valeur"}}

Sinon réponds normalement en texte.`;

  return prompt;
}

export function getRecentMessages(messages: MerlinMessage[]): MerlinMessage[] {
  return messages.slice(-MAX_CONTEXT_MESSAGES);
}

export async function maybeCompressConversation(): Promise<void> {
  const conv = await getMerlinConversation();
  if (conv.messages.length < COMPRESS_THRESHOLD) return;

  const toCompress = conv.messages.slice(0, MESSAGES_TO_COMPRESS);
  const remaining = conv.messages.slice(MESSAGES_TO_COMPRESS);

  const transcript = toCompress
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Merlin'} : ${m.content}`)
    .join('\n');

  const result = await chatCompletion(
    [
      {
        role: 'system',
        content: `Résume cette conversation en français en 5-8 phrases.
Conserve les faits importants, décisions et préférences mentionnées.
Réponds uniquement avec le résumé, sans commentaire.`,
      },
      { role: 'user', content: transcript },
    ],
    { temperature: 0.3 },
  );

  if (!result.ok || !result.text) return;

  const newSummary = conv.summary
    ? `${conv.summary}\n\n${result.text.trim()}`
    : result.text.trim();

  await updateMerlinConversationSummary(newSummary, remaining);
}

interface ToolCallPayload {
  action: 'tool';
  name: string;
  args?: Record<string, string>;
}

function parseToolCall(text: string): ToolCallPayload | null {
  const parsed = parseJsonFromAi<ToolCallPayload>(text);
  if (parsed?.action === 'tool' && parsed.name) {
    return parsed;
  }
  return null;
}

export async function extractFactsFromExchange(
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  const existing = await getMerlinFacts();
  const existingBlock =
    existing.length > 0
      ? existing.map((f) => `- ${f.key}: ${f.value}`).join('\n')
      : '(aucun)';

  const result = await chatCompletion(
    [
      {
        role: 'system',
        content: `Tu extrais des faits stables sur l'utilisateur à partir d'un échange.
Ne retiens que des informations personnelles utiles à long terme (prénom, projets, préférences, relations).
Ignore les questions ponctuelles et le contenu du journal.
Ne duplique pas les faits déjà connus sauf pour les mettre à jour.

Faits déjà connus :
${existingBlock}

Réponds UNIQUEMENT en JSON :
{"facts":[{"key":"snake_case","value":"texte court"}]}
Si rien de nouveau : {"facts":[]}`,
      },
      {
        role: 'user',
        content: `Utilisateur : ${userMessage}\nMerlin : ${assistantReply}`,
      },
    ],
    { temperature: 0.2, jsonMode: true },
  );

  if (!result.ok || !result.text) return;

  const parsed = parseJsonFromAi<{ facts?: { key?: string; value?: string }[] }>(
    result.text,
  );
  if (!parsed?.facts?.length) return;

  const existingByKey = new Map(existing.map((f) => [f.key, f]));
  const now = Date.now();
  const toSave: MerlinFact[] = [];

  for (const item of parsed.facts) {
    const key = item.key?.trim();
    const value = item.value?.trim();
    if (!key || !value) continue;

    const prev = existingByKey.get(key);
    if (prev && prev.value === value) continue;

    toSave.push({
      id: prev?.id ?? createMessageId(),
      key,
      value,
      source: 'inferred',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    });
  }

  if (toSave.length > 0) {
    await saveMerlinFacts(toSave);
  }
}

export async function rememberExplicitFact(key: string, value: string): Promise<void> {
  const now = Date.now();
  const facts = await getMerlinFacts();
  const existing = facts.find((f) => f.key === key);
  await saveMerlinFact({
    id: existing?.id ?? createMessageId(),
    key,
    value,
    source: 'explicit',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export interface AgentReply {
  ok: boolean;
  content?: string;
  error?: string;
}

export async function handleUserMessage(userText: string): Promise<AgentReply> {
  const trimmed = userText.trim();
  if (!trimmed) {
    return { ok: false, error: 'Message vide.' };
  }

  const explicitMatch = trimmed.match(
    /^(?:merlin[, ]+)?(?:retiens que|souviens[- ]toi que|rappelle[- ]toi que)\s+(.+)/i,
  );
  if (explicitMatch) {
    const factText = explicitMatch[1].trim();
    const userMsg: MerlinMessage = {
      id: createMessageId(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };
    await appendMerlinMessage(userMsg);

    const factResult = await chatCompletion(
      [
        {
          role: 'system',
          content: `Extrais un fait à mémoriser. Réponds en JSON : {"key":"snake_case","value":"texte court"}`,
        },
        { role: 'user', content: factText },
      ],
      { temperature: 0.2, jsonMode: true },
    );

    let reply = "C'est noté, je m'en souviendrai.";
    if (factResult.ok && factResult.text) {
      const parsed = parseJsonFromAi<{ key?: string; value?: string }>(factResult.text);
      if (parsed?.key && parsed?.value) {
        await rememberExplicitFact(parsed.key, parsed.value);
        reply = `C'est noté — je retiendrai que ${parsed.value}.`;
      }
    }

    const assistantMsg: MerlinMessage = {
      id: createMessageId(),
      role: 'assistant',
      content: reply,
      createdAt: Date.now(),
    };
    await appendMerlinMessage(assistantMsg);
    return { ok: true, content: reply };
  }

  const userMsg: MerlinMessage = {
    id: createMessageId(),
    role: 'user',
    content: trimmed,
    createdAt: Date.now(),
  };
  await appendMerlinMessage(userMsg);

  await maybeCompressConversation();

  const systemPrompt = await buildSystemPrompt();
  const conv = await getMerlinConversation();
  const recent = getRecentMessages(conv.messages);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...recent.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  const { executeMerlinTool } = await import('./merlin-tools');

  let result = await chatCompletion(messages, { temperature: 0.5 });
  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? 'Réponse impossible.' };
  }

  let replyText = result.text;
  const toolCall = parseToolCall(result.text);

  if (toolCall) {
    const toolResult = await executeMerlinTool(toolCall.name, toolCall.args ?? {});
    const toolMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: result.text },
      {
        role: 'user',
        content: `Résultat de l'outil ${toolCall.name} :\n${toolResult.content}\n\nFormule une réponse naturelle pour l'utilisateur.`,
      },
    ];
    const followUp = await chatCompletion(toolMessages, { temperature: 0.5 });
    if (!followUp.ok || !followUp.text) {
      return { ok: false, error: followUp.error ?? 'Réponse impossible après outil.' };
    }
    replyText = followUp.text;
  }

  const assistantMsg: MerlinMessage = {
    id: createMessageId(),
    role: 'assistant',
    content: replyText,
    createdAt: Date.now(),
  };
  await appendMerlinMessage(assistantMsg);

  messagesSinceFactExtraction += 1;
  if (messagesSinceFactExtraction >= FACT_EXTRACTION_INTERVAL) {
    messagesSinceFactExtraction = 0;
    void extractFactsFromExchange(trimmed, replyText);
  }

  return { ok: true, content: replyText };
}

export async function getWelcomeMessage(): Promise<string> {
  const facts = await getMerlinFacts();
  const name = facts.find((f) => f.key === 'prenom' || f.key === 'user_name' || f.key === 'name');
  if (name) {
    return `Bonjour ${name.value}. Je suis Merlin, votre assistant. Comment puis-je vous aider ?`;
  }
  return 'Bonjour. Je suis Merlin, votre assistant personnel. Comment puis-je vous aider ?';
}
