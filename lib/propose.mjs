import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read, requireThat, stable, submissionId, validateSubmission } from './model.mjs';

/** Publisher-side automation opens a data PR; it never approves, merges or edits the index. */
export async function propose(github, directory, reassess = false) {
  const base = await github.call('git/ref/heads/main');
  const sources = JSON.parse(await github.content('sources.json', base.object.sha));
  const results = [];
  for (const filename of readdirSync(directory).filter((f) => /^[a-f0-9]{64}\.json$/.test(f)).sort()) {
    const submission = read(join(directory, filename));
    validateSubmission(submission, sources);
    const id = submissionId(submission), kind = reassess ? 'reassessment' : 'submission', path = `${reassess ? 'reassessments' : 'submissions'}/${id}.json`, branch = `${kind}/${id}`;
    requireThat(filename === `${id}.json`, 'submission filename mismatch');
    const existing = await github.call(`pulls?state=all&head=${encodeURIComponent(`${github.repository.split('/')[0]}:${branch}`)}&base=main`);
    if (existing.length) { results.push({ id, url: existing[0].html_url, state: existing[0].state }); continue; }
    let ref;
    try { ref = await github.call(`git/ref/heads/${branch}`); }
    catch (e) { if (!e.message.endsWith('HTTP 404')) throw e; ref = await github.call('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: base.object.sha }); }
    let held;
    try { held = JSON.parse(await github.content(path, ref.object.sha)); }
    catch (e) { if (!e.message.endsWith('HTTP 404')) throw e; }
    if (held) requireThat(stable(held) === stable(submission), 'existing submission branch has different data');
    else await github.call(`contents/${path}`, 'PUT', { message: `Submit ${submission.package}@${submission.version}`, branch, content: Buffer.from(`${JSON.stringify(submission, null, 2)}\n`).toString('base64') });
    const pr = await github.call('pulls', 'POST', { title: `Submit ${submission.package}@${submission.version}`, head: branch, base: 'main', body: `Published artifact submission for ${submission.vendor}.\n\nThe catalog prepares evidence; moderators decide admission.\n\nIntegrity: \`${submission.integrity}\`` });
    results.push({ id, url: pr.html_url, state: pr.state });
  }
  return results;
}
