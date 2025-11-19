import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  isLoading?: boolean;
  width?: number | string;
  height?: number | string;
  children: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      isLoading = false,
      disabled,
      width,
      height,
      className = '',
      children,
      style,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'font-sans font-medium text-sm leading-5 transition disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2';

    const variants = {
      primary: 'bg-cyan-400 hover:bg-cyan-500 disabled:bg-slate-400 text-white',
      secondary: 'bg-slate-200 hover:bg-slate-300 disabled:bg-slate-200 text-slate-900',
      outline: 'border border-slate-300 bg-white hover:bg-slate-50 disabled:bg-slate-50 text-slate-900',
      danger: 'text-white disabled:opacity-50 transition',
    };

    const sizes = {
      sm: 'px-2.5 py-1.5',
      md: 'px-4 py-2 text-base leading-6',
      lg: 'px-6 py-3 text-lg leading-7',
    };

    const widthClass = fullWidth ? 'w-full' : '';
    const borderRadiusClass = 'rounded-[calc(var(--ui-radius)*1.5)]';

    const finalClassName = `${baseStyles} ${variants[variant]} ${sizes[size]} ${widthClass} ${borderRadiusClass} ${className}`;

    const finalStyle: React.CSSProperties = {
      ...style,
      ...(width && { width: typeof width === 'number' ? `${width}px` : width }),
      ...(height && { height: typeof height === 'number' ? `${height}px` : height }),
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={finalClassName}
        style={finalStyle}
        {...props}
      >
        {isLoading ? 'Carregando...' : children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
