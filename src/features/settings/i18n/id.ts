// TODO(i18n-id): translate from English placeholders. Structure must match en.ts exactly.
export const id = {
  settings: {
    byom: {
      sidebarLabel: 'Penyedia Model',
      title: 'Penyedia Model',
      subtitle: 'Pilih model AI mana yang digunakan agen Anda',
      loadingSubtitle: 'Memuat...',
      policyToggleTitle: 'Aturan Penyedia Model',
      policyToggleDescription: 'Saat diaktifkan, pemilihan penyedia mengikuti aturan yang Anda konfigurasi',
      policyToggleLabel: 'Aturan penyedia model',
      corruptTitle: 'Kebijakan Penyedia Model Rusak',
      unsavedSection: 'Kebijakan Penyedia Model',
    },
    qualityGates: {
      sidebarLabel: 'Filter Konten',
      title: 'Filter Konten',
      subtitle: '{count} aturan filter aktif',
      loadingSubtitle: 'Memuat...',
      errorSubtitle: 'Gagal memuat konfigurasi',
      description:
        'Filter konten meninjau memori dan ulasan yang dihasilkan AI selama eksekusi. ' +
        'Pola dicocokkan sebagai substring terhadap judul dan konten gabungan dari setiap pengiriman. ' +
        'Ketika pola cocok, tindakan yang dikonfigurasi diterapkan. Filter ini mencegah noise operasional mencemari basis pengetahuan Anda.',
      loadingMessage: 'Memuat konfigurasi filter konten...',
    },
    configResolution: {
      sidebarLabel: 'Konfigurasi Agen',
      title: 'Ikhtisar Konfigurasi Agen',
      subtitle: 'Menunjukkan tingkat mana (agen / ruang kerja / global) yang menyediakan setiap pengaturan per agen',
    },
    ambientContext: {
      title: 'Kesadaran Desktop',
      toggleLabel: 'Kesadaran desktop',
      description:
        'Kesadaran desktop menangkap sinyal clipboard, perubahan file, dan fokus aplikasi untuk memberikan agen Anda kesadaran tentang alur kerja desktop Anda.',
    },
  },
};
