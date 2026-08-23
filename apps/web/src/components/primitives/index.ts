/*
 * Atomic layer of the design system. A component from here is purely visual: no network call,
 * no route, no store — everything comes in as props and leaves as callbacks.
 *
 * One exception, and only one: the copy a primitive owns itself (a tone prefix, a status label,
 * the wording of the drop zone) is read from the message catalogue. That text belongs to the
 * primitive, not to its host, and threading it through props would make every call site carry
 * strings it has no opinion about.
 */
export { Button } from './button';
export type { ButtonProps } from './button';
export { IconButton } from './icon-button';
export { Field, TextInput, Select } from './field';
export { StatusPill } from './status-pill';
export { Notice } from './notice';
export { Skeleton } from './skeleton';
export { VisuallyHidden } from './visually-hidden';
export { FileDrop } from './file-drop';
export { EmptyState } from './empty-state';
