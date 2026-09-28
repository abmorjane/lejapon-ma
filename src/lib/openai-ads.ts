export type OpenAiBusinessEvent =
  | "page_viewed"
  | "contents_viewed"
  | "checkout_started"
  | "lead_created"
  | "registration_completed"
  | "order_created";

export type OpenAiConversionCandidate = {
  event: OpenAiBusinessEvent;
  openaiClickRef?: string;
  eventId: string;
  occurredAt: string;
};

export const OPENAI_EVENT_MAPPING = {
  page_view: "page_viewed",
  view_content: "contents_viewed",
  initiate_checkout: "checkout_started",
  booking_form_submitted: "lead_created",
  registration_completed: "registration_completed",
  payment_confirmed: "order_created",
} as const satisfies Record<string, OpenAiBusinessEvent>;

export interface OpenAiConversionSender {
  send(candidate: OpenAiConversionCandidate): Promise<void>;
}

/**
 * Intentional no-op until server credentials and the production integration
 * contract are approved. Attribution is preserved without inventing requests.
 */
export class DisabledOpenAiConversionSender implements OpenAiConversionSender {
  async send(_candidate: OpenAiConversionCandidate) {
    return Promise.resolve();
  }
}
