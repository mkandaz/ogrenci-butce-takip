import {
  Chart,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  DoughnutController,
  BarController
} from 'chart.js';
import { formatCurrency, formatNumber } from '../utils/formatters.js';
import { t } from '../i18n/index.js';

// Chart.js bileşenlerini kaydet
Chart.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  DoughnutController,
  BarController
);

export class ChartManager {
  constructor(canvasCategory, canvasFlow, emptyCategoryEl, emptyFlowEl) {
    this.canvasCategory = canvasCategory;
    this.canvasFlow = canvasFlow;
    this.emptyCategoryEl = emptyCategoryEl;
    this.emptyFlowEl = emptyFlowEl;

    this.categoryChart = null;
    this.flowChart = null;
  }

  isDark() {
    return document.documentElement.classList.contains('dark');
  }

  render(monthTransactions, summary, categories, currency = 'TRY', lang = 'tr') {
    this.renderCategoryChart(monthTransactions, categories, currency, lang);
    this.renderFlowChart(summary, currency, lang);
  }

  renderCategoryChart(monthTransactions, categories, currency, lang) {
    if (!this.canvasCategory) return;

    const expenseTxs = (monthTransactions || []).filter(t => t.type === 'expense');

    if (expenseTxs.length === 0) {
      this.canvasCategory.style.display = 'none';
      if (this.emptyCategoryEl) this.emptyCategoryEl.classList.remove('hidden');
      if (this.categoryChart) {
        this.categoryChart.destroy();
        this.categoryChart = null;
      }
      return;
    }

    this.canvasCategory.style.display = 'block';
    if (this.emptyCategoryEl) this.emptyCategoryEl.classList.add('hidden');

    const catTotals = {};
    for (const tx of expenseTxs) {
      const amt = Number(tx.amount) || 0;
      catTotals[tx.categoryId] = (catTotals[tx.categoryId] || 0) + amt;
    }

    const labels = [];
    const data = [];
    const bgColors = [];

    const catMap = new Map((categories || []).map(c => [c.id, c]));

    const sortedEntries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    for (const [catId, total] of sortedEntries) {
      const cat = catMap.get(catId);
      const translatedName = t(`categories.${catId}`);
      const name = (translatedName !== `categories.${catId}`) ? translatedName : (cat ? cat.name : catId);
      labels.push(name);
      data.push(Math.round(total * 100) / 100);
      bgColors.push(cat ? cat.color : '#94A3B8');
    }

    const isDark = this.isDark();
    const textColor = isDark ? '#E2E8F0' : '#475569';

    if (this.categoryChart) {
      this.categoryChart.data.labels = labels;
      this.categoryChart.data.datasets[0].data = data;
      this.categoryChart.data.datasets[0].backgroundColor = bgColors;
      this.categoryChart.options.plugins.legend.labels.color = textColor;
      this.categoryChart.update();
      return;
    }

    this.categoryChart = new Chart(this.canvasCategory, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgColors,
          borderWidth: 2,
          borderColor: isDark ? '#0f172a' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              boxWidth: 12,
              padding: 12,
              color: textColor,
              font: {
                family: "'Plus Jakarta Sans', sans-serif",
                size: 11,
                weight: '500'
              }
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.raw, currency, lang)}`
            }
          }
        }
      }
    });
  }

  renderFlowChart(summary, currency, lang) {
    if (!this.canvasFlow) return;

    const hasData = summary.totalIncome > 0 || summary.totalExpense > 0 || summary.carriedOverBalance !== 0;

    if (!hasData) {
      this.canvasFlow.style.display = 'none';
      if (this.emptyFlowEl) this.emptyFlowEl.classList.remove('hidden');
      if (this.flowChart) {
        this.flowChart.destroy();
        this.flowChart = null;
      }
      return;
    }

    this.canvasFlow.style.display = 'block';
    if (this.emptyFlowEl) this.emptyFlowEl.classList.add('hidden');

    const labels = [
      t('charts.carriedBalanceLabel'),
      t('charts.incomeLabel'),
      t('charts.expenseLabel'),
      t('charts.remainingLabel')
    ];

    const data = [
      summary.carriedOverBalance,
      summary.totalIncome,
      summary.totalExpense,
      summary.balance
    ];

    const bgColors = [
      '#6366f1', // İndigo (Devreden)
      '#10b981', // Yeşil (Bu Ay Gelir)
      '#ef4444', // Kırmızı (Bu Ay Gider)
      summary.balance >= 0 ? '#3b82f6' : '#f43f5e' // Mavi / Gül (Kalan)
    ];

    const isDark = this.isDark();
    const textColor = isDark ? '#E2E8F0' : '#475569';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

    if (this.flowChart) {
      this.flowChart.data.labels = labels;
      this.flowChart.data.datasets[0].data = data;
      this.flowChart.data.datasets[0].backgroundColor = bgColors;
      this.flowChart.options.scales.x.ticks.color = textColor;
      this.flowChart.options.scales.y.ticks.color = textColor;
      this.flowChart.options.scales.y.grid.color = gridColor;
      this.flowChart.update();
      return;
    }

    this.flowChart = new Chart(this.canvasFlow, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgColors,
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${formatCurrency(ctx.raw, currency, lang)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: {
                family: "'Plus Jakarta Sans', sans-serif",
                size: 11,
                weight: '600'
              }
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: {
                family: "'Plus Jakarta Sans', sans-serif",
                size: 10
              },
              callback: (val) => `${formatNumber(val, lang)}`
            }
          }
        }
      }
    });
  }

  destroy() {
    if (this.categoryChart) this.categoryChart.destroy();
    if (this.flowChart) this.flowChart.destroy();
  }
}
