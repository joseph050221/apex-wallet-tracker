import './style.css';
import store from './store.js';
import {
  renderDonutChart,
  renderTrendChart,
  renderCardChart,
  updateChartThemes
} from './charts.js';
import {
  signUp,
  signIn,
  signInWithGoogle,
  signOutUser,
  deleteAccount,
  onAuthChange,
  authErrorMessage
} from './auth.js';
import { CATEGORIES, getCategoryColor, getCategoryLabel, hexToRgba } from './categories.js';
import { parseImportFile } from './import.js';
import { parseLocalDate } from './dateUtils.js';

// Sentinel option value that triggers the "add a new category" prompt
const ADD_NEW_CATEGORY_VALUE = '__add_new_category__';

// Neutral color for the "Credit Card Payment" pseudo-category (excluded from
// the regular category color system since it isn't a spending category)
const PAYMENT_BADGE_COLOR = '#64748b';

// Currently selected Spending Trend range, preserved across unrelated re-renders
let currentTrendRange = 'month';

// Currently selected Personal/Business/All scope, applied across Dashboard,
// Analytics, My Cards, and the ledger. Persisted per-account in settings.
let currentScope = 'all';

// The currently signed-in Firebase user object (set by the auth listener)
let currentAuthUser = null;

// TOAST NOTIFICATION MANAGER
const toastManager = {
  show(title, message, type = 'info') {
    const container = document.getElementById('toast-notifications');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast`;

    // Choose icon based on type
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'warning') iconName = 'alert-triangle';

    toast.innerHTML = `
      <div class="toast-icon-box ${type}">
        <i data-lucide="${iconName}"></i>
      </div>
      <div class="toast-details">
        <div class="toast-title">${title}</div>
        <div class="toast-msg">${message}</div>
      </div>
      <button class="toast-close">
        <i data-lucide="x"></i>
      </button>
    `;

    container.appendChild(toast);

    // Initialize icons for the dynamic toast
    if (window.lucide) {
      window.lucide.createIcons();
    }

    // Bind close click
    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    });

    // Auto remove
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
      }
    }, 4500);
  }
};

// PUSH DESKTOP NOTIFICATION SENDER
// Always attempts to notify (no manual settings toggle); requests browser
// permission lazily the first time an alert fires.
function triggerPushNotification(title, body) {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/favicon.svg' });
    } catch (err) {
      console.warn('HTML5 Notification trigger failed', err);
    }
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        try {
          new Notification(title, { body, icon: '/favicon.svg' });
        } catch (err) {
          console.warn('HTML5 Notification trigger failed', err);
        }
      }
    });
  }
}

// ELECTRONIC SPEAKER WARNING BUZZER
function playWarningBeep(isCritical = false) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const audioCtx = new AudioContextClass();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Sawtooth waveform for warnings, sine for info
    osc.type = isCritical ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(isCritical ? 190 : 310, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.04, audioCtx.currentTime);

    osc.start();
    osc.stop(audioCtx.currentTime + (isCritical ? 0.35 : 0.2));
  } catch (e) {
    console.warn('Audio Context warning playback blocked:', e);
  }
}

// SMART ALERTS DISPATCHER
export function triggerSmartAlert(alert) {
  // 1. Map severity to Toast styles
  const toastStyle = alert.severity === 'error' ? 'warning' : 'info';
  toastManager.show(alert.title, alert.message, toastStyle);

  // 2. Play warning tone
  playWarningBeep(alert.severity === 'error');

  // 3. Trigger Browser Web Notification
  triggerPushNotification(alert.title, alert.message);
}

// TAB SYSTEM NAVIGATION
function initTabNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-tab]');
  const panels = document.querySelectorAll('.tab-panel');
  const mainTitle = document.getElementById('page-title-main');
  const mainSubtitle = document.getElementById('page-subtitle-main');

  const subtitles = {
    dashboard: 'Overview of your transactions',
    wallet: 'Manage your credit cards and payment methods',
    analytics: 'Deep dive into spending timeline and categorical distribution'
  };

  const titles = {
    dashboard: 'Dashboard',
    wallet: 'My Cards',
    analytics: 'Analytics'
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');

      // Update Nav active indicator
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // Update Mobile Nav active indicator
      const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
      mobileNavItems.forEach(m => m.classList.remove('active'));
      const activeMobileItem = document.querySelector(`.mobile-nav-item[data-tab="${tab}"]`);
      if (activeMobileItem) activeMobileItem.classList.add('active');

      // Update active panel
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');

      // Update Header Text
      mainTitle.textContent = titles[tab];
      mainSubtitle.textContent = subtitles[tab];

      // Refresh layout-specific actions
      if (tab === 'analytics') {
        renderAnalyticsTrend(currentTrendRange);
      }
    });
  });

  // Bind Mobile Bottom Nav Clicks
  const mobileNavButtons = document.querySelectorAll('.mobile-nav-item');
  mobileNavButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      const matchingDesktopBtn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
      if (matchingDesktopBtn) {
        matchingDesktopBtn.click();
      }
    });
  });

  // Short-cuts
  document.getElementById('btn-view-analytics-shortcut')?.addEventListener('click', () => {
    document.querySelector('[data-tab="analytics"]').click();
  });
}

// THEME TOGGLE (DARK / LIGHT)
function applyThemeFromSettings() {
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');
  const themeText = document.getElementById('theme-text');

  if (store.settings.theme === 'light') {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
    sunIcon.classList.remove('hidden');
    moonIcon.classList.add('hidden');
    themeText.textContent = 'Light Mode';
  } else {
    document.body.classList.remove('light-theme');
    document.body.classList.add('dark-theme');
    sunIcon.classList.add('hidden');
    moonIcon.classList.remove('hidden');
    themeText.textContent = 'Dark Mode';
  }

  updateChartThemes();
}

function bindThemeToggleClick() {
  const toggleBtn = document.getElementById('btn-theme-toggle');

  toggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark-theme');
    store.updateSettings({ theme: isDark ? 'light' : 'dark' });
    applyThemeFromSettings();
    toastManager.show('Theme Updated', `Switched to ${!isDark ? 'Dark' : 'Light'} UI style`, 'info');
  });
}

// RENDERING: DYNAMIC WIDGETS AND LISTS
function renderAppUI() {
  const metrics = store.getMetrics(currentScope);
  const txs = store.getTransactionsForScope(currentScope);
  const cards = store.getCardsForScope(currentScope);

  // 1. DASHBOARD STAT CARDS
  document.getElementById('stat-total-spent').textContent = `$${metrics.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('stat-percentage-change').textContent = `${metrics.percentageChange}%`;
  document.getElementById('stat-active-cards').textContent = metrics.activeCards;
  document.getElementById('stat-transactions-month').textContent = metrics.transactionsThisMonth;

  // 2. RENDER CREDIT CARDS HORIZONTAL SCROLL
  renderDashboardCards(cards);

  // 3. RENDER TRANSACTION LEDGER (with filters)
  renderTransactionsLedger();

  // 4. RENDER PROGRESS CATEGORIES LIST
  renderCategoryProgressList(metrics);

  // 5. RENDER WALLET TAB DETAILS
  renderWalletTabDetails(cards);

  // 6. DRAW CHARTS
  renderDonutChart(metrics);
  renderTrendChart(txs, currentTrendRange);
  renderCardChart(cards, txs);

  // Update Lucide SVG icons in markup
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Render dashboard scroll cards
function renderDashboardCards(cards) {
  const container = document.getElementById('cards-scroll-container');
  if (!container) return;

  container.innerHTML = '';

  if (cards.length === 0) {
    container.innerHTML = `
      <div class="empty-cards-box" style="flex:1; border: 1px dashed var(--border-color); border-radius: 12px; padding: 32px; text-align:center; color: var(--text-secondary);">
        <p>No cards added yet.</p>
        <p style="font-size:12px; margin-top:4px;">Add a new credit card under My Cards.</p>
      </div>
    `;
    return;
  }

  cards.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = `credit-card-widget ${card.color}`;

    // Network name visual representation
    let netLogo = 'VISA';
    if (card.brand === 'mastercard') netLogo = 'Mastercard';
    if (card.brand === 'amex') netLogo = 'AMEX';
    if (card.brand === 'discover') netLogo = 'Discover';

    cardEl.innerHTML = `
      <div class="card-top">
        <div class="card-top-left">
          <span class="card-issuer">${card.name.split(' ')[0]}</span>
          ${card.scope === 'business' ? '<span class="scope-badge business">Business</span>' : ''}
        </div>
        <div class="card-chip"></div>
      </div>
      <div class="card-middle">
        <span class="card-number">•••• •••• •••• ${card.last4}</span>
      </div>
      <div class="card-bottom">
        <div class="card-holder">
          <span class="card-label">Card Brand</span>
          <span class="card-name">${card.name}</span>
        </div>
        <span class="card-network-logo">${netLogo}</span>
      </div>

      <div class="card-balance-overlay">
        <span class="overlay-bal-label">Month Spend:</span>
        <span class="overlay-bal-val">$${card.balance.toFixed(2)}</span>
      </div>
    `;

    // 3D Tilt Glare listener
    cardEl.addEventListener('mousemove', (e) => {
      const rect = cardEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const rx = -( (y - h/2) / h ) * 16; // Up to 16deg rotateX
      const ry = ( (x - w/2) / w ) * 16;  // Up to 16deg rotateY

      cardEl.style.setProperty('--rx', `${rx}deg`);
      cardEl.style.setProperty('--ry', `${ry}deg`);
      cardEl.style.setProperty('--mx', `${(x / w) * 100}%`);
      cardEl.style.setProperty('--my', `${(y / h) * 100}%`);
    });

    cardEl.addEventListener('mouseleave', () => {
      cardEl.style.setProperty('--rx', '0deg');
      cardEl.style.setProperty('--ry', '0deg');
    });

    container.appendChild(cardEl);
  });
}

// Render Transaction Ledger List with dynamic filtering
function renderTransactionsLedger() {
  const tbody = document.getElementById('transactions-tbody');
  if (!tbody) return;

  const searchQuery = document.getElementById('input-search-transactions').value.toLowerCase();
  const categoryFilter = document.getElementById('select-filter-category').value;

  // Filter transactions (scoped to the current Personal/Business/All view)
  let filtered = store.getTransactionsForScope(currentScope).filter(tx => {
    const matchesSearch = tx.merchant.toLowerCase().includes(searchQuery);
    const matchesCategory = categoryFilter === '' || tx.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
          <i data-lucide="inbox" style="width:24px; height:24px; margin-bottom:8px; display:inline-block;"></i>
          <p>No transactions match the filters.</p>
        </td>
      </tr>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  filtered.forEach(tx => {
    const tr = document.createElement('tr');

    // Find card label
    const card = store.cards.find(c => c.id === tx.cardId);
    const cardLabel = card ? `${card.name.split(' ')[0]} (...${card.last4})` : 'Unlinked Card';
    const cardColor = card ? card.color.replace('card-theme-', '') : 'gray';

    // Format Date
    const txDate = parseLocalDate(tx.date);
    const formattedDate = txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Credit card payments aren't a spending category, so they get a
    // neutral color instead of the category color system
    const isPayment = tx.type === 'payment';
    const catColor = isPayment ? PAYMENT_BADGE_COLOR : getCategoryColor(tx.category);
    const catLabel = isPayment ? 'Credit Card Payment' : getCategoryLabel(tx.category);

    // Icon based on how the transaction was logged
    const sourceIconMap = { 'Manual Input': 'edit-2', 'Bank Import': 'upload', 'Payment Simulator': 'nfc' };
    const sourceIcon = sourceIconMap[tx.source] || 'edit-2';

    tr.innerHTML = `
      <td>
        <div class="merchant-info">
          <div class="merchant-icon">${tx.merchant[0].toUpperCase()}</div>
          <div class="merchant-details">
            <span class="merchant-name">${tx.merchant}</span>
            <span class="tag-wallet-badge">
              <i data-lucide="${sourceIcon}"></i>
              <span>${tx.source}</span>
            </span>
          </div>
        </div>
      </td>
      <td>
        <span class="badge-category" style="background-color: ${hexToRgba(catColor, 0.1)}; color: ${catColor};">${catLabel}</span>
      </td>
      <td>
        <div class="card-used-badge">
          <div class="card-indicator-dot" style="background-color: ${catColor};"></div>
          <span>${cardLabel}</span>
        </div>
      </td>
      <td>${formattedDate}</td>
      <td class="text-right amount-value negative">-$${tx.amount.toFixed(2)}</td>
      <td class="text-center">
        <div class="row-action-group">
          <button class="btn-icon-edit btn-edit-tx" data-id="${tx.id}" title="Edit Transaction">
            <i data-lucide="pencil"></i>
          </button>
          <button class="btn-icon-danger btn-delete-tx" data-id="${tx.id}" title="Remove Transaction">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </td>
    `;

    // Bind Edit Event
    tr.querySelector('.btn-edit-tx').addEventListener('click', () => {
      openExpenseModal(tx);
    });

    // Bind Delete Event
    tr.querySelector('.btn-delete-tx').addEventListener('click', () => {
      if (confirm(`Remove transaction for "${tx.merchant}" ($${tx.amount.toFixed(2)})?`)) {
        store.deleteTransaction(tx.id);
        renderAppUI();
        toastManager.show('Ledger Update', `Deleted transaction from ${tx.merchant}`, 'info');
      }
    });

    tbody.appendChild(tr);
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Render progress bars breakdown of categories
function renderCategoryProgressList(metrics) {
  const container = document.getElementById('category-progress-list');
  if (!container) return;

  container.innerHTML = '';
  const total = metrics.totalSpent || 1; // Avoid divide by 0
  const totals = metrics.categoryTotals;

  // Sort categories by volume spent
  const sortedCats = Object.entries(totals).sort((a,b) => b[1] - a[1]);

  if (sortedCats.length === 0) {
    container.innerHTML = `<p style="font-size:13px; text-align:center; color:var(--text-muted); padding: 10px 0;">No categorical spends logged yet.</p>`;
    return;
  }

  sortedCats.forEach(([catName, amount]) => {
    const pct = ((amount / total) * 100).toFixed(0);
    const catColor = getCategoryColor(catName);

    const item = document.createElement('div');
    item.className = 'category-list-item';
    item.innerHTML = `
      <div class="category-item-meta">
        <span class="category-item-name">
          <span class="category-dot" style="background-color: ${catColor};"></span>
          <span>${getCategoryLabel(catName)}</span>
          <span class="category-item-pct">${pct}%</span>
        </span>
        <span class="category-item-amount">$${amount.toFixed(2)}</span>
      </div>
      <div class="category-progress-bar-bg">
        <div class="category-progress-bar-fill" style="width: ${pct}%; background-color: ${catColor};"></div>
      </div>
    `;
    container.appendChild(item);
  });
}

// Render My Cards tab management list
function renderWalletTabDetails(cards) {
  const container = document.getElementById('wallet-cards-detailed-list');
  if (!container) return;

  container.innerHTML = '';

  if (cards.length === 0) {
    container.innerHTML = `
      <div style="border: 1px dashed var(--border-color); border-radius: 12px; padding: 40px 20px; text-align:center; color: var(--text-secondary);">
        <h3>No cards yet</h3>
        <p style="font-size:12px; margin-top:8px;">Add a payment card to start tracking monthly expenditures.</p>
      </div>
    `;
    return;
  }

  cards.forEach(card => {
    const item = document.createElement('div');
    item.className = 'card-manage-item';

    const limitPct = card.limit > 0 ? ((card.balance / card.limit) * 100) : 0;
    const usageColor = limitPct >= 90 ? 'var(--danger)' : limitPct >= 75 ? '#f59e0b' : 'var(--accent)';

    item.innerHTML = `
      <div class="card-manage-visual ${card.color}">
        <span class="mini-network">${card.brand.toUpperCase()}</span>
        <span class="mini-last4">•••• ${card.last4}</span>
      </div>

      <div class="card-manage-info">
        <span class="card-manage-title">${card.name}${card.scope === 'business' ? ' <span class="scope-badge business">Business</span>' : ''}</span>
        <div class="card-manage-meta">
          <span>Spent: <strong class="card-manage-spend">$${card.balance.toFixed(2)}</strong></span>
          ${card.limit > 0 ? `<span>Limit: $${card.limit.toLocaleString()} (${limitPct.toFixed(0)}%)</span>` : '<span>Limit: Uncapped</span>'}
        </div>
        ${card.limit > 0 ? `
          <div class="card-usage-bar-bg">
            <div class="card-usage-bar-fill" style="width: ${Math.min(limitPct, 100)}%; background-color: ${usageColor};"></div>
          </div>
        ` : ''}
      </div>

      <div class="card-manage-actions">
        <button class="btn-icon-edit btn-log-payment" data-id="${card.id}" title="Log a Payment">
          <i data-lucide="banknote"></i>
        </button>
        <button class="btn-icon-edit btn-edit-card" data-id="${card.id}" title="Edit Card">
          <i data-lucide="pencil"></i>
        </button>
        <button class="btn-icon-danger btn-delete-card" data-id="${card.id}" title="Remove Card">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    `;

    // Bind Log Payment button
    item.querySelector('.btn-log-payment').addEventListener('click', () => {
      openPaymentModal(card);
    });

    // Bind Edit Card button
    item.querySelector('.btn-edit-card').addEventListener('click', () => {
      openCardModal(card);
    });

    // Bind Delete Card button
    item.querySelector('.btn-delete-card').addEventListener('click', () => {
      if (confirm(`Are you sure you want to remove card "${card.name}" from your tracker? Transactions will be unlinked but retained.`)) {
        store.deleteCard(card.id);
        toastManager.show('Card Deleted', `Removed ${card.name}`, 'info');
        renderAppUI();
      }
    });

    container.appendChild(item);
  });
}

// Binds the Personal/Business/All switcher (applies globally, not per-tab)
function bindScopeSwitcher() {
  const buttons = document.querySelectorAll('#scope-switcher .btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentScope = btn.getAttribute('data-scope');
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      store.updateSettings({ dashboardScope: currentScope });
      renderAppUI();
      if (document.getElementById('tab-analytics').classList.contains('active')) {
        renderAnalyticsTrend(currentTrendRange);
      }
    });
  });
}

// Syncs the switcher's active button + currentScope with the loaded account
// settings (called once per login, since settings aren't known until then)
function applyScopeFromSettings() {
  currentScope = store.settings.dashboardScope || 'all';
  document.querySelectorAll('#scope-switcher .btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-scope') === currentScope);
  });
}

