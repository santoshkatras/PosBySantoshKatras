import type { Metadata, Viewport } from 'next';
import { Figtree, Fraunces } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

const sans = Figtree({ subsets: ['latin'], variable: '--font-sans' });
const serif = Fraunces({ subsets: ['latin'], variable: '--font-serif' });

export const metadata: Metadata = {
  title: 'Stockkeep',
  description: 'Stock and service jobs for computer shops and two-wheeler workshops.',
  applicationName: 'Stockkeep',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Stockkeep', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#1b2e28',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable} font-sans antialiased`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
