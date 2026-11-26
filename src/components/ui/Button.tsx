import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out motion-safe:active:translate-y-[0.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-45 aria-[pressed=true]:border-foreground aria-[pressed=true]:bg-foreground aria-[pressed=true]:font-semibold aria-[pressed=true]:text-card aria-[pressed=true]:hover:bg-foreground aria-[pressed=true]:hover:text-card aria-[pressed=true]:before:absolute aria-[pressed=true]:before:left-1 aria-[pressed=true]:before:top-1/2 aria-[pressed=true]:before:h-1.5 aria-[pressed=true]:before:w-1.5 aria-[pressed=true]:before:-translate-y-1/2 aria-[pressed=true]:before:rounded-full aria-[pressed=true]:before:bg-primary aria-[pressed=true]:before:content-[''] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: 'bg-foreground text-card shadow-[0_1px_2px_hsl(var(--foreground)/0.2),inset_0_1px_0_hsl(var(--card)/0.18)] hover:bg-foreground/90 active:bg-foreground',
        secondary:
          'border border-border bg-card text-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] hover:border-foreground/45 hover:bg-muted/70 active:bg-secondary',
        ghost: 'text-muted-foreground hover:bg-secondary/90 hover:text-foreground active:bg-secondary',
        danger: 'text-destructive hover:bg-destructive/10 active:bg-destructive/15',
      },
      size: { sm: 'min-h-10 px-3 text-xs', md: 'min-h-11 px-4', icon: 'h-11 w-11' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = 'Button';
