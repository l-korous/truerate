// Azure Communication Services email sender for TrueRate.
//
// Env vars:
//   ACS_EMAIL_ENDPOINT — "https://<resource>.communication.azure.com"
//   ACS_EMAIL_SENDER   — verified sender address (e.g. "noreply@truerate.app")
//   ACS_EMAIL_KEY      — ACS access key; omit to use Managed Identity instead.
//
// Falls back to NoOpEmailSender when the env vars are absent or the
// @azure/communication-email package is not installed.  Zero cost at idle.

import { NoOpEmailSender, type EmailSender, type EmailMessage } from "@truerate/core";

export async function createEmailSender(): Promise<EmailSender> {
  const endpoint = process.env.ACS_EMAIL_ENDPOINT?.trim();
  const senderAddress = process.env.ACS_EMAIL_SENDER?.trim();
  const key = process.env.ACS_EMAIL_KEY?.trim();

  if (!endpoint || !senderAddress) {
    return new NoOpEmailSender();
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emailMod = await import("@azure/communication-email" as any);
    const { EmailClient } = emailMod;

    let credential: unknown;
    if (key) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authMod = await import("@azure/core-auth" as any);
      credential = new authMod.AzureKeyCredential(key);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const identityMod = await import("@azure/identity" as any);
      credential = new identityMod.DefaultAzureCredential();
    }

    const client = new EmailClient(endpoint, credential);

    return {
      async send(message: EmailMessage): Promise<void> {
        const poller = await client.beginSend({
          senderAddress,
          recipients: { to: [{ address: message.to }] },
          content: {
            subject: message.subject,
            plainText: message.text,
            ...(message.html ? { html: message.html } : {}),
          },
        });
        await poller.pollUntilDone();
      },
    };
  } catch {
    return new NoOpEmailSender();
  }
}
