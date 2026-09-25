import { createIcons, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide';

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-enter pointer-events-auto flex items-center justify-between p-3.5 rounded-2xl shadow-xl border text-xs font-medium space-x-3 transition-all';

  let iconName = 'info';
  let bgClasses = '';

  if (type === 'success') {
    bgClasses = 'bg-white dark:bg-slate-900 border-emerald-500/40 text-slate-800 dark:text-slate-100 glow-emerald';
    iconName = 'check-circle';
  } else if (type === 'error') {
    bgClasses = 'bg-white dark:bg-slate-900 border-rose-500/40 text-slate-800 dark:text-slate-100 glow-rose';
    iconName = 'alert-circle';
  } else if (type === 'warning') {
    bgClasses = 'bg-white dark:bg-slate-900 border-amber-500/40 text-slate-800 dark:text-slate-100 glow-amber';
    iconName = 'alert-triangle';
  } else {
    bgClasses = 'bg-white dark:bg-slate-900 border-indigo-500/40 text-slate-800 dark:text-slate-100 glow-blue';
    iconName = 'info';
  }

  toast.className += ` ${bgClasses}`;

  const iconColors = {
    success: 'text-emerald-500',
    error: 'text-rose-500',
    warning: 'text-amber-500',
    info: 'text-indigo-500'
  };

  toast.innerHTML = `
    <div class="flex items-center space-x-2.5 min-w-0">
      <i data-lucide="${iconName}" class="w-4 h-4 ${iconColors[type] || 'text-indigo-500'} shrink-0"></i>
      <span class="leading-snug break-words">${message}</span>
    </div>
    <button type="button" aria-label="Kapat" class="min-w-[32px] min-h-[32px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition shrink-0 ml-2">
      <i data-lucide="x" class="w-3.5 h-3.5"></i>
    </button>
  `;

  const closeBtn = toast.querySelector('button');
  let timerId = null;

  const dismiss = () => {
    if (timerId) clearTimeout(timerId);
    toast.classList.remove('toast-enter');
    toast.classList.add('toast-leave');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  };

  closeBtn.addEventListener('click', dismiss);
  container.appendChild(toast);

  // Lucide ikonlarını oluştur
  createIcons({
    root: toast,
    icons: { CheckCircle, AlertTriangle, AlertCircle, Info }
  });

  timerId = setTimeout(dismiss, duration);
}
