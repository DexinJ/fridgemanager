// utils/foodTypeInference.js
// Purpose: infer a food-type label from item name using keyword rules.
// Keep it pure: pass allowedLabels (from preset tags) to enforce "only preset labels".

export const FOOD_TYPE_RULES = [
    {
      label: "Produce",
      keys: [
        "apple",
        "banana",
        "berry",
        "lettuce",
        "spinach",
        "kale",
        "tomato",
        "onion",
        "garlic",
        "potato",
        "avocado",
        "lemon",
        "lime",
        "carrot",
        "broccoli",
        "pepper",
        "cucumber",
        "mushroom",
        "cilantro",
        "ginger",
      ],
    },
    {
      label: "Dairy",
      keys: ["milk", "cheese", "yogurt", "butter", "cream", "half", "mozz", "cheddar", "parmesan", "sour cream"],
    },
    {
      label: "Meat",
      keys: ["beef", "pork", "chicken", "turkey", "bacon", "sausage", "ham", "steak", "ground beef"],
    },
    { label: "Seafood", keys: ["salmon", "tuna", "shrimp", "cod", "tilapia", "crab", "lobster"] },
    { label: "Bakery", keys: ["bread", "bagel", "bun", "tortilla", "croissant", "muffin", "pita"] },
    { label: "Snacks", keys: ["chips", "cracker", "cookie", "popcorn", "nuts", "granola", "pretzel"] },
    { label: "Beverages", keys: ["water", "juice", "soda", "coffee", "tea", "sparkling", "coke"] },
    { label: "Condiments", keys: ["ketchup", "mustard", "mayo", "sauce", "soy", "vinegar", "hot sauce", "salsa", "dressing", "bbq"] },
    { label: "Frozen", keys: ["frozen", "ice cream"] },
    { label: "Prepared", keys: ["meal", "ready", "rotisserie", "deli"] },
  ];
  
  export function inferFoodTypeLabelFromName(name, allowedLabels = null, rules = FOOD_TYPE_RULES) {
    const s = String(name || "").toLowerCase();
  
    const hit = (Array.isArray(rules) ? rules : []).find((r) =>
      (Array.isArray(r?.keys) ? r.keys : []).some((k) => s.includes(String(k).toLowerCase()))
    );
  
    const label = hit?.label || null;
    if (!label) return null;
  
    if (Array.isArray(allowedLabels) && allowedLabels.length > 0) {
      return allowedLabels.includes(label) ? label : null;
    }
  
    return label;
  }
  