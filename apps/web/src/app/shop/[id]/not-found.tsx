import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Shell } from '@/components/shell';
import { PageState } from '@/components/page-state';
import { ProductReturnLink } from '@/components/product-return-link';

export default function ProductNotFound() {
  return (
    <Shell>
      <PageState title="Product not found" description="This product could not be found. It may no longer be available, or the link may be incorrect.">
        <Suspense fallback={<Link href="/shop" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Explore the shop <ArrowRight size={16} aria-hidden="true" /></Link>}>
          <ProductReturnLink />
        </Suspense>
      </PageState>
    </Shell>
  );
}
