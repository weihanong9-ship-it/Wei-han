// Shared by the Node server and the browser (GitHub Pages build).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FoodLoopLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Pure business logic: no I/O, so it is easy to test.

  const DAY_MS = 24 * 60 * 60 * 1000;

  // Rough average greenhouse-gas footprint of food that ends up wasted
  // (production + transport + disposal), in kg CO2e per kg of food.
  const CO2E_PER_KG = 2.5;
  const DEFAULT_WEIGHT_KG = 0.3;

  const CATEGORIES = ['produce', 'dairy', 'meat', 'bakery', 'pantry', 'frozen', 'prepared', 'other'];
  const OUTCOMES = ['eaten', 'shared', 'wasted'];

  // Calendar-day difference, so "expires today" is 0 regardless of time of day.
  function daysUntil(dateStr, now = new Date()) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = Date.UTC(y, m - 1, d);
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / DAY_MS);
  }

  function urgency(days) {
    if (days < 0) return 'expired';
    if (days <= 1) return 'critical';
    if (days <= 3) return 'soon';
    return 'ok';
  }

  function isValidDate(str) {
    if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function cleanString(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }

  function parseWeight(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_WEIGHT_KG;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
  }

  function parsePrice(value) {
    if (value === undefined || value === null || value === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 10000 ? n : null;
  }

  // Returns { value } on success or { errors } on failure.
  function validatePantryItem(input) {
    const errors = [];
    const name = cleanString(input && input.name, 80);
    if (!name) errors.push('name is required');
    const expiresOn = input && input.expiresOn;
    if (!isValidDate(expiresOn)) errors.push('expiresOn must be a date in YYYY-MM-DD format');
    const category = CATEGORIES.includes(input && input.category) ? input.category : 'other';
    const weightKg = parseWeight(input && input.weightKg);
    if (weightKg === null) errors.push('weightKg must be a number between 0 and 100');
    const price = parsePrice(input && input.price);
    if (price === null) errors.push('price must be a non-negative number');
    if (errors.length) return { errors };
    return { value: { name, expiresOn, category, weightKg, price } };
  }

  function validateListing(input) {
    const errors = [];
    const title = cleanString(input && input.title, 80);
    if (!title) errors.push('title is required');
    const location = cleanString(input && input.location, 120);
    if (!location) errors.push('location is required');
    const expiresOn = input && input.expiresOn;
    if (!isValidDate(expiresOn)) errors.push('expiresOn must be a date in YYYY-MM-DD format');
    const pickupWindow = cleanString(input && input.pickupWindow, 60);
    const description = cleanString(input && input.description, 400);
    const donor = cleanString(input && input.donor, 60) || 'A neighbour';
    const category = CATEGORIES.includes(input && input.category) ? input.category : 'other';
    const weightKg = parseWeight(input && input.weightKg);
    if (weightKg === null) errors.push('weightKg must be a number between 0 and 100');
    if (errors.length) return { errors };
    return { value: { title, location, expiresOn, pickupWindow, description, donor, category, weightKg } };
  }

  function decoratePantryItem(item, now) {
    const days = daysUntil(item.expiresOn, now);
    return { ...item, daysLeft: days, urgency: urgency(days) };
  }

  // Active items first, most urgent at the top.
  function sortByExpiry(items) {
    return [...items].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.name.localeCompare(b.name));
  }

  function computeStats(items) {
    const stats = {
      eaten: 0, shared: 0, wasted: 0, active: 0,
      savedKg: 0, wastedKg: 0, savedMoney: 0, wastedMoney: 0,
    };
    for (const item of items) {
      if (!item.outcome) { stats.active += 1; continue; }
      stats[item.outcome] += 1;
      if (item.outcome === 'wasted') {
        stats.wastedKg += item.weightKg;
        stats.wastedMoney += item.price || 0;
      } else {
        stats.savedKg += item.weightKg;
        stats.savedMoney += item.price || 0;
      }
    }
    const resolved = stats.eaten + stats.shared + stats.wasted;
    stats.rescueRate = resolved ? Math.round(((stats.eaten + stats.shared) / resolved) * 100) : null;
    stats.co2eSavedKg = round(stats.savedKg * CO2E_PER_KG);
    stats.savedKg = round(stats.savedKg);
    stats.wastedKg = round(stats.wastedKg);
    stats.savedMoney = round(stats.savedMoney);
    stats.wastedMoney = round(stats.wastedMoney);
    return stats;
  }

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  function singular(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
    if (w.endsWith('oes')) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }

  function words(text) {
    return text.split(/\s+/).map(singular).filter(Boolean);
  }

  // An ingredient matches an item when its words appear as whole words in the
  // item name, e.g. "Greek yoghurt" matches "yoghurt", "Tomatoes" matches
  // "tomato", but "Pears" does not match "pea".
  function itemMatchesIngredient(itemName, ingredient) {
    const nameWords = words(itemName);
    const target = words(ingredient);
    if (!target.length) return false;
    for (let i = 0; i + target.length <= nameWords.length; i += 1) {
      if (target.every((t, j) => nameWords[i + j] === t)) return true;
    }
    return false;
  }

  // Rank recipes by how many of the at-risk items they use up.
  // Items expiring sooner weigh more, so the most urgent food gets cooked first.
  function suggestRecipes(items, recipes, now, limit = 5) {
    const atRisk = items
      .filter((i) => !i.outcome)
      .map((i) => decoratePantryItem(i, now))
      .filter((i) => i.daysLeft >= 0 && i.daysLeft <= 5);

    const scored = [];
    for (const recipe of recipes) {
      const uses = [];
      let score = 0;
      for (const item of atRisk) {
        if (recipe.ingredients.some((ing) => itemMatchesIngredient(item.name, ing))) {
          uses.push(item.name);
          score += 6 - item.daysLeft;
        }
      }
      if (uses.length) scored.push({ ...recipe, uses, score });
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return scored.slice(0, limit);
  }

  const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'fibre'];

  // Finds the nutrition row for an item name. Longer aliases are tried first,
  // so "Sweet potatoes" matches "sweet potato" rather than "potato".
  function findNutrition(name, table) {
    let best = null;
    let bestLength = 0;
    for (const row of table) {
      for (const alias of row.aliases) {
        const length = alias.split(/\s+/).length;
        if (length > bestLength && itemMatchesIngredient(name, alias)) {
          best = row;
          bestLength = length;
        }
      }
    }
    return best;
  }

  // Nutrition for the whole item, scaled from per-100 g values by its weight.
  function nutritionFor(item, table) {
    const row = findNutrition(item.name, table);
    if (!row) return null;
    const factor = (item.weightKg * 1000) / 100;
    const amount = {};
    for (const key of NUTRIENTS) {
      amount[key] = key === 'kcal' ? Math.round(row.per100g[key] * factor) : round(row.per100g[key] * factor);
    }
    return { food: row.food, amount, highlights: row.highlights };
  }

  function sumNutrition(amounts) {
    const total = Object.fromEntries(NUTRIENTS.map((k) => [k, 0]));
    for (const amount of amounts) {
      for (const key of NUTRIENTS) total[key] += amount[key];
    }
    for (const key of NUTRIENTS) total[key] = key === 'kcal' ? Math.round(total[key]) : round(total[key]);
    return total;
  }

  function isListingVisible(listing, now) {
    return listing.status === 'available' && daysUntil(listing.expiresOn, now) >= 0;
  }

  return {
    CATEGORIES,
    OUTCOMES,
    CO2E_PER_KG,
    DEFAULT_WEIGHT_KG,
    daysUntil,
    urgency,
    isValidDate,
    validatePantryItem,
    validateListing,
    decoratePantryItem,
    sortByExpiry,
    computeStats,
    itemMatchesIngredient,
    suggestRecipes,
    isListingVisible,
    NUTRIENTS,
    findNutrition,
    nutritionFor,
    sumNutrition,
  };
}));
