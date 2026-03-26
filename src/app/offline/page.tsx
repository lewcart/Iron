export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center bg-background">
      <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-6">
        <svg
          className="w-8 h-8 text-zinc-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M3 3l18 18M9.879 9.879A3 3 0 0012 9a3 3 0 013 3 3 3 0 01-.879 2.121"
          />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-foreground mb-2">You&apos;re offline</h1>
      <p className="text-sm text-muted-foreground max-w-xs">
        Your workout data is safe locally and will sync when you&apos;re back online.
      </p>
    </div>
  );
}
