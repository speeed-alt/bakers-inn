// What `@page { size: … }` will actually accept.
//
// The fault this file exists for is silent. An invalid page size is not an
// error the browser reports — it is a declaration it discards, leaving the page
// at whatever the print dialog happens to be set to. `80mm auto` sat in the
// code looking entirely reasonable, and the only symptom would have been a
// receipt printed as a strip in the corner of an A4 sheet, weeks later, with
// nobody able to see why from the file.

import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidPageSize, PAPER_SIZES } from '../src/lib/paper.js'

test('every paper the shop can be set to has a size the browser will keep', () => {
  for (const [name, size] of Object.entries(PAPER_SIZES)) {
    assert.ok(isValidPageSize(size), `${name} has an invalid page size: ${size}`)
  }
})

test('the till roll is given both of its lengths', () => {
  // The bug: `80mm auto` mixes a length with the keyword, which the grammar
  // does not allow. Two lengths, or none.
  assert.equal(PAPER_SIZES['80mm'], '80mm 200mm')
  assert.equal(isValidPageSize('80mm auto'), false)
  assert.equal(isValidPageSize('auto 200mm'), false)
  assert.equal(isValidPageSize('80mm 200mm'), true)
})

test('auto stands on its own', () => {
  assert.equal(isValidPageSize('auto'), true)
  assert.equal(isValidPageSize('auto auto'), false)
})

test('one length means a square page, which is valid and rarely meant', () => {
  // `size: 80mm` is legal and means 80mm x 80mm — it would truncate every slip
  // longer than a couple of lines. Valid, so the check passes it; the comment
  // in paper.js is what stops somebody reaching for it.
  assert.equal(isValidPageSize('80mm'), true)
})

test('named sizes are accepted, with or without an orientation', () => {
  for (const good of ['A4', 'a4', 'A5 portrait', 'A4 landscape', 'landscape A4', 'letter', 'legal']) {
    assert.ok(isValidPageSize(good), `${good} should be accepted`)
  }
})

test('rubbish is refused rather than passed through to be discarded', () => {
  for (const bad of ['', '   ', 'A9', 'portrait', '80mm 200mm 3mm', '80', 'wide', null, undefined]) {
    assert.equal(isValidPageSize(bad), false, `${bad} should be refused`)
  }
})

test('a length can carry any unit the printer might be set up in', () => {
  assert.ok(isValidPageSize('3.15in 7.87in'))
  assert.ok(isValidPageSize('8cm 20cm'))
  assert.ok(isValidPageSize('226pt 566pt'))
})
