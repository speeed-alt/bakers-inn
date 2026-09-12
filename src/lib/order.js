// One order for every list of items in the shop: the order of the code sheet.
//
// The owner's price list is numbered 1 to 20, it is pinned up at every counter,
// and every person in the business finds an item by its number. The app used to
// sort each list its own way — the order form and the baking list by category
// and then name, the catalogue the same, the daily rates by name — so Biscuits
// (19) came before Buns (14) and the codes jumped about on every screen. The
// lists that did sort by code compared the codes as text, which puts 10 and 11
// ahead of 2.
//
// So there is one comparator, and every list of items uses it. Lists that are
// not lists of items keep their own order on purpose: staff and raw materials
// alphabetically, best sellers by how much they sold, days by date.

const nameOf = (item) => String(item?.name ?? item?.productName ?? '')

/**
 * Sort by code the way a person reads a numbered sheet.
 *
 * Numbers compare as numbers, so 2 comes before 10, and a zero-padded "02" sits
 * with 2. Anything that is not a plain number still sorts sensibly rather than
 * throwing. An item with no code goes to the end — it is the odd one out, not
 * the first thing anyone should see. Ties fall back to the name, so the order
 * never depends on what order the database happened to return things in.
 *
 * Takes products (`name`) and sheet lines (`productName`) alike.
 */
export function byCode(a, b) {
  const x = String(a?.code ?? '').trim()
  const y = String(b?.code ?? '').trim()
  if (x === '' && y !== '') return 1
  if (y === '' && x !== '') return -1
  return (
    x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }) ||
    nameOf(a).localeCompare(nameOf(b))
  )
}
