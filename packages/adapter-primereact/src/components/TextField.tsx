import { useId } from 'react';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { TextFieldApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';

export const TextField = createComponentImplementation(TextFieldApi, ({ props }) => {
  const uniqueId = useId();
  const isLong = props.variant === 'longText';
  const type =
    props.variant === 'number'
      ? 'number'
      : props.variant === 'obscured'
        ? 'password'
        : 'text';
  const hasError =
    Array.isArray((props as Record<string, unknown>).validationErrors) &&
    ((props as Record<string, unknown>).validationErrors as unknown[]).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {props.label && (
        <label htmlFor={uniqueId} style={{ fontSize: 13, fontWeight: 600 }}>
          {typeof props.label === 'string' ? props.label : ''}
        </label>
      )}
      {isLong ? (
        <InputTextarea
          id={uniqueId}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(e) =>
            typeof props.setValue === 'function' && props.setValue(e.target.value)
          }
          rows={4}
          className={hasError ? 'p-invalid' : ''}
        />
      ) : (
        <InputText
          id={uniqueId}
          type={type}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(e) =>
            typeof props.setValue === 'function' && props.setValue(e.target.value)
          }
          className={hasError ? 'p-invalid' : ''}
        />
      )}
      {hasError && (
        <small style={{ color: '#ef4444' }}>
          {String(
            ((props as Record<string, unknown>)
              .validationErrors as string[])?.[0] ?? '',
          )}
        </small>
      )}
    </div>
  );
});
