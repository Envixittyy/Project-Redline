"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type NavigationTransitionContextValue = {
  pendingPath: string | null;
  beginNavigation: (path: string) => void;
};

const NavigationTransitionContext =
  createContext<NavigationTransitionContextValue | null>(null);
const idleNavigationTransition: NavigationTransitionContextValue = {
  pendingPath: null,
  beginNavigation: () => {},
};

export function NavigationTransitionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [pendingNavigation, setPendingNavigation] = useState<{
    path: string;
    fromPath: string;
  } | null>(null);
  const pendingPath =
    pendingNavigation?.fromPath === pathname ? pendingNavigation.path : null;

  useEffect(() => {
    if (!pendingPath) return;
    const timeout = window.setTimeout(() => setPendingNavigation(null), 12_000);
    return () => window.clearTimeout(timeout);
  }, [pendingPath]);

  const beginNavigation = useCallback(
    (path: string) => {
      const cleanPath = path.split("?")[0].split("#")[0] || "/";
      if (cleanPath !== pathname) {
        setPendingNavigation({ path: cleanPath, fromPath: pathname });
      }
    },
    [pathname],
  );

  const value = useMemo(
    () => ({ pendingPath, beginNavigation }),
    [beginNavigation, pendingPath],
  );

  return (
    <NavigationTransitionContext.Provider value={value}>
      {children}
    </NavigationTransitionContext.Provider>
  );
}

export function useNavigationTransition() {
  return useContext(NavigationTransitionContext) ?? idleNavigationTransition;
}
