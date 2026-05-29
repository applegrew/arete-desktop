import { useId } from 'react';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { CheckBoxApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { Checkbox } from 'primereact/checkbox';

export const CheckBox = createComponentImplementation(CheckBoxApi, ({ props }) => {
  const uniqueId = useId();
  const hasError =
    Array.isArray((props as Record<string, unknown>).validationErrors) &&
    ((props as Record<string, unknown>).validationErrors as unknown[]).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox
          inputId={uniqueId}
          checked={!!props.value}
          onChange={(e) =>
            typeof props.setValue === 'function' && props.setValue(e.checked ?? false)
          }
          className={hasError ? 'p-invalid' : ''}
        />
        {props.label && (
          <label htmlFor={uniqueId} style={{ fontSize: 13, cursor: 'pointer' }}>
            {typeof props.label === 'string' ? props.label : ''}
          </label>
        )}
      </div>
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
