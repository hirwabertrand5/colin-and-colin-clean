import { useEffect } from 'react';

export default function usePageTitle(title?: string) {
  useEffect(() => {
    const base = 'Colin & Colin Legal Solution';
    document.title = title ? `${title} | ${base}` : base;
  }, [title]);
}