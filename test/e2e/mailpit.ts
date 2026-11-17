/**
 * Reads the emails the app really sent, through Mailpit's HTTP API
 * (https://mailpit.axllent.org/docs/api-v1/). The same way a user reads their inbox.
 */
const MAILPIT_API = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';

interface MessageSummary {
  ID: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${MAILPIT_API}${path}`);
  if (!res.ok) {
    throw new Error(
      `Mailpit ${path} → ${res.status}. Is it running? (docker compose up -d)`,
    );
  }
  return (await res.json()) as T;
}

/** All messages to `address`, newest first. */
async function messagesTo(address: string): Promise<MessageSummary[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const { messages } = await getJson<{ messages: MessageSummary[] }>(
    `/api/v1/search?query=${query}`,
  );
  return messages;
}

export async function countEmailsTo(address: string): Promise<number> {
  return (await messagesTo(address)).length;
}

/**
 * The text body of the newest email to `address`. Waits a little: SMTP delivery and Mailpit's
 * indexing are fast, but not guaranteed to be finished the moment the HTTP response arrives.
 * `atLeast` = how many emails must have arrived (2 after one resend).
 */
export async function latestEmailTo(
  address: string,
  atLeast = 1,
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const messages = await messagesTo(address);
    if (messages.length >= atLeast) {
      const { Text } = await getJson<{ Text: string }>(
        `/api/v1/message/${messages[0].ID}`,
      );
      return Text;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email #${atLeast} to ${address} arrived in Mailpit`);
}

/** "Your confirmation code: 123456" (MailService.sendRegistrationOtp). */
export function otpFrom(text: string): string {
  const code = /confirmation code: (\d{6})/.exec(text)?.[1];
  if (!code) throw new Error(`No OTP code in email:\n${text}`);
  return code;
}

/** "…/register/confirm#token=<43 chars>" (MailService.sendRegistrationMagicLink). */
export function tokenFrom(text: string): string {
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(text)?.[1];
  if (!token) throw new Error(`No magic-link token in email:\n${text}`);
  return token;
}
