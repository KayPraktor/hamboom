import { useEffect, useRef, useState, type ReactNode } from "react";

import { api, setSessionEndedHandler } from "../api/client.ts";
import { SessionContext, type SessionStatus, type SessionValue } from "./session-context.ts";

/**
 * نگهدارنده‌ی نشست — access در حافظه‌ی `sdk`، و این فقط `user`/`teams` را برای UI
 * نگه می‌دارد و وضعیت را از کوکیِ refresh **بازمی‌گرداند**.
 *
 * ⚠️ **StrictMode-safe** ([ADR-032](../../../../ARCHITECTURE_DECISIONS.md#adr-032)):
 * افکت cleanup دارد و با `alive` از به‌روزرسانیِ بعد از unmount جلوگیری می‌کند —
 * پس اجرای دوباره‌ی افکت زیرِ StrictMode بی‌آزار است.
 *
 * قرارداد و `useSession` عمداً در [`session-context.ts`](session-context.ts) اند
 * (این فایل فقط کامپوننت export می‌کند).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<SessionValue["user"]>(null);
  const [teams, setTeams] = useState<SessionValue["teams"]>([]);

  const applyAnonymous = (): void => {
    setUser(null);
    setTeams([]);
    setStatus("anonymous");
  };

  const loadMe = async (): Promise<void> => {
    const me = await api.me.get();
    setUser(me.user);
    setTeams(me.teams);
    setStatus("authenticated");
  };

  // ⚠️ **یک‌بار** اجرا شود، نه دوبار. زیرِ StrictMode افکت دوبار صدا زده می‌شود؛
  // اگر هر بار `refresh` بزنیم، **دو** چرخشِ توکن با یک کوکی اتفاق می‌افتد — هم
  // هدررفت، هم ریسکِ «reuse»ِ خانواده‌ی refresh (سرور خانواده را می‌سوزاند). این
  // ref تضمین می‌کند بازیابی فقط یک‌بار شروع شود. (ریشه هرگز واقعاً unmount نمی‌شود،
  // پس نیازی به گاردِ «alive» نیست.)
  const restoreStarted = useRef(false);
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void (async () => {
      // بازگرداندنِ نشست از کوکیِ HttpOnly. (اگر کوکی نباشد، refresh داخلاً
      // onSessionEnded را صدا می‌زند ولی هنوز handlerی وصل نیست — بی‌اثر.)
      const restored = await api.auth.refresh();
      if (restored) {
        try {
          await loadMe();
        } catch {
          applyAnonymous();
        }
      } else {
        applyAnonymous();
      }
      // حالا که وضعیتِ اولیه معلوم شد، مرگِ نشستِ بعدی را گوش بده.
      setSessionEndedHandler(() => applyAnonymous());
    })();
  }, []);

  const value: SessionValue = {
    status,
    user,
    teams,
    establish: loadMe,
    signOut: () => {
      api.setAccessToken(null);
      applyAnonymous();
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
