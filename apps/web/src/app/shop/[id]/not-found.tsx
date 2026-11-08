import { Shell } from '@/components/shell';
import { PageState } from '@/components/page-state';

export default function ProductNotFound() {
  return <Shell><PageState title="Product not found" description="This product could not be found. It may no longer be available, or the link may be incorrect." action="shop" /></Shell>;
}