// Binds the Week/Month/3M/6M/Year buttons above the Spending Trend chart
function bindTrendRangeButtons() {
  const buttons = document.querySelectorAll('#trend-range-group .btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentTrendRange = btn.getAttribute('data-range');
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAnalyticsTrend(currentTrendRange);
    });
  });
}

// RENDERING ANALYTICS DETAIL CARDS
function renderAnalyticsTrend(range = 'month') {
  const scopedTxs = store.getTransactionsForScope(currentScope);
  renderTrendChart(scopedTxs, range);

  const container = document.getElementById('analytics-categories-detailed-grid');
  if (!container) return;

  container.innerHTML = '';
  const metrics = store.getMetrics(currentScope);

  // Create mapping of category to transaction items count
  const categoryCounts = {};
  scopedTxs.forEach(tx => {
    categoryCounts[tx.category] = (categoryCounts[tx.category] || 0) + 1;
  });

  [...CATEGORIES, ...store.customCategories].forEach(cat => {
    const totalSpent = metrics.categoryTotals[cat] || 0.00;
    const count = categoryCounts[cat] || 0;
    const catColor = getCategoryColor(cat);

    // Category icon mapping (for visual decoration; custom categories fall back to dollar-sign)
    let icon = 'dollar-sign';
    if (cat === 'Dining') icon = 'coffee';
    if (cat === 'Shopping') icon = 'shopping-bag';
    if (cat === 'Transport') icon = 'car';
    if (cat === 'Entertainment') icon = 'film';
    if (cat === 'Bills') icon = 'receipt';
    if (cat === 'Groceries') icon = 'shopping-cart';
    if (cat === 'Travel') icon = 'plane';

    const card = document.createElement('div');
    card.className = 'analytics-cat-card';
    card.innerHTML = `
      <div class="cat-card-header">
        <div class="cat-card-title">
          <div class="cat-card-icon" style="background-color: ${catColor}; color:#fff;">
            <i data-lucide="${icon}"></i>
          </div>
          <span>${getCategoryLabel(cat)}</span>
        </div>
        <span class="cat-stat-count">${count} txs</span>
      </div>

      <div class="cat-card-stats">
        <div>
          <div class="cat-stat-lbl">Total Spent</div>
          <div class="cat-stat-val" style="color: ${catColor};">$${totalSpent.toFixed(2)}</div>
        </div>
        <div>
          <div class="cat-stat-lbl">Daily Avg</div>
          <div class="cat-stat-val">$${(totalSpent / 30).toFixed(2)}</div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Populates a <select> with built-in + custom categories, preserving the
// currently selected value if it still exists after repopulating.
function populateCategorySelect(select, { includeAllOption = false, includeAddNew = false } = {}) {
  if (!select) return;
  const previousValue = select.value;
  select.innerHTML = '';

  if (includeAllOption) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'All Categories';
    select.appendChild(opt);
  }

  [...CATEGORIES, ...store.customCategories].forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = getCategoryLabel(cat);
    select.appendChild(opt);
  });

  if (includeAddNew) {
    const opt = document.createElement('option');
    opt.value = ADD_NEW_CATEGORY_VALUE;
    opt.textContent = '+ Add New Category';
    select.appendChild(opt);
  }

  if ([...select.options].some(o => o.value === previousValue)) {
    select.value = previousValue;
  }
}

// EXPENSE MODAL: shared between "Add Expense" and "Edit Transaction"
let editingTransactionId = null;

function populateModalCardsDropdown(selectCardForm = document.getElementById('form-card')) {
  if (!selectCardForm) return;
  selectCardForm.innerHTML = '';

  if (store.cards.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- No cards found --';
    selectCardForm.appendChild(opt);
    return;
  }

  store.cards.forEach(card => {
    const opt = document.createElement('option');
    opt.value = card.id;
    opt.textContent = `${card.name} (...${card.last4})`;
    selectCardForm.appendChild(opt);
  });
}

// Opens the expense modal. Pass a transaction to edit it, or omit to add a new one.
function openExpenseModal(tx = null) {
  populateModalCardsDropdown();
  populateCategorySelect(document.getElementById('form-category'), { includeAddNew: true });
  editingTransactionId = tx ? tx.id : null;

  const title = document.getElementById('expense-modal-title');
  const saveBtn = document.getElementById('btn-save-expense');

  if (tx) {
    title.textContent = 'Edit Expense';
    saveBtn.textContent = 'Save Changes';
    document.getElementById('form-merchant').value = tx.merchant;
    document.getElementById('form-amount').value = tx.amount;
    document.getElementById('form-category').value = tx.category;
    if (tx.cardId) document.getElementById('form-card').value = tx.cardId;
    document.getElementById('form-date').value = tx.date;
  } else {
    title.textContent = 'Add Expense Manually';
    saveBtn.textContent = 'Save Expense';
    document.getElementById('form-add-expense').reset();
    document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
  }

  document.getElementById('modal-add-expense').classList.remove('hidden');
}

// CARD MODAL: shared between "Add New Payment Card" and "Edit Card"
let editingCardId = null;

// Opens the card modal. Pass a card to edit it, or omit to add a new one.
function openCardModal(card = null) {
  editingCardId = card ? card.id : null;

  const title = document.getElementById('card-modal-title');
  const saveBtn = document.getElementById('btn-save-card');

  if (card) {
    title.textContent = 'Edit Payment Card';
    saveBtn.textContent = 'Save Changes';
    document.getElementById('form-card-name').value = card.name;
    document.getElementById('form-card-brand').value = card.brand;
    document.getElementById('form-card-last4').value = card.last4;
    document.getElementById('form-card-limit').value = card.limit;
    document.getElementById('form-card-scope').value = card.scope || 'personal';
    document.getElementById('form-card-color').value = card.color;
  } else {
    title.textContent = 'Add New Payment Card';
    saveBtn.textContent = 'Add Card';
    document.getElementById('form-add-card').reset();
    document.getElementById('form-card-limit').value = 10000;
    // Default to the currently active scope filter, if a specific one is selected
    document.getElementById('form-card-scope').value = currentScope === 'business' ? 'business' : 'personal';
  }

  document.getElementById('modal-add-card').classList.remove('hidden');
}

// IMPORT TRANSACTIONS MODAL
let pendingImportRows = [];

function renderImportPreview() {
  const summary = document.getElementById('import-preview-summary');
  const list = document.getElementById('import-preview-list');
  const preview = document.getElementById('import-preview');
  const confirmBtn = document.getElementById('btn-confirm-import');
  const cardSelect = document.getElementById('import-card-select');

  if (pendingImportRows.length === 0) {
    preview.classList.add('hidden');
    confirmBtn.disabled = true;
    return;
  }

  preview.classList.remove('hidden');
  const total = pendingImportRows.reduce((sum, r) => sum + r.amount, 0);
  summary.textContent = `${pendingImportRows.length} transaction${pendingImportRows.length === 1 ? '' : 's'} found, totaling $${total.toFixed(2)}`;

  list.innerHTML = pendingImportRows.map((row, index) => `
    <div class="import-preview-row">
      <span class="import-preview-date">${row.date}</span>
      <span class="import-preview-merchant" title="${row.merchant}">${row.merchant}${row.category ? ` · ${getCategoryLabel(row.category)}` : ''}</span>
      <span class="import-preview-amount">$${row.amount.toFixed(2)}</span>
      <button type="button" class="import-preview-remove" data-index="${index}" title="Remove this row">
        <i data-lucide="x"></i>
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.import-preview-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingImportRows.splice(parseInt(btn.dataset.index, 10), 1);
      renderImportPreview();
      if (window.lucide) window.lucide.createIcons();
    });
  });

  confirmBtn.disabled = pendingImportRows.length === 0 || !cardSelect.value;

  if (window.lucide) window.lucide.createIcons();
}

