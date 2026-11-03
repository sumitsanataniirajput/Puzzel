/** Local high-score table, persisted in localStorage. */
const KEY = 'neonworm.scores.v1';
const NAME_KEY = 'neonworm.pilot.v1';
export const MAX_ENTRIES = 8;

export function loadScores() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.score === 'number' && typeof e.name === 'string')
      .map((e) => ({
        name: e.name.slice(0, 8),
        score: Math.round(e.score),
        kills: e.kills | 0,
        length: e.length | 0,
        time: e.time || 0,
        date: e.date || 0,
        id: e.id || `${e.date}-${e.score}-${e.name}`,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ENTRIES);
  } catch (_) {
    return [];
  }
}

export function saveScore(entry) {
  const list = loadScores();
  const record = {
    name: (entry.name || 'PILOT').toUpperCase().slice(0, 8) || 'PILOT',
    score: Math.round(entry.score) || 0,
    kills: entry.kills | 0,
    length: entry.length | 0,
    time: Math.round(entry.time) || 0,
    date: Date.now(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  list.push(record);
  list.sort((a, b) => b.score - a.score || b.date - a.date);
  const trimmed = list.slice(0, MAX_ENTRIES);
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch (_) { /* ignore */ }
  return {
    list: trimmed,
    entry: trimmed.find((e) => e.id === record.id) || null,
    rank: trimmed.findIndex((e) => e.id === record.id),
    isBest: trimmed[0] && trimmed[0].id === record.id,
    record,
  };
}

export function clearScores() {
  try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ }
}

export function bestScore() {
  const list = loadScores();
  return list.length ? list[0].score : 0;
}

export function loadName() {
  try {
    const n = localStorage.getItem(NAME_KEY);
    if (n) return n.slice(0, 8).toUpperCase();
  } catch (_) { /* ignore */ }
  return 'PILOT';
}

export function saveName(name) {
  const clean = (name || 'PILOT').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 8).trim() || 'PILOT';
  try { localStorage.setItem(NAME_KEY, clean); } catch (_) { /* ignore */ }
  return clean;
}
