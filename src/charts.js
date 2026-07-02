// Chart Manager using Chart.js Auto-Registration
import Chart from 'chart.js/auto';
import { getCategoryColor } from './categories.js';

// Global references to Chart instances
let donutChart = null;
let trendChart = null;
let distributionChart = null;

// Helper to get text/grid colors depending on active theme
function getThemeColors() {
  const isLight = document.body.classList.contains('light-theme');
  return {
    text: isLight ? '#475569' : '#9ca3af',
    grid: isLight ? 'rgba(15, 23, 42, 0.05)' : 'rgba(255, 255, 255, 0.05)',
    tooltipBg: isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 17, 26, 0.95)',
    tooltipBorder: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)',
    tooltipText: isLight ? '#0f172a' : '#f3f4f6'
  };
}

// 1. DOUGHNUT CHART: Spending breakdown by category
export function renderDonutChart(metrics) {
  const ctx = document.getElementById('chart-categories-donut');
  if (!ctx) return;

  const categories = Object.keys(metrics.categoryTotals);
  const dataValues = Object.values(metrics.categoryTotals);
  const backgroundColors = categories.map(cat => getCategoryColor(cat));

  const totalCount = metrics.totalSpent;
  document.getElementById('donut-total-count').textContent = `$${totalCount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const themeColors = getThemeColors();

  if (donutChart) {
    donutChart.data.labels = categories;
    donutChart.data.datasets[0].data = dataValues;
    donutChart.data.datasets[0].backgroundColor = backgroundColors;
    donutChart.options.plugins.legend.labels.color = themeColors.text;
    donutChart.update();
  } else {
    donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: categories,
        datasets: [{
          data: dataValues,
          backgroundColor: backgroundColors,
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: {
          legend: {
            display: false // We render custom HTML progress bars instead
          },
          tooltip: {
            backgroundColor: themeColors.tooltipBg,
            titleColor: themeColors.tooltipText,
            bodyColor: themeColors.tooltipText,
            borderColor: themeColors.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const val = context.parsed || 0;
                const percentage = ((val / totalCount) * 100).toFixed(1);
                return ` ${label}: $${val.toFixed(2)} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }
}

