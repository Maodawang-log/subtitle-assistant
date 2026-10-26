interface LookupEntry {
  term: string;
  reading: string;
  meaning: string;
  source: string;
  dictionaryId?: string;
  version?: string;
}

// Merge display-only spelling variants. Keep different readings, definitions,
// and dictionary sources separate, and leave the stored dictionary untouched.
export function renderDictionaryResults(target: HTMLElement, entries: LookupEntry[]) {
  const groups = new Map<string, { entry: LookupEntry; terms: string[] }>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.dictionaryId, entry.version, entry.source, entry.reading, entry.meaning]);
    const group = groups.get(key);
    if (group) {
      if (!group.terms.includes(entry.term)) group.terms.push(entry.term);
    } else groups.set(key, { entry, terms: [entry.term] });
  }
  const doc = target.ownerDocument;
  target.replaceChildren();
  for (const { entry, terms } of groups.values()) {
    const block = doc.createElement("p"), label = doc.createElement("strong"), body = doc.createElement("div");
    label.textContent = terms.join(" / ") + (entry.reading ? " · " + entry.reading : "");
    body.textContent = entry.meaning;
    block.append(label, body);
    target.append(block);
  }
  const sources = [...new Set(entries.map(entry => entry.source).filter(Boolean))];
  if (sources.length) {
    const source = doc.createElement("small");
    source.textContent = sources.join(" / ");
    target.append(source);
  }
}
