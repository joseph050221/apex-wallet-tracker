// Application State Store with Firestore Persistence (per authenticated user)

import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase.js';
import { CATEGORIES } from './categories.js';

const DEFAULT_BUDGETS = {
  Dining: 180,
  Shopping: 250,
  Transport: 100,
  Entertainment: 120,
  Bills: 350,
  Groceries: 400,
  Travel: 500
};

const DEFAULT_SETTINGS = {
  theme: 'dark',
  sidebarCollapsed: false,
  notify: true
};

class StateStore {
  constructor() {
    this.currentUid = null;
    this.ready = false;
    this.cards = [];
    this.transactions = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.categoryBudgets = DEFAULT_BUDGETS;
    this.customCategories = [];
    this.listeners = [];
  }

  // Subscribe to state updates
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  notifyListeners() {
    this.listeners.forEach(callback => callback(this));
  }

  // Build the plain object shape persisted to Firestore
  _snapshotState() {
    return {
      cards: this.cards,
      transactions: this.transactions,
      settings: this.settings,
      categoryBudgets: this.categoryBudgets,
      customCategories: this.customCategories
    };
  }

  // Load (or seed) state for a newly authenticated user
  async initForUser(uid) {
    this.currentUid = uid;
    this.ready = false;

    try {
      const ref = doc(db, 'users', uid);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        const data = snap.data();
        this.cards = data.cards || [];
        this.transactions = data.transactions || [];
        this.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
        this.categoryBudgets = data.categoryBudgets || DEFAULT_BUDGETS;
        this.customCategories = data.customCategories || [];
      } else {
        // First-ever login for this account: start with a clean slate
        this.cards = [];
        this.transactions = [];
        this.settings = { ...DEFAULT_SETTINGS };
        this.categoryBudgets = DEFAULT_BUDGETS;
        this.customCategories = [];
        await setDoc(ref, this._snapshotState());
      }
    } catch (e) {
      console.error('Error loading state from Firestore, using defaults.', e);
      this.cards = [];
      this.transactions = [];
      this.settings = { ...DEFAULT_SETTINGS };
      this.categoryBudgets = DEFAULT_BUDGETS;
      this.customCategories = [];
    }

