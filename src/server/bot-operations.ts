import { createHash } from 'node:crypto';
import { conflict, forbidden, nowMs } from '../shared/mattermost.js';
import type { AuditOutboxRecord, BotOperationReceipt, StoreState } from './domain.js';

export function botOperationDigest(action: string, input: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([action, ...input])).digest('hex');
}
export function assertNewBotOperation(state: StoreState, operationId: string | undefined, actorId: string, action: string, digest: string): void {
  if (!operationId) return;
  if (!/^[a-z0-9]{26}$/u.test(operationId)) throw conflict('A 26-character operation ID is required');
  const prior = state.botOperationReceipts.find(item => item.operationId === operationId);
  if (prior) {
    if (prior.actorUserId !== actorId) throw forbidden('Bot operation belongs to another administrator');
    if (prior.action !== action || prior.inputSHA256 !== digest) throw conflict('Bot operation is bound to different inputs');
    throw conflict('Bot operation is already committed; reconcile its receipt without repeating the credential mutation');
  }
  // Never prune credential-mutation tombstones or reuse old operation IDs.
  if (state.botOperationReceipts.length >= 10000) throw conflict('Bot operation receipt capacity requires reviewed maintenance');
  if (state.auditOutbox.some(item => item.operationId === operationId)) throw conflict('Operation ID already exists');
}
export function recordBotOperation(state: StoreState, operationId: string | undefined, actorId: string, action: string, digest: string, targetId: string): void {
  if (!operationId) return;
  state.botOperationReceipts.push({ operationId, actorUserId: actorId, action, inputSHA256: digest, targetId, createAt: nowMs() });
}
export function durableBotOperation(receipt: BotOperationReceipt): AuditOutboxRecord {
  return { operationId: receipt.operationId, actorUserId: receipt.actorUserId, action: receipt.action, targetId: receipt.targetId, createAt: receipt.createAt, publishedAt: 0, ip: null, metadata: {} };
}
