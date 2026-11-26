interface ViewfinderEmptyStateProps {
  status: string;
  title: string;
  description: string;
  stepsLabel: string;
  steps: readonly string[];
}

export function ViewfinderEmptyState({ status, title, description, stepsLabel, steps }: ViewfinderEmptyStateProps) {
  return (
    <div className="viewfinder-grid flex min-h-64 w-full flex-1 items-center justify-center rounded-lg border border-dashed border-input bg-background px-5 py-8">
      <div className="relative w-full max-w-sm bg-card/95 px-4 py-6 text-center">
        <p className="mb-4 inline-flex items-center gap-2 text-[10px] font-medium tracking-wider text-muted-foreground">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
          {status}
        </p>
        <p className="text-base font-semibold tracking-tight">{title}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
        <ol className="mt-6 grid grid-cols-3 divide-x divide-border border-y border-border py-3 text-[11px]" aria-label={stepsLabel}>
          {steps.map((step, index) => (
            <li key={step} className="space-y-1 px-1">
              <span className="block font-mono text-xs tabular-nums text-foreground">{String(index + 1).padStart(2, '0')} //</span>
              <span className="block text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
