import { requireThat } from './model.mjs';

export class GitHub {
  constructor(repository, token, fetcher = fetch) {
    requireThat(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'invalid repository');
    requireThat(token, 'GitHub token required for repository automation');
    this.repository = repository; this.token = token; this.fetcher = fetcher;
  }
  async call(path, method = 'GET', body) {
    const url = `https://api.github.com/repos/${this.repository}/${path}`;
    const options = { method, headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    let r;
    for (let attempt = 0; ; attempt++) {
      try { r = await this.fetcher(url, options); break; }
      catch (error) {
        // Both sandbox attempts retained ready evidence but failed on the post-evaluation read
        // (Actions 37313751170, attempts 1 and 2). Retry the read, never a potentially applied write.
        if (method === 'GET' && attempt === 0) continue;
        const code = error.cause?.code ?? error.code ?? 'unknown';
        throw new Error(`GitHub ${method} ${path}: transport failed (${code})`, { cause: error });
      }
    }
    if (!r.ok) { const error = new Error(`GitHub ${method} ${path}: HTTP ${r.status}`); error.status = r.status; throw error; }
    return r.status === 204 ? null : r.json();
  }
  async optional(path) {
    try { return await this.call(path); } catch (error) { if (error.status === 404) return null; throw error; }
  }
  async download(path) {
    const response = await this.fetcher(`https://api.github.com/repos/${this.repository}/${path}`, { headers: { authorization: `Bearer ${this.token}`, accept: 'application/octet-stream', 'x-github-api-version': '2022-11-28' } });
    requireThat(response.ok, `GitHub download ${path}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  async upload(url, name, bytes) {
    const target = new URL(url.replace(/\{.*$/, ''));
    requireThat(target.origin === 'https://uploads.github.com', 'unexpected evidence upload host');
    target.searchParams.set('name', name);
    const response = await this.fetcher(target, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' }, body: bytes });
    requireThat(response.ok, `GitHub evidence upload: HTTP ${response.status}`);
    return response.json();
  }
  async pages(path) {
    const result = [];
    for (let page = 1; ; page++) {
      const rows = await this.call(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      requireThat(Array.isArray(rows), 'GitHub pagination expected an array');
      result.push(...rows);
      if (rows.length < 100) return result;
    }
  }
  async content(path, ref) {
    requireThat(/^[a-f0-9]{40}$/.test(ref), 'content must be read at an immutable commit');
    const doc = await this.call(`contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`);
    requireThat(doc.type === 'file' && doc.encoding === 'base64', 'expected a data file');
    return Buffer.from(doc.content, 'base64').toString('utf8');
  }
}

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@/g, '@\u200b').replace(/`/g, '\\`');
export function summary(envelope) {
  const s = envelope.input?.submission;
  const lines = [`Catalog: **${escape(envelope.status)}**`, '', `Head: \`${escape(envelope.input?.head ?? 'unknown')}\``, `Policy and inputs: \`${envelope.inputSha256 ?? 'not assessed'}\``];
  if (s) lines.push(`Artifact: \`${escape(s.package)}@${escape(s.version)}\``, `Integrity: \`${s.integrity}\``);
  if (envelope.error) lines.push('', escape(envelope.error));
  const report = envelope.report;
  if (report) {
    lines.push('', `Journey: ${escape(report.quick?.answered ?? 'not measured')} answered steps; ${escape(report.quick?.failures?.length ?? 'not measured')} recorded failures.`, `Replay: ${report.quick?.replay?.equal ? 'matches' : 'failed'}.`);
    const surface = report.quick?.surface;
    lines.push(surface ? `Declared API surface: ${escape(surface.served)}/${escape(surface.total)} served; ${escape(surface.gap)} gaps.` : 'Declared API surface: not measured.');
    const coverage = report.quick?.operationCoverage;
    lines.push(coverage ? `Journey operation coverage: ${escape(coverage.exercised)}/${escape(coverage.total)} (${escape(coverage.percent.toFixed(1))}%).` : 'Journey operation coverage: not measured.');
    lines.push(report.browser?.measured ? `Chromium: ${escape(report.browser.version)}; ${escape(report.browser.answered)} answered steps; ${escape(report.browser.failures.length)} failures; replay ${report.browser.replay.equal ? 'matches' : 'failed'}.` : `Chromium: not measured (${escape(report.browser?.reason ?? 'unknown target')}).`);
    lines.push('Browser DOM, code-line and state-transition coverage: not measured by this quick run.');
    for (const group of [...(report.gates ?? []), ...(report.conformance ?? [])]) for (const failure of group.failures ?? []) lines.push(`- ${escape(group.id ?? group.unit)}: ${escape(failure)}`);
    for (const failure of report.quick?.failures ?? []) lines.push(`- ${escape(failure.step)} / ${escape(failure.beat)}: ${escape(failure.detail)}`);
    lines.push('', escape(report.comparison?.note ?? 'Baseline comparison is in the JSON report.'));
  }
  lines.push('', 'Readiness is automated evidence, not approval. A moderator must review and merge the current head.', 'The workflow artifacts contain the complete JSON report and diagnostics.');
  return lines.join('\n').slice(0, 60000);
}

export async function feedback(github, number, body) {
  const marker = '<!-- twin-catalog-readiness -->';
  const comments = await github.pages(`issues/${number}/comments`);
  const old = comments.find((c) => c.user?.login === 'github-actions[bot]' && c.body?.startsWith(marker));
  return github.call(old ? `issues/comments/${old.id}` : `issues/${number}/comments`, old ? 'PATCH' : 'POST', { body: `${marker}\n${body}` });
}
