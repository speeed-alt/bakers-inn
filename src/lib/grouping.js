// One id per category and price, with the names kept underneath it.
//
// A shop that sells five cakes at Rs 2,000 does not want five codes, five
// stock lines and five order rows. It wants one: "cakes at 2,000 — we have
// ten". But it does not want to lose the names either, because a customer asks
// for a Lotus, not for a two-thousand-rupee cake.
//
// So the product becomes the group, and the names become variants of it. That
// choice is what makes this cheap: everything downstream — stock, the baking
// list, deliveries, the daily report — already keys on productId, so grouping
// at that level merges all of them at once with no further changes. The variant
// the customer chose is copied onto the sale line, exactly as the name and
// price already are, so a receipt still says Lotus and history still reads.
//
// What is given up, and it is worth saying out loud: once two products share an
// id the system can no longer tell how many of each variant sold. It knows ten
// cakes went; it cannot say which. For same-price items in one category that is
// usually a fair trade for a faster counter, but it is a trade.

/** Two products belong together when the category and the price both match. */
export function groupKey(product) {
  return `${product?.category ?? ''}::${product?.price ?? 0}`
}

/**
 * Groups of products that could share one id.
 *
 * Only live products, and only where more than one exists — a group of one is
 * just a product. Weighed items are left alone: a price per kilo and a price
 * each are not the same kind of number, and merging them would put a loaf and
 * a weight under one code.
 */
export function mergeSuggestions(products = []) {
  const groups = new Map()

  for (const product of products) {
    if (product.active === false) continue
    if (product.soldByWeight) continue
    const key = groupKey(product)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        category: product.category ?? '',
        price: product.price ?? 0,
        members: [],
      })
    }
    groups.get(key).members.push(product)
  }

  return [...groups.values()]
    .filter((group) => group.members.length > 1)
    .map((group) => {
      const members = [...group.members].sort((a, b) =>
        String(a.code).localeCompare(String(b.code)),
      )
      return {
        ...group,
        members,
        // The lowest code survives, because it is the one staff have been
        // reading off the printed sheet longest.
        keepCode: members[0].code,
        suggestedName: `${group.category} ${group.price}`,
        variants: members.map((m) => m.name),
      }
    })
    .sort(
      (a, b) =>
        String(a.category).localeCompare(String(b.category)) || a.price - b.price,
    )
}

/**
 * What a merge would do, worked out before anything is written.
 *
 * `keep` is the product that survives and gains the variants; `archive` are the
 * ones that stop being sold separately. Nothing is deleted — an archived
 * product still explains every sale that was ever rung against it.
 */
export function planMerge(group, { name, code } = {}) {
  if (!group || group.members.length < 2) return null
  const [first, ...rest] = group.members

  return {
    keep: {
      id: first.id,
      code: code ?? group.keepCode,
      name: name ?? group.suggestedName,
      category: group.category,
      price: group.price,
      sellsNextDay: group.members.some((m) => m.sellsNextDay),
      variants: group.variants,
    },
    archive: rest.map((m) => ({ id: m.id, name: m.name })),
  }
}

/** The names a cashier can pick between, or none when there is nothing to pick. */
export function variantsOf(product) {
  const list = product?.variants ?? []
  return Array.isArray(list) && list.length > 1 ? list : []
}

/**
 * What goes on the bill and the receipt.
 *
 * The variant on its own, not "Cakes 2000 — Lotus". The customer asked for a
 * Lotus and that is what should be on their slip; the group name is a thing the
 * till needs, not the shop.
 */
export function lineNameFor(product, variant) {
  return variant || product?.name || ''
}
