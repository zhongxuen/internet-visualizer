import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Internet Visualizer',
  description:
    'An interactive, visual explanation of how the Internet works -- DNS, HTTP, TLS, TCP/IP and more, as live simulations rather than text.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // `dark` is set here, not toggled: the product is dark-mode-first.
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
