// @ts-check
/** @typedef {{ id: string, title: string, prompt: string, files: string | null, passWhen: string[] }} Scenario */

/**
 * Parse a skill's tests/scenarios.md.
 * @param {string} text
 * @returns {Scenario[]}
 */
export function parseScenarios(text) {
  /** @type {Scenario[]} */ const out = [];
  const blocks = text.split(/^## /m).slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    const head = lines[0].match(/^(S\d+):\s*(.+)$/);
    if (!head) continue;
    const [, id, title] = head;
    /** @type {string[]} */ const prompt = [];
    /** @type {string[]} */ const passWhen = [];
    let files = null;
    let section = '';
    for (const line of lines.slice(1)) {
      if (/^Prompt:\s*$/.test(line)) { section = 'prompt'; continue; }
      if (/^Pass when:\s*$/.test(line)) { section = 'pass'; continue; }
      const f = line.match(/^Files:\s*(\S+)\s*$/);
      if (f) { files = f[1]; section = ''; continue; }
      if (section === 'prompt' && line.startsWith('>')) prompt.push(line.replace(/^>\s?/, ''));
      if (section === 'pass' && /^- /.test(line)) passWhen.push(line.slice(2).trim());
    }
    if (prompt.length === 0) throw new Error(`Scenario ${id} has no Prompt: block.`);
    if (passWhen.length === 0) throw new Error(`Scenario ${id} has no Pass when: list.`);
    out.push({ id, title: title.trim(), prompt: prompt.join('\n'), files, passWhen });
  }
  return out;
}
