export interface GitHubRepoSummary {
  owner: string;
  repo: string;
  description: string;
  defaultBranch: string;
  language: string;
  topics: string[];
  readmeExcerpt: string;
  treeSummary: string;
}

function decodeBase64Utf8(b64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function inspectGitHubRepo(
  owner: string,
  repo: string,
  token?: string,
): Promise<{ ok: true; summary: GitHubRepoSummary } | { ok: false; error: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Merlin-Assistant',
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  try {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!repoRes.ok) {
      const status = repoRes.status;
      if (status === 404) return { ok: false, error: `Dépôt ${owner}/${repo} introuvable.` };
      if (status === 401 || status === 403) {
        return {
          ok: false,
          error: 'Accès GitHub refusé — ajoutez un token en lecture dans Réglages → Variables Merlin (GITHUB_TOKEN).',
        };
      }
      return { ok: false, error: `Erreur GitHub (${status}).` };
    }

    const repoData = (await repoRes.json()) as {
      description?: string | null;
      default_branch?: string;
      language?: string | null;
      topics?: string[];
    };

    const defaultBranch = repoData.default_branch ?? 'main';

    const [readmeRes, treeRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers }),
      fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
        { headers },
      ),
    ]);

    let readmeExcerpt = '';
    if (readmeRes.ok) {
      const readme = (await readmeRes.json()) as { content?: string };
      if (readme.content) {
        const decoded = decodeBase64Utf8(readme.content);
        readmeExcerpt = decoded.slice(0, 2000);
      }
    }

    let treeSummary = '';
    if (treeRes.ok) {
      const tree = (await treeRes.json()) as {
        tree?: { path: string; type: string }[];
      };
      const paths = (tree.tree ?? [])
        .filter((t) => t.type === 'blob')
        .map((t) => t.path)
        .filter((p) => !p.startsWith('.') && p.split('/').length <= 3)
        .slice(0, 40);
      treeSummary = paths.join('\n');
    }

    return {
      ok: true,
      summary: {
        owner,
        repo,
        description: repoData.description?.trim() ?? '',
        defaultBranch,
        language: repoData.language ?? '',
        topics: repoData.topics ?? [],
        readmeExcerpt,
        treeSummary,
      },
    };
  } catch {
    return { ok: false, error: 'Impossible de contacter l\'API GitHub.' };
  }
}

export function formatGitHubSummary(summary: GitHubRepoSummary): string {
  const lines = [
    `Dépôt : ${summary.owner}/${summary.repo}`,
    summary.description ? `Description : ${summary.description}` : '',
    summary.language ? `Langage principal : ${summary.language}` : '',
    summary.topics.length > 0 ? `Topics : ${summary.topics.join(', ')}` : '',
    summary.defaultBranch ? `Branche : ${summary.defaultBranch}` : '',
  ].filter(Boolean);

  if (summary.treeSummary) {
    lines.push('\nStructure (extraits) :\n' + summary.treeSummary);
  }
  if (summary.readmeExcerpt) {
    lines.push('\nREADME (extrait) :\n' + summary.readmeExcerpt);
  }

  return lines.join('\n');
}
