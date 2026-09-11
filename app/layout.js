import './globals.css';
import { Analytics } from '@vercel/analytics/next';

export const metadata = {
  title: 'Gabitor AI',
  description: 'Create AI images and videos in one place.'
};

export default function RootLayout({ children }) {
  return <html lang="en-US"><body>{children}<Analytics /></body></html>;
}
