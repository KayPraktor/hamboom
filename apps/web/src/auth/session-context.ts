import type { Team, User } from "@hamboom/shared-types";
import { createContext, useContext } from "react";

/**
 * قرارداد و hookِ نشست — عمداً جدا از `SessionProvider` (که کامپوننت است) تا هر
 * فایل فقط یک جنس export کند و Fast Refresh تمیز بماند.
 */
export type SessionStatus = "loading" | "authenticated" | "anonymous";

export interface SessionValue {
  status: SessionStatus;
  user: User | null;
  teams: Team[];
  /** بعد از `verifyOtp` صدا زده می‌شود: `me` را می‌گیرد و نشست را برقرار می‌کند. */
  establish: () => Promise<void>;
  /** خروج — توکنِ حافظه‌ای پاک، وضعیت anonymous. */
  signOut: () => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession باید داخلِ SessionProvider استفاده شود.");
  return value;
}
