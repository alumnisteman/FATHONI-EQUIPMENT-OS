// Helper untuk print dokumen di Electron dan browser
export async function printDocument(htmlContent: string, title: string = 'Document'): Promise<void> {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

  if (api?.printDocument) {
    // Desktop: HTML dokumen dikirim ke main process yang membuat jendela cetak
    // sementara. Popup renderer diblokir oleh hardening, dan mencetak jendela
    // utama akan mengeluarkan antarmuka aplikasi dari printer, bukan dokumennya.
    try {
      const result = await api.printDocument(htmlContent, {
        silent: false,
        printBackground: true,
        pageSize: 'A4',
      });
      if (!result?.success) {
        alert('Gagal mencetak dokumen: ' + (result?.error || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Print error:', error);
      alert('Gagal mencetak dokumen. Silakan coba lagi. ' + (error?.message || ''));
    }
    return;
  }

  // Fallback untuk browser biasa
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) {
    alert('Gagal membuka window print. Pastikan popup blocker dimatikan.');
    return;
  }

  w.document.write(htmlContent);
  w.document.close();

  w.onload = () => {
    w.print();
    w.onafterprint = () => w.close();
  };
}

// Fungsi sanitasi string untuk mencegah XSS
export function sanitize(str: string): string {
  if (!str) return '';
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Ambil nama perusahaan dari localStorage
export function getCompanyName(): string {
  const savedSettings = localStorage.getItem('hems_settings');
  return savedSettings ? JSON.parse(savedSettings).name : 'CV. MUGHNY NAMASKARABUMI KURNIA';
}
