import type { Page, Route } from '@playwright/test';
import type { AgentRunResult, AgentStep, MerlinSpace } from '../../lib/merlin-agent/types';

type AgentRequestBody = {
  message: string;
  context?: {
    activeSpace?: MerlinSpace | null;
    activeSpaceId?: string | null;
    spaces?: MerlinSpace[];
  };
  stream?: boolean;
  background?: boolean;
  jobId?: string;
};

type MockJob = {
  status: 'pending' | 'running' | 'done' | 'error';
  steps: AgentStep[];
  result?: AgentRunResult;
  error?: string;
};

function ndjsonStream(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function sseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function comparisonSpace(
  id: string,
  title: string,
  rows: string[][],
  updatedAt = Date.now(),
): MerlinSpace {
  const space: MerlinSpace = {
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
  return withComparisonImages(space);
}

function withComparisonImages(space: MerlinSpace, overwrite = false): MerlinSpace {
  if (space.kind !== 'comparison') return space;
  const rowImages: Record<string, string> = { ...(space.data.rowImages ?? {}) };
  for (const row of space.data.rows ?? []) {
    const key = (row[0] ?? '').trim().toLowerCase();
    if (!key) continue;
    if (overwrite || !rowImages[key]) {
      const suffix = overwrite ? '-override' : '';
      rowImages[key] = `https://cdn.example.com/e2e-${key}${suffix}.jpg`;
    }
  }
  return { ...space, data: { ...space.data, rowImages } };
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

function buildAgentResponse(
  message: string,
  body: AgentRequestBody,
  spaces: Map<string, MerlinSpace>,
): { reply: string; result: AgentRunResult; steps: AgentStep[] } {
  const lower = message.toLowerCase();
  const active = body.context?.activeSpace ?? null;

  let reply = '';
  let mutationSpaces: MerlinSpace[] = [];
  const steps: AgentStep[] = [{ phase: 'think', label: 'Réflexion…' }];

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
  } else if (
    active?.kind === 'comparison' &&
    /\b(image|images|photo|photos|illustration|vignette)\b/i.test(message) &&
    /\b(remplace|rafra[îi]chis|r[ée]affiche|cherche|trouve|recherche|illustre)\b/i.test(message)
  ) {
    const existing = spaces.get(active.id) ?? active;
    const updated = withComparisonImages(existing, true);
    spaces.set(updated.id, updated);
    mutationSpaces = [updated];
    reply = 'J’ai remplacé les images de la comparaison.';
    steps.push({ phase: 'tool', label: 'Images remplacées' });
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
    steps,
    mutations: mutationSpaces.length ? { spaces: mutationSpaces } : {},
    sideEffects: mutationSpaces.length ? 'space_updated' : undefined,
    depth: 'standard',
  };

  return { reply, result, steps };
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
  const jobs = new Map<string, MockJob>();

  await page.route('**/api/merlin-agent**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId || !jobs.has(jobId)) {
        await route.fulfill({ status: 404, body: JSON.stringify({ error: 'Job not found' }) });
        return;
      }

      const job = jobs.get(jobId)!;
      const stream = url.searchParams.get('stream') === '1';

      if (stream) {
        let body = '';
        for (const step of job.steps) {
          body += sseEvent('step', { step });
        }
        if (job.status === 'done' && job.result) {
          body += sseEvent('done', { result: job.result });
        } else if (job.status === 'error') {
          body += sseEvent('error', { error: job.error ?? 'Erreur agent', steps: job.steps });
        }
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream; charset=utf-8',
          body,
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobId,
          status: job.status,
          steps: job.steps,
          result: job.result,
          error: job.error,
        }),
      });
      return;
    }

    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service temporairement indisponible' }),
      });
      return;
    }

    const body = request.postDataJSON() as AgentRequestBody;
    const message = body.message.trim();
    const { result, steps } = buildAgentResponse(message, body, spaces);

    if (body.background) {
      const jobId = body.jobId?.trim() || `e2e-job-${Date.now()}`;
      jobs.set(jobId, {
        status: 'done',
        steps,
        result,
      });
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ jobId, status: 'pending' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: agentDone(
        result,
        steps.map((s) => ({ phase: s.phase, label: s.label })),
      ),
    });
  });
}
