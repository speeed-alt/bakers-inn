import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { businessDateOf } from '../lib/dates.js'
import { SALARY, UTILITY } from '../lib/pnl.js'

// What the business spends besides ingredients: bills and wages.
//
// Ids are natural keys, like everywhere else in this system. One electricity
// bill per outlet per month, one salary per person per month — so entering the
// same thing twice corrects it instead of doubling it. That matters more here
// than anywhere: a duplicated salary would quietly take a month's profit down
// by the price of a person.

/** `UTL-202608-B2-electricity`, or `UTL-202608-ALL-internet` for the business. */
export function utilityDocId(month, branchId, category) {
  const where_ = branchId || 'ALL'
  const slug = String(category).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `UTL-${month.replace('-', '')}-${where_}-${slug}`
}

/** `SAL-202608-bilal`. */
export function salaryDocId(month, personId) {
  return `SAL-${month.replace('-', '')}-${personId}`
}

export function expensesQuery(months = 6) {
  return query(collection(db, 'expenses'), orderBy('month', 'desc'), limit(months * 40))
}

export function expensesForMonth(month) {
  return query(collection(db, 'expenses'), where('month', '==', month))
}

export function saveUtility({ month, branchId, category, amount, note = null, user }) {
  const id = utilityDocId(month, branchId, category)
  return setDoc(
    doc(db, 'expenses', id),
    {
      type: UTILITY,
      category,
      // Null rather than absent: a bill for the whole business is a real
      // choice, and the P&L has to be able to tell it from a missing field.
      branchId: branchId || null,
      month,
      businessDate: businessDateOf(),
      amount,
      note,
      updatedBy: user.id,
      updatedByName: user.name,
      updatedAt: Timestamp.fromDate(new Date()),
      syncedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export function saveSalary({ month, person, amount, note = null, user }) {
  const id = salaryDocId(month, person.id)
  return setDoc(
    doc(db, 'expenses', id),
    {
      type: SALARY,
      category: 'Salary',
      personId: person.id,
      personName: person.name,
      branchId: person.branchId || null,
      month,
      businessDate: businessDateOf(),
      amount,
      note,
      updatedBy: user.id,
      updatedByName: user.name,
      updatedAt: Timestamp.fromDate(new Date()),
      syncedAt: serverTimestamp(),
    },
    { merge: true },
  )
}
