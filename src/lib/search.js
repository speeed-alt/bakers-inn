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

// ---------------------------------------------------------------------------
// Choices: what the cashier can actually put on a bill.
//
// Once the catalogue is priced in tiers, a product is not a thing on a shelf —
// it is four cakes at 1,800 sharing one code. `findProducts` returns that
// product, which was fine when the two were the same and is wrong now, in two
// ways that both cost time at the counter:
//
//   - A customer asks for a Nutella. The cashier types "nut" and the till says
//     nothing matches, because Nutella is a variant and only the group name
//     "Fudge & Velvet Cake" was ever searched. The one thing the customer
//     actually said is the one thing that could not be typed.
//   - Typing the code found the group, and choosing between its names then
//     needed a dialogue over the whole screen. Which is slower than reading the
//     list already open beside the bill, and it hides the bill while a queue
//     waits.
//
// So the unit of search is a *choice*: a product plus which of its names. Four
// cakes at 1,800 are four rows, each addable in one click, and each findable by
// the name the customer said.

/** Every way one product can be put on a bill. */
export function choicesOf(product) {
  const variants = Array.isArray(product?.variants) ? product.variants.filter(Boolean) : []
  if (variants.length < 2) {
    return [{ product, variant: null, name: product?.name ?? '', key: String(product?.id ?? '') }]
  }
  return variants.map((variant) => ({
    product,
    variant,
    name: variant,
    key: `${product.id}::${variant}`,
  }))
}

function rankOf(choice, q) {
  const code = String(choice.product?.code ?? '').toLowerCase()
  if (code && code === q) return RANK.exactCode
  if (code && code.startsWith(q)) return RANK.codePrefix

  // The variant and the group both count. A cashier may know it as "Nutella"
  // or as the 2,000 cake, and either should find it.
  let best = null
  for (const source of [choice.name, choice.product?.name]) {
    const name = String(source ?? '').toLowerCase()
    if (!name) continue
    let rank = null
    if (name.startsWith(q)) rank = RANK.namePrefix
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) rank = RANK.wordPrefix
    else if (name.includes(q)) rank = RANK.contains
    if (rank !== null && (best === null || rank < best)) best = rank
  }
  return best
}

/**
 * Ranked choices. An empty query lists everything, so the box doubles as the
 * menu a new cashier reads names off.
 *
 * Ties keep the order the owner wrote them in — his sheet says Kit Kat,
 * Ferrero, Oreo, Candy, and the four rows under code 3 say the same, because
 * that is the order the cashier's eye already knows. Sorting them
 * alphabetically would be tidier and slower to read.
 */
export function findChoices(products = [], queryText) {
  const all = []
  products.forEach((product, order) => {
    choicesOf(product).forEach((choice, index) => all.push({ ...choice, order, index }))
  })

  const q = String(queryText ?? '').trim().toLowerCase()
  if (!q) {
    return all.sort(
      (a, b) =>
        (a.product.category ?? '').localeCompare(b.product.category ?? '') ||
        String(a.product.name).localeCompare(String(b.product.name)) ||
        a.index - b.index,
    )
  }

  const hits = []
  for (const choice of all) {
    const rank = rankOf(choice, q)
    if (rank !== null) hits.push({ choice, rank })
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.choice.order - b.choice.order || a.choice.index - b.choice.index)
    .map((hit) => hit.choice)
}
