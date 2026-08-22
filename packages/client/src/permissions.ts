import type { SynqedClient } from './client.js'
import type {
  PermissionAnswerSheet,
  PermissionAssignment,
  PermissionRulebook,
  SetPermissionAssignmentInput,
} from './types.js'

/** The ONE core-owned permission system: rulebook + assignments + the
 *  answer sheet (rights + visible stores + version). Screens cache by
 *  `version` and re-ask when it changes. */
export class PermissionClient {
  constructor(private client: SynqedClient) {}

  /** One source for both apps' toggle UIs. */
  async rulebook(): Promise<PermissionRulebook> {
    return this.client.fetch<PermissionRulebook>('/permissions/rulebook')
  }

  /** Rights + visible stores + version for one person, server-computed and
   *  server-filtered. staff card id or login uuid. */
  async answerSheet(staffId: string): Promise<PermissionAnswerSheet> {
    return this.client.fetch<PermissionAnswerSheet>(
      `/permissions/answer-sheet?staff_id=${encodeURIComponent(staffId)}`,
    )
  }

  /** Roster admin read — explicit and coarse-derived assignments. */
  async listAssignments(): Promise<{ assignments: PermissionAssignment[]; version: string }> {
    return this.client.fetch('/permissions/staff')
  }

  /** HQ-gated write; the business's permission version bumps transactionally. */
  async setAssignment(
    staffId: string,
    input: SetPermissionAssignmentInput,
  ): Promise<PermissionAssignment> {
    return this.client.fetch<PermissionAssignment>(
      `/permissions/staff/${encodeURIComponent(staffId)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    )
  }
}
