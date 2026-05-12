/**
 * <Card> — compound component for paneled surfaces.
 *
 * Usage:
 *   <Card>
 *     <CardHeader>
 *       <h3 class="font-serif text-base font-medium">Title</h3>
 *     </CardHeader>
 *     <CardBody>...</CardBody>
 *     <CardFooter>...</CardFooter>
 *   </Card>
 *
 * `flat` removes shadow; useful inside nested layouts.
 */
import type { ParentComponent } from 'solid-js';

interface CardProps {
  flat?: boolean;
  class?: string;
}

export const Card: ParentComponent<CardProps> = (props) => (
  <div
    class={[
      'bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-xl',
      props.flat ? 'shadow-none' : 'shadow-[var(--shadow-sm)]',
      props.class ?? '',
    ].join(' ')}
  >
    {props.children}
  </div>
);

export const CardHeader: ParentComponent<{ class?: string }> = (props) => (
  <div
    class={[
      'flex items-center gap-2.5 px-5 py-3.5 border-b border-[color:var(--color-line)]',
      props.class ?? '',
    ].join(' ')}
  >
    {props.children}
  </div>
);

export const CardBody: ParentComponent<{ class?: string }> = (props) => (
  <div class={['p-5', props.class ?? ''].join(' ')}>{props.children}</div>
);

export const CardFooter: ParentComponent<{ class?: string }> = (props) => (
  <div
    class={[
      'flex items-center gap-2 px-5 py-3.5 border-t border-[color:var(--color-line)]',
      props.class ?? '',
    ].join(' ')}
  >
    {props.children}
  </div>
);

export default Card;
