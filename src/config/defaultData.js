export const DEFAULT_PRESETS = [
  { id: 'preset_food', title: 'Yemekhane Fişi', amount: 40, categoryId: 'exp_food', icon: '🍱', emoji: '🍱', name: 'Yemekhane', label: 'Yemekhane' },
  { id: 'preset_coffee', title: 'Kampüs Kahve', amount: 70, categoryId: 'exp_social', icon: '☕', emoji: '☕', name: 'Kahve', label: 'Kahve' },
  { id: 'preset_market', title: 'Haftalık Market', amount: 200, categoryId: 'exp_food', icon: '🛒', emoji: '🛒', name: 'Market', label: 'Market' },
  { id: 'preset_transit', title: 'Ulaşım / Dolmuş', amount: 30, categoryId: 'exp_transport', icon: '🚌', emoji: '🚌', name: 'Dolmuş', label: 'Dolmuş' },
  { id: 'preset_print', title: 'Fotokopi & Ders Notu', amount: 50, categoryId: 'exp_education', icon: '📄', emoji: '📄', name: 'Fotokopi', label: 'Fotokopi' }
];

export const DEFAULT_SETTINGS = {
  currency: 'TRY', // ISO kodu
  language: 'tr',
  monthStartDay: 1,
  warningThresholdPercent: 15,
  theme: 'light',
  targetMonth: '',
  presets: DEFAULT_PRESETS
};

export const DEFAULT_CATEGORIES = [
  // Gelir Kategorileri
  { id: 'inc_kyk', name: 'KYK Burs / Kredi', type: 'income', icon: 'graduation-cap', color: '#3B82F6' },
  { id: 'inc_allowance', name: 'Aile Harçlığı', type: 'income', icon: 'hand-coins', color: '#10B981' },
  { id: 'inc_part_time', name: 'Part-Time / Freelance', type: 'income', icon: 'briefcase', color: '#8B5CF6' },
  { id: 'inc_scholarship', name: 'Özel Kurum Bursu', type: 'income', icon: 'award', color: '#06B6D4' },
  { id: 'inc_other', name: 'Diğer Gelirler', type: 'income', icon: 'piggy-bank', color: '#64748B' },

  // Gider Kategorileri
  { id: 'exp_housing', name: 'Yurt / Ev Kirası', type: 'expense', icon: 'home', color: '#6366F1' },
  { id: 'exp_food', name: 'Yemek & Market', type: 'expense', icon: 'utensils-crossed', color: '#F59E0B' },
  { id: 'exp_transport', name: 'Ulaşım', type: 'expense', icon: 'bus', color: '#0EA5E9' },
  { id: 'exp_bills', name: 'Faturalar & Abonelikler', type: 'expense', icon: 'receipt', color: '#EF4444' },
  { id: 'exp_education', name: 'Kitap & Kırtasiye', type: 'expense', icon: 'book-open', color: '#14B8A6' },
  { id: 'exp_social', name: 'Sosyal & Eğlence', type: 'expense', icon: 'party-popper', color: '#EC4899' },
  { id: 'exp_health', name: 'Sağlık & Kişisel Bakım', type: 'expense', icon: 'heart-pulse', color: '#10B981' },
  { id: 'exp_tech', name: 'Teknoloji & Donanım', type: 'expense', icon: 'laptop', color: '#8B5CF6' },
  { id: 'exp_other', name: 'Diğer Giderler', type: 'expense', icon: 'circle-ellipsis', color: '#94A3B8' }
];

export const DEFAULT_SEED_TRANSACTIONS = [
  {
    id: 'seed-tx-001',
    title: 'KYK Lisans Bursu',
    amount: 2000.00,
    type: 'income',
    categoryId: 'inc_kyk',
    date: '2026-09-06',
    notes: 'Eylül ayı burs ödemesi',
    createdAt: 1725609600000,
    updatedAt: 1725609600000
  },
  {
    id: 'seed-tx-002',
    title: 'Aile Destek Harçlığı',
    amount: 4000.00,
    type: 'income',
    categoryId: 'inc_allowance',
    date: '2026-09-01',
    notes: 'Eylül başı kira ve harçlık desteği',
    createdAt: 1725177600000,
    updatedAt: 1725177600000
  },
  {
    id: 'seed-tx-003',
    title: 'Özel Ders Ücreti',
    amount: 1200.00,
    type: 'income',
    categoryId: 'inc_part_time',
    date: '2026-09-10',
    notes: 'Lise matematik 2 seans',
    createdAt: 1725955200000,
    updatedAt: 1725955200000
  },
  {
    id: 'seed-tx-004',
    title: 'KYK Yurt Ücreti',
    amount: 1100.00,
    type: 'expense',
    categoryId: 'exp_housing',
    date: '2026-09-02',
    notes: 'Eylül yurt taksiti',
    createdAt: 1725264000000,
    updatedAt: 1725264000000
  },
  {
    id: 'seed-tx-005',
    title: 'İstanbulkart Öğrenci Abonman',
    amount: 250.00,
    type: 'expense',
    categoryId: 'exp_transport',
    date: '2026-09-03',
    notes: 'Aylık 200 basım',
    createdAt: 1725350400000,
    updatedAt: 1725350400000
  },
  {
    id: 'seed-tx-006',
    title: 'Haftalık Market & Kahvaltılık',
    amount: 750.00,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-05',
    notes: 'Yulaf, süt, peynir, yumurta',
    createdAt: 1725523200000,
    updatedAt: 1725523200000
  },
  {
    id: 'seed-tx-007',
    title: 'Dönem Ders Kitapları & Fotokopi',
    amount: 420.00,
    type: 'expense',
    categoryId: 'exp_education',
    date: '2026-09-08',
    notes: 'Mühendislik ders notları',
    createdAt: 1725782400000,
    updatedAt: 1725782400000
  },
  {
    id: 'seed-tx-008',
    title: 'Spotify & Telefon Faturası',
    amount: 210.00,
    type: 'expense',
    categoryId: 'exp_bills',
    date: '2026-09-09',
    notes: 'Öğrenci paketi',
    createdAt: 1725868800000,
    updatedAt: 1725868800000
  },
  {
    id: 'seed-tx-009',
    title: 'Kampüs Kahve & Sinema',
    amount: 340.00,
    type: 'expense',
    categoryId: 'exp_social',
    date: '2026-09-11',
    notes: 'Kulüp etkinliği sonrası',
    createdAt: 1726041600000,
    updatedAt: 1726041600000
  }
];
