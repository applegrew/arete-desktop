import { useState } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Button as PrimeButton } from 'primereact/button';
import { useSystemActions } from '@arete-desktop/core';

/**
 * Trusted, system-owned button for creating a page.
 *
 * The agent CANNOT create pages itself (that would let it silently mutate the
 * workspace), so this is the only path: a real user click routes through
 * `SystemActions.createPage`, never through the LLM.
 *
 * SAFETY: the visible action label is **hard-coded** ("Create page"). The agent
 * may place this component and pass *data* (which page to make, an optional
 * surface to pin) but it CANNOT relabel the action to mislead the user — any
 * `label`/`text`/`child` prop is intentionally ignored. The agent-supplied
 * `pageTitle` is rendered only as a separate, clearly-secondary descriptor.
 */
const createPageButtonSchema = z.object({
  /** Suggested page title (data, not the action label). */
  pageTitle: z.string().optional(),
  /** Suggested page icon name/emoji. */
  pageIcon: z.string().optional(),
  /** Well-known page id for dedupe (e.g. the dashboard id). */
  pageId: z.string().optional(),
  /** Optional surface to pin into the new page on creation ("track this result"). */
  pinSurfaceId: z.string().optional(),
});

/** Fixed action label — never overridable by the agent. */
const FIXED_LABEL = 'Create page';

export const CreatePageButtonApi: ComponentApi<typeof createPageButtonSchema> = {
  name: 'CreatePageButton',
  schema: createPageButtonSchema,
};

export const CreatePageButton = createComponentImplementation(CreatePageButtonApi, ({ props }) => {
  const systemActions = useSystemActions();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  const onClick = async () => {
    if (!systemActions || state !== 'idle') return;
    setState('busy');
    try {
      await systemActions.createPage({
        id: props.pageId,
        title: props.pageTitle,
        icon: props.pageIcon,
        pinSurfaceId: props.pinSurfaceId,
      });
      setState('done');
    } catch {
      setState('idle');
    }
  };

  const label = state === 'done' ? 'Page created' : FIXED_LABEL;

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
      <PrimeButton
        label={label}
        icon={state === 'done' ? 'pi pi-check' : 'pi pi-plus'}
        severity="info"
        loading={state === 'busy'}
        // Disabled when already created or when no trusted handler is wired.
        disabled={state !== 'idle' || !systemActions}
        onClick={onClick}
      />
      {props.pageTitle && state !== 'done' && (
        <span style={{ fontSize: 11.5, opacity: 0.7 }}>“{props.pageTitle}”</span>
      )}
    </div>
  );
});
