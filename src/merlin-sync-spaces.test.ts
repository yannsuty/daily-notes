import { describe, expect, it } from 'vitest';
import { mergeMerlinData } from './db';
import type { MerlinConversation, MerlinSyncData } from './types';

const emptyConversation = (): MerlinConversation => ({
  id: 'main',
  messages: [],
  summary: '',
  updatedAt: 0,
});

function baseSync(partial: Partial<MerlinSyncData> = {}): MerlinSyncData {
  return {
    conversation: emptyConversation(),
    facts: [],
    lists: [],
    reminders: [],
    shortcuts: [],
    customTools: [],
    env: [],
    spaces: [],
    updatedAt: 0,
    ...partial,
  };
}

describe('mergeMerlinData — espaces', () => {
  it('conserve la version la plus récente par id', () => {
    const local = baseSync({
      spaces: [
        {
          id: 's1',
          kind: 'recipe',
          title: 'Local',
          recap: 'ancien',
          data: {},
          status: 'active',
          createdAt: 1,
          updatedAt: 100,
        },
      ],
      updatedAt: 100,
    });

    const remote = baseSync({
      spaces: [
        {
          id: 's1',
          kind: 'recipe',
          title: 'Remote',
          recap: 'récent',
          data: {},
          status: 'active',
          createdAt: 1,
          updatedAt: 200,
        },
      ],
      updatedAt: 200,
    });

    const merged = mergeMerlinData(local, remote);
    expect(merged.spaces).toHaveLength(1);
    expect(merged.spaces?.[0].title).toBe('Remote');
  });

  it('fusionne des espaces distincts des deux côtés', () => {
    const local = baseSync({
      spaces: [
        {
          id: 'local',
          kind: 'diy',
          title: 'A',
          recap: '',
          data: {},
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const remote = baseSync({
      spaces: [
        {
          id: 'remote',
          kind: 'plan',
          title: 'B',
          recap: '',
          data: {},
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const merged = mergeMerlinData(local, remote);
    expect(merged.spaces?.map((s) => s.id).sort()).toEqual(['local', 'remote']);
  });

  it('respecte une suppression locale (tombstone) face au remote', () => {
    const local = baseSync({
      spaces: [],
      deletedSpaces: { s1: 500 },
      updatedAt: 500,
    });
    const remote = baseSync({
      spaces: [
        {
          id: 's1',
          kind: 'comparison',
          title: 'Remote',
          recap: '',
          data: {},
          status: 'active',
          createdAt: 1,
          updatedAt: 100,
        },
      ],
      updatedAt: 200,
    });

    const merged = mergeMerlinData(local, remote);
    expect(merged.spaces).toHaveLength(0);
    expect(merged.deletedSpaces?.s1).toBe(500);
  });

  it('fusionne les tombstones de suppression des deux appareils', () => {
    const local = baseSync({
      spaces: [],
      deletedSpaces: { a: 100 },
    });
    const remote = baseSync({
      spaces: [],
      deletedSpaces: { b: 200 },
    });

    const merged = mergeMerlinData(local, remote);
    expect(merged.deletedSpaces).toEqual({ a: 100, b: 200 });
  });

  it('restaure un espace si mis à jour après la tombstone', () => {
    const local = baseSync({
      spaces: [
        {
          id: 's1',
          kind: 'plan',
          title: 'Nouveau',
          recap: '',
          data: {},
          status: 'active',
          createdAt: 1,
          updatedAt: 600,
        },
      ],
      deletedSpaces: { s1: 500 },
    });
    const remote = baseSync({
      spaces: [],
      deletedSpaces: { s1: 500 },
    });

    const merged = mergeMerlinData(local, remote);
    expect(merged.spaces).toHaveLength(1);
    expect(merged.spaces?.[0].title).toBe('Nouveau');
  });
});
