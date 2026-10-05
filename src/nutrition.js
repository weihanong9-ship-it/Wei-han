// Shared by the Node server and the browser (GitHub Pages build).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FoodLoopNutrition = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Approximate nutrition per 100 g (edible portion; grains and pulses as cooked),
  // rounded from typical food-composition averages such as USDA FoodData Central.
  // Columns: food, aliases matched against item names, kcal, protein g, carbs g,
  // fat g, fibre g, notable nutrients.
  const ROWS = [
    // Fruit
    ['Apple', ['apple'], 52, 0.3, 13.8, 0.2, 2.4, ['Fibre', 'Vitamin C']],
    ['Avocado', ['avocado'], 160, 2, 8.5, 14.7, 6.7, ['Healthy fats', 'Potassium']],
    ['Banana', ['banana'], 89, 1.1, 22.8, 0.3, 2.6, ['Potassium', 'Vitamin B6']],
    ['Blueberries', ['blueberry', 'berry'], 57, 0.7, 14.5, 0.3, 2.4, ['Vitamin C', 'Vitamin K']],
    ['Grapes', ['grape'], 69, 0.7, 18.1, 0.2, 0.9, ['Vitamin K']],
    ['Mango', ['mango'], 60, 0.8, 15, 0.4, 1.6, ['Vitamin C', 'Vitamin A']],
    ['Orange', ['orange'], 47, 0.9, 11.8, 0.1, 2.4, ['Vitamin C']],
    ['Pear', ['pear'], 57, 0.4, 15.2, 0.1, 3.1, ['Fibre']],
    ['Strawberries', ['strawberry'], 32, 0.7, 7.7, 0.3, 2, ['Vitamin C']],
    // Vegetables
    ['Bell pepper', ['pepper', 'capsicum'], 31, 1, 6, 0.3, 2.1, ['Vitamin C', 'Vitamin A']],
    ['Broccoli', ['broccoli'], 34, 2.8, 6.6, 0.4, 2.6, ['Vitamin C', 'Vitamin K']],
    ['Cabbage', ['cabbage'], 25, 1.3, 5.8, 0.1, 2.5, ['Vitamin C', 'Vitamin K']],
    ['Carrot', ['carrot'], 41, 0.9, 9.6, 0.2, 2.8, ['Vitamin A']],
    ['Cauliflower', ['cauliflower'], 25, 1.9, 5, 0.3, 2, ['Vitamin C']],
    ['Celery', ['celery'], 16, 0.7, 3, 0.2, 1.6, ['Vitamin K']],
    ['Cucumber', ['cucumber'], 15, 0.7, 3.6, 0.1, 0.5, ['Vitamin K']],
    ['Garlic', ['garlic'], 149, 6.4, 33, 0.5, 2.1, ['Vitamin B6', 'Manganese']],
    ['Lettuce', ['lettuce', 'salad'], 15, 1.4, 2.9, 0.2, 1.3, ['Vitamin K', 'Vitamin A']],
    ['Mushrooms', ['mushroom'], 22, 3.1, 3.3, 0.3, 1, ['B vitamins']],
    ['Onion', ['onion'], 40, 1.1, 9.3, 0.1, 1.7, ['Vitamin C']],
    ['Potato', ['potato'], 77, 2, 17.5, 0.1, 2.2, ['Potassium', 'Vitamin C']],
    ['Spinach', ['spinach'], 23, 2.9, 3.6, 0.4, 2.2, ['Iron', 'Folate', 'Vitamin K']],
    ['Spring onion', ['spring onion', 'scallion'], 32, 1.8, 7.3, 0.2, 2.6, ['Vitamin K']],
    ['Sweet potato', ['sweet potato'], 86, 1.6, 20.1, 0.1, 3, ['Vitamin A']],
    ['Tomato', ['tomato'], 18, 0.9, 3.9, 0.2, 1.2, ['Vitamin C']],
    ['Zucchini', ['zucchini', 'courgette'], 17, 1.2, 3.1, 0.3, 1, ['Vitamin C']],
    // Pulses
    ['Chickpeas (cooked)', ['chickpea'], 164, 8.9, 27.4, 2.6, 7.6, ['Protein', 'Fibre', 'Folate']],
    ['Corn', ['corn', 'sweetcorn'], 86, 3.3, 19, 1.4, 2, ['Fibre']],
    ['Kidney beans (cooked)', ['bean'], 127, 8.7, 22.8, 0.5, 6.4, ['Protein', 'Fibre', 'Iron']],
    ['Lentils (cooked)', ['lentil'], 116, 9, 20, 0.4, 7.9, ['Protein', 'Iron', 'Folate']],
    ['Peas', ['pea'], 81, 5.4, 14.5, 0.4, 5.7, ['Protein', 'Fibre', 'Vitamin C']],
    // Dairy & eggs
    ['Butter', ['butter'], 717, 0.9, 0.1, 81.1, 0, ['Vitamin A']],
    ['Cheese (cheddar)', ['cheese', 'cheddar'], 403, 24.9, 1.3, 33.1, 0, ['Calcium', 'Protein']],
    ['Coconut milk', ['coconut milk'], 230, 2.3, 5.5, 23.8, 2.2, ['Manganese']],
    ['Cream', ['cream'], 340, 2.1, 2.8, 36, 0, ['Vitamin A']],
    ['Eggs', ['egg'], 143, 12.6, 0.7, 9.5, 0, ['Protein', 'Vitamin B12']],
    ['Greek yoghurt', ['greek yoghurt', 'greek yogurt'], 97, 9, 3.6, 5, 0, ['Protein', 'Calcium']],
    ['Milk (whole)', ['milk'], 61, 3.2, 4.8, 3.3, 0, ['Calcium', 'Vitamin B12']],
    ['Yoghurt (plain)', ['yoghurt', 'yogurt'], 61, 3.5, 4.7, 3.3, 0, ['Calcium', 'Probiotics']],
    // Meat, fish & alternatives
    ['Bacon', ['bacon'], 417, 12.6, 1.4, 40, 0, ['Protein']],
    ['Beef mince', ['beef', 'mince', 'steak'], 254, 17.2, 0, 20, 0, ['Protein', 'Iron', 'Vitamin B12']],
    ['Chicken', ['chicken'], 120, 22.5, 0, 2.6, 0, ['Protein', 'Vitamin B6']],
    ['Ham', ['ham'], 145, 21, 1.5, 6, 0, ['Protein']],
    ['Pork', ['pork'], 242, 27, 0, 14, 0, ['Protein', 'Vitamin B1']],
    ['Salmon', ['salmon', 'fish'], 208, 20, 0, 13, 0, ['Omega-3', 'Protein', 'Vitamin D']],
    ['Tofu', ['tofu'], 76, 8, 1.9, 4.8, 0.3, ['Protein', 'Calcium']],
    // Bakery & grains
    ['Bread', ['bread', 'bagel', 'baguette', 'loaf'], 265, 9, 49, 3.2, 2.7, ['Fibre', 'B vitamins']],
    ['Flour', ['flour'], 364, 10.3, 76.3, 1, 2.7, ['B vitamins']],
    ['Noodles (cooked)', ['noodle'], 138, 4.5, 25, 2.1, 1.2, []],
    ['Oats', ['oat', 'porridge'], 389, 16.9, 66.3, 6.9, 10.6, ['Fibre', 'Iron']],
    ['Pasta (cooked)', ['pasta', 'spaghetti'], 158, 5.8, 31, 0.9, 1.8, []],
    ['Peanut butter', ['peanut butter'], 588, 25, 20, 50, 6, ['Protein', 'Healthy fats']],
    ['Rice (cooked)', ['rice'], 130, 2.7, 28, 0.3, 0.4, []],
    ['Tortilla wraps', ['tortilla', 'wrap'], 310, 8, 52, 7.5, 3, []],
  ];

  return ROWS.map(([food, aliases, kcal, protein, carbs, fat, fibre, highlights]) => ({
    food, aliases, per100g: { kcal, protein, carbs, fat, fibre }, highlights,
  }));
}));
