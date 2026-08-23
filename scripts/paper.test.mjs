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
import { RECEIPT_PAPER } from '../src/config.js'

test('every paper the shop can be set to has a size the browser will keep', () => {
  for (const [name, size] of Object.entries(PAPER_SIZES)) {
    assert.ok(isValidPageSize(size), `${name} has an invalid page size: ${size}`)
  }
})

test('the till roll is given both of its lengths', () => {
  // The bug: `80mm auto` mixes a length with the keyword, which the grammar
  // does not allow. Two lengths, or none.
  assert.equal(PAPER_SIZES['80mm'], '80mm 210mm')
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

// The paper the driver offers. A till printer presents fixed media to Windows,
// not a continuous roll, so these are the only three lengths a page can be if
// Chrome is to lay it out at 1:1 rather than floating or shrinking it.
const DRIVER_MEDIA = ['80mm 210mm', '80mm 297mm', '80mm 3276mm']

test('the roll is set to a paper the printer actually has', () => {
  // The failure this catches is the one that reached the shop: an 80mm page of
  // some other length is not printed short, it is printed adrift in the middle
  // of the driver's own page, with a band of blank above and below it. Any
  // length here has to be one of the three the driver offers, and whichever it
  // is has to be the one the Windows paper setting is on.
  assert.ok(
    DRIVER_MEDIA.includes(PAPER_SIZES['80mm']),
    `${PAPER_SIZES['80mm']} is not a paper this printer offers`,
  )
})

test('receipts are set to a paper that exists', () => {
  // The whole 80mm path can be correct and still print a stamp in the middle of
  // the roll, because this one line was left on A5 from the days of testing on
  // an office printer. That is exactly what happened.
  assert.ok(PAPER_SIZES[RECEIPT_PAPER], `RECEIPT_PAPER is ${RECEIPT_PAPER}, which is not a paper`)
})

test('the till roll is what a till prints on', () => {
  assert.equal(RECEIPT_PAPER, '80mm')
})
