function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

export function isUpdateAvailable(
  installed: { versionCode: number; versionName: string },
  latestVersion: string,
  latestVersionCode?: number,
): boolean {
  if (latestVersionCode != null) {
    if (latestVersionCode > installed.versionCode) {
      return true;
    }
    if (latestVersionCode < installed.versionCode) {
      return false;
    }
  }
  return compareVersions(latestVersion, installed.versionName) > 0;
}
