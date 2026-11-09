'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { shopHref } from '@/lib/shop-query';

/** Only catalog filters are retained; no arbitrary URL from the query is followed. */
export function ProductReturnLink() {
  const search = useSearchParams();
  const href = shopHref({
    q: search?.get('q') ?? undefined,
    categoryId: search?.get('categoryId') ?? undefined,
    cursor: search?.get('cursor') ?? undefined,
  });
  return (
    <Link href={href} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">
      {href === '/shop' ? 'Explore the shop' : 'Back to results'} <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}