function initImportModal() {
  const modal = document.getElementById('modal-import-transactions');
  const btnOpen = document.getElementById('btn-open-import');
  const btnClose = document.getElementById('btn-close-import-modal');
  const btnCancel = document.getElementById('btn-cancel-import-modal');
  const btnConfirm = document.getElementById('btn-confirm-import');
  const fileInput = document.getElementById('import-file-input');
  const cardSelect = document.getElementById('import-card-select');
  const errorText = document.getElementById('import-error-text');
  const statusText = document.getElementById('import-status-text');
  const pdfWarning = document.getElementById('import-pdf-warning');

  const closeModal = () => modal.classList.add('hidden');

  const resetModal = () => {
    pendingImportRows = [];
    fileInput.value = '';
    errorText.classList.add('hidden');
    statusText.classList.add('hidden');
    pdfWarning.classList.add('hidden');
    document.getElementById('import-preview').classList.add('hidden');
    btnConfirm.disabled = true;
  };

  btnOpen?.addEventListener('click', () => {
    populateModalCardsDropdown(cardSelect);
    resetModal();
    modal.classList.remove('hidden');
  });

  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  cardSelect.addEventListener('change', renderImportPreview);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    pendingImportRows = [];
    errorText.classList.add('hidden');
    pdfWarning.classList.add('hidden');
    document.getElementById('import-preview').classList.add('hidden');
    statusText.classList.remove('hidden');
    btnConfirm.disabled = true;

    try {
      const { transactions, error, bestEffort } = await parseImportFile(file);
      statusText.classList.add('hidden');

      if (error) {
        errorText.textContent = error;
        errorText.classList.remove('hidden');
        return;
      }

      pendingImportRows = transactions;
      if (bestEffort) pdfWarning.classList.remove('hidden');
      renderImportPreview();
    } catch (e) {
      console.error('Import parsing failed', e);
      statusText.classList.add('hidden');
      errorText.textContent = 'Something went wrong reading that file.';
      errorText.classList.remove('hidden');
    }
  });

  btnConfirm.addEventListener('click', () => {
    const cardId = cardSelect.value;
    if (!cardId || pendingImportRows.length === 0) return;

    const { count, totalAdded } = store.importTransactions(pendingImportRows, cardId);
    toastManager.show('Import Complete', `Added ${count} transactions totaling $${totalAdded.toFixed(2)}.`, 'success');

    closeModal();
    resetModal();
    renderAppUI();
  });
}

