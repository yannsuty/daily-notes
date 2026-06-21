import { Capacitor, registerPlugin } from '@capacitor/core';

export type AutomationKind = 'open_app' | 'open_url' | 'share_text' | 'tap_sequence';

export interface MerlinAutomationPlugin {
  openApp(options: { packageName: string }): Promise<{ ok: boolean }>;
  openUrl(options: { url: string }): Promise<{ ok: boolean }>;
  shareText(options: { text: string; packageName?: string }): Promise<{ ok: boolean }>;
  isAccessibilityEnabled(): Promise<{ enabled: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  performTapSequence(options: { stepsJson: string }): Promise<{ ok: boolean }>;
}

const MerlinAutomation = registerPlugin<MerlinAutomationPlugin>('MerlinAutomation');

/** Noms familiers → identifiants de package Android */
export const APP_PACKAGES: Record<string, string> = {
  deezer: 'deezer.android.app',
  spotify: 'com.spotify.music',
  messenger: 'com.facebook.orca',
  facebook: 'com.facebook.katana',
  whatsapp: 'com.whatsapp',
  telegram: 'org.telegram.messenger',
  instagram: 'com.instagram.android',
  gmail: 'com.google.android.gm',
  maps: 'com.google.android.apps.maps',
  chrome: 'com.android.chrome',
  sms: 'com.google.android.apps.messaging',
  messages: 'com.google.android.apps.messaging',
};

const APP_LABELS: Record<string, string> = {
  deezer: 'Deezer',
  spotify: 'Spotify',
  messenger: 'Messenger',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
  gmail: 'Gmail',
  maps: 'Google Maps',
  chrome: 'Chrome',
  sms: 'Messages',
  messages: 'Messages',
};

export function isAutomationPlatform(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function resolveAppPackage(appOrPackage: string): string | null {
  const key = appOrPackage.trim().toLowerCase();
  if (!key) return null;
  if (key.includes('.')) return appOrPackage.trim();
  return APP_PACKAGES[key] ?? null;
}

export function resolveAppLabel(appOrPackage: string): string {
  const key = appOrPackage.trim().toLowerCase();
  if (APP_LABELS[key]) return APP_LABELS[key];
  if (key.includes('.')) {
    const alias = Object.entries(APP_PACKAGES).find(([, pkg]) => pkg === appOrPackage.trim());
    if (alias) return APP_LABELS[alias[0]] ?? appOrPackage.trim();
  }
  return appOrPackage.trim();
}

export interface AutomationSummary {
  kind: AutomationKind;
  title: string;
  detail: string;
  spoken: string;
  needsAccessibility: boolean;
}

export function describeAutomation(args: Record<string, string>): AutomationSummary | null {
  const kind = (args.kind ?? args.action ?? '').trim().toLowerCase() as AutomationKind;
  const app = args.app ?? args.package ?? '';
  const target = args.target ?? args.contact ?? args.destinataire ?? '';
  const text = args.text ?? args.message ?? args.contenu ?? '';
  const url = args.url ?? args.link ?? '';
  const stepsJson = args.steps_json ?? args.steps ?? '';

  switch (kind) {
    case 'open_app': {
      const pkg = resolveAppPackage(app);
      if (!pkg) {
        return null;
      }
      const label = resolveAppLabel(app);
      return {
        kind,
        title: `Ouvrir ${label}`,
        detail: `Application : ${label}`,
        spoken: `J'ai compris : ouvrir ${label}.`,
        needsAccessibility: false,
      };
    }
    case 'open_url': {
      if (!url.trim()) return null;
      return {
        kind,
        title: app ? `Ouvrir ${resolveAppLabel(app)}` : 'Ouvrir un lien',
        detail: url.trim(),
        spoken: app
          ? `J'ai compris : ouvrir ${resolveAppLabel(app)}.`
          : `J'ai compris : ouvrir ce lien.`,
        needsAccessibility: false,
      };
    }
    case 'share_text': {
      if (!text.trim()) return null;
      const pkg = app ? resolveAppPackage(app) : null;
      const appLabel = app ? resolveAppLabel(app) : 'une application';
      const targetPart = target.trim() ? ` à ${target.trim()}` : '';
      return {
        kind,
        title: `Envoyer un message${targetPart}`,
        detail: pkg
          ? `Via ${appLabel}${targetPart}\n\n« ${text.trim()} »`
          : `Texte à partager :\n\n« ${text.trim()} »`,
        spoken: pkg
          ? `J'ai compris : envoyer sur ${appLabel}${targetPart} le message suivant : ${text.trim()}`
          : `J'ai compris : partager ce texte : ${text.trim()}`,
        needsAccessibility: false,
      };
    }
    case 'tap_sequence': {
      if (!stepsJson.trim()) return null;
      let stepCount = 0;
      try {
        const parsed = JSON.parse(stepsJson) as unknown[];
        stepCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return null;
      }
      return {
        kind,
        title: 'Automatisation par gestes',
        detail: `${stepCount} étape(s) enregistrée(s). Nécessite le service d'accessibilité Merlin.`,
        spoken: `J'ai compris : exécuter une séquence de ${stepCount} gestes sur l'écran.`,
        needsAccessibility: true,
      };
    }
    default:
      return null;
  }
}

export function buildConfirmationPrompt(summary: AutomationSummary): string {
  const suffix =
    ' Dites oui pour confirmer, ou non pour annuler. Vous pouvez aussi utiliser les boutons à l\'écran.';
  if (summary.detail.includes('\n')) {
    return `${summary.spoken}\n\n${summary.detail}\n\n${suffix}`;
  }
  return `${summary.spoken} ${summary.detail}.${suffix}`;
}

export async function executeAutomationAction(
  args: Record<string, string>,
): Promise<{ ok: boolean; content: string }> {
  if (!isAutomationPlatform()) {
    return {
      ok: false,
      content: "L'automatisation est disponible uniquement sur l'application Android Merlin.",
    };
  }

  const summary = describeAutomation(args);
  if (!summary) {
    return {
      ok: false,
      content:
        "Je n'ai pas pu interpréter cette automatisation. Précisez l'action (open_app, open_url, share_text).",
    };
  }

  const kind = summary.kind;
  const app = args.app ?? args.package ?? '';
  const text = args.text ?? args.message ?? args.contenu ?? '';
  const url = args.url ?? args.link ?? '';
  const stepsJson = args.steps_json ?? args.steps ?? '';

  try {
    switch (kind) {
      case 'open_app': {
        const packageName = resolveAppPackage(app);
        if (!packageName) {
          return { ok: false, content: `Application inconnue : ${app}` };
        }
        await MerlinAutomation.openApp({ packageName });
        return { ok: true, content: `${resolveAppLabel(app)} est ouvert.` };
      }
      case 'open_url': {
        await MerlinAutomation.openUrl({ url: url.trim() });
        return { ok: true, content: 'Lien ouvert.' };
      }
      case 'share_text': {
        const packageName = app ? resolveAppPackage(app) : null;
        await MerlinAutomation.shareText({
          text: text.trim(),
          packageName: packageName ?? undefined,
        });
        const label = app ? resolveAppLabel(app) : 'le partage';
        return {
          ok: true,
          content: app
            ? `J'ai ouvert ${label} avec votre message. Vérifiez et appuyez sur Envoyer si besoin.`
            : 'Choisissez l\'application pour envoyer le message.',
        };
      }
      case 'tap_sequence': {
        const access = await MerlinAutomation.isAccessibilityEnabled();
        if (!access.enabled) {
          await MerlinAutomation.openAccessibilitySettings();
          return {
            ok: false,
            content:
              "Activez le service d'accessibilité Merlin dans les réglages, puis réessayez.",
          };
        }
        await MerlinAutomation.performTapSequence({ stepsJson: stepsJson.trim() });
        return { ok: true, content: 'Séquence de gestes exécutée.' };
      }
      default:
        return { ok: false, content: `Action inconnue : ${kind}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, content: `Échec : ${message}` };
  }
}

export async function openAccessibilitySettings(): Promise<void> {
  if (!isAutomationPlatform()) return;
  await MerlinAutomation.openAccessibilitySettings();
}

export async function isAccessibilityEnabled(): Promise<boolean> {
  if (!isAutomationPlatform()) return false;
  try {
    const result = await MerlinAutomation.isAccessibilityEnabled();
    return result.enabled === true;
  } catch {
    return false;
  }
}
