/** The real <html>/<body> live in app/[locale]/layout.tsx so lang/dir follow the route. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
