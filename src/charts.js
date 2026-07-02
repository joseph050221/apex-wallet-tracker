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
  
  // Compile transaction timeline data
  let labels = [];
  let dataPoints = [];

  // Sort transactions by date ascending for charts
  const sortedTxs = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

  if (range === 'month') {
    // Group transactions by day of current month (last 30 days)
    const dailySpend = {};
    const today = new Date();
    
    // Pre-populate last 10 days to make line chart look continuous
    for (let i = 9; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dailySpend[dateStr] = 0;
    }

    sortedTxs.forEach(tx => {
      if (dailySpend[tx.date] !== undefined) {
        dailySpend[tx.date] += tx.amount;
      } else {
        // Only log if it is within range of the keys
        const txDate = new Date(tx.date);
        const diffTime = Math.abs(today - txDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 30) {
          dailySpend[tx.date] = tx.amount;
        }
      }
    });

    // Sort dates
    labels = Object.keys(dailySpend).map(dateStr => {
      const [_, m, d] = dateStr.split('-');
      return `${m}/${d}`;
    });
    dataPoints = Object.values(dailySpend);
  } else {
    // Yearly View (Group by Month)
    const monthlySpend = {
      'Jan': 0, 'Feb': 0, 'Mar': 0, 'Apr': 0, 'May': 0, 'Jun': 0,
      'Jul': 0, 'Aug': 0, 'Sep': 0, 'Oct': 0, 'Nov': 0, 'Dec': 0
    };

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Add mock background spends for yearly chart to look pretty
    monthlySpend['Jan'] = 850.00;
    monthlySpend['Feb'] = 980.50;
    monthlySpend['Mar'] = 1120.00;
    monthlySpend['Apr'] = 910.20;
    monthlySpend['May'] = 1340.00;
    
    sortedTxs.forEach(tx => {
      const txDate = new Date(tx.date);
      if (txDate.getFullYear() === 2026) {
        const mName = monthNames[txDate.getMonth()];
        monthlySpend[mName] = (monthlySpend[mName] || 0) + tx.amount;
      }
    });

    labels = Object.keys(monthlySpend);
    dataPoints = Object.values(monthlySpend);
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
    // Calculate total spend in transaction list for this card
    const cardSpent = transactions
      .filter(tx => tx.cardId === card.id)
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
