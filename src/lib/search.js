// Matching for the till's one entry box. The cashier types either the item code
// or part of the name into the same field, so the ranking has to make an exact
// code win outright — a memorised code should never be beaten by a product that
// happens to have those digits in its name.

const RANK = {
  exactCode: 0,
  codePrefix: 1,
  namePrefix: 2,
  wordPrefix: 3,
  contains: 4,
}

export function byCategoryThenName(a, b) {
  return (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name)
}

/** Ranked matches. An empty query lists everything, so the box doubles as the menu. */
export function findProducts(products, queryText) {
  const q = String(queryText ?? '').trim().toLowerCase()
  if (!q) return [...products].sort(byCategoryThenName)

  const hits = []
  for (const p of products) {
    const code = String(p.code ?? '').toLowerCase()
    const name = String(p.name ?? '').toLowerCase()

    let rank
    if (code && code === q) rank = RANK.exactCode
    else if (code && code.startsWith(q)) rank = RANK.codePrefix
    else if (name.startsWith(q)) rank = RANK.namePrefix
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) rank = RANK.wordPrefix
    else if (name.includes(q)) rank = RANK.contains
    else continue

    hits.push({ p, rank })
  }

  return hits.sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name)).map((h) => h.p)
}

/** The item whose code was typed exactly, if any. */
export function exactCodeMatch(products, queryText) {
  const q = String(queryText ?? '').trim().toLowerCase()
  if (!q) return null
  return products.find((p) => String(p.code ?? '').toLowerCase() === q) ?? null
}
