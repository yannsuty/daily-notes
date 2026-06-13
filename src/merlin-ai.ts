const API_KEY_STORAGE_KEY = 'daily-note-merlin-api-key';

export function storeMerlinApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function getStoredMerlinApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function clearStoredMerlinApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

export interface StructureResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export async function structureJournalText(rawText: string): Promise<StructureResult> {
  const apiKey = getStoredMerlinApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Clé API non configurée.' };
  }

  if (!rawText.trim()) {
    return { ok: false, error: 'Aucun texte à structurer.' };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: `Tu structures des notes de journal quotidien en français.
Règles :
- Conserve le sens et les faits du texte original
- Organise en sections avec ## Titre si pertinent
- Utilise des puces - pour les listes
- Ajoute des #tags pertinents (2 à 5 max)
- Utilise [[concept]] pour les idées ou projets importants
- Réponds uniquement avec le texte structuré, sans commentaire`,
          },
          {
            role: 'user',
            content: rawText,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return { ok: false, error: `API erreur ${response.status}: ${errBody.slice(0, 120)}` };
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { ok: false, error: 'Réponse vide de l\'API.' };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur réseau' };
  }
}
