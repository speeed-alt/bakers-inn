import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  businessDateOf,
  nextDate,
  previousDate,
  toISODate,
} from '../src/lib/dates.js'

// A business date is stamped by whatever machine creates the record, from its
// own local clock, against a 04:00 rollover. That is deliberate — it is what
// lets a sale rung at 19:50 and synced at 08:00 the next morning land on the
// right day — but it means every caller inherits the clock it runs on. The
// scheduled jobs run on a GitHub runner, and that is where it went wrong.

test('a date is read off the local clock, not off UTC', () => {
  // toISODate uses local getFullYear/getMonth/getDate. An evening in Karachi is
  // already tomorrow in UTC, and taking the UTC half would file a day's takings
  // one day forward every single night.
  const evening = new Date('2026-08-08T20:30:00')
  assert.equal(toISODate(evening), '2026-08-08')
})

test('trading after midnight still belongs to the day that opened', () => {
  // The whole point of the rollover: a shop closing at 01:00 is still working
  // yesterday, and its takings have to land there.
  assert.equal(businessDateOf(new Date('2026-08-09T01:30:00')), '2026-08-08')
  assert.equal(businessDateOf(new Date('2026-08-09T03:59:00')), '2026-08-08')
})

test('four in the morning starts the new day', () => {
  assert.equal(businessDateOf(new Date('2026-08-09T04:00:00')), '2026-08-09')
  assert.equal(businessDateOf(new Date('2026-08-09T05:00:00')), '2026-08-09')
})

test('the rollover carries backwards across a month and a year', () => {
  assert.equal(businessDateOf(new Date('2026-09-01T02:00:00')), '2026-08-31')
  assert.equal(businessDateOf(new Date('2027-01-01T02:00:00')), '2026-12-31')
})

test('the 05:00 job must run on a clock set to Karachi, not on UTC', () => {
  // The bug this file exists for. A UTC cron at 00:00 is 05:00
  // in Karachi — the schedule is right. But businessDateOf reads the *process*
  // clock, and on a UTC runner that instant is hour 0, which is under the
  // rollover, so it hands back yesterday. The kitchen would have got yesterday's
  // baking list every morning, and the vans yesterday's delivery notes.
  //
  // Both assertions describe the same moment in time.
  const cronFires = new Date('2026-08-14T00:00:00Z')

  const asUtcRunner = new Date(cronFires.toLocaleString('en-US', { timeZone: 'UTC' }))
  assert.equal(businessDateOf(asUtcRunner), '2026-08-13', 'what it did before TZ was set')

  const asKarachi = new Date(cronFires.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  assert.equal(businessDateOf(asKarachi), '2026-08-14', 'what the kitchen actually needs')
})

test('the 06:00 job rebuilds yesterday, and yesterday is one day back', () => {
  // Same trap one hour later: it asks for the previous date, so a runner an
  // hour off the rollover rebuilds the day before yesterday and leaves the
  // owner looking at a blank waste panel for the day that just closed.
  const cronFires = new Date('2026-08-14T01:00:00Z')
  const asKarachi = new Date(cronFires.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  assert.equal(previousDate(businessDateOf(asKarachi)), '2026-08-13')
})

// --- plain date arithmetic -------------------------------------------------

test('adding days crosses months, years and a leap day', () => {
  assert.equal(addDays('2026-08-08', 1), '2026-08-09')
  assert.equal(addDays('2026-08-31', 1), '2026-09-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-08-08', -7), '2026-08-01')
})

test('date arithmetic does not drift across a daylight-saving change', () => {
  // Pakistan does not observe daylight saving, but the machine running a script
  // might. addDays anchors at midday for exactly this reason: from midnight, an
  // hour lost in spring lands the result on the previous date.
  assert.equal(addDays('2026-03-29', 1), '2026-03-30')
  assert.equal(addDays('2026-10-25', 1), '2026-10-26')
})

test('next and previous are the ones the daily cycle actually calls', () => {
  assert.equal(nextDate('2026-08-08'), '2026-08-09')
  assert.equal(previousDate('2026-08-08'), '2026-08-07')
  assert.equal(nextDate(previousDate('2026-08-08')), '2026-08-08')
})
