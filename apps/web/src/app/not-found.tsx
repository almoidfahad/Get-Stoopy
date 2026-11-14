import { Shell } from '@/components/shell';
import { PageState } from '@/components/page-state';

export default function NotFound() {
  return <Shell><PageState title="Page not found" description="The page you’re looking for may have moved or the link may be incorrect. You can return home or explore the shop." action="shop" /></Shell>;
}
