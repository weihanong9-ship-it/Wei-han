'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../src/logic');
const recipes = require('../src/recipes');

const NOW = new Date(2026, 9, 5, 15, 30); // 5 Oct 2026, mid-afternoon local time

test('daysUntil counts calendar days regardless of time of day', () => {
  assert.equal(logic.daysUntil('2026-10-05', NOW), 0);
  assert.equal(logic.daysUntil('2026-10-06', NOW), 1);
  assert.equal(logic.daysUntil('2026-10-04', NOW), -1);
  assert.equal(logic.daysUntil('2026-11-05', NOW), 31);
});

test('urgency buckets', () => {
  assert.equal(logic.urgency(-1), 'expired');
  assert.equal(logic.urgency(0), 'critical');
  assert.equal(logic.urgency(1), 'critical');
  assert.equal(logic.urgency(3), 'soon');
  assert.equal(logic.urgency(4), 'ok');
});

test('isValidDate rejects malformed and impossible dates', () => {
  assert.ok(logic.isValidDate('2026-02-28'));
  assert.ok(!logic.isValidDate('2026-02-30'));
  assert.ok(!logic.isValidDate('05/10/2026'));
  assert.ok(!logic.isValidDate(undefined));
});

test('validatePantryItem applies defaults and reports errors', () => {
  const ok = logic.validatePantryItem({ name: '  Milk ', expiresOn: '2026-10-07', category: 'dairy' });
  assert.deepEqual(ok.value, { name: 'Milk', expiresOn: '2026-10-07', category: 'dairy', weightKg: 0.3, price: 0 });

  const unknownCategory = logic.validatePantryItem({ name: 'X', expiresOn: '2026-10-07', category: 'nope' });
  assert.equal(unknownCategory.value.category, 'other');

  const bad = logic.validatePantryItem({ name: '', expiresOn: 'soon', weightKg: -1, price: 'abc' });
  assert.equal(bad.errors.length, 4);
});

test('validateListing requires title, location and date', () => {
  const bad = logic.validateListing({});
  assert.equal(bad.errors.length, 3);
  const ok = logic.validateListing({ title: 'Bagels', location: 'Lobby', expiresOn: '2026-10-06' });
  assert.equal(ok.value.donor, 'A neighbour');
});

test('computeStats tallies outcomes, weight, money and rescue rate', () => {
  const stats = logic.computeStats([
    { outcome: 'eaten', weightKg: 1, price: 3 },
    { outcome: 'shared', weightKg: 0.5, price: 2 },
    { outcome: 'wasted', weightKg: 0.5, price: 1 },
    { outcome: null, weightKg: 1, price: 5 },
  ]);
  assert.equal(stats.active, 1);
  assert.equal(stats.savedKg, 1.5);
  assert.equal(stats.wastedKg, 0.5);
  assert.equal(stats.savedMoney, 5);
  assert.equal(stats.co2eSavedKg, 3.75);
  assert.equal(stats.rescueRate, 67);
  assert.equal(logic.computeStats([]).rescueRate, null);
});

test('itemMatchesIngredient matches whole words and plurals only', () => {
  assert.ok(logic.itemMatchesIngredient('Tomatoes', 'tomato'));
  assert.ok(logic.itemMatchesIngredient('Greek yoghurt', 'yoghurt'));
  assert.ok(logic.itemMatchesIngredient('Strawberries', 'strawberry'));
  assert.ok(logic.itemMatchesIngredient('Apples', 'apple'));
  assert.ok(logic.itemMatchesIngredient('Fresh spring onions', 'spring onion'));
  assert.ok(!logic.itemMatchesIngredient('Pears', 'pea'));
  assert.ok(!logic.itemMatchesIngredient('Eggplant', 'egg'));
});

test('suggestRecipes prioritises recipes using the most urgent food', () => {
  const items = [
    { name: 'Bananas', expiresOn: '2026-10-05', outcome: null },
    { name: 'Carrots', expiresOn: '2026-10-09', outcome: null },
    { name: 'Rice', expiresOn: '2027-01-01', outcome: null }, // not at risk
    { name: 'Eggs', expiresOn: '2026-10-06', outcome: 'eaten' }, // already resolved
    { name: 'Spinach', expiresOn: '2026-10-01', outcome: null }, // already expired
  ];
  const result = logic.suggestRecipes(items, recipes, NOW);
  assert.ok(result.length > 0);
  assert.ok(result[0].uses.includes('Bananas'));
  for (const r of result) {
    assert.ok(!r.uses.includes('Rice'));
    assert.ok(!r.uses.includes('Eggs'));
    assert.ok(!r.uses.includes('Spinach'));
  }
});

test('isListingVisible hides claimed and expired listings', () => {
  assert.ok(logic.isListingVisible({ status: 'available', expiresOn: '2026-10-05' }, NOW));
  assert.ok(!logic.isListingVisible({ status: 'claimed', expiresOn: '2026-10-06' }, NOW));
  assert.ok(!logic.isListingVisible({ status: 'available', expiresOn: '2026-10-04' }, NOW));
});
