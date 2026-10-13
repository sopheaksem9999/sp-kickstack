import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { clsx } from 'clsx';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={clsx(
      'inline-flex items-center justify-center rounded-xl bg-slate-100/80 dark:bg-[#1e1e1e] p-1 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-[#2d2d2d]',
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={clsx(
      'inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold ring-offset-background transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7b68ee] disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-white dark:data-[state=active]:bg-[#282828] data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm',
      'hover:text-slate-900 dark:hover:text-white',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={clsx(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7b68ee]',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
