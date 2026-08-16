import * as wati from './services/wati';
import { answerFarmerQuestion } from './services/farmer-qa';
import { classifyIntent } from './services/farmer-intent';
import { wasRecentlySentTo } from './outboundTracker';
import * as farmerSession from './farmer-session';

/**
 * Handles messages from numbers NOT in the agronomist whitelist — i.e.
 * farmers. Unlike the agronomist flow (bug/admin reports with a fixed menu),
 * this treats real questions as auto-answerable from the farmer knowledge
 * base (see services/farmer-knowledge.ts + services/farmer-qa.ts).
 */
export async function handleFarmerMessage(
  phoneNumber: string,
  senderName: string,
  cleanText: string,
  messageType: string,
  mediaUrl: string | null
): Promise<void> {
  if (!cleanText) {
    console.log(`[FarmerFlow] Ignoring media-only message from ${phoneNumber} (no text to answer)`);
    return;
  }

  const intent = classifyIntent(cleanText);
  if (!intent.isQuestion) {
    console.log(`[FarmerFlow] Ignoring non-question from ${phoneNumber} (looks like an acknowledgement): "${cleanText}"`);
    return;
  }
  if (!intent.confident && wasRecentlySentTo(phoneNumber)) {
    console.log(`[FarmerFlow] Ignoring ambiguous message from ${phoneNumber} shortly after we messaged them: "${cleanText}"`);
    return;
  }

  const history = farmerSession.getHistory(phoneNumber);
  farmerSession.appendTurn(phoneNumber, 'user', cleanText);

  const answer = await answerFarmerQuestion(phoneNumber, senderName, cleanText, history);
  farmerSession.appendTurn(phoneNumber, 'assistant', answer);

  await wati.sendMessage(phoneNumber, answer);
}