// 2. LINE CHART: Spending Trend over the month/year
export function renderTrendChart(transactions, range = 'month') {
  const ctx = document.getElementById('chart-spending-trend');
  if (!ctx) return;

  const themeColors = getThemeColors();

  // Payments toward a credit card bill aren't a "purchase" over time, so
  // they're excluded from the trend line (matches categoryTotals/cardTotals).
  const purchaseTxs = transactions.filter(tx => tx.type !== 'payment');

  let labels = [];
  let dataPoints = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (range === 'week' || range === 'month') {
    // Daily buckets over a rolling window
    const days = range === 'week' ? 7 : 30;
    const dailySpend = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dailySpend[d.toISOString().split('T')[0]] = 0;
    }

    purchaseTxs.forEach(tx => {
      if (dailySpend[tx.date] !== undefined) {
        dailySpend[tx.date] += tx.amount;
      }
    });

    labels = Object.keys(dailySpend).map(dateStr => {
      const [, m, d] = dateStr.split('-');
      return `${m}/${d}`;
    });
    dataPoints = Object.values(dailySpend);
  } else if (range === '3months' || range === '6months') {
    // Weekly buckets over a rolling window
    const weeks = range === '3months' ? 13 : 26;
    labels = [];
    dataPoints = [];

    for (let w = weeks - 1; w >= 0; w--) {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - (w * 7 + 6));
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() - (w * 7));
      weekEnd.setHours(23, 59, 59, 999);

      const total = purchaseTxs.reduce((sum, tx) => {
        const txDate = new Date(tx.date);
        return (txDate >= weekStart && txDate <= weekEnd) ? sum + tx.amount : sum;
      }, 0);

      labels.push(`${weekStart.getMonth() + 1}/${weekStart.getDate()}`);
      dataPoints.push(total);
    }
  } else {
    // Yearly view: rolling last 12 calendar months
    labels = [];
    dataPoints = [];

    for (let m = 11; m >= 0; m--) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const total = purchaseTxs.reduce((sum, tx) => {
        const txDate = new Date(tx.date);
        return (txDate.getFullYear() === monthDate.getFullYear() && txDate.getMonth() === monthDate.getMonth())
          ? sum + tx.amount : sum;
      }, 0);

      labels.push(monthDate.toLocaleDateString('en-US', { month: 'short' }));
      dataPoints.push(total);
    }
  }

  // Draw chart
  if (trendChart) {
    trendChart.data.labels = labels;
    trendChart.data.datasets[0].data = dataPoints;
    trendChart.options.scales.x.grid.color = themeColors.grid;
    trendChart.options.scales.x.ticks.color = themeColors.text;
    trendChart.options.scales.y.grid.color = themeColors.grid;
    trendChart.options.scales.y.ticks.color = themeColors.text;
    trendChart.update();
  } else {
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Spending ($)',
          data: dataPoints,
          borderColor: '#8b5cf6',
          borderWidth: 3,
          tension: 0.4,
          fill: true,
          backgroundColor: 'rgba(139, 92, 246, 0.05)',
          pointBackgroundColor: '#8b5cf6',
          pointHoverRadius: 7,
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: themeColors.tooltipBg,
            titleColor: themeColors.tooltipText,
            bodyColor: themeColors.tooltipText,
            borderColor: themeColors.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function(context) {
                return ` Spent: $${context.parsed.y.toFixed(2)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: themeColors.grid
            },
            ticks: {
              color: themeColors.text,
              font: { family: 'Inter', size: 11 }
            }
          },
          y: {
            grid: {
              color: themeColors.grid
            },
            ticks: {
              color: themeColors.text,
              font: { family: 'Inter', size: 11 },
              callback: function(value) {
                return '$' + value;
              }
            }
          }
        }
      }
    });
  }
}

// 3. BAR CHART: Spend distribution per Credit Card
export function renderCardChart(cards, transactions) {
  const ctx = document.getElementById('chart-card-distribution');
  if (!ctx) return;

  const themeColors = getThemeColors();

  // Aggregate totals per card
  const cardNames = [];
  const spendData = [];
  const barColors = [];

  cards.forEach(card => {
    // Calculate total spend in transaction list for this card (excluding
    // credit card payments -- those aren't a charge against the card)
    const cardSpent = transactions
      .filter(tx => tx.cardId === card.id && tx.type !== 'payment')
      .reduce((sum, tx) => sum + tx.amount, 0);

    cardNames.push(`${card.name} (...${card.last4})`);
    spendData.push(cardSpent);
    
    // Assign custom matching theme colors
    if (card.color === 'card-theme-blue') barColors.push('#3b82f6');
    else if (card.color === 'card-theme-gold') barColors.push('#f59e0b');
    else if (card.color === 'card-theme-dark') barColors.push('#6b7280');
    else if (card.color === 'card-theme-purple') barColors.push('#8b5cf6');
    else if (card.color === 'card-theme-emerald') barColors.push('#10b981');
    else barColors.push('#a7f3d0');
  });

  if (distributionChart) {
    distributionChart.data.labels = cardNames;
    distributionChart.data.datasets[0].data = spendData;
    distributionChart.data.datasets[0].backgroundColor = barColors;
    distributionChart.options.scales.x.grid.color = themeColors.grid;
    distributionChart.options.scales.x.ticks.color = themeColors.text;
    distributionChart.options.scales.y.grid.color = themeColors.grid;
    distributionChart.options.scales.y.ticks.color = themeColors.text;
    distributionChart.update();
  } else {
    distributionChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: cardNames,
        datasets: [{
          data: spendData,
          backgroundColor: barColors,
          borderRadius: 8,
          borderWidth: 0,
          barThickness: 24
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: themeColors.tooltipBg,
            titleColor: themeColors.tooltipText,
            bodyColor: themeColors.tooltipText,
            borderColor: themeColors.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function(context) {
                return ` Total Spent: $${context.parsed.y.toFixed(2)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: themeColors.text,
              font: { family: 'Inter', size: 10 }
            }
          },
          y: {
            grid: {
              color: themeColors.grid
            },
            ticks: {
              color: themeColors.text,
              font: { family: 'Inter', size: 10 },
              callback: function(value) {
                return '$' + value;
              }
            }
          }
        }
      }
    });
  }
}

// Force redrawing gridlines on theme change (dark / light toggle)
export function updateChartThemes() {
  const themeColors = getThemeColors();
  const configDonut = donutChart;
  const configTrend = trendChart;
  const configCard = distributionChart;

  if (configDonut) {
    configDonut.options.plugins.tooltip.backgroundColor = themeColors.tooltipBg;
    configDonut.options.plugins.tooltip.titleColor = themeColors.tooltipText;
    configDonut.options.plugins.tooltip.bodyColor = themeColors.tooltipText;
    configDonut.options.plugins.tooltip.borderColor = themeColors.tooltipBorder;
    configDonut.update();
  }

  if (configTrend) {
    configTrend.options.scales.x.grid.color = themeColors.grid;
    configTrend.options.scales.x.ticks.color = themeColors.text;
    configTrend.options.scales.y.grid.color = themeColors.grid;
    configTrend.options.scales.y.ticks.color = themeColors.text;
    configTrend.options.plugins.tooltip.backgroundColor = themeColors.tooltipBg;
    configTrend.options.plugins.tooltip.titleColor = themeColors.tooltipText;
    configTrend.options.plugins.tooltip.bodyColor = themeColors.tooltipText;
    configTrend.options.plugins.tooltip.borderColor = themeColors.tooltipBorder;
    configTrend.update();
  }

  if (configCard) {
    configCard.options.scales.x.grid.color = themeColors.grid;
    configCard.options.scales.x.ticks.color = themeColors.text;
    configCard.options.scales.y.grid.color = themeColors.grid;
    configCard.options.scales.y.ticks.color = themeColors.text;
    configCard.options.plugins.tooltip.backgroundColor = themeColors.tooltipBg;
    configCard.options.plugins.tooltip.titleColor = themeColors.tooltipText;
    configCard.options.plugins.tooltip.bodyColor = themeColors.tooltipText;
    configCard.options.plugins.tooltip.borderColor = themeColors.tooltipBorder;
    configCard.update();
  }
}
