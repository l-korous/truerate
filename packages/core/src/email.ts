// Email-sender abstraction for TrueRate partner notifications.
//
// PartnerWorkflow accepts an optional EmailSender to decouple transport from
// the domain logic.  When absent (or NoOp), lifecycle events still capture to
// PartnerNotificationRepo — the email delivery is the only missing piece.
//
// Concrete transport implementations (ACS, SMTP) live in the consuming app
// (apps/api) to keep Azure SDK dependencies out of the core package.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

// ---------------------------------------------------------------------------
// No-op sender (default when no transport is configured — zero cost)
// ---------------------------------------------------------------------------

export class NoOpEmailSender implements EmailSender {
  async send(_message: EmailMessage): Promise<void> {
    // Intentionally silent; lifecycle events are still captured in the
    // PartnerNotificationRepo so nothing is truly lost.
  }
}

// ---------------------------------------------------------------------------
// In-memory sender (for unit/integration tests)
// ---------------------------------------------------------------------------

export class MemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push({ ...message });
  }

  /** Reset captured emails between tests. */
  clear(): void {
    this.sent.length = 0;
  }

  /** Find messages sent to a specific address. */
  sentTo(address: string): EmailMessage[] {
    return this.sent.filter((m) => m.to === address);
  }
}
