import type { MerlinSpace, MerlinSpaceKind } from './types.js';

export const SPACE_KIND_LABELS: Record<MerlinSpaceKind, string> = {
  comparison: 'Comparaison',
  diy: 'Projet DIY',
  plan: 'Plan',
  recipe: 'Recette',
};

export function formatSpaceForAgent(space: MerlinSpace): string {
  const lines: string[] = [
    `[${SPACE_KIND_LABELS[space.kind]}] ${space.title}`,
    `Récap : ${space.recap}`,
  ];

  const { data } = space;

  if (space.kind === 'comparison' && data.columns?.length) {
    lines.push('Tableau :');
    lines.push(data.columns.join(' | '));
    for (const row of data.rows ?? []) {
      lines.push(row.join(' | '));
    }
  }

  if (space.kind === 'diy') {
    if (data.intro) lines.push(`Intro : ${data.intro}`);
    for (const section of data.sections ?? []) {
      lines.push(`## ${section.title}\n${section.content}`);
    }
    if (data.listId) lines.push(`Liste liée : ${data.listId}`);
  }

  if (space.kind === 'plan') {
    if (data.goal) lines.push(`Objectif : ${data.goal}`);
    if (data.github) {
      lines.push(`Repo : ${data.github.owner}/${data.github.repo}`);
    }
    for (const m of data.milestones ?? []) {
      lines.push(`${m.done ? '✓' : '○'} ${m.title}`);
    }
  }

  if (space.kind === 'recipe') {
    if (data.servings) lines.push(`Portions : ${data.servings}`);
    lines.push('Ingrédients :');
    for (const ing of data.ingredients ?? []) {
      const qty = [ing.quantity, ing.unit].filter(Boolean).join(' ');
      lines.push(`- ${qty ? `${qty} ` : ''}${ing.text}`);
    }
    lines.push('Étapes :');
    for (const step of [...(data.steps ?? [])].sort((a, b) => a.order - b.order)) {
      lines.push(`${step.order}. ${step.text}`);
    }
  }

  return lines.join('\n');
}

export function formatSpacesSummary(spaces: MerlinSpace[]): string {
  const active = spaces.filter((s) => s.status === 'active');
  if (active.length === 0) return '';
  return active
    .slice(0, 12)
    .map((s) => `- [${s.kind}] ${s.title} (id: ${s.id})`)
    .join('\n');
}
