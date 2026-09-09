import './globals.css';

export const metadata = {
  title: 'Aura Studio',
  description: 'AI képek és videók egy helyen.'
};

export default function RootLayout({ children }) {
  return <html lang="hu"><body>{children}</body></html>;
}
