import { useState } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Checkbox } from 'primereact/checkbox';
import { Dropdown } from 'primereact/dropdown';
import { Editor } from 'primereact/editor';
import { Button } from 'primereact/button';
import { useAction, useReportDiagnostics, type DiagnosticInput } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const optionSchema = z.union([
  z.string(),
  z.object({ label: z.string(), value: z.unknown() }),
]);

const fieldSchema = z.object({
  /** Key the value is reported under on submit. */
  name: z.string(),
  /** Display label (defaults to `name`). */
  label: z.string().optional(),
  /** Input kind (editable mode). Defaults to "text". "richText" is a WYSIWYG editor
   *  whose value is an HTML string. */
  type: z.enum(['text', 'number', 'longText', 'richText', 'obscured', 'checkbox', 'select']).optional(),
  /** Initial value. */
  value: z.unknown().optional(),
  placeholder: z.string().optional(),
  /** Helper text shown under the field. */
  helpText: z.string().optional(),
  /** For type "select": ["a","b"] or [{label, value}]. */
  options: z.array(optionSchema).optional(),
});

const formSchema = z.object({
  fields: z.array(fieldSchema),
  title: z.string().optional(),
  /** READ-ONLY variant: render label/value pairs, no inputs, no submit. Default false (editable). */
  readOnly: z.boolean().optional(),
  /** Editable submit button label (defaults to "Submit"). */
  submitLabel: z.string().optional(),
  /**
   * Action fired on submit (editable mode). Auto-context: `{ values }` (a map of
   * each field `name` → current value) merged with any spec-declared context.
   */
  action: actionSchema.optional(),
  weight: z.number().optional(),
});

export const FormApi: ComponentApi<typeof formSchema> = {
  name: 'Form',
  schema: formSchema,
};

type Option = string | { label: string; value?: unknown };

function normalizeOptions(options?: Option[]): { label: string; value: unknown }[] {
  return (options ?? []).map((o) =>
    typeof o === 'string' ? { label: o, value: o } : { label: o.label, value: o.value },
  );
}

/** Human-readable rendering of a value for the read-only variant. */
function displayValue(v: unknown, options?: Option[]): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (options) {
    const match = normalizeOptions(options).find((o) => o.value === v);
    if (match) return match.label;
  }
  return String(v);
}

export const Form = createComponentImplementation(FormApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const readOnly = props.readOnly === true;

  const diagnostics: DiagnosticInput[] = [];
  if (props.fields.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'form.no-fields',
      message: 'Form has no fields, so nothing renders. Provide a non-empty fields array.',
    });
  }
  useReportDiagnostics(context.componentModel.id, diagnostics);

  // Self-contained local state (like DataTable); submit reports the values back.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of props.fields) {
      init[f.name] = f.value ?? (f.type === 'checkbox' ? false : '');
    }
    return init;
  });
  const setField = (name: string, v: unknown) => setValues((prev) => ({ ...prev, [name]: v }));

  const submit = () => {
    const action = props.action;
    if (!action) return;
    // Coerce number fields back to numbers before reporting.
    const out: Record<string, unknown> = { ...values };
    for (const f of props.fields) {
      if (f.type === 'number' && out[f.name] !== '' && out[f.name] != null) {
        const n = Number(out[f.name]);
        if (!Number.isNaN(n)) out[f.name] = n;
      }
    }
    dispatchAction({
      name: action.event.name,
      context: { values: out, ...(action.event.context ?? {}) },
    });
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text, #e5e7eb)' };
  const helpStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-dim, #888)' };

  return (
    <div style={containerStyle}>
      {props.title && <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #e5e7eb)' }}>{props.title}</div>}

      {props.fields.map((f) => {
        const label = f.label ?? f.name;
        const val = values[f.name];

        if (readOnly) {
          // Rich text renders its HTML via Quill (read-only) — not raw innerHTML.
          if (f.type === 'richText') {
            return (
              <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={helpStyle}>{label}</span>
                <Editor value={typeof val === 'string' ? val : ''} readOnly showHeader={false} style={{ border: 'none' }} />
              </div>
            );
          }
          return (
            <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={helpStyle}>{label}</span>
              <span style={{ fontSize: 13, color: 'var(--text, #e5e7eb)' }}>{displayValue(val, f.options)}</span>
            </div>
          );
        }

        return (
          <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {f.type !== 'checkbox' && <label style={labelStyle}>{label}</label>}
            {f.type === 'richText' ? (
              <Editor
                value={typeof val === 'string' ? val : ''}
                onTextChange={(e) => setField(f.name, e.htmlValue ?? '')}
                style={{ height: 180 }}
              />
            ) : f.type === 'longText' ? (
              <InputTextarea
                value={typeof val === 'string' ? val : String(val ?? '')}
                placeholder={f.placeholder}
                rows={4}
                onChange={(e) => setField(f.name, e.target.value)}
              />
            ) : f.type === 'checkbox' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, ...labelStyle, fontWeight: 500 }}>
                <Checkbox checked={val === true} onChange={(e) => setField(f.name, !!e.checked)} />
                {label}
              </label>
            ) : f.type === 'select' ? (
              <Dropdown
                value={val}
                options={normalizeOptions(f.options)}
                optionLabel="label"
                placeholder={f.placeholder ?? 'Select…'}
                onChange={(e) => setField(f.name, e.value)}
              />
            ) : (
              <InputText
                type={f.type === 'number' ? 'number' : f.type === 'obscured' ? 'password' : 'text'}
                value={typeof val === 'string' ? val : String(val ?? '')}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.name, e.target.value)}
              />
            )}
            {f.helpText && <small style={helpStyle}>{f.helpText}</small>}
          </div>
        );
      })}

      {!readOnly && props.action && (
        <div>
          <Button label={props.submitLabel ?? 'Submit'} size="small" onClick={submit} />
        </div>
      )}
    </div>
  );
});
