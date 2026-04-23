import './globals.css';
import type { Metadata } from 'next';
import Sidebar from '../components/Sidebar';

export const metadata: Metadata = {
  title: 'NQ Daily Bias — Local Dashboard',
  description: 'Local MVP dashboard for the NQ Daily Bias pipeline. Rules engine = production; ML = shadow only.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 px-6 py-6 md:px-10 md:py-8 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
