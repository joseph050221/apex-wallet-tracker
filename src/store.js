// Application State Store with LocalStorage Persistence

const DEFAULT_CARDS = [
  {
    id: 'card-1',
    name: 'Chase Sapphire Reserve',
    brand: 'visa',
    last4: '8593',
    color: 'card-theme-blue',
    limit: 20000,
    balance: 1425.80,
    autoSync: true
  },
  {
    id: 'card-2',
    name: 'Amex Gold Card',
    brand: 'amex',
    last4: '1007',
    color: 'card-theme-gold',
    limit: 15000,
    balance: 842.10,
    autoSync: true
  },
  {
    id: 'card-3',
    name: 'Apple Card',
    brand: 'mastercard',
    last4: '4022',
    color: 'card-theme-silver',
    limit: 10000,
    balance: 312.40,
    autoSync: true
  },
  {
    id: 'card-4',
    name: 'Chase Freedom Flex',
    brand: 'visa',
    last4: '6240',
    color: 'card-theme-purple',
    limit: 8000,
    balance: 95.00,
    autoSync: false
  }
];

const DEFAULT_TRANSACTIONS = [
  {
    id: 'tx-1',
    merchant: 'Target Stores',
    amount: 85.20,
    category: 'Shopping',
    cardId: 'card-1',
    date: '2026-06-29',
    source: 'Google Wallet Sync'
  },
  {
    id: 'tx-2',
    merchant: 'Starbucks Coffee',
    amount: 12.50,
    category: 'Dining',
    cardId: 'card-2',
    date: '2026-06-28',
    source: 'Google Wallet Sync'
  },
  {
    id: 'tx-3',
    merchant: 'Uber Trip',
    amount: 22.40,
    category: 'Transport',
    cardId: 'card-1',
    date: '2026-06-27',
    source: 'Google Wallet Sync'
  },
  {
    id: 'tx-4',
    merchant: 'Whole Foods Market',
    amount: 72.10,
    category: 'Groceries',
    cardId: 'card-2',
    date: '2026-06-26',
    source: 'Google Wallet Sync'
  },
  {
    id: 'tx-5',
    merchant: 'Netflix Subscription',
    amount: 15.49,
    category: 'Entertainment',
    cardId: 'card-3',
    date: '2026-06-25',
    source: 'Google Wallet Sync'
  },
  {
    id: 'tx-6',
    merchant: 'Delta Air Lines',
    amount: 249.50,
    category: 'Travel',
    cardId: 'card-1',
    date: '2026-06-24',
    source: 'Google Wallet Sync'
  },
  {
    id: 'tx-7',
    merchant: 'ConEd Utility',
    amount: 112.40,
    category: 'Bills',
    cardId: 'card-4',
    date: '2026-06-20',
    source: 'Manual Input'
  }
];

const DEFAULT_BUDGETS = {
  Dining: 180,
  Shopping: 250,
  Transport: 100,
  Entertainment: 120,
  Bills: 350,
  Groceries: 400,
  Travel: 500
};

class StateStore {
  constructor() {
    this.cards = [];
    this.transactions = [];
    this.walletConnected = false;
    this.connectedEmail = '';
    this.lastSyncTime = null;
    this.settings = {
      autoSync: true,
      notify: true,
      autoCategorize: true,
      theme: 'dark'
    };
    this.categoryBudgets = DEFAULT_BUDGETS;
    this.listeners = [];
    this.loadState();
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

  // Load configuration from local storage
  loadState() {
    try {
      const savedState = localStorage.getItem('apex_wallet_state');
      if (savedState) {
        const parsed = JSON.parse(savedState);
        this.cards = parsed.cards || DEFAULT_CARDS;
        this.transactions = parsed.transactions || DEFAULT_TRANSACTIONS;
        this.walletConnected = parsed.walletConnected ?? false;
        this.connectedEmail = parsed.connectedEmail || '';
        this.lastSyncTime = parsed.lastSyncTime || null;
        this.settings = parsed.settings || this.settings;
        this.categoryBudgets = parsed.categoryBudgets || DEFAULT_BUDGETS;
      } else {
        this.cards = DEFAULT_CARDS;
        this.transactions = DEFAULT_TRANSACTIONS;
        this.walletConnected = false;
        this.connectedEmail = '';
        this.lastSyncTime = null;
        this.categoryBudgets = DEFAULT_BUDGETS;
      }
    } catch (e) {
      console.error('Error loading state from LocalStorage, resetting to defaults.', e);
      this.cards = DEFAULT_CARDS;
      this.transactions = DEFAULT_TRANSACTIONS;
    }
    this.notifyListeners();
  }

  // Save current configurations to local storage
  saveState() {
    try {
      const stateObj = {
        cards: this.cards,
        transactions: this.transactions,
        walletConnected: this.walletConnected,
        connectedEmail: this.connectedEmail,
        lastSyncTime: this.lastSyncTime,
        settings: this.settings,
        categoryBudgets: this.categoryBudgets
      };
      localStorage.setItem('apex_wallet_state', JSON.stringify(stateObj));
    } catch (e) {
      console.error('Error writing to LocalStorage', e);
    }
    this.notifyListeners();
  }

  // Clear data back to initial defaults
  resetState() {
    localStorage.removeItem('apex_wallet_state');
    this.loadState();
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
      balance: 0.00,
      autoSync: this.walletConnected // Set auto-sync enabled automatically if Google Wallet linked
    };

    this.cards.push(newCard);
    this.saveState();
    return newCard;
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

  // Enable/disable card auto sync
  toggleCardSync(cardId, enabled) {
    const card = this.cards.find(c => c.id === cardId);
    if (card) {
      card.autoSync = enabled;
      this.saveState();
      return true;
    }
    return false;
  }

  // Link Google Wallet account
  connectWallet(email) {
    this.walletConnected = true;
    this.connectedEmail = email || 'alex.mercer@gmail.com';
    this.lastSyncTime = new Date().toISOString();
    // Enable autoSync for all existing cards upon wallet connection
    this.cards.forEach(card => {
      card.autoSync = true;
    });
    this.saveState();
  }

  // Disconnect Google Wallet
  disconnectWallet() {
    this.walletConnected = false;
    this.connectedEmail = '';
    this.lastSyncTime = null;
    // Turn off sync for cards
    this.cards.forEach(card => {
      card.autoSync = false;
    });
    this.saveState();
  }

  // Perform a mock manual sync trigger
  triggerSync() {
    if (!this.walletConnected) return false;
    this.lastSyncTime = new Date().toISOString();
    this.saveState();
    return true;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveState();
  }

  // Get metrics and totals
  getMetrics() {
    const totalSpent = this.transactions.reduce((sum, tx) => sum + tx.amount, 0);
    const activeCards = this.cards.length;

    // Last Month Total Spend comparison (mocked to look realistic)
    const prevMonthSpent = totalSpent * 0.92;
    const percentageDiff = prevMonthSpent > 0 ? ((totalSpent - prevMonthSpent) / prevMonthSpent) * 100 : 0;

    // Spending breakdown by Category
    const categoryTotals = {};
    this.transactions.forEach(tx => {
      categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
    });

    // Spending breakdown by Card
    const cardTotals = {};
    this.transactions.forEach(tx => {
      if (tx.cardId) {
        cardTotals[tx.cardId] = (cardTotals[tx.cardId] || 0) + tx.amount;
      }
    });

    return {
      totalSpent,
      percentageChange: percentageDiff.toFixed(1),
      activeCards,
      categoryTotals,
      cardTotals
    };
  }
}

export const store = new StateStore();
export default store;
