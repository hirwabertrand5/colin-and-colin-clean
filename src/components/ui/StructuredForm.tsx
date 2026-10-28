import { ReactNode } from 'react';

/** Shared fields and option cards used by the retainer and staff TPA forms. */
export function StructuredFormField({ label, children, required = false, hint, wide = false }: {
  label: string; children: ReactNode; required?: boolean; hint?: string; wide?: boolean;
}) {
  return <label className={`retainer-form-field ${wide ? 'is-wide' : ''}`}>
    <span className="retainer-form-label">{label}{required && <em aria-hidden="true"> *</em>}</span>
    {children}
    {hint && <small className="retainer-form-hint">{hint}</small>}
  </label>;
}

export function StructuredFormChoice({ title, description, selected, onSelect, disabled = false }: {
  title: string; description: string; selected: boolean; onSelect: () => void; disabled?: boolean;
}) {
  return <button type="button" role="radio" aria-label={title} aria-checked={selected} disabled={disabled} tabIndex={selected ? 0 : -1}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const group = event.currentTarget.closest('[role="radiogroup"]');
      if (!group) return;
      const options = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]')).filter(option => !option.matches(':disabled'));
      const index = options.indexOf(event.currentTarget);
      if (index < 0 || !options.length) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
        (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
      options[next]?.focus(); options[next]?.click();
    }}
    onClick={onSelect} className={`retainer-model-option ${selected ? 'is-selected' : ''}`}>
    <span className="retainer-model-indicator" aria-hidden="true" />
    <span><strong>{title}</strong><small>{description}</small></span>
  </button>;
}
