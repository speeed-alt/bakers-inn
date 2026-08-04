import { addDoc, collection, doc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase.js'

// The catalog is the enter-once source. Everything downstream copies from it;
// nothing downstream ever asks a human to type a product name or a price again.

export function saveProduct(id, data) {
  if (id) return updateDoc(doc(db, 'products', id), data)
  return addDoc(collection(db, 'products'), { active: true, ...data })
}

/** Products are archived, never deleted, so old sales still make sense. */
export function archiveProduct(id, archived) {
  return updateDoc(doc(db, 'products', id), { active: !archived })
}

export function saveBranch(id, data) {
  return setDoc(doc(db, 'branches', id), data, { merge: true })
}

export function setUserActive(id, active) {
  return updateDoc(doc(db, 'users', id), { active })
}
