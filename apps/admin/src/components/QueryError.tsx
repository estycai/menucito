import { Notice } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";

interface QueryErrorProps {
  message: string;
  onRetry: () => void;
  /** Disables the button while the retry is in flight. */
  retrying?: boolean;
  /**
   * Small one-line version for a refresh that failed while older data is still on screen, so a
   * background refetch never replaces what the user is looking at.
   */
  compact?: boolean;
}

/** Error state of a query that failed: the message plus a "Reintentar" button that refetches. */
export function QueryError({ message, onRetry, retrying = false, compact = false }: QueryErrorProps) {
  if (compact) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-danger">
        <span className="min-w-0">{message}</span>
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="min-h-11 cursor-pointer font-bold text-link underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Notice tone="error">{message}</Notice>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={retrying}
          onClick={onRetry}
          className="min-h-11 px-4 text-sm font-bold"
        >
          Reintentar
        </Button>
      </div>
    </div>
  );
}
