"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type AmbientContextValue = {
  courseAccent?: string;
  setCourseAccent: (color?: string) => void;
};

const AmbientContext = createContext<AmbientContextValue>({
  courseAccent: undefined,
  setCourseAccent: () => {},
});

export function AmbientProvider({
  children,
  initialCourseAccent,
}: {
  children: ReactNode;
  initialCourseAccent?: string;
}) {
  const [courseAccent, setCourseAccent] = useState<string | undefined>(
    initialCourseAccent,
  );

  return (
    <AmbientContext.Provider value={{ courseAccent, setCourseAccent }}>
      <div
        style={
          courseAccent
            ? ({ "--course-accent": courseAccent } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
    </AmbientContext.Provider>
  );
}

export function useAmbientContext() {
  return useContext(AmbientContext);
}

/**
 * Hook for future course-scoped views to supply a restrained contextual accent color
 * (15–20% influence on secondary ambient light field) without altering School domain models.
 * Automatically cleans up upon unmount.
 */
export function useCourseAccent(color?: string) {
  const { setCourseAccent } = useAmbientContext();

  useEffect(() => {
    if (!color) return;
    setCourseAccent(color);
    return () => setCourseAccent(undefined);
  }, [color, setCourseAccent]);
}
