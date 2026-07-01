// Google Wallet & POS Terminal Simulator Logic
import store from './store.js';

let activePhoneCardId = null;

// Play electronic NFC terminal beep using Web Audio API
export function playNfcBeep() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    
    const audioCtx = new AudioContextClass();
    
    // First note
    const osc1 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc1.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(950, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    
    osc1.start();
    osc1.stop(audioCtx.currentTime + 0.08);

    // Second note (double tone response)
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gainNode2 = audioCtx.createGain();
      osc2.connect(gainNode2);
      gainNode2.connect(audioCtx.destination);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1400, audioCtx.currentTime);
      gainNode2.gain.setValueAtTime(0.08, audioCtx.currentTime);
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.12);
    }, 80);
    
  } catch (e) {
    console.warn('Web Audio playback failed or blocked by browser policy:', e);
  }
}

// Log to simulator debug console
export function logToConsole(message, type = 'system') {
  const consoleEl = document.getElementById('simulator-console-log');
  if (!consoleEl) return;

  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  line.innerHTML = `[${time}] ${message}`;
  
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// Draw cards inside the mock mobile phone
export function renderPhoneCards(cards) {
  const container = document.getElementById('phone-wallet-cards-list');
  const labelEl = document.getElementById('selected-card-label');
  if (!container) return;

  container.innerHTML = '';
  
  if (cards.length === 0) {
    container.innerHTML = `
      <div class="no-cards-prompt" style="font-size:12px; color:#6b7280; text-align:center; padding: 40px 10px;">
        No cards linked.<br>Link Wallet or add manual card.
      </div>
    `;
    activePhoneCardId = null;
    if (labelEl) labelEl.textContent = 'None';
    return;
  }

  // Pre-select first card if activePhoneCardId is invalid
  if (!activePhoneCardId || !cards.some(c => c.id === activePhoneCardId)) {
    activePhoneCardId = cards[0].id;
  }

  // Render cards in a fan structure
  const activeIdx = cards.findIndex(c => c.id === activePhoneCardId);
  const orderedCards = [...cards];
  
  // Re-order card list so active card is at stack position 0 (front)
  if (activeIdx !== -1) {
    const [activeCard] = orderedCards.splice(activeIdx, 1);
    orderedCards.unshift(activeCard);
  }

  orderedCards.forEach((card, index) => {
    const cardEl = document.createElement('div');
    cardEl.className = `phone-card-item ${card.color} stack-${Math.min(index, 3)}`;
    if (card.id === activePhoneCardId) {
      cardEl.classList.add('active-slide');
    }

    cardEl.innerHTML = `
      <div class="card-top">
        <span class="mini-card-brand">${card.brand.toUpperCase()}</span>
        <div class="card-chip"></div>
      </div>
      <div class="card-middle">
        <span class="mini-last4">•••• ${card.last4}</span>
      </div>
      <div class="card-bottom">
        <span class="card-name" style="font-size: 8px;">${card.name}</span>
      </div>
    `;

    // Click handler to bring this card to front
    cardEl.addEventListener('click', () => {
      activePhoneCardId = card.id;
      renderPhoneCards(cards);
      
      const cardDetail = cards.find(c => c.id === card.id);
      if (labelEl && cardDetail) {
        labelEl.textContent = `${cardDetail.name} (...${cardDetail.last4})`;
      }
      
      logToConsole(`Card changed to ${cardDetail.name} (...${cardDetail.last4}).`, 'system');
    });

    container.appendChild(cardEl);
  });

  const selected = cards.find(c => c.id === activePhoneCardId);
  if (labelEl && selected) {
    labelEl.textContent = `${selected.name} (...${selected.last4})`;
  }
}

// Bind POS terminals input controls & merchant selectors
export function initSimulator(toastManager, onTxSyncCallback) {
  const simMerchantSelect = document.getElementById('sim-input-merchant');
  const simAmountInput = document.getElementById('sim-input-amount');
  const simCategorySelect = document.getElementById('sim-input-category');
  
  const displayMerchant = document.getElementById('pos-terminal-display-merchant');
  const displayAmount = document.getElementById('pos-terminal-display-amount');
  const posStatus = document.getElementById('pos-terminal-status');
  
  const btnTapPay = document.getElementById('btn-sim-tap-pay');

  if (!simMerchantSelect) return;

  // Sync inputs with POS Terminal screen on merchant changes
  simMerchantSelect.addEventListener('change', () => {
    const opt = simMerchantSelect.options[simMerchantSelect.selectedIndex];
    const amount = opt.getAttribute('data-amount');
    const category = opt.getAttribute('data-category');

    simAmountInput.value = amount;
    simCategorySelect.value = category;
    
    displayMerchant.textContent = opt.text;
    displayAmount.textContent = `$${parseFloat(amount).toFixed(2)}`;
    posStatus.textContent = 'READY TO TAP';
    posStatus.style.color = '#f59e0b';
  });

  // Sync amount inputs directly on screen
  simAmountInput.addEventListener('input', () => {
    const val = parseFloat(simAmountInput.value) || 0;
    displayAmount.textContent = `$${val.toFixed(2)}`;
    posStatus.textContent = 'READY TO TAP';
    posStatus.style.color = '#f59e0b';
  });

  // Tap-to-pay trigger sync routine
  btnTapPay.addEventListener('click', () => {
    // 1. Verify Wallet Connected
    if (!store.walletConnected) {
      logToConsole('Connection Error: Google Wallet account not linked.', 'warning');
      toastManager.show(
        'Google Wallet Sync Error',
        'Cannot authorize sync. Link your Google Wallet from the Settings / Wallet tab first.',
        'warning'
      );
      
      // Flash indicator red
      const badge = document.getElementById('wallet-status-indicator');
      if (badge) {
        badge.style.transform = 'scale(1.1)';
        setTimeout(() => badge.style.transform = '', 200);
      }
      return;
    }

    // 2. Verify we have cards
    if (store.cards.length === 0) {
      logToConsole('Authorization Error: No payment cards found in Google Wallet.', 'warning');
      toastManager.show('Google Wallet', 'Sync aborted: Please add a card to your wallet first.', 'warning');
      return;
    }

    // 3. Verify active card has autoSync enabled
    const selectedCard = store.cards.find(c => c.id === activePhoneCardId);
    if (!selectedCard) {
      logToConsole('Sync Error: Select a card to pay.', 'warning');
      return;
    }

    if (!selectedCard.autoSync) {
      logToConsole(`Sync Denied: Auto-sync is disabled for ${selectedCard.name}.`, 'warning');
      toastManager.show(
        'Sync Blocked',
        `Google Wallet sync is disabled for ${selectedCard.name}. Enable it under Cards & Wallet.`,
        'warning'
      );
      return;
    }

    // 4. Begin NFC simulation
    btnTapPay.disabled = true;
    posStatus.textContent = 'PROCESSING...';
    posStatus.style.color = '#f59e0b';
    logToConsole(`NFC Handshake started with terminal. Authorizing payment...`, 'system');

    // Toggle NFC wave effect class
    const nfcWave = document.getElementById('nfc-pulse-wave-effect');
    if (nfcWave) {
      nfcWave.classList.add('pulsing');
    }

    // Tap NFC device sound
    playNfcBeep();

    setTimeout(() => {
      // 5. Add Transaction
      const merchant = displayMerchant.textContent;
      const amount = parseFloat(simAmountInput.value) || 0.01;
      const category = simCategorySelect.value;
      const date = new Date().toISOString().split('T')[0];

      const { transaction: newTx, alerts } = store.addTransaction({
        merchant,
        amount,
        category,
        cardId: activePhoneCardId,
        date,
        source: 'Google Wallet Sync'
      });

      // 6. Complete UI Feedback
      posStatus.textContent = 'APPROVED';
      posStatus.style.color = '#10B981';
      
      if (nfcWave) {
        nfcWave.classList.remove('pulsing');
      }
      
      logToConsole(`Payment Approved! $${amount.toFixed(2)} charged to ${selectedCard.name} (...${selectedCard.last4}).`, 'success');
      logToConsole(`Google Wallet sync event parsed successfully. Store updated.`, 'success');
      
      toastManager.show(
        'Google Wallet Sync',
        `Tap Success: $${amount.toFixed(2)} at ${merchant} (Card: ...${selectedCard.last4})`,
        'success'
      );

      // Trigger callback to re-render charts & tables in main app script
      if (onTxSyncCallback) {
        onTxSyncCallback(newTx, alerts);
      }

      // Reset POS terminal status after 2 seconds
      setTimeout(() => {
        posStatus.textContent = 'READY TO TAP';
        posStatus.style.color = '#f59e0b';
        btnTapPay.disabled = false;
      }, 2000);

    }, 1200);

  });
}
