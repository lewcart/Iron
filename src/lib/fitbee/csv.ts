/** Split a CSV line into fields; supports quoted fields with doubled quotes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQ = false;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"') {
      inQ = true;
      continue;
    }
    if (c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function splitCsvRows(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const rows: string[] = [];
  let buf = '';
  let inQ = false;
  for (const line of lines) {
    if (!buf && !line.trim() && !inQ) continue;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
    }
    buf = buf ? `${buf}\n${line}` : line;
    if (!inQ) {
      rows.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) rows.push(buf);
  return rows;
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rawRows = splitCsvRows(text.trim());
  if (rawRows.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(rawRows[0]).map((h) => h.trim());
  const rows = rawRows.slice(1).map(parseCsvLine).filter((r) => r.some((c) => c.trim() !== ''));
  return { headers, rows };
}
