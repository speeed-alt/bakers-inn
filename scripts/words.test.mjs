import test from 'node:test'
import assert from 'node:assert/strict'
import { amountInWords, numberInWords } from '../src/lib/words.js'

test('the small numbers', () => {
  assert.equal(numberInWords(0), 'ZERO')
  assert.equal(numberInWords(7), 'SEVEN')
  assert.equal(numberInWords(13), 'THIRTEEN')
  assert.equal(numberInWords(20), 'TWENTY')
})

test('above twenty the two halves are hyphenated, as the printed bills have it', () => {
  assert.equal(numberInWords(86), 'EIGHTY-SIX')
  assert.equal(numberInWords(41), 'FORTY-ONE')
  assert.equal(numberInWords(90), 'NINETY')
})

test('hundreds', () => {
  assert.equal(numberInWords(100), 'ONE HUNDRED')
  assert.equal(numberInWords(220), 'TWO HUNDRED TWENTY')
  assert.equal(numberInWords(986), 'NINE HUNDRED EIGHTY-SIX')
})

test('the figure off the shop receipt that prompted this', () => {
  assert.equal(numberInWords(6986), 'SIX THOUSAND NINE HUNDRED EIGHTY-SIX')
  assert.equal(numberInWords(8520), 'EIGHT THOUSAND FIVE HUNDRED TWENTY')
})

test('counting is in lakh and crore, because that is what the number means here', () => {
  assert.equal(numberInWords(100000), 'ONE LAKH')
  assert.equal(numberInWords(1234567), 'TWELVE LAKH THIRTY-FOUR THOUSAND FIVE HUNDRED SIXTY-SEVEN')
  assert.equal(numberInWords(10000000), 'ONE CRORE')
  assert.equal(numberInWords(25000000), 'TWO CRORE FIFTY LAKH')
})

test('a round thousand does not trail an empty hundreds', () => {
  assert.equal(numberInWords(5000), 'FIVE THOUSAND')
  assert.equal(numberInWords(1000000), 'TEN LAKH')
})

test('the line that goes under the total', () => {
  assert.equal(amountInWords(6986), 'RUPEES SIX THOUSAND NINE HUNDRED EIGHTY-SIX ONLY')
  assert.equal(amountInWords(0), 'RUPEES ZERO ONLY')
})

test('a refund says so, because a refund slip that reads like a bill gets paid twice', () => {
  assert.equal(
    amountInWords(-450),
    'RUPEES FOUR HUNDRED FIFTY ONLY REFUNDED',
  )
})

test('rubbish is nothing rather than NaN', () => {
  assert.equal(amountInWords(null), 'RUPEES ZERO ONLY')
  assert.equal(amountInWords(undefined), 'RUPEES ZERO ONLY')
})
