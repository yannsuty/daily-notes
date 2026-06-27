/** Indice lisible pour les logs debug fetch_page selon le code HTTP. */
export function fetchPageBlockedHint(status: number): string | undefined {
  switch (status) {
    case 401:
      return 'Authentification requise (401)';
    case 403:
      return 'Accès refusé (403) — anti-bot, paywall ou restriction géographique probable';
    case 404:
      return 'Page introuvable (404)';
    case 429:
      return 'Trop de requêtes (429) — rate limit';
    case 451:
      return 'Indisponible pour raisons légales (451)';
    default:
      if (status >= 500) return `Erreur serveur distant (${status})`;
      if (status >= 400) return `Erreur client HTTP (${status})`;
      return undefined;
  }
}
