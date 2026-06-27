import { isAppDevEnv } from '../lib/merlin-agent/app-env';
import { APP_VERSION } from './version';

export function getBuildAppEnv(): string | undefined {
  return typeof __APP_ENV__ !== 'undefined' && __APP_ENV__ ? __APP_ENV__ : undefined;
}

export function isDevBuild(): boolean {
  if (import.meta.env.DEV) return true;
  return isAppDevEnv(getBuildAppEnv());
}

export function getFrontendVersionLabel(): string {
  return APP_VERSION;
}