// LOG CARD PAYMENT MODAL
let paymentModalCardId = null;

function openPaymentModal(card) {
  paymentModalCardId = card.id;
  document.getElementById('payment-card-name').textContent = card.name;
  document.getElementById('form-log-payment').reset();
  document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('modal-log-payment').classList.remove('hidden');
}

function initPaymentModal() {
  const modal = document.getElementById('modal-log-payment');
  const btnClose = document.getElementById('btn-close-payment-modal');
  const btnCancel = document.getElementById('btn-cancel-payment-modal');
  const form = document.getElementById('form-log-payment');

  const closeModal = () => modal.classList.add('hidden');
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const amount = document.getElementById('payment-amount').value;
    const date = document.getElementById('payment-date').value;
    const note = document.getElementById('payment-note').value;

    const tx = store.logCardPayment({ cardId: paymentModalCardId, amount, date, note });
    if (tx) {
      toastManager.show('Payment Logged', `Logged a $${parseFloat(amount).toFixed(2)} payment.`, 'success');
    }

    closeModal();
    renderAppUI();
  });
}

// MONTHLY REPORT MODAL
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function renderReport() {
  const picker = document.getElementById('report-month-picker');
  const [yearStr, monthStr] = picker.value.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;

  const data = store.generateMonthlyReportData(year, month, currentScope);
  const body = document.getElementById('report-body');

  const scopeLabel = { personal: 'Personal', business: 'Business', all: 'All Cards' }[data.scope];
  const totalCombined = data.totalSpent + data.totalPayments;

  let html = `
    <div class="report-header">
      <h2>${MONTH_NAMES[month]} ${year} -- ${scopeLabel}</h2>
      <p>Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
    </div>

    <div class="report-summary-stats">
      <div class="report-summary-stat">
        <div class="report-summary-stat-label">Total Purchases</div>
        <div class="report-summary-stat-value">$${data.totalSpent.toFixed(2)}</div>
      </div>
      <div class="report-summary-stat">
        <div class="report-summary-stat-label">Card Payments Made</div>
        <div class="report-summary-stat-value">$${data.totalPayments.toFixed(2)}</div>
      </div>
      <div class="report-summary-stat">
        <div class="report-summary-stat-label">Combined Cash Out</div>
        <div class="report-summary-stat-value">$${totalCombined.toFixed(2)}</div>
      </div>
      <div class="report-summary-stat">
        <div class="report-summary-stat-label">Cards With Activity</div>
        <div class="report-summary-stat-value">${data.cardBreakdown.length}</div>
      </div>
    </div>
  `;

  if (data.cardBreakdown.length === 0 && data.unlinkedTransactions.length === 0) {
    html += `<div class="report-empty-state">No transactions logged for ${MONTH_NAMES[month]} ${year}.</div>`;
  } else {
    const sections = [...data.cardBreakdown];
    if (data.unlinkedTransactions.length > 0) {
      sections.push({
        card: { name: 'Unlinked Transactions', last4: '----', brand: '' },
        transactions: data.unlinkedTransactions,
        subtotal: data.unlinkedTransactions.reduce((s, t) => s + t.amount, 0)
      });
    }

    sections.forEach(({ card, transactions, subtotal }) => {
      html += `
        <div class="report-card-section">
          <div class="report-card-section-header">
            <h4><i data-lucide="credit-card"></i> ${card.name}${card.last4 !== '----' ? ` (...${card.last4})` : ''}</h4>
            <span class="report-card-section-total">$${subtotal.toFixed(2)}</span>
          </div>
          <table class="report-tx-table">
            <thead>
              <tr><th>Date</th><th>Merchant</th><th>Category</th><th style="text-align:right;">Amount</th></tr>
            </thead>
            <tbody>
              ${transactions.map(tx => `
                <tr>
                  <td>${parseLocalDate(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td>${tx.merchant}</td>
                  <td>${getCategoryLabel(tx.category)}</td>
                  <td style="text-align:right;">$${tx.amount.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    });
  }

  body.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

function initReportModal() {
  const modal = document.getElementById('modal-report');
  const btnOpen = document.getElementById('btn-open-report');
  const btnClose = document.getElementById('btn-close-report-modal');
  const picker = document.getElementById('report-month-picker');
  const btnPrint = document.getElementById('btn-print-report');

  btnOpen?.addEventListener('click', () => {
    const now = new Date();
    picker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    renderReport();
    modal.classList.remove('hidden');
  });

  btnClose.addEventListener('click', () => modal.classList.add('hidden'));
  picker.addEventListener('change', renderReport);
  btnPrint.addEventListener('click', () => window.print());
}

// AVATAR RENDERING: shows the user's real photo (Google sign-in) or a
// letter-initial fallback (email/password accounts have no photo)
function applyAvatar(imgEl, fallbackEl, user) {
  if (!imgEl || !fallbackEl || !user) return;

  if (user.photoURL) {
    imgEl.src = user.photoURL;
    imgEl.classList.remove('hidden');
    fallbackEl.classList.add('hidden');
  } else {
    fallbackEl.textContent = (user.email || '?')[0].toUpperCase();
    fallbackEl.classList.remove('hidden');
    imgEl.classList.add('hidden');
  }
}

function renderHeaderAvatar(user) {
  applyAvatar(
    document.getElementById('header-avatar-img'),
    document.getElementById('header-avatar-fallback'),
    user
  );
}

// PROFILE & SETTINGS MODAL
function populateBudgetsGrid(containerId, budgets, inputPrefix) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = [...CATEGORIES, ...store.customCategories].map(cat => `
    <div class="form-group">
      <label for="${inputPrefix}-${cat}">${getCategoryLabel(cat)}</label>
      <input type="number" min="0" step="1" id="${inputPrefix}-${cat}" value="${budgets[cat] || 0}">
    </div>
  `).join('');
}

function openProfileModal() {
  if (!currentAuthUser) return;

  applyAvatar(
    document.getElementById('profile-avatar-img'),
    document.getElementById('profile-avatar-fallback'),
    currentAuthUser
  );

  document.getElementById('profile-email').textContent = currentAuthUser.email || '';

  const createdAt = currentAuthUser.metadata?.creationTime;
  document.getElementById('profile-joined').textContent = createdAt
    ? `Member since ${new Date(createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
    : '';

  populateBudgetsGrid('budgets-grid', store.categoryBudgets, 'budget-input');
  populateBudgetsGrid('business-budgets-grid', store.businessCategoryBudgets, 'business-budget-input');
  updateNotificationStatusUI();

  document.getElementById('modal-profile').classList.remove('hidden');
}

function updateNotificationStatusUI() {
  const statusText = document.getElementById('notification-status-text');
  const enableBtn = document.getElementById('btn-enable-notifications');
  if (!statusText || !enableBtn) return;

  if (!('Notification' in window)) {
    statusText.textContent = 'Desktop notifications are not supported in this browser.';
    enableBtn.classList.add('hidden');
    return;
  }

  if (Notification.permission === 'granted') {
    statusText.textContent = 'Desktop notifications are enabled for spending alerts.';
    enableBtn.classList.add('hidden');
  } else if (Notification.permission === 'denied') {
    statusText.textContent = 'Notifications are blocked. Enable them in your browser\'s site settings.';
    enableBtn.classList.add('hidden');
  } else {
    statusText.textContent = 'Enable desktop notifications to get notified about spending alerts.';
    enableBtn.classList.remove('hidden');
  }
}

function initProfileModal() {
  const modalProfile = document.getElementById('modal-profile');
  const btnOpenProfile = document.getElementById('btn-open-profile');
  const btnCloseProfile = document.getElementById('btn-close-profile-modal');

  btnOpenProfile?.addEventListener('click', openProfileModal);
  btnCloseProfile?.addEventListener('click', () => modalProfile.classList.add('hidden'));

  document.getElementById('btn-save-budgets')?.addEventListener('click', () => {
    const newBudgets = {};
    [...CATEGORIES, ...store.customCategories].forEach(cat => {
      const input = document.getElementById(`budget-input-${cat}`);
      newBudgets[cat] = parseFloat(input.value) || 0;
    });
    store.updateCategoryBudgets(newBudgets);
    toastManager.show('Budgets Updated', 'Your personal category budgets have been saved.', 'success');
  });

  document.getElementById('btn-save-business-budgets')?.addEventListener('click', () => {
    const newBudgets = {};
    [...CATEGORIES, ...store.customCategories].forEach(cat => {
      const input = document.getElementById(`business-budget-input-${cat}`);
      newBudgets[cat] = parseFloat(input.value) || 0;
    });
    store.updateBusinessCategoryBudgets(newBudgets);
    toastManager.show('Budgets Updated', 'Your business category budgets have been saved.', 'success');
  });

  document.getElementById('btn-enable-notifications')?.addEventListener('click', () => {
    Notification.requestPermission().then(() => updateNotificationStatusUI());
  });

  document.getElementById('btn-signout-from-profile')?.addEventListener('click', () => {
    signOutUser();
  });

  document.getElementById('btn-delete-account')?.addEventListener('click', async () => {
    const confirmed = confirm('This will permanently delete your account and all your cards and transactions. This cannot be undone. Continue?');
    if (!confirmed) return;

    const typed = prompt('Type DELETE to confirm.');
    if (typed !== 'DELETE') return;

    try {
      await store.deleteAccountData();
      await deleteAccount();
      toastManager.show('Account Deleted', 'Your account and data have been removed.', 'info');
    } catch (err) {
      toastManager.show('Deletion Failed', authErrorMessage(err), 'warning');
    }
  });
}

// BIND MODAL DIALOGS ACTION EVENT LISTENERS
function initModals() {
  const modalAddExpense = document.getElementById('modal-add-expense');
  const btnQuickAdd = document.getElementById('btn-quick-add');
  const btnCloseExpense = document.getElementById('btn-close-expense-modal');
  const btnCancelExpense = document.getElementById('btn-cancel-expense-modal');
  const formExpense = document.getElementById('form-add-expense');

  // Add Expense Dialog trigger (always opens in "add" mode)
  btnQuickAdd.addEventListener('click', () => openExpenseModal());

  const closeExpenseModal = () => modalAddExpense.classList.add('hidden');
  btnCloseExpense.addEventListener('click', closeExpenseModal);
  btnCancelExpense.addEventListener('click', closeExpenseModal);

  // Submit Expense Form Handler (add or edit, depending on editingTransactionId)
  formExpense.addEventListener('submit', (e) => {
    e.preventDefault();

    const merchant = document.getElementById('form-merchant').value;
    const amount = parseFloat(document.getElementById('form-amount').value);
    const category = document.getElementById('form-category').value;
    const cardId = document.getElementById('form-card').value;
    const date = document.getElementById('form-date').value;

    if (!cardId) {
      alert('You must add a card first!');
      return;
    }

    if (editingTransactionId) {
      store.updateTransaction(editingTransactionId, { merchant, amount, category, cardId, date });
      toastManager.show('Transaction Updated', `Saved changes to ${merchant}`, 'success');
    } else {
      const { alerts } = store.addTransaction({
        merchant,
        amount,
        category,
        cardId,
        date,
        source: 'Manual Input'
      });

      toastManager.show('Transaction Added', `Directly saved $${amount.toFixed(2)} spent at ${merchant}`, 'success');

      if (alerts && alerts.length > 0) {
        alerts.forEach(alert => {
          triggerSmartAlert(alert);
        });
      }
    }

    closeExpenseModal();
    formExpense.reset();
    editingTransactionId = null;
    renderAppUI();
  });

  // "+ Add New Category" — prompts for a name, adds it, and selects it
  document.getElementById('form-category')?.addEventListener('change', (e) => {
    if (e.target.value !== ADD_NEW_CATEGORY_VALUE) return;

    const name = prompt('New category name:');
    if (name && name.trim()) {
      const added = store.addCustomCategory(name);
      populateCategorySelect(e.target, { includeAddNew: true });
      e.target.value = added;
      populateCategorySelect(document.getElementById('select-filter-category'), { includeAllOption: true });
    } else {
      e.target.value = CATEGORIES[0];
    }
  });

  // ADD/EDIT CARD POPUP MODAL
  const modalAddCard = document.getElementById('modal-add-card');
  const btnAddCardOpen = document.getElementById('btn-add-card');
  const btnCloseCardModal = document.getElementById('btn-close-card-modal');
  const btnCancelCardModal = document.getElementById('btn-cancel-card-modal');
  const formCardAdd = document.getElementById('form-add-card');

  btnAddCardOpen?.addEventListener('click', () => openCardModal());

  const closeCardModal = () => modalAddCard.classList.add('hidden');
  btnCloseCardModal.addEventListener('click', closeCardModal);
  btnCancelCardModal.addEventListener('click', closeCardModal);

  formCardAdd?.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('form-card-name').value;
    const brand = document.getElementById('form-card-brand').value;
    const last4 = document.getElementById('form-card-last4').value;
    const limit = document.getElementById('form-card-limit').value;
    const scope = document.getElementById('form-card-scope').value;
    const color = document.getElementById('form-card-color').value;

    if (editingCardId) {
      store.updateCard(editingCardId, { name, brand, last4, color, limit, scope });
      toastManager.show('Card Updated', `Saved changes to ${name}`, 'success');
    } else {
      store.addCard({ name, brand, last4, color, limit, scope });
      toastManager.show('Card Added', `Added ${name} (...${last4}) to your account`, 'success');
    }

    closeCardModal();
    formCardAdd.reset();
    editingCardId = null;
    renderAppUI();
  });
}

// BIND KEY FILTER INPUTS
function initLedgerFilters() {
  const searchInput = document.getElementById('input-search-transactions');
  const selectFilter = document.getElementById('select-filter-category');

  populateCategorySelect(selectFilter, { includeAllOption: true });

  searchInput.addEventListener('input', () => {
    renderTransactionsLedger();
  });

  selectFilter.addEventListener('change', () => {
    renderTransactionsLedger();
  });
}

// SIDEBAR COLLAPSE TOGGLE
function applySidebarCollapsedState() {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;
  appContainer.classList.toggle('collapsed', !!store.settings.sidebarCollapsed);
}

function bindSidebarToggle() {
  const appContainer = document.getElementById('app');
  const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');

  btnSidebarToggle?.addEventListener('click', () => {
    if (appContainer) {
      const isCollapsed = appContainer.classList.toggle('collapsed');
      store.updateSettings({ sidebarCollapsed: isCollapsed });

      // Dispatch resize event to force Chart.js updates after sidebar animation ends
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 350);
    }
  });
}

// LOGOUT BUTTON
function bindLogoutButton() {
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    signOutUser();
  });
}

// AUTH GATE: login / signup / Google sign-in bindings
function showAuthError(elId, message) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideAuthErrors() {
  document.getElementById('login-error')?.classList.add('hidden');
  document.getElementById('signup-error')?.classList.add('hidden');
}

function bindAuthGateEvents() {
  const panelLogin = document.getElementById('auth-panel-login');
  const panelSignup = document.getElementById('auth-panel-signup');
  const formLogin = document.getElementById('form-login');
  const formSignup = document.getElementById('form-signup');

  document.getElementById('link-show-signup')?.addEventListener('click', (e) => {
    e.preventDefault();
    hideAuthErrors();
    panelLogin.classList.add('hidden');
    panelSignup.classList.remove('hidden');
  });

  document.getElementById('link-show-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    hideAuthErrors();
    panelSignup.classList.add('hidden');
    panelLogin.classList.remove('hidden');
  });

  formLogin?.addEventListener('submit', (e) => {
    e.preventDefault();
    hideAuthErrors();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    signIn(email, password).catch(err => showAuthError('login-error', authErrorMessage(err)));
  });

  formSignup?.addEventListener('submit', (e) => {
    e.preventDefault();
    hideAuthErrors();
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    signUp(email, password).catch(err => showAuthError('signup-error', authErrorMessage(err)));
  });

  document.getElementById('btn-google-signin')?.addEventListener('click', () => {
    hideAuthErrors();
    signInWithGoogle().catch(err => showAuthError('login-error', authErrorMessage(err)));
  });
}

function resetAuthForms() {
  document.getElementById('form-login')?.reset();
  document.getElementById('form-signup')?.reset();
  hideAuthErrors();
  document.getElementById('auth-panel-signup')?.classList.add('hidden');
  document.getElementById('auth-panel-login')?.classList.remove('hidden');
}

// VISIBILITY HELPERS
function showLoadingSplash() {
  document.getElementById('initial-loading')?.classList.remove('hidden');
  document.getElementById('auth-gate')?.classList.add('hidden');
  document.getElementById('app')?.classList.add('hidden');
}

function showAuthGate() {
  document.getElementById('initial-loading')?.classList.add('hidden');
  document.getElementById('auth-gate')?.classList.remove('hidden');
  document.getElementById('app')?.classList.add('hidden');
}

function showApp() {
  document.getElementById('initial-loading')?.classList.add('hidden');
  document.getElementById('auth-gate')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');
}

// APP INITIALIZATION ENTRY POINT
document.addEventListener('DOMContentLoaded', () => {
  showLoadingSplash();
  bindAuthGateEvents();

  let appInitialized = false;
  let authGeneration = 0;

  onAuthChange(async (user) => {
    const myGeneration = ++authGeneration;

    if (user) {
      currentAuthUser = user;
      await store.initForUser(user.uid);
      if (myGeneration !== authGeneration) return; // superseded by a newer auth event

      const emailEl = document.getElementById('sidebar-user-email');
      if (emailEl) emailEl.textContent = user.email || '';
      renderHeaderAvatar(user);

      if (!appInitialized) {
        initTabNavigation();
        bindThemeToggleClick();
        initModals();
        initProfileModal();
        initImportModal();
        initPaymentModal();
        initReportModal();
        initLedgerFilters();
        bindSidebarToggle();
        bindLogoutButton();
        bindTrendRangeButtons();
        bindScopeSwitcher();
        appInitialized = true;
      }

      applyThemeFromSettings();
      applySidebarCollapsedState();
      applyScopeFromSettings();
      renderAppUI();

      showApp();
    } else {
      currentAuthUser = null;
      store.clearForLogout();
      resetAuthForms();
      showAuthGate();
    }
  });
});
