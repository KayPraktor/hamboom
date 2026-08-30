import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * مرزِ خطای ریشه — یک خطای رندرِ ناگرفته کلِ اپ را سفید نکند، بلکه یک پیامِ
 * فارسیِ خوانا نشان دهد. خطاهای شبکه/داده کارِ خودِ صفحه‌هاست؛ این فقط تورِ آخر است.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // بدونِ سرویسِ خارجی (P2) — فعلاً فقط کنسول.
    console.error("خطای رندرِ ناگرفته:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-screen" role="alert">
          <h1>مشکلی پیش آمد</h1>
          <p>صفحه را دوباره بارگذاری کنید. اگر باز هم تکرار شد، بعداً دوباره امتحان کنید.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
