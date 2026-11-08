'use client';

import { Shell } from '@/components/shell';
import { PageState } from '@/components/page-state';

/** Never show exception messages, URLs, stack traces or potentially private data. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Shell>
      <PageState title="Something went wrong" description="We couldn’t load this page. Please try again, or return to the home page.">
        <button type="button" onClick={reset} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Try again</button>
      </PageState>
    </Shell>
  );
}