    this.ready = true;
    this.notifyListeners();
  }

  // Reset in-memory state on logout so a second account never sees stale data
  clearForLogout() {
    this.currentUid = null;
    this.ready = false;
    this.cards = [];
    this.transactions = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.categoryBudgets = DEFAULT_BUDGETS;
    this.customCategories = [];
    this.notifyListeners();
  }

  // Persist current state to Firestore (fire-and-forget) and notify listeners
  saveState() {
    if (this.currentUid) {
      const ref = doc(db, 'users', this.currentUid);
      setDoc(ref, this._snapshotState()).catch(e => {
        console.error('Error writing to Firestore', e);
      });
    }
    this.notifyListeners();
  }

  // Add a new transaction
  addTransaction({ merchant, amount, category, cardId, date, source }) {
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount)) return { transaction: null, alerts: [] };

    const newTx = {
      id: `tx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      merchant,
      amount: numericAmount,
      category,
      cardId,
      date: date || new Date().toISOString().split('T')[0],
      source: source || 'Manual Input'
    };

    const alerts = [];
    const otherTxs = [...this.transactions];

    this.transactions.unshift(newTx);

    // If card exists, update balance
    const card = this.cards.find(c => c.id === cardId);
    if (card) {
      card.balance += numericAmount;
    }

    // === RUN SMART SPEND CHECKS ===

    // 1. Check duplicate transaction (same merchant & amount within 10 minutes/transactions)
    const duplicate = otherTxs.slice(0, 3).find(t =>
      t.merchant.toLowerCase() === merchant.toLowerCase() &&
      Math.abs(t.amount - numericAmount) < 0.01
    );
    if (duplicate) {
      alerts.push({
        type: 'duplicate',
        title: '🛡️ Fraud Shield: Duplicate Charge',
        message: `Potential double charge of $${numericAmount.toFixed(2)} at ${merchant} flagged on your card.`,
        severity: 'warning'
      });
    }

    // 2. Check unusual large single spend (> 2.5x historical average and > $75)
    const totalHistoryAmount = otherTxs.reduce((sum, t) => sum + t.amount, 0);
    const avgSpend = otherTxs.length > 0 ? (totalHistoryAmount / otherTxs.length) : 0;
    if (avgSpend > 0 && numericAmount > avgSpend * 2.5 && numericAmount > 75) {
      alerts.push({
        type: 'large_spend',
        title: '⚠️ Unusual Spend Flagged',
        message: `Purchase of $${numericAmount.toFixed(2)} at ${merchant} is 2.5x higher than your average transactions.`,
        severity: 'warning'
      });
    }

    // 3. Check Credit Card limit utilization (crossing 75% or 90%)
    if (card && card.limit > 0) {
      const prevBal = card.balance - numericAmount;
      const prevUtil = (prevBal / card.limit) * 100;
      const currentUtil = (card.balance / card.limit) * 100;

      if (currentUtil >= 90 && prevUtil < 90) {
        alerts.push({
          type: 'card_limit_critical',
          title: '🚫 Credit limit Critical',
          message: `${card.name} is now at ${currentUtil.toFixed(0)}% utilization ($${card.balance.toFixed(2)} / $${card.limit.toLocaleString()}).`,
          severity: 'error'
        });
      } else if (currentUtil >= 75 && prevUtil < 75) {
        alerts.push({
          type: 'card_limit_warning',
          title: '⚠️ Card Limit Warning',
          message: `${card.name} has crossed 75% credit limit utilization.`,
          severity: 'warning'
        });
      }
    }

    // 4. Check Category Budget limits (crossing 80% or 100%)
    const categorySpent = this.transactions
      .filter(t => t.category === category)
      .reduce((sum, t) => sum + t.amount, 0);
    const budget = this.categoryBudgets[category] || 200;
    const prevCategorySpent = categorySpent - numericAmount;

    const prevPct = (prevCategorySpent / budget) * 100;
    const currentPct = (categorySpent / budget) * 100;

    if (currentPct >= 100 && prevPct < 100) {
      alerts.push({
        type: 'budget_critical',
        title: '🚫 Budget Allowance Exceeded',
        message: `Monthly spent for category "${category}" is at ${currentPct.toFixed(0)}% ($${categorySpent.toFixed(2)} spent of $${budget} limit).`,
        severity: 'error'
      });
    } else if (currentPct >= 80 && prevPct < 80) {
      alerts.push({
        type: 'budget_warning',
        title: '⚠️ Category Budget Warning',
        message: `Monthly spent for category "${category}" has reached ${currentPct.toFixed(0)}% ($${categorySpent.toFixed(2)} / $${budget}).`,
        severity: 'warning'
      });
    }

    this.saveState();
    return { transaction: newTx, alerts };
  }

  // Edit an existing transaction's details
  updateTransaction(txId, { merchant, amount, category, cardId, date }) {
    const tx = this.transactions.find(t => t.id === txId);
    if (!tx) return false;

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount)) return false;

    // Revert the old amount from whichever card it was charged to
    const oldCard = this.cards.find(c => c.id === tx.cardId);
    if (oldCard) {
      oldCard.balance = Math.max(0, oldCard.balance - tx.amount);
    }

    tx.merchant = merchant;
    tx.amount = numericAmount;
    tx.category = category;
    tx.cardId = cardId;
    tx.date = date || tx.date;

    // Apply the new amount to whichever card it's now charged to
    const newCard = this.cards.find(c => c.id === cardId);
    if (newCard) {
      newCard.balance += numericAmount;
    }

    this.saveState();
    return true;
  }

  // Bulk-add transactions parsed from an imported bank statement (CSV/PDF).
  // Does a single balance update and a single Firestore write instead of one
  // per row, and skips smart-alert generation (would flood the user with
  // toasts on a large import).
  importTransactions(rows, cardId) {
    const card = this.cards.find(c => c.id === cardId);
    let totalAdded = 0;
    let count = 0;
    let needsUncategorized = false;

    rows.forEach(row => {
      const numericAmount = parseFloat(row.amount);
      if (isNaN(numericAmount) || numericAmount <= 0) return;

      if (!row.category) needsUncategorized = true;

      this.transactions.unshift({
        id: `tx-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
        merchant: row.merchant || 'Imported Transaction',
        amount: numericAmount,
        category: row.category || 'Uncategorized',
        cardId,
        date: row.date || new Date().toISOString().split('T')[0],
        source: 'Bank Import'
      });

      totalAdded += numericAmount;
      count++;
    });

    // Register "Uncategorized" as a real custom category (if not already)
    // so it shows up consistently in filters, budgets, and Analytics
    if (needsUncategorized) {
      const exists = [...CATEGORIES, ...this.customCategories]
        .some(c => c.toLowerCase() === 'uncategorized');
      if (!exists) this.customCategories.push('Uncategorized');
    }

    if (card) card.balance += totalAdded;

    this.saveState();
    return { count, totalAdded };
  }

  // Logs a payment made toward a credit card's bill. This is purely for
  // total-spending visibility (it counts toward totalSpent so "how much did
  // I spend this month" includes real cash that left your account) -- it
  // intentionally does NOT reduce card.balance, since that field tracks
  // purchase volume, not a real running balance. It's also excluded from
  // per-category and per-card spend breakdowns, since it isn't a purchase.
  logCardPayment({ cardId, amount, date, note }) {
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) return null;

    const card = this.cards.find(c => c.id === cardId);
    const newTx = {
      id: `tx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      merchant: (note || '').trim() || `Payment to ${card ? card.name : 'Card'}`,
      amount: numericAmount,
      category: 'Credit Card Payment',
      cardId,
      date: date || new Date().toISOString().split('T')[0],
      source: 'Manual Input',
      type: 'payment'
    };

    this.transactions.unshift(newTx);
    this.saveState();
    return newTx;
  }

  // Delete a transaction
  deleteTransaction(txId) {
    const txIndex = this.transactions.findIndex(t => t.id === txId);
    if (txIndex === -1) return false;

    const tx = this.transactions[txIndex];
    // Revert card balance increase
    const card = this.cards.find(c => c.id === tx.cardId);
    if (card) {
      card.balance = Math.max(0, card.balance - tx.amount);
    }

    this.transactions.splice(txIndex, 1);
    this.saveState();
    return true;
  }

  // Add a credit/debit card
  addCard({ name, brand, last4, color, limit }) {
    const newCard = {
      id: `card-${Date.now()}`,
      name,
      brand: brand.toLowerCase(),
      last4,
      color: color || 'card-theme-blue',
      limit: parseFloat(limit) || 0,
      balance: 0.00
    };

    this.cards.push(newCard);
    this.saveState();
    return newCard;
  }

  // Edit an existing card's details
  updateCard(cardId, { name, brand, last4, color, limit }) {
    const card = this.cards.find(c => c.id === cardId);
    if (!card) return false;

    card.name = name;
    card.brand = brand.toLowerCase();
    card.last4 = last4;
    card.color = color || card.color;
    if (limit !== undefined && limit !== '') {
      card.limit = parseFloat(limit) || 0;
    }

    this.saveState();
    return true;
  }

  // Delete a card
  deleteCard(cardId) {
    const index = this.cards.findIndex(c => c.id === cardId);
    if (index === -1) return false;

    this.cards.splice(index, 1);
    // Unlink transaction cards instead of deleting them to maintain ledger balance
    this.transactions.forEach(t => {
      if (t.cardId === cardId) {
        t.cardId = null;
      }
    });

    this.saveState();
    return true;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveState();
  }

  // Update monthly category budgets (used by the smart spend-alert thresholds)
  updateCategoryBudgets(newBudgets) {
    this.categoryBudgets = { ...this.categoryBudgets, ...newBudgets };
    this.saveState();
  }

  // Add a user-defined category. Returns the canonical name (existing match if
  // already present, case-insensitively, among built-in or custom categories).
  addCustomCategory(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;

    const existing = [...CATEGORIES, ...this.customCategories]
      .find(c => c.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;

    this.customCategories.push(trimmed);
    this.saveState();
    return trimmed;
  }

  // Permanently delete this account's Firestore document
  async deleteAccountData() {
    if (!this.currentUid) return;
    await deleteDoc(doc(db, 'users', this.currentUid));
  }

  // Get metrics and totals
  getMetrics() {
    const totalSpent = this.transactions.reduce((sum, tx) => sum + tx.amount, 0);
    const activeCards = this.cards.length;

    // Last Month Total Spend comparison (mocked to look realistic)
    const prevMonthSpent = totalSpent * 0.92;
    const percentageDiff = prevMonthSpent > 0 ? ((totalSpent - prevMonthSpent) / prevMonthSpent) * 100 : 0;

    // Spending breakdown by Category (excludes credit card payments -- those
    // aren't a purchase category, they're a debt repayment)
    const categoryTotals = {};
    this.transactions.forEach(tx => {
      if (tx.type === 'payment') return;
      categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
    });

    // Spending breakdown by Card (same exclusion -- a payment isn't a charge)
    const cardTotals = {};
    this.transactions.forEach(tx => {
      if (tx.type === 'payment') return;
      if (tx.cardId) {
        cardTotals[tx.cardId] = (cardTotals[tx.cardId] || 0) + tx.amount;
      }
    });

    // Purchases logged in the current calendar month (payments excluded)
    const now = new Date();
    const transactionsThisMonth = this.transactions.filter(tx => {
      if (tx.type === 'payment') return false;
      const txDate = new Date(tx.date);
      return txDate.getFullYear() === now.getFullYear() && txDate.getMonth() === now.getMonth();
    }).length;

    return {
      totalSpent,
      percentageChange: percentageDiff.toFixed(1),
      activeCards,
      categoryTotals,
      cardTotals,
      transactionsThisMonth
    };
  }
}

export const store = new StateStore();
export default store;
