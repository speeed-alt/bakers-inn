import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'

/**
 * One outlet's recent closing reports, newest first.
 *
 * The branch filter is not optional. A list is only allowed when the query
 * itself proves every row it can return belongs to the caller's outlet — see
 * the note on queries in firestore.rules. The branchId + businessDate index
 * already exists for the dashboard, so this costs nothing new.
 *
 * Thirty days is four weeks plus slack, which is what the order suggestion
 * needs to find four of the same weekday even when a shop was shut on one.
 */
export function branchReportsQuery(branchId, days = 30) {
  return query(
    collection(db, 'dailyReports'),
    where('branchId', '==', branchId),
    orderBy('businessDate', 'desc'),
    limit(days),
  )
}
