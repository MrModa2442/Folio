import 'dotenv/config';
import readline from 'readline';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

async function generateSession() {
  console.log('=== Folio Telegram MTProto StringSession Generator ===\n');
  const apiIdInput = process.env.TELEGRAM_API_ID || (await ask('Enter your TELEGRAM_API_ID (from my.telegram.org): '));
  const apiHash = process.env.TELEGRAM_API_HASH || (await ask('Enter your TELEGRAM_API_HASH (from my.telegram.org): '));

  const apiId = Number.parseInt(apiIdInput, 10);
  if (!apiId || !apiHash) {
    console.error('Invalid API_ID or API_HASH.');
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await ask('Enter your phone number (with country code, e.g. +1234567890): '),
    password: async () => await ask('Enter your 2FA password (if enabled, otherwise press Enter): '),
    phoneCode: async () => await ask('Enter the verification code sent to your Telegram app: '),
    onError: err => console.error('Telegram auth error:', err),
  });

  const sessionString = client.session.save() as unknown as string;
  console.log('\n✅ Successfully authenticated with Telegram!');
  console.log('\nCopy the value below into your TELEGRAM_SESSION environment variable:\n');
  console.log(sessionString);
  console.log('\n======================================================');
  rl.close();
  process.exit(0);
}

generateSession();
