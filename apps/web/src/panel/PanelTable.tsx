import type { ReactNode } from "react";

/**
 * جدولِ پایه‌ی پنل — M6 فاز ۳٫۶. همان ظاهرِ `invoice-table`ِ صفحه‌ی صورت‌حساب (کلاسِ `panel-table`
 * در `app.css` از آن مشتق شده)، با ستون‌های اعلامی تا صفحه‌های بعد (کاربران، پرداخت‌ها، audit) فقط
 * ستون تعریف کنند نه markup. اعدادِ ltr (شناسه، شماره، مبلغ) با `panel-table__ltr` در ستون.
 *
 * ⚠️ صفحه‌بندیِ cursor **این‌جا نیست** — اولین مصرف‌کننده‌اش `GET /admin/audit` (فاز ۴٫۳) است و
 * hookش همان‌جا با endpointِ واقعی ساخته می‌شود، نه پیش از آن (کدِ بی‌مصرف‌کننده: D7).
 */
export interface PanelColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** محتوای چپ‌به‌راست (شناسه، شماره، مبلغ) — فقط جهت، تراز همچنان `start`. */
  ltr?: boolean;
}

export function PanelTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty = "چیزی نیست.",
}: {
  columns: readonly PanelColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** عنوانِ دسترس‌پذیرِ جدول (پنهان نمی‌شود — پنل ابزار است، نه ویترین). */
  caption?: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <table className="panel-table">
      {caption !== undefined && <caption className="panel-table__caption">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col">
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="panel-table__empty" colSpan={columns.length}>
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.ltr === true ? "panel-table__ltr" : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
