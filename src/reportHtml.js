// Builds a complete, standalone HTML document for a monthly report (charts +
// transaction tables). This is the single source of truth for what the PDF
// looks like -- it's rendered identically in two places:
//   1. In-app: loaded into an <iframe>, printed via iframe.contentWindow.print()
//   2. The monthly email script: rendered by headless Chromium (Puppeteer)
//      and exported to a real PDF file attached to the email
// Being one shared template (rather than two separate implementations) is
// what guarantees the in-app PDF and the emailed PDF are actually the same.
import { getCategoryColor, getCategoryLabel } from './categories.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Safe to inline inside a <script> tag: JSON.stringify already escapes
// quotes, but a literal "</script>" inside a merchant name could still break
// out of the tag, so neutralize any "<" characters in the JSON string.
function toInlineJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildReportHtmlDocument(report, year, month) {
  const monthLabel = `${MONTH_NAMES[month]} ${year}`;
  const scopeLabel = { personal: 'Personal', business: 'Business', all: 'All Cards' }[report.scope] || 'All Cards';
  const totalCombined = report.totalSpent + report.totalPayments;

  const cardSections = [...report.cardBreakdown];
  if (report.unlinkedTransactions.length > 0) {
    cardSections.push({
      card: { name: 'Unlinked Transactions', last4: null },
      transactions: report.unlinkedTransactions,
      subtotal: report.unlinkedTransactions.reduce((s, t) => s + t.amount, 0)
    });
  }

  const cardTablesHtml = cardSections.length === 0
    ? `<p class="empty-note">No transactions logged for ${monthLabel}.</p>`
    : cardSections.map(({ card, transactions, subtotal }) => `
        <table class="card-section">
          <tr>
            <td class="card-section-title">${escapeHtml(card.name)}${card.last4 ? ` (...${escapeHtml(card.last4)})` : ''}</td>
            <td class="card-section-total">$${subtotal.toFixed(2)}</td>
          </tr>
        </table>
        <table class="tx-table">
          <thead>
            <tr><th>Date</th><th>Merchant</th><th>Category</th><th class="amount-col">Amount</th></tr>
          </thead>
          <tbody>
            ${transactions.map(tx => `
              <tr>
                <td>${tx.date}</td>
                <td>${escapeHtml(tx.merchant)}</td>
                <td>${escapeHtml(getCategoryLabel(tx.category))}</td>
                <td class="amount-col">$${tx.amount.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `).join('');

  // Chart data, computed here (not in the browser) so it's identical
  // regardless of which environment renders this document.
  const categoryLabels = Object.keys(report.categoryTotals);
  const categoryValues = Object.values(report.categoryTotals);
  const categoryColors = categoryLabels.map(getCategoryColor);

  const cardLabels = report.cardBreakdown.map(({ card }) => card.name);
  const cardValues = report.cardBreakdown.map(({ subtotal }) => subtotal);
  const hasChartData = categoryLabels.length > 0 || cardLabels.length > 0;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(monthLabel)} Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #0f172a;
    max-width: 720px;
    margin: 0 auto;
    padding: 24px;
    background: #ffffff;
  }
  h1 { font-size: 22px; margin: 0 0 4px 0; }
  .subtitle { color: #64748b; font-size: 13px; margin: 0 0 24px 0; }
  .stats-grid {
    display: table;
    width: 100%;
    border-collapse: separate;
    border-spacing: 8px;
    margin-bottom: 24px;
  }
  .stats-row { display: table-row; }
  .stat-box {
    display: table-cell;
    width: 25%;
    padding: 12px 14px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    vertical-align: top;
  }
  .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; }
  .stat-value { font-size: 18px; font-weight: 700; margin-top: 2px; }
  .charts-row { display: flex; gap: 24px; margin-bottom: 28px; }
  .chart-box { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
  .chart-box h3 { font-size: 13px; margin: 0 0 10px 0; color: #334155; }
  .card-section { width: 100%; border-collapse: collapse; margin-top: 20px; }
  .card-section-title { font-weight: 700; font-size: 14px; padding: 4px 0; }
  .card-section-total { font-weight: 700; font-size: 14px; text-align: right; padding: 4px 0; }
  .tx-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 4px; }
  .tx-table th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 11px; text-transform: uppercase; }
  .tx-table td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
  .amount-col { text-align: right; }
  .empty-note { color: #64748b; font-size: 14px; }
  .footer-note { color: #94a3b8; font-size: 11px; margin-top: 32px; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(monthLabel)} -- ${escapeHtml(scopeLabel)}</h1>
  <p class="subtitle">ApexWallet Tracker monthly report</p>

  <div class="stats-grid">
    <div class="stats-row">
      <div class="stat-box"><div class="stat-label">Total Purchases</div><div class="stat-value">$${report.totalSpent.toFixed(2)}</div></div>
      <div class="stat-box"><div class="stat-label">Card Payments Made</div><div class="stat-value">$${report.totalPayments.toFixed(2)}</div></div>
      <div class="stat-box"><div class="stat-label">Combined Cash Out</div><div class="stat-value">$${totalCombined.toFixed(2)}</div></div>
      <div class="stat-box"><div class="stat-label">Cards With Activity</div><div class="stat-value">${report.cardBreakdown.length}</div></div>
    </div>
  </div>

  ${hasChartData ? `
  <div class="charts-row">
    <div class="chart-box">
      <h3>Spending by Category</h3>
      <canvas id="categoryChart" width="320" height="220"></canvas>
    </div>
    <div class="chart-box">
      <h3>Spending by Card</h3>
      <canvas id="cardChart" width="320" height="220"></canvas>
    </div>
  </div>
  ` : ''}

  ${cardTablesHtml}

  <p class="footer-note">You're receiving this because monthly email reports are enabled in your ApexWallet Tracker profile settings.</p>

  <script>
    window.__chartsReady = false;
    const categoryLabels = ${toInlineJson(categoryLabels)};
    const categoryValues = ${toInlineJson(categoryValues)};
    const categoryColors = ${toInlineJson(categoryColors)};
    const cardLabels = ${toInlineJson(cardLabels)};
    const cardValues = ${toInlineJson(cardValues)};

    function renderCharts() {
      if (categoryLabels.length > 0) {
        new Chart(document.getElementById('categoryChart'), {
          type: 'doughnut',
          data: { labels: categoryLabels, datasets: [{ data: categoryValues, backgroundColor: categoryColors, borderWidth: 0 }] },
          options: {
            responsive: false,
            animation: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }
          }
        });
      }
      if (cardLabels.length > 0) {
        new Chart(document.getElementById('cardChart'), {
          type: 'bar',
          data: { labels: cardLabels, datasets: [{ data: cardValues, backgroundColor: '#8b5cf6', borderRadius: 4 }] },
          options: {
            responsive: false,
            animation: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
          }
        });
      }
      window.__chartsReady = true;
    }

    if (typeof Chart !== 'undefined') {
      renderCharts();
    } else {
      window.addEventListener('load', renderCharts);
    }
  </script>
</body>
</html>`;
}
