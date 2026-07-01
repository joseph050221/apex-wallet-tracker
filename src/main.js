import './style.css';
import store from './store.js';
import {
  renderDonutChart,
  renderTrendChart,
  renderCardChart,
  updateChartThemes
} from './charts.js';
import {
  initSimulator,
  renderPhoneCards,
  logToConsole
} from './simulator.js';
import {
  signUp,
  signIn,
  signInWithGoogle,
  signOutUser,
  onAuthChange,
  authErrorMessage
} from './auth.js';

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

  // 4. Log alert to simulator system console (if open)
  logToConsole(`[ALERT] ${alert.title}: ${alert.message}`, alert.severity === 'error' ? 'warning' : 'system');
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
    analytics: 'Deep dive into spending timeline and categorical distribution',
    simulator: 'Interactive sandbox terminal for simulating NFC payments'
  };

  const titles = {
    dashboard: 'Dashboard',
    wallet: 'My Cards',
    analytics: 'Analytics',
    simulator: 'Payment Simulator'
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
        renderAnalyticsTrend('month');
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

  document.getElementById('btn-goto-simulator')?.addEventListener('click', () => {
    document.querySelector('[data-tab="simulator"]').click();
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
  const metrics = store.getMetrics();
  const txs = store.transactions;
  const cards = store.cards;

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

  // 6. PHONE CARDS INSIDE PAYMENT SIMULATOR
  renderPhoneCards(cards);

  // 7. DRAW CHARTS
  renderDonutChart(metrics);
  renderTrendChart(txs, 'month');
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
        <span class="card-issuer">${card.name.split(' ')[0]}</span>
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

  // Filter transactions
  let filtered = store.transactions.filter(tx => {
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
    const txDate = new Date(tx.date);
    const formattedDate = txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Choose class color for categories
    const catClass = tx.category.toLowerCase().replace(' & ', '-');

    // Icon based on how the transaction was logged
    const sourceIcon = tx.source === 'Manual Input' ? 'edit-2' : 'nfc';

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
        <span class="badge-category ${catClass}">${tx.category}</span>
      </td>
      <td>
        <div class="card-used-badge">
          <div class="card-indicator-dot" style="background-color: var(--color-${catClass});"></div>
          <span>${cardLabel}</span>
        </div>
      </td>
      <td>${formattedDate}</td>
      <td class="text-right amount-value negative">-$${tx.amount.toFixed(2)}</td>
      <td class="text-center">
        <button class="btn-icon-danger btn-delete-tx" data-id="${tx.id}" title="Remove Transaction">
          <i data-lucide="trash-2"></i>
        </button>
      </td>
    `;

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
    const catClass = catName.toLowerCase().replace(' & ', '-');

    const item = document.createElement('div');
    item.className = 'category-list-item';
    item.innerHTML = `
      <div class="category-item-meta">
        <span class="category-item-name">
          <span class="category-dot" style="background-color: var(--color-${catClass});"></span>
          <span>${catName}</span>
          <span class="category-item-pct">${pct}%</span>
        </span>
        <span class="category-item-amount">$${amount.toFixed(2)}</span>
      </div>
      <div class="category-progress-bar-bg">
        <div class="category-progress-bar-fill" style="width: ${pct}%; background-color: var(--color-${catClass});"></div>
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

    const limitPct = card.limit > 0 ? ((card.balance / card.limit) * 100).toFixed(0) : 0;

    item.innerHTML = `
      <div class="card-manage-visual ${card.color}">
        <span class="mini-network">${card.brand.toUpperCase()}</span>
        <span class="mini-last4">•••• ${card.last4}</span>
      </div>

      <div class="card-manage-info">
        <span class="card-manage-title">${card.name}</span>
        <div class="card-manage-meta">
          <span>Spent: <strong class="card-manage-spend">$${card.balance.toFixed(2)}</strong></span>
          ${card.limit > 0 ? `<span>Limit: $${card.limit.toLocaleString()} (${limitPct}%)</span>` : '<span>Limit: Uncapped</span>'}
        </div>
      </div>

      <div class="card-manage-actions">
        <button class="btn-icon-danger btn-delete-card" data-id="${card.id}" title="Remove Card">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    `;

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

// RENDERING ANALYTICS DETAIL CARDS
function renderAnalyticsTrend(range = 'month') {
  renderTrendChart(store.transactions, range);

  const container = document.getElementById('analytics-categories-detailed-grid');
  if (!container) return;

  container.innerHTML = '';
  const metrics = store.getMetrics();

  // Create mapping of category to transaction items count
  const categoryCounts = {};
  store.transactions.forEach(tx => {
    categoryCounts[tx.category] = (categoryCounts[tx.category] || 0) + 1;
  });

  const categories = ['Dining', 'Shopping', 'Transport', 'Entertainment', 'Bills', 'Groceries', 'Travel'];

  categories.forEach(cat => {
    const totalSpent = metrics.categoryTotals[cat] || 0.00;
    const count = categoryCounts[cat] || 0;
    const catClass = cat.toLowerCase().replace(' & ', '-');

    // Category icon mapping (for visual decoration)
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
          <div class="cat-card-icon" style="background-color: var(--color-${catClass}); color:#fff;">
            <i data-lucide="${icon}"></i>
          </div>
          <span>${cat}</span>
        </div>
        <span class="cat-stat-count">${count} txs</span>
      </div>

      <div class="cat-card-stats">
        <div>
          <div class="cat-stat-lbl">Total Spent</div>
          <div class="cat-stat-val" style="color: var(--color-${catClass});">$${totalSpent.toFixed(2)}</div>
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

// BIND MODAL DIALOGS ACTION EVENT LISTENERS
function initModals() {
  const modalAddExpense = document.getElementById('modal-add-expense');
  const btnQuickAdd = document.getElementById('btn-quick-add');
  const btnCloseExpense = document.getElementById('btn-close-expense-modal');
  const btnCancelExpense = document.getElementById('btn-cancel-expense-modal');
  const formExpense = document.getElementById('form-add-expense');

  // Card elements
  const selectCardForm = document.getElementById('form-card');

  // Load select input cards helper
  function populateModalCardsDropdown() {
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

  // Add Expense Dialog triggers
  btnQuickAdd.addEventListener('click', () => {
    populateModalCardsDropdown();
    // Pre-populate today's date
    document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
    modalAddExpense.classList.remove('hidden');
  });

  const closeExpenseModal = () => modalAddExpense.classList.add('hidden');
  btnCloseExpense.addEventListener('click', closeExpenseModal);
  btnCancelExpense.addEventListener('click', closeExpenseModal);

  // Submit Expense Form Handler
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

    const { transaction: newTx, alerts } = store.addTransaction({
      merchant,
      amount,
      category,
      cardId,
      date,
      source: 'Manual Input'
    });

    toastManager.show('Transaction Added', `Directly saved $${amount.toFixed(2)} spent at ${merchant}`, 'success');

    // Check and trigger smart alerts
    if (alerts && alerts.length > 0) {
      alerts.forEach(alert => {
        triggerSmartAlert(alert);
      });
    }

    closeExpenseModal();
    formExpense.reset();
    renderAppUI();
  });

  // ADD NEW CARD POPUP MODAL
  const modalAddCard = document.getElementById('modal-add-card');
  const btnAddCardOpen = document.getElementById('btn-add-card');
  const btnCloseCardModal = document.getElementById('btn-close-card-modal');
  const btnCancelCardModal = document.getElementById('btn-cancel-card-modal');
  const formCardAdd = document.getElementById('form-add-card');

  btnAddCardOpen?.addEventListener('click', () => {
    modalAddCard.classList.remove('hidden');
  });

  const closeCardModal = () => modalAddCard.classList.add('hidden');
  btnCloseCardModal.addEventListener('click', closeCardModal);
  btnCancelCardModal.addEventListener('click', closeCardModal);

  formCardAdd?.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('form-card-name').value;
    const brand = document.getElementById('form-card-brand').value;
    const last4 = document.getElementById('form-card-last4').value;
    const color = document.getElementById('form-card-color').value;

    store.addCard({
      name,
      brand,
      last4,
      color,
      limit: 10000 // Default limit
    });

    toastManager.show('Card Added', `Added ${name} (...${last4}) to your account`, 'success');
    closeCardModal();
    formCardAdd.reset();
    renderAppUI();
  });
}

// BIND KEY FILTER INPUTS
function initLedgerFilters() {
  const searchInput = document.getElementById('input-search-transactions');
  const selectFilter = document.getElementById('select-filter-category');

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
      await store.initForUser(user.uid);
      if (myGeneration !== authGeneration) return; // superseded by a newer auth event

      const emailEl = document.getElementById('sidebar-user-email');
      if (emailEl) emailEl.textContent = user.email || '';

      if (!appInitialized) {
        initTabNavigation();
        bindThemeToggleClick();
        initModals();
        initLedgerFilters();
        bindSidebarToggle();
        bindLogoutButton();
        initSimulator(toastManager, (newTx, alerts) => {
          renderAppUI();
          if (alerts && alerts.length > 0) {
            setTimeout(() => {
              alerts.forEach(alert => triggerSmartAlert(alert));
            }, 350);
          }
        });
        appInitialized = true;
      }

      applyThemeFromSettings();
      applySidebarCollapsedState();
      renderAppUI();

      showApp();
      logToConsole('Welcome to ApexWallet Tracker. Click simulator cards to select.', 'system');
    } else {
      store.clearForLogout();
      resetAuthForms();
      showAuthGate();
    }
  });
});
