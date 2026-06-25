/** `APP_ENV=dev` (build client ou runtime serveur). */
export function isAppDevEnv(envValue?: string): boolean {
  return envValue?.trim().toLowerCase() === 'dev';
}
