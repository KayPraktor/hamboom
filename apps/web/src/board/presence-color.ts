/**
 * رنگِ حضورِ **قطعی** از شناسه‌ی کاربر — یک هیو از هشِ ساده. User DTO رنگِ حضور
 * ندارد، پس همین‌جا مشتق می‌شود؛ همان کاربر همیشه همان رنگ را می‌گیرد.
 */
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 65% 60%)`;
}
