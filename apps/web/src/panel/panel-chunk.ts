/**
 * نقطه‌ی ورودِ chunkِ lazyِ پنل — `router.tsx` هر دو را از **همین** ماژول lazy می‌کند تا Vite یک chunk
 * بسازد (نه یکی به‌ازای هر صفحه) و chunkِ ورودی فقط دو `lazy()`ِ کوچک بگیرد.
 */
export { PanelAudit } from "./PanelAudit.tsx";
export { PanelHome } from "./PanelHome.tsx";
export { PanelLayout } from "./PanelLayout.tsx";
export { PanelPayment } from "./PanelPayment.tsx";
export { PanelPayments } from "./PanelPayments.tsx";
export { PanelStats } from "./PanelStats.tsx";
export { PanelSystem } from "./PanelSystem.tsx";
export { PanelTeam } from "./PanelTeam.tsx";
export { PanelUser } from "./PanelUser.tsx";
export { PanelUsers } from "./PanelUsers.tsx";
