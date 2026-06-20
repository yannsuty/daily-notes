import { Capacitor } from '@capacitor/core';
import { getMerlinReminders } from './db';
import type { MerlinReminder } from './types';

let initialized = false;

function reminderNotificationId(reminderId: string): number {
  let hash = 0;
  for (let i = 0; i < reminderId.length; i++) {
    hash = (hash << 5) - hash + reminderId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 1_000_000 + 1000;
}

function nextFireDate(reminder: MerlinReminder): Date | null {
  if (reminder.status !== 'active' || reminder.trigger.kind !== 'time') return null;

  const { at, timeOfDay, recurrence } = reminder.trigger;
  const now = new Date();

  if (at && recurrence === 'once') {
    return at > now.getTime() ? new Date(at) : null;
  }

  if (!timeOfDay) {
    if (at) return new Date(at);
    return null;
  }

  const [h, m] = timeOfDay.split(':').map(Number);
  const next = new Date(now);
  next.setHours(h, m ?? 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export async function initMerlinScheduler(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!Capacitor.isNativePlatform()) return;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;

    await LocalNotifications.addListener('localNotificationActionPerformed', () => {
      // App opens on tap; Merlin panel can show pending reminder
    });

    await rescheduleMerlinReminders();
  } catch (err) {
    console.warn('[merlin-scheduler] init failed', err);
  }
}

export async function rescheduleMerlinReminders(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const reminders = await getMerlinReminders();
    const pending = await LocalNotifications.getPending();

    const merlinIds = new Set(reminders.map((r) => reminderNotificationId(r.id)));
    const toCancel = pending.notifications
      .filter((n) => n.id >= 1000 && !merlinIds.has(n.id))
      .map((n) => ({ id: n.id }));
    if (toCancel.length > 0) {
      await LocalNotifications.cancel({ notifications: toCancel });
    }

    const schedules: {
      id: number;
      title: string;
      body: string;
      schedule: { at: Date; repeats?: boolean; every?: 'day' | 'week' };
    }[] = [];

    for (const reminder of reminders) {
      if (reminder.status !== 'active' || reminder.trigger.kind !== 'time') continue;

      const at = nextFireDate(reminder);
      if (!at) continue;

      const id = reminderNotificationId(reminder.id);
      const recurrence = reminder.trigger.recurrence ?? 'once';

      schedules.push({
        id,
        title: 'Merlin — Rappel',
        body: reminder.text,
        schedule: {
          at,
          ...(recurrence === 'daily' ? { repeats: true, every: 'day' as const } : {}),
          ...(recurrence === 'weekly' ? { repeats: true, every: 'week' as const } : {}),
        },
      });
    }

    if (schedules.length > 0) {
      await LocalNotifications.schedule({ notifications: schedules });
    }
  } catch (err) {
    console.warn('[merlin-scheduler] reschedule failed', err);
  }
}

export async function snoozeReminder(reminderId: string, minutes = 15): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const { getMerlinReminder, saveMerlinReminder } = await import('./db');
  const reminder = await getMerlinReminder(reminderId);
  if (!reminder) return;

  reminder.status = 'snoozed';
  reminder.updatedAt = Date.now();
  await saveMerlinReminder(reminder);

  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const at = new Date(Date.now() + minutes * 60_000);
  await LocalNotifications.schedule({
    notifications: [
      {
        id: reminderNotificationId(reminderId) + 1,
        title: 'Merlin — Rappel',
        body: reminder.text,
        schedule: { at },
      },
    ],
  });
}
