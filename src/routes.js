// The FoodLoop API, independent of transport. The Node server calls it over
// HTTP; the static GitHub Pages build calls it directly in the browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic'), require('./recipes'));
  else root.FoodLoopRoutes = factory(root.FoodLoopLogic, root.FoodLoopRecipes);
}(typeof self !== 'undefined' ? self : this, function (logic, recipes) {
  'use strict';

  class HttpError extends Error {
    constructor(status, message, details) {
      super(message);
      this.status = status;
      this.details = details;
    }
  }

  function validated(result) {
    if (result.errors) throw new HttpError(400, 'Validation failed', result.errors);
    return result.value;
  }

  // `store` must provide list/find/insert/update/remove; `now` returns a Date.
  function createRoutes({ store, now = () => new Date() }) {
    // Each route: [method, pattern, handler(params, body, searchParams)].
    // A handler returns a payload (status 200) or [status, payload].
    const routes = [
      ['GET', /^\/api\/pantry$/, (p, b, query) => {
        const showAll = query.get('all') === '1';
        const items = store.list('pantry').filter((i) => showAll || !i.outcome);
        return logic.sortByExpiry(items).map((i) => logic.decoratePantryItem(i, now()));
      }],
      ['POST', /^\/api\/pantry$/, (p, body) => {
        const value = validated(logic.validatePantryItem(body));
        return [201, logic.decoratePantryItem(store.insert('pantry', { ...value, outcome: null }), now())];
      }],
      ['PATCH', /^\/api\/pantry\/([\w-]+)$/, ([id], body) => {
        const item = store.find('pantry', id);
        if (!item) throw new HttpError(404, 'Item not found');
        if (!logic.OUTCOMES.includes(body.outcome)) {
          throw new HttpError(400, `outcome must be one of: ${logic.OUTCOMES.join(', ')}`);
        }
        if (item.outcome) throw new HttpError(409, 'Item already resolved');
        const updated = store.update('pantry', id, { outcome: body.outcome, resolvedAt: now().toISOString() });
        return logic.decoratePantryItem(updated, now());
      }],
      ['DELETE', /^\/api\/pantry\/([\w-]+)$/, ([id]) => {
        if (!store.remove('pantry', id)) throw new HttpError(404, 'Item not found');
        return [204, null];
      }],
      // Turn a pantry item you won't use into a public listing in one step.
      ['POST', /^\/api\/pantry\/([\w-]+)\/share$/, ([id], body) => {
        const item = store.find('pantry', id);
        if (!item) throw new HttpError(404, 'Item not found');
        if (item.outcome) throw new HttpError(409, 'Item already resolved');
        const listing = validated(logic.validateListing({
          title: item.name,
          expiresOn: item.expiresOn,
          category: item.category,
          weightKg: item.weightKg,
          ...body,
        }));
        const created = store.insert('listings', { ...listing, status: 'available', claimedBy: null, sourceItemId: id });
        store.update('pantry', id, { outcome: 'shared', resolvedAt: now().toISOString() });
        return [201, created];
      }],
      ['GET', /^\/api\/listings$/, () => store.list('listings')
        .filter((l) => logic.isListingVisible(l, now()))
        .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
        .map((l) => ({ ...l, daysLeft: logic.daysUntil(l.expiresOn, now()) }))],
      ['POST', /^\/api\/listings$/, (p, body) => {
        const value = validated(logic.validateListing(body));
        return [201, store.insert('listings', { ...value, status: 'available', claimedBy: null })];
      }],
      ['POST', /^\/api\/listings\/([\w-]+)\/claim$/, ([id], body) => {
        const listing = store.find('listings', id);
        if (!listing) throw new HttpError(404, 'Listing not found');
        if (!logic.isListingVisible(listing, now())) throw new HttpError(409, 'Listing is no longer available');
        const claimedBy = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Someone';
        return store.update('listings', id, { status: 'claimed', claimedBy, claimedAt: now().toISOString() });
      }],
      ['GET', /^\/api\/recipes$/, () => logic.suggestRecipes(store.list('pantry'), recipes, now())],
      ['GET', /^\/api\/stats$/, () => {
        const stats = logic.computeStats(store.list('pantry'));
        stats.communityMealsShared = store.list('listings').filter((l) => l.status === 'claimed').length;
        return stats;
      }],
      ['GET', /^\/api\/meta$/, () => ({ categories: logic.CATEGORIES, outcomes: logic.OUTCOMES })],
    ];

    // Finds the matching route, or throws 404/405. Returns a function that
    // runs it with the request body, so callers only read a body when needed.
    function match(method, pathname, searchParams) {
      const candidates = routes.filter(([, pattern]) => pattern.test(pathname));
      if (!candidates.length) throw new HttpError(404, 'Not found');
      const route = candidates.find(([m]) => m === method);
      if (!route) throw new HttpError(405, 'Method not allowed');
      const params = pathname.match(route[1]).slice(1);
      return (body) => {
        const result = route[2](params, body || {}, searchParams);
        return Array.isArray(result) && typeof result[0] === 'number'
          ? { status: result[0], payload: result[1] }
          : { status: 200, payload: result };
      };
    }

    return { match };
  }

  return { HttpError, createRoutes };
}));
