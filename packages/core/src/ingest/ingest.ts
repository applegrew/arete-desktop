import type { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { A2uiMessage } from '@a2ui/web_core/v0_9';

/**
 * Feed A2UI messages into a processor. Thin wrapper around `processor.processMessages`
 * that exists so consumers can attach hooks/middleware later without changing call sites.
 */
export function ingest(
  processor: MessageProcessor<ReactComponentImplementation>,
  messages: A2uiMessage[],
): void {
  processor.processMessages(messages);
}
