// Shared category list and color resolution, used by store.js, main.js, and charts.js

export const CATEGORIES = ['Dining', 'Shopping', 'Transport', 'Entertainment', 'Bills', 'Groceries', 'Travel'];

// Display labels that differ from the internal category key
const CATEGORY_LABELS = {
  Bills: 'Bills & Services'
};

export function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category;
}

const BUILTIN_COLORS = {
  Dining: '#f59e0b',
  Shopping: '#ec4899',
  Transport: '#3b82f6',
  Entertainment: '#8b5cf6',
  Bills: '#10b981',
  Groceries: '#06b6d4',
  Travel: '#f43f5e'
};

// Extra palette for user-defined categories, assigned deterministically by name
const CUSTOM_PALETTE = ['#eab308', '#14b8a6', '#a855f7', '#f97316', '#22c55e', '#6366f1', '#e11d48', '#0ea5e9', '#84cc16', '#d946ef'];

export function getCategoryColor(category) {
  if (BUILTIN_COLORS[category]) return BUILTIN_COLORS[category];

  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return CUSTOM_PALETTE[hash % CUSTOM_PALETTE.length];
}

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
