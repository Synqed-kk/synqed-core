import type { SynqedClient } from './client.js'
import type { RecordingJob, EnqueueRecordingJobInput } from './types.js'

/** Server-side recording→karute pipeline jobs. Enqueue/status are tenant-
 *  scoped; claim/complete/fail are worker verbs (trusted server key). */
export class RecordingJobClient {
  constructor(private client: SynqedClient) {}

  /** Idempotent: one job per recording session; re-enqueue returns the same
   *  job (a FAILED-out job is re-armed — UI "retry" is just enqueue). */
  async enqueue(input: EnqueueRecordingJobInput): Promise<RecordingJob> {
    return this.client.fetch<RecordingJob>('/recording-jobs', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  /** Tenant status poll (the client's progress screen). */
  async getByRecordingSession(recordingSessionId: string): Promise<RecordingJob> {
    return this.client.fetch<RecordingJob>(
      `/recording-jobs/by-recording/${encodeURIComponent(recordingSessionId)}`,
    )
  }

  /** WORKER: atomically claim the next runnable job; null when the queue is dry. */
  async claim(): Promise<RecordingJob | null> {
    const res = await this.client.fetchRaw('/recording-jobs/claim', { method: 'POST' })
    if (res.status === 204) return null
    return (await res.json()) as RecordingJob
  }

  /** WORKER: job finished — the karute record exists. */
  async complete(id: string, karuteRecordId: string): Promise<RecordingJob> {
    return this.client.fetch<RecordingJob>(`/recording-jobs/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ karute_record_id: karuteRecordId }),
    })
  }

  /** WORKER: run failed — requeues while attempts remain, else FAILED. */
  async fail(id: string, error: string): Promise<RecordingJob> {
    return this.client.fetch<RecordingJob>(`/recording-jobs/${id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ error }),
    })
  }
}
