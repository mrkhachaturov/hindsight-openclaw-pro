import type { HindsightClient } from '../client.js';
import type { BankPlan } from './plan.js';

export interface ApplyResult {
  bankId: string;
  agentId: string;
  configUpdated: boolean;
  directivesCreated: number;
  directivesUpdated: number;
  directivesDeleted: number;
  errors: string[];
}

export async function applyBank(
  plan: BankPlan,
  client: HindsightClient,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    bankId: plan.bankId,
    agentId: plan.agentId,
    configUpdated: false,
    directivesCreated: 0,
    directivesUpdated: 0,
    directivesDeleted: 0,
    errors: [],
  };

  if (!plan.hasChanges) return result;

  // 1. Apply config changes (single PATCH with all changed fields)
  if (plan.configChanges.length > 0) {
    const updates: Record<string, unknown> = {};
    for (const change of plan.configChanges) {
      if (change.action === 'add' || change.action === 'change') {
        updates[change.field] = change.newValue;
      }
      // 'remove' — we don't remove config fields via PATCH (would need reset + re-apply)
      // For v1, removing a field from the file doesn't remove it from server
    }
    if (Object.keys(updates).length > 0) {
      try {
        await client.updateBankConfig(plan.bankId, updates);
        result.configUpdated = true;
      } catch (err) {
        result.errors.push(`Config update failed: ${err}`);
      }
    }
  }

  // 2. Apply directive changes (one operation per directive)
  for (const change of plan.directiveChanges) {
    try {
      switch (change.action) {
        case 'create':
          await client.createDirective(plan.bankId, { name: change.name, content: change.content! });
          result.directivesCreated++;
          break;
        case 'update':
          await client.updateDirective(plan.bankId, change.serverId!, { content: change.content! });
          result.directivesUpdated++;
          break;
        case 'delete':
          await client.deleteDirective(plan.bankId, change.serverId!);
          result.directivesDeleted++;
          break;
      }
    } catch (err) {
      result.errors.push(`Directive ${change.action} '${change.name}' failed: ${err}`);
    }
  }

  return result;
}
