import type { Page, Route } from '@playwright/test';
import type { AgentRunResult, MerlinSpace } from '../../lib/merlin-agent/types';

type AgentRequestBody = {
  message: string;
  context?: {
    activeSpace?: MerlinSpace | null;
    activeSpaceId?: string | null;
    spaces?: MerlinSpace[];
  };
  stream?: boolean;
};

function ndjsonStream(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function comparisonSpace(
  id: string,
  title: string,
  rows: string[][],
  updatedAt = Date.now(),
): MerlinSpace {
  return {
    id,
    kind: 'comparison',
    title,
    recap: `Comparaison : ${rows.map((r) => r[0]).join(', ')}`,
    status: 'active',
    createdAt: updatedAt - 1000,
    updatedAt,
    data: {
      columns: ['Modèle', 'Prix', 'Bruit'],
      rows,
    },
  };
}

function recipeSpace(id: string, title: string): MerlinSpace {
  return {
    id,
    kind: 'recipe',
    title,
    recap: 'Recette pour 4 personnes',
    status: 'active',
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    data: {
      servings: 4,
      ingredients: [{ text: 'farine' }, { text: 'œufs' }],
      steps: [{ order: 1, text: 'Mélanger' }],
    },
  };
}

function agentDone(result: AgentRunResult, steps: { phase: string; label: string }[] = []): string {
  const lines = steps.map((step) => ({
    type: 'step',
    step: { phase: step.phase, label: step.label },
  }));
  lines.push({ type: 'done', result });
  return ndjsonStream(lines);
}

export interface AgentMockOptions {
  /** Première requête POST échoue (pour scénario retry). */
  failFirstRequest?: boolean;
}

/**
 * Mock déterministe de /api/merlin-agent pour les parcours Espaces sans clé OpenRouter.
 */
export async function installAgentMock(
  page: Page,
  options: AgentMockOptions = {},
): Promise<void> {
  let failNext = options.failFirstRequest ?? false;
  const spaces = new Map<string, MerlinSpace>();

  await page.route('**/api/merlin-agent**', async (route: Route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      await route.fulfill({ status: 404, body: JSON.stringify({ error: 'Job not found' }) });
      return;
    }

    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: ndjsonStream([{ type: 'error', error: 'Service temporairement indisponible' }]),
      });
      return;
    }

    const body = request.postDataJSON() as AgentRequestBody;
    const message = body.message.trim();
    const lower = message.toLowerCase();
    const active = body.context?.activeSpace ?? null;

    let reply = '';
    let mutationSpaces: MerlinSpace[] = [];
    const steps = [{ phase: 'think', label: 'Réflexion…' }];

    if (/quel modèle|chambre de \d+ m²|^\s*quel\b.+\?$/i.test(message)) {
      reply =
        'Pour une chambre de 20 m², un ventilateur silencieux autour de 30 dB convient bien.';
    } else if (/recette/.test(lower) && (!active || active.kind !== 'recipe')) {
      const space = recipeSpace('e2e-recipe-crepes', 'Crêpes pour 4');
      spaces.set(space.id, space);
      mutationSpaces = [space];
      reply = 'Voici une recette de crêpes pour 4 personnes.';
      steps.push({ phase: 'tool', label: 'Espace recette créé' });
    } else if (
      active?.kind === 'comparison' &&
      (/autres|compare|ajoute|élargi|étoffe/.test(lower))
    ) {
      const existing = spaces.get(active.id) ?? active;
      const rows = [...(existing.data.rows ?? [])];
      if (!rows.some((r) => r[0] === 'Gamma')) {
        rows.push(['Gamma', '200 €', '25 dB']);
      }
      const updated = comparisonSpace(existing.id, existing.title, rows, Date.now());
      spaces.set(updated.id, updated);
      mutationSpaces = [updated];
      reply = 'J’ai ajouté le modèle Gamma à la comparaison.';
      steps.push({ phase: 'tool', label: 'Comparaison mise à jour' });
    } else if (/compare|comparaison|ventilateur/.test(lower)) {
      const space = comparisonSpace('e2e-ventilateurs', 'Ventilateurs de plafond', [
        ['Alpha', '150 €', '30 dB'],
        ['Beta', '180 €', '28 dB'],
      ]);
      spaces.set(space.id, space);
      mutationSpaces = [space];
      reply = 'Voici une comparaison des ventilateurs Alpha et Beta.';
      steps.push({ phase: 'tool', label: 'Comparaison créée' });
    } else {
      reply = `Réponse mock pour : ${message}`;
    }

    const result: AgentRunResult = {
      ok: true,
      reply,
      steps: steps.map((s) => ({ phase: s.phase as 'think', label: s.label })),
      mutations: mutationSpaces.length ? { spaces: mutationSpaces } : {},
      sideEffects: mutationSpaces.length ? 'space_updated' : undefined,
      depth: 'standard',
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: agentDone(result, steps),
    });
  });
}
