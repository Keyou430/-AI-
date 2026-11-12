import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 motion-safe:active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-45 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/85',
        secondary:
          'border border-border bg-card text-foreground shadow-sm hover:border-foreground/25 hover:bg-muted/75 active:bg-secondary aria-[pressed=true]:border-primary/45 aria-[pressed=true]:bg-accent aria-[pressed=true]:font-semibold aria-[pressed=true]:text-accent-foreground aria-[pressed=true]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18)]',
        ghost: 'text-muted-foreground hover:bg-muted/80 hover:text-foreground active:bg-secondary aria-[pressed=true]:bg-accent aria-[pressed=true]:font-semibold aria-[pressed=true]:text-accent-foreground aria-[pressed=true]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.24)]',
        danger: 'text-destructive hover:bg-destructive/10 active:bg-destructive/15',
      },
      size: { sm: 'min-h-9 px-3 text-xs', md: 'min-h-11 px-4', icon: 'h-11 w-11' },
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
