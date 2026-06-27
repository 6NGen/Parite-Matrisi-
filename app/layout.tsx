import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Göreceli Güç & Makro Likidite Matrisi',
  description:
    'Forex, Kripto, Emtia ve Hisse enstrümanlarının makro referanslara göre rölatif güç ısı haritası — canlı veri.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
