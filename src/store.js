// Application State Store with Firestore Persistence (per authenticated user)

import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch, deleteField } from 'firebase/firestore';
import { db } from './firebase.js';
import { CATEGORIES } from './categories.js';
import { parseLocalDate } from './dateUtils.js';
import {
  getCardScope as getCardScopePure,
  getCardsForScope as getCardsForScopePure,
  getTransactionsForScope as getTransactionsForScopePure,
  generateMonthlyReportData as generateMonthlyReportDataPure
} from './reportLogic.js';

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
  notify: true,
  monthlyReportEmailOptIn: false,
  hasSeenTutorial: false,
  welcomeEmailSent: false,
  fullName: ''
};

const DEVELOPER_EMAILS = [
  'josephzhangce0221@gmail.com'
];

class StateStore {
  constructor() {
    this.currentUid = null;
    this.userEmail = '';
    this.ready = false;
    this.cards = [];
    this.transactions = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.categoryBudgets = { ...DEFAULT_BUDGETS };
    this.businessCategoryBudgets = { ...DEFAULT_BUDGETS };
    this.customCategories = [];
    this.listeners = [];
    
    // Firestore operation counters for developer diagnostic dashboard
    this.readCount = 0;
    this.writeCount = 0;
    this.simulatedLatency = false;

    // Developer Impersonation (Inspection) Mode parameters
    this.inspectionMode = false;
    this.inspectedUid = null;
    this.inspectedEmail = '';
    this._backupCards = [];
    this._backupTransactions = [];
    this._backupSettings = {};
  }

  get isDeveloper() {
    return DEVELOPER_EMAILS.map(e => e.toLowerCase()).includes((this.userEmail || '').toLowerCase());
  }

