import type { ReactNode } from 'react';

/** Native details keeps each translation independent and collapsed on remount. */
export function Translation({ children, label }: { children: ReactNode; label: string }) {
  return <details className="translation"><summary>{label}</summary><p>{children}</p></details>;
}
