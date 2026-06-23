import { describe, expect, it } from 'vitest';
import {
  buildRoutineParams,
  createRoutineContext,
  evaluateRoutineCondition,
  parseRoutineInvocation,
  parseRoutineSteps,
  recordRoutineStepResult,
  resolveRoutineArgs,
  resolveRoutineTemplate,
  shouldRunRoutineStep,
} from './routine.js';

describe('resolveRoutineTemplate', () => {
  it('résout paramètres et défauts', () => {
    const ctx = createRoutineContext({ ville: 'Lyon' });
    expect(resolveRoutineTemplate('météo {{ville}}', ctx)).toBe('météo Lyon');
    expect(resolveRoutineTemplate('{{manquant|Paris}}', ctx)).toBe('Paris');
  });

  it('résout prev et steps', () => {
    const ctx = createRoutineContext({});
    recordRoutineStepResult(ctx, 'web_search', 'Voir https://ex.com/page', true);
    expect(resolveRoutineTemplate('{{prev.url}}', ctx)).toBe('https://ex.com/page');
    expect(resolveRoutineTemplate('{{steps.0.content}}', ctx)).toContain('https://ex.com/page');
  });
});

describe('evaluateRoutineCondition', () => {
  it('évalue exists/empty/eq', () => {
    const ctx = createRoutineContext({ ville: 'Lyon', vide: '' });
    expect(evaluateRoutineCondition({ exists: 'ville' }, ctx)).toBe(true);
    expect(evaluateRoutineCondition({ empty: 'vide' }, ctx)).toBe(true);
    expect(evaluateRoutineCondition({ eq: ['{{ville}}', 'Lyon'] }, ctx)).toBe(true);
    expect(evaluateRoutineCondition({ neq: ['{{ville}}', 'Paris'] }, ctx)).toBe(true);
  });

  it('évalue and/or/not', () => {
    const ctx = createRoutineContext({ a: '1', b: '' });
    expect(
      evaluateRoutineCondition({ and: [{ exists: 'a' }, { empty: 'b' }] }, ctx),
    ).toBe(true);
    expect(
      evaluateRoutineCondition({ or: [{ empty: 'a' }, { exists: 'b' }] }, ctx),
    ).toBe(false);
    expect(evaluateRoutineCondition({ not: { empty: 'a' } }, ctx)).toBe(true);
  });
});

describe('shouldRunRoutineStep', () => {
  it('respecte when et unless', () => {
    const ctx = createRoutineContext({ flag: 'oui' });
    expect(
      shouldRunRoutineStep(
        { tool: 'web_search', args: {}, when: { exists: 'flag' } },
        ctx,
      ),
    ).toBe(true);
    expect(
      shouldRunRoutineStep(
        { tool: 'web_search', args: {}, unless: { exists: 'flag' } },
        ctx,
      ),
    ).toBe(false);
  });
});

describe('parseRoutineInvocation', () => {
  it('parse clé=valeur', () => {
    expect(
      parseRoutineInvocation('ville=Lyon tags=maison', [
        { name: 'ville', description: 'Ville' },
        { name: 'tags', description: 'Tags' },
      ]),
    ).toEqual({ ville: 'Lyon', tags: 'maison' });
  });

  it('parse positionnel et défauts', () => {
    expect(
      parseRoutineInvocation('Lyon', [{ name: 'ville', description: 'Ville', default: 'Paris' }]),
    ).toEqual({ ville: 'Lyon' });

    expect(
      buildRoutineParams([{ name: 'ville', description: 'Ville', default: 'Paris' }], {}),
    ).toEqual({ ville: 'Paris' });
  });
});

describe('parseRoutineSteps', () => {
  it('accepte when sur une étape', () => {
    const parsed = parseRoutineSteps(
      JSON.stringify([
        { tool: 'web_search', args: { query: 'test' }, when: { exists: 'ville' } },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.steps[0]?.when).toEqual({ exists: 'ville' });
    }
  });

  it('refuse une condition invalide', () => {
    const parsed = parseRoutineSteps(
      JSON.stringify([{ tool: 'web_search', args: {}, when: { bad: true } }]),
    );
    expect(parsed.ok).toBe(false);
  });
});

describe('resolveRoutineArgs', () => {
  it('résout tous les args d\'une étape', () => {
    const ctx = createRoutineContext({ ville: 'Lyon' });
    expect(
      resolveRoutineArgs({ query: 'météo {{ville}}', max_results: '3' }, ctx),
    ).toEqual({ query: 'météo Lyon', max_results: '3' });
  });
});
