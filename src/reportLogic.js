// Pure report/scope-filtering logic, deliberately free of any Firebase or
// browser dependency. This is imported by both the app (src/store.js) and
// the Node script that emails monthly reports (scripts/send-monthly-reports.mjs),
// so the two can never drift apart on what a "report" actually contains.
import { parseLocalDate } from './dateUtils.js';

// Personal by default -- deleted/missing cards fall back to personal so
// nothing silently disappears from a scoped view.
export function getCardScope(cards, cardId) {
  const card = cards.find(c => c.id === cardId);
  return (card && card.scope) || 'personal';
}

// Cards belonging to the given scope ('personal' | 'business' | 'all')
export function getCardsForScope(cards, scope = 'all') {
  if (scope === 'all') return cards;
  return cards.filter(c => (c.scope || 'personal') === scope);
}

// Transactions whose card belongs to the given scope ('personal' | 'business' | 'all')
export function getTransactionsForScope(cards, transactions, scope = 'all') {
  if (scope === 'all') return transactions;
  return transactions.filter(tx => getCardScope(cards, tx.cardId) === scope);
}

// Builds a consolidated report for one calendar month across every card
// (this is the actual point of it -- individual card statements only show
// that one card; this shows everything together with each transaction's
// card clearly attributed), optionally filtered to Personal or Business.
export function generateMonthlyReportData(cards, transactions, year, month, scope = 'all') {
  const scopedCards = getCardsForScope(cards, scope);
  const cardIds = new Set(scopedCards.map(c => c.id));

  const monthTxs = getTransactionsForScope(cards, transactions, scope).filter(tx => {
    const d = parseLocalDate(tx.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const purchases = monthTxs.filter(tx => tx.type !== 'payment');
  const payments = monthTxs.filter(tx => tx.type === 'payment');

  const totalSpent = purchases.reduce((sum, tx) => sum + tx.amount, 0);
  const totalPayments = payments.reduce((sum, tx) => sum + tx.amount, 0);

  // Group purchases by card, including cards with zero activity that month
  // so the report shows a complete picture of every card in scope.
  const cardBreakdown = scopedCards.map(card => {
    const cardTxs = purchases
      .filter(tx => tx.cardId === card.id)
      .sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
    return {
      card,
      transactions: cardTxs,
      subtotal: cardTxs.reduce((sum, tx) => sum + tx.amount, 0)
    };
  }).filter(entry => entry.transactions.length > 0);

  // Purchases whose card was later deleted (cardId no longer resolves)
  const unlinkedTransactions = purchases
    .filter(tx => !tx.cardId || !cardIds.has(tx.cardId))
    .sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));

  const categoryTotals = {};
  purchases.forEach(tx => {
    categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
  });

  return {
    year,
    month,
    scope,
    totalSpent,
    totalPayments,
    cardBreakdown,
    unlinkedTransactions,
    categoryTotals
  };
}
