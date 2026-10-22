/**
 * Mock implementation of `next/navigation` for Storybook.
 *
 * Components such as `GiftCard` call `useRouter()` which otherwise throws
 * outside of a Next.js router context. This mock provides a no-op router so
 * stories render without the full Next.js routing stack.
 */

export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
    prefetch: () => Promise.resolve(),
    back: () => {},
    forward: () => {},
    refresh: () => {},
  };
}

export function usePathname() {
  return "/";
}

export function useParams() {
  return {};
}

export function useSearchParams() {
  return new URLSearchParams();
}

export const router = {
  push: () => {},
  replace: () => {},
  prefetch: () => Promise.resolve(),
  back: () => {},
  forward: () => {},
  refresh: () => {},
};

export const useRouterHook = useRouter;