  // Personal by default -- deleted/missing cards fall back to personal so
  // nothing silently disappears from a scoped view.
  getCardScope(cardId) {
    return getCardScopePure(this.cards, cardId);
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

  // Build the plain object shape persisted to Firestore (excludes sub-collections cards and transactions)
  _snapshotState() {
    return {
      settings: this.settings,
      categoryBudgets: this.categoryBudgets,
      businessCategoryBudgets: this.businessCategoryBudgets,
      customCategories: this.customCategories,
      userEmail: this.userEmail
    };
  }

  _saveCardDoc(card) {
    if (this.inspectionMode) return;
    if (this.currentUid) {
      this.writeCount++;
      const run = () => setDoc(doc(db, 'users', this.currentUid, 'cards', card.id), card).catch(e => {
        console.error('Error writing card to Firestore', e);
      });
      if (this.simulatedLatency) setTimeout(run, 2000);
      else run();
    }
  }

  _saveTransactionDoc(tx) {
    if (this.inspectionMode) return;
    if (this.currentUid) {
      this.writeCount++;
      const run = () => setDoc(doc(db, 'users', this.currentUid, 'transactions', tx.id), tx).catch(e => {
        console.error('Error writing transaction to Firestore', e);
      });
      if (this.simulatedLatency) setTimeout(run, 2000);
      else run();
    }
  }

  _deleteCardDoc(cardId) {
    if (this.inspectionMode) return;
    if (this.currentUid) {
      this.writeCount++;
      const run = () => deleteDoc(doc(db, 'users', this.currentUid, 'cards', cardId)).catch(e => {
        console.error('Error deleting card from Firestore', e);
      });
      if (this.simulatedLatency) setTimeout(run, 2000);
      else run();
    }
  }

  _deleteTransactionDoc(txId) {
    if (this.inspectionMode) return;
    if (this.currentUid) {
      this.writeCount++;
      const run = () => deleteDoc(doc(db, 'users', this.currentUid, 'transactions', txId)).catch(e => {
        console.error('Error deleting transaction from Firestore', e);
      });
      if (this.simulatedLatency) setTimeout(run, 2000);
      else run();
    }
  }

  // Load (or seed) state for a newly authenticated user. `email` is stored
  // alongside the data so the monthly report email script (which runs
  // outside the browser, via Firebase Admin SDK) knows where to send it.
  async initForUser(uid, email = '', googleDisplayName = '') {
    this.currentUid = uid;
    this.userEmail = email;
    this.ready = false;

    if (this.simulatedLatency) {
      await new Promise(r => setTimeout(r, 2000));
    }

    try {
      const ref = doc(db, 'users', uid);
      this.readCount++;
      const snap = await getDoc(ref);

      let legacyCards = [];
      let legacyTransactions = [];
      let hasLegacyData = false;

      if (snap.exists()) {
        const data = snap.data();
        
        // Check for legacy fields
        if (data.cards || data.transactions) {
          legacyCards = data.cards || [];
          legacyTransactions = data.transactions || [];
          hasLegacyData = true;
        }

        this.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
        this.categoryBudgets = data.categoryBudgets || { ...DEFAULT_BUDGETS };
        this.businessCategoryBudgets = data.businessCategoryBudgets || { ...DEFAULT_BUDGETS };
        this.customCategories = data.customCategories || [];

        // Save Google display name if no name is currently persisted
        if (!this.settings.fullName && googleDisplayName) {
          this.settings.fullName = googleDisplayName;
          this.writeCount++;
          await setDoc(ref, { settings: { fullName: googleDisplayName } }, { merge: true });
        }
      } else {
        // First-ever login for this account: start with a clean slate
        this.settings = { ...DEFAULT_SETTINGS };
        if (googleDisplayName) {
          this.settings.fullName = googleDisplayName;
        }
        this.categoryBudgets = { ...DEFAULT_BUDGETS };
        this.businessCategoryBudgets = { ...DEFAULT_BUDGETS };
        this.customCategories = [];
        this.writeCount++;
        await setDoc(ref, this._snapshotState());
      }

      if (hasLegacyData) {
        console.log('Migrating legacy data to Firestore sub-collections...');
        this.cards = legacyCards;
        this.transactions = legacyTransactions;

        // Perform migration: write cards
        for (const card of this.cards) {
          this.writeCount++;
          await setDoc(doc(db, 'users', uid, 'cards', card.id), card);
        }

        // Write transactions in chunks of 400
        const batchSize = 400;
        for (let i = 0; i < this.transactions.length; i += batchSize) {
          const chunk = this.transactions.slice(i, i + batchSize);
          this.writeCount++;
          const batch = writeBatch(db);
          for (const tx of chunk) {
            batch.set(doc(db, 'users', uid, 'transactions', tx.id), tx);
          }
          await batch.commit();
        }

        // Remove legacy fields from main user doc
        this.writeCount++;
        await setDoc(ref, {
          ...this._snapshotState(),
          cards: deleteField(),
          transactions: deleteField()
        }, { merge: true });

        console.log('Legacy database migration completed successfully.');
      } else {
        // Load from sub-collections
        this.readCount++;
        const cardsSnap = await getDocs(collection(db, 'users', uid, 'cards'));
        this.cards = [];
        cardsSnap.forEach(doc => {
          this.cards.push(doc.data());
        });

        this.readCount++;
        const txsSnap = await getDocs(collection(db, 'users', uid, 'transactions'));
        this.transactions = [];
        txsSnap.forEach(doc => {
          this.transactions.push(doc.data());
        });
        
        // Sort transactions descending using lexicographical ID comparison
        this.transactions.sort((a, b) => b.id.localeCompare(a.id));
      }
    } catch (e) {
      console.error('Error loading state from Firestore, using defaults.', e);
      this.cards = [];
      this.transactions = [];
      this.settings = { ...DEFAULT_SETTINGS };
      this.categoryBudgets = { ...DEFAULT_BUDGETS };
      this.businessCategoryBudgets = { ...DEFAULT_BUDGETS };
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
    this.categoryBudgets = { ...DEFAULT_BUDGETS };
    this.businessCategoryBudgets = { ...DEFAULT_BUDGETS };
    this.customCategories = [];
    this.notifyListeners();
  }

  // Persist current state to Firestore (fire-and-forget) and notify listeners
  saveState() {
    if (this.inspectionMode) {
      this.notifyListeners();
      return;
    }
    if (this.currentUid) {
      this.writeCount++;
      const ref = doc(db, 'users', this.currentUid);
      const run = () => setDoc(ref, this._snapshotState()).catch(e => {
        console.error('Error writing to Firestore', e);
      });
      if (this.simulatedLatency) setTimeout(run, 2000);
      else run();
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
    const scope = this.getCardScope(cardId);
    // Compare against same-scope history only -- a $500 business flight
    // shouldn't get flagged as "unusual" against personal $50 averages, and
    // vice versa.
    const otherTxs = this.transactions.filter(t => this.getCardScope(t.cardId) === scope);

    this.transactions.unshift(newTx);

    // If card exists, update balance
    const card = this.cards.find(c => c.id === cardId);
    if (card) {
      card.balance += numericAmount;
    }

    // === RUN SMART SPEND CHECKS ===

    // Helper to get creation timestamp from transaction ID
    const getTxTimestamp = (txId) => {
      const parts = (txId || '').split('-');
      if (parts[0] === 'tx' && parts[1]) {
        const ts = parseInt(parts[1], 10);
        return isNaN(ts) ? 0 : ts;
      }
      return 0;
    };

    // 1. Check duplicate transaction (same merchant & amount within 10 minutes)
    const newTxTime = Date.now();
    const duplicate = otherTxs.find(t => {
      const tTime = getTxTimestamp(t.id);
      return tTime > 0 &&
        Math.abs(newTxTime - tTime) < 10 * 60 * 1000 &&
        t.merchant.toLowerCase() === merchant.toLowerCase() &&
        Math.abs(t.amount - numericAmount) < 0.01;
    });
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

    // 4. Check Category Budget limits (crossing 80% or 100%) -- uses the
    // budget set (personal vs business) matching this transaction's card
    const categorySpent = this.transactions
      .filter(t => t.category === category && this.getCardScope(t.cardId) === scope)
      .reduce((sum, t) => sum + t.amount, 0);
    const budgetSet = scope === 'business' ? this.businessCategoryBudgets : this.categoryBudgets;
    const budget = budgetSet[category] || 200;
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

    this._saveTransactionDoc(newTx);
    if (card) {
      this._saveCardDoc(card);
    }
    this.notifyListeners();
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

    this._saveTransactionDoc(tx);
    if (oldCard) this._saveCardDoc(oldCard);
    if (newCard && newCard !== oldCard) this._saveCardDoc(newCard);
    this.notifyListeners();
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
    const newTxs = [];

    rows.forEach(row => {
      const numericAmount = parseFloat(row.amount);
      if (isNaN(numericAmount) || numericAmount <= 0) return;

      if (!row.category) needsUncategorized = true;

      const newTx = {
        id: `tx-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
        merchant: row.merchant || 'Imported Transaction',
        amount: numericAmount,
        category: row.category || 'Uncategorized',
        cardId,
        date: row.date || new Date().toISOString().split('T')[0],
        source: 'Bank Import'
      };

      this.transactions.unshift(newTx);
      newTxs.push(newTx);
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

    if (this.currentUid) {
      if (card) {
        this._saveCardDoc(card);
      }

      const batchSize = 400;
      for (let i = 0; i < newTxs.length; i += batchSize) {
        const chunk = newTxs.slice(i, i + batchSize);
        const batch = writeBatch(db);
        for (const tx of chunk) {
          batch.set(doc(db, 'users', this.currentUid, 'transactions', tx.id), tx);
        }
        batch.commit().catch(e => {
          console.error('Error writing imported transactions batch to Firestore', e);
        });
      }
    }

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
    this._saveTransactionDoc(newTx);
    this.notifyListeners();
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
    this._deleteTransactionDoc(txId);
    if (card) this._saveCardDoc(card);
    this.notifyListeners();
    return true;
  }

  // Add a credit/debit card
  addCard({ name, brand, last4, color, limit, scope }) {
    const newCard = {
      id: `card-${Date.now()}`,
      name,
      brand: brand.toLowerCase(),
      last4,
      color: color || 'card-theme-blue',
      limit: parseFloat(limit) || 0,
      balance: 0.00,
      scope: scope === 'business' ? 'business' : 'personal'
    };

    this.cards.push(newCard);
    this._saveCardDoc(newCard);
    this.notifyListeners();
    return newCard;
  }

  // Edit an existing card's details
  updateCard(cardId, { name, brand, last4, color, limit, scope }) {
    const card = this.cards.find(c => c.id === cardId);
    if (!card) return false;

    card.name = name;
    card.brand = brand.toLowerCase();
    card.last4 = last4;
    card.color = color || card.color;
    if (limit !== undefined && limit !== '') {
      card.limit = parseFloat(limit) || 0;
    }
    if (scope !== undefined) {
      card.scope = scope === 'business' ? 'business' : 'personal';
    }

    this._saveCardDoc(card);
    this.notifyListeners();
    return true;
  }

  // Delete a card
  deleteCard(cardId) {
    const index = this.cards.findIndex(c => c.id === cardId);
    if (index === -1) return false;

    this.cards.splice(index, 1);
    const unlinkedTxs = [];
    // Unlink transaction cards instead of deleting them to maintain ledger balance
    this.transactions.forEach(t => {
      if (t.cardId === cardId) {
        t.cardId = null;
        unlinkedTxs.push(t);
      }
    });

    this._deleteCardDoc(cardId);

    if (this.currentUid && unlinkedTxs.length > 0) {
      const batchSize = 400;
      for (let i = 0; i < unlinkedTxs.length; i += batchSize) {
        const chunk = unlinkedTxs.slice(i, i + batchSize);
        const batch = writeBatch(db);
        for (const tx of chunk) {
          batch.set(doc(db, 'users', this.currentUid, 'transactions', tx.id), tx);
        }
        batch.commit().catch(e => {
          console.error('Error updating transactions in Firestore after card deletion', e);
        });
      }
    }

    this.notifyListeners();
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

  // Same as above, but for business-scoped cards' spending
  updateBusinessCategoryBudgets(newBudgets) {
    this.businessCategoryBudgets = { ...this.businessCategoryBudgets, ...newBudgets };
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

  // Permanently delete this account's Firestore document and all sub-collections
  async deleteAccountData() {
    if (!this.currentUid) return;
    const uid = this.currentUid;
    
    // Delete cards sub-collection documents
    const cardsSnap = await getDocs(collection(db, 'users', uid, 'cards'));
    for (const cardDoc of cardsSnap.docs) {
      await deleteDoc(cardDoc.ref);
    }
    
    // Delete transactions sub-collection documents
    const txsSnap = await getDocs(collection(db, 'users', uid, 'transactions'));
    const txDocs = txsSnap.docs;
    const batchSize = 400;
    for (let i = 0; i < txDocs.length; i += batchSize) {
      const chunk = txDocs.slice(i, i + batchSize);
      const batch = writeBatch(db);
      for (const txDoc of chunk) {
        batch.delete(txDoc.ref);
      }
      await batch.commit();
    }
    
    // Delete main user document
    await deleteDoc(doc(db, 'users', uid));
  }

  // Cards belonging to the given scope ('personal' | 'business' | 'all')
  getCardsForScope(scope = 'all') {
    return getCardsForScopePure(this.cards, scope);
  }

  // Transactions whose card belongs to the given scope ('personal' | 'business' | 'all')
  getTransactionsForScope(scope = 'all') {
    return getTransactionsForScopePure(this.cards, this.transactions, scope);
  }

  // Get metrics and totals, optionally filtered to just Personal or Business cards
  getMetrics(scope = 'all') {
    const cards = this.getCardsForScope(scope);
    const transactions = this.getTransactionsForScope(scope);

    const totalSpent = transactions.reduce((sum, tx) => sum + tx.amount, 0);
    const activeCards = cards.length;

    // Last Month Total Spend comparison (mocked to look realistic)
    const prevMonthSpent = totalSpent * 0.92;
    const percentageDiff = prevMonthSpent > 0 ? ((totalSpent - prevMonthSpent) / prevMonthSpent) * 100 : 0;

    // Spending breakdown by Category (excludes credit card payments -- those
    // aren't a purchase category, they're a debt repayment)
    const categoryTotals = {};
    transactions.forEach(tx => {
      if (tx.type === 'payment') return;
      categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
    });

    // Spending breakdown by Card (same exclusion -- a payment isn't a charge)
    const cardTotals = {};
    transactions.forEach(tx => {
      if (tx.type === 'payment') return;
      if (tx.cardId) {
        cardTotals[tx.cardId] = (cardTotals[tx.cardId] || 0) + tx.amount;
      }
    });

    // Purchases logged in the current calendar month (payments excluded)
    const now = new Date();
    const transactionsThisMonth = transactions.filter(tx => {
      if (tx.type === 'payment') return false;
      const txDate = parseLocalDate(tx.date);
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

  // Builds a consolidated report for one calendar month across every card
  // (this is the actual point of it -- individual card statements only show
  // that one card; this shows everything together with each transaction's
  // card clearly attributed), optionally filtered to Personal or Business.
  // Delegates to reportLogic.js, which is also used by the monthly email script.
  generateMonthlyReportData(year, month, scope = 'all') {
    return generateMonthlyReportDataPure(this.cards, this.transactions, year, month, scope);
  }

  // Developer feature: Fetch all user profiles from the users collection.
  // Securely restricted by Firestore Security Rules to only allow the developer.
  async fetchAllUsers() {
    try {
      const colRef = collection(db, 'users');
      this.readCount++;
      const snap = await getDocs(colRef);
      return snap.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      }));
    } catch (err) {
      console.error('Error fetching all users from Firestore:', err);
      throw err;
    }
  }

  // Seeding tool: Generates 3 mock cards and 12 mock transactions.
  async seedDemoData() {
    if (!this.currentUid) throw new Error("No user signed in to seed.");

    const cardId1 = `card-demo-chase-${Date.now()}`;
    const cardId2 = `card-demo-amex-${Date.now()}`;
    const cardId3 = `card-demo-apple-${Date.now()}`;

    const demoCards = [
      {
        id: cardId1,
        name: 'Chase Sapphire Preferred',
        brand: 'visa',
        last4: '4382',
        color: 'sapphire',
        limit: 15000,
        balance: 368.75,
        scope: 'personal'
      },
      {
        id: cardId2,
        name: 'American Express Gold',
        brand: 'amex',
        last4: '1007',
        color: 'gold',
        limit: 25000,
        balance: 280.49,
        scope: 'personal'
      },
      {
        id: cardId3,
        name: 'Apple Cash Business',
        brand: 'mastercard',
        last4: '8821',
        color: 'dark',
        limit: 10000,
        balance: 914.80,
        scope: 'business'
      }
    ];

    const now = new Date();
    const formatDate = (daysAgo) => {
      const d = new Date(now);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().split('T')[0];
    };

    const demoTxs = [
      {
        id: `tx-demo-1-${Date.now()}`,
        merchant: 'Whole Foods Market',
        amount: 142.80,
        category: 'Groceries',
        cardId: cardId1,
        date: formatDate(1),
        source: 'Manual Input'
      },
      {
        id: `tx-demo-2-${Date.now()}`,
        merchant: 'Starbucks Coffee',
        amount: 12.45,
        category: 'Dining',
        cardId: cardId1,
        date: formatDate(1),
        source: 'Manual Input'
      },
      {
        id: `tx-demo-3-${Date.now()}`,
        merchant: 'Uber Rides',
        amount: 28.50,
        category: 'Transport',
        cardId: cardId1,
        date: formatDate(3),
        source: 'Bank Import'
      },
      {
        id: `tx-demo-4-${Date.now()}`,
        merchant: 'Amazon Shopping',
        amount: 185.00,
        category: 'Shopping',
        cardId: cardId1,
        date: formatDate(4),
        source: 'Bank Import'
      },
      {
        id: `tx-demo-5-${Date.now()}`,
        merchant: 'Netflix Subscription',
        amount: 15.99,
        category: 'Entertainment',
        cardId: cardId2,
        date: formatDate(5),
        source: 'Manual Input'
      },
      {
        id: `tx-demo-6-${Date.now()}`,
        merchant: 'Olive Garden Dining',
        amount: 84.50,
        category: 'Dining',
        cardId: cardId2,
        date: formatDate(6),
        source: 'Manual Input'
      },
      {
        id: `tx-demo-7-${Date.now()}`,
        merchant: 'Shell Gasoline',
        amount: 45.00,
        category: 'Transport',
        cardId: cardId2,
        date: formatDate(7),
        source: 'Manual Input'
      },
      {
        id: `tx-demo-8-${Date.now()}`,
        merchant: 'City Water & Power',
        amount: 135.00,
        category: 'Utilities',
        cardId: cardId2,
        date: formatDate(10),
        source: 'Bank Import'
      },
      {
        id: `tx-demo-9-${Date.now()}`,
        merchant: 'Staples Office Supplies',
        amount: 114.80,
        category: 'Office',
        cardId: cardId3,
        date: formatDate(2),
        source: 'Bank Import'
      },
      {
        id: `tx-demo-10-${Date.now()}`,
        merchant: 'Google Workspace Cloud',
        amount: 50.00,
        category: 'Software',
        cardId: cardId3,
        date: formatDate(5),
        source: 'Manual Input'
      },
      {
        id: `tx-demo-11-${Date.now()}`,
        merchant: 'Delta Airlines Travel',
        amount: 450.00,
        category: 'Travel',
        cardId: cardId3,
        date: formatDate(12),
        source: 'Bank Import'
      },
      {
        id: `tx-demo-12-${Date.now()}`,
        merchant: 'Meta Ads Marketing',
        amount: 300.00,
        category: 'Marketing',
        cardId: cardId3,
        date: formatDate(15),
        source: 'Manual Input'
      }
    ];

    const batch = writeBatch(db);
    this.writeCount++;

    demoCards.forEach(card => {
      batch.set(doc(db, 'users', this.currentUid, 'cards', card.id), card);
    });

    demoTxs.forEach(tx => {
      batch.set(doc(db, 'users', this.currentUid, 'transactions', tx.id), tx);
    });

    await batch.commit();

    this.cards.push(...demoCards);
    this.transactions.push(...demoTxs);
    this.transactions.sort((a, b) => b.id.localeCompare(a.id));

    this.notifyListeners();
  }

  // Developer Impersonation Mode: Backup own data and load target user's records (READ-ONLY)
  async loadInspectedUserState(inspectUid, inspectEmail) {
    if (!this.isDeveloper) throw new Error("Unauthorized.");
    
    // Backup developer state
    if (!this.inspectionMode) {
      this._backupCards = [...this.cards];
      this._backupTransactions = [...this.transactions];
      this._backupSettings = { ...this.settings };
    }

    this.inspectionMode = true;
    this.inspectedUid = inspectUid;
    this.inspectedEmail = inspectEmail;

    try {
      this.readCount++;
      const ref = doc(db, 'users', inspectUid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        this.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      } else {
        this.settings = { ...DEFAULT_SETTINGS };
      }

      this.readCount++;
      const cardsSnap = await getDocs(collection(db, 'users', inspectUid, 'cards'));
      this.cards = [];
      cardsSnap.forEach(doc => {
        this.cards.push(doc.data());
      });

      this.readCount++;
      const txsSnap = await getDocs(collection(db, 'users', inspectUid, 'transactions'));
      this.transactions = [];
      txsSnap.forEach(doc => {
        this.transactions.push(doc.data());
      });

      this.transactions.sort((a, b) => b.id.localeCompare(a.id));
      this.notifyListeners();
    } catch (err) {
      console.error('Failed to load inspected user state:', err);
      this.exitInspectedUserState();
      throw err;
    }
  }

  // Restore developer's own backup data
  exitInspectedUserState() {
    this.inspectionMode = false;
    this.inspectedUid = null;
    this.inspectedEmail = '';

    this.cards = [...this._backupCards];
    this.transactions = [...this._backupTransactions];
    this.settings = { ...this._backupSettings };

    this._backupCards = [];
    this._backupTransactions = [];
    this._backupSettings = {};

    this.notifyListeners();
  }

  // Purge Account Data tool: Deletes all cards and transactions in Firestore under the active user's account.
  async purgeAccountData() {
    if (!this.currentUid) throw new Error("No user signed in to purge.");
    if (this.inspectionMode) throw new Error("Wiping database is blocked in Inspection Mode.");

    const batch = writeBatch(db);
    this.writeCount++;

    this.cards.forEach(card => {
      batch.delete(doc(db, 'users', this.currentUid, 'cards', card.id));
    });

    this.transactions.forEach(tx => {
      batch.delete(doc(db, 'users', this.currentUid, 'transactions', tx.id));
    });

    await batch.commit();

    this.cards = [];
    this.transactions = [];
    this.notifyListeners();
  }
}

export const store = new StateStore();
export default store;
