/**
 * Sync Queue Module
 * Handles background synchronization with retry logic
 */

import { events, EVENT } from './events'
import type { APIClient } from '../services/api'

export interface SyncOperation {
  id?: number
  type: 'save-note' | 'delete-note' | 'create-context'
  data: any
}

export interface SyncStats {
  queueSize: number
  processing: boolean
  failedOperations: number
  retryDelay: number
}

export class SyncQueue {
  private api: APIClient
  private queue: SyncOperation[] = []
  private processing = false
  private retryDelay = 2000
  private readonly maxRetryDelay = 30000
  private batchTimer: NodeJS.Timeout | null = null
  private readonly batchDelay = 15000 // 15 seconds
  private failedOperations = new Map<string, number>()
  private readonly maxRetries = 3

  constructor(api: APIClient) {
    this.api = api
  }

  add(operation: SyncOperation): void {
    console.log('[Sync] Adding operation to queue:', operation.type, operation.data)

    // Check if we already have a pending operation for this note
    if (operation.type === 'save-note') {
      const existingIndex = this.queue.findIndex(
        op =>
          op.type === 'save-note' &&
          op.data.context === operation.data.context &&
          op.data.date === operation.data.date
      )

      if (existingIndex !== -1) {
        // Update existing operation instead of adding new one
        this.queue[existingIndex] = { ...operation, id: Date.now() + Math.random() }
        console.log('[Sync] Updated existing save operation in queue')
      } else {
        this.queue.push({ ...operation, id: Date.now() + Math.random() })
        console.log('[Sync] Added new save operation to queue')
      }
    } else if (operation.type === 'delete-note') {
      // Remove any pending save operations for this note
      const beforeLength = this.queue.length
      this.queue = this.queue.filter(
        op =>
          !(
            op.type === 'save-note' &&
            op.data.context === operation.data.context &&
            op.data.date === operation.data.date
          )
      )
      const removedCount = beforeLength - this.queue.length
      if (removedCount > 0) {
        console.log(`[Sync] Removed ${removedCount} pending save operations for this note`)
      }
      // Add the delete operation
      this.queue.push({ ...operation, id: Date.now() + Math.random() })
      console.log('[Sync] Added delete operation to queue')

      // Process delete operations immediately (no batching delay)
      console.log('[Sync] Delete operation detected, processing immediately')
      this.processImmediate()
      return
    } else {
      this.queue.push({ ...operation, id: Date.now() + Math.random() })
      console.log('[Sync] Added operation to queue')
    }

    console.log('[Sync] Queue size:', this.queue.length)
    this.updateUI()
    this.scheduleBatch()
  }

  private scheduleBatch(): void {
    // Clear existing timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
    }

    // Schedule batch processing after delay
    console.log(`[Sync] Scheduling batch processing in ${this.batchDelay}ms`)
    this.batchTimer = setTimeout(() => {
      console.log('[Sync] Batch timer triggered, starting process')
      this.process()
    }, this.batchDelay)
  }

  processImmediate(): void {
    // Clear any pending batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    // Process immediately without delay
    console.log('[Sync] Processing queue immediately')
    this.updateUI()
    this.process()
  }

  private updateUI(): void {
    const pending = this.queue.length
    events.emit(EVENT.SYNC_STATUS, {
      pending,
      syncing: this.processing
    })
  }

  async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) return

    this.processing = true
    this.batchTimer = null
    this.updateUI()

    while (this.queue.length > 0) {
      const op = this.queue[0]
      if (!op) break // Guard against undefined

      const opKey = this.getOperationKey(op)

      try {
        await this.executeOperation(op)

        // Success - remove from queue and failed operations
        this.queue.shift()
        this.failedOperations.delete(opKey)

        events.emit(EVENT.OPERATION_SYNCED, { operationId: String(op.id || opKey) })
        console.log('[Sync] Successfully synced:', op.type, opKey)
        this.updateUI()

        // Reset retry delay on success
        this.retryDelay = 2000
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        console.warn('[Sync] Failed to sync operation:', error)

        // Check if this is a session expired error
        if (error.message.includes('Session expired')) {
          console.log('[Sync] Session expired, keeping operations in queue for later')
          // Don't remove from queue, will retry after re-login
          break
        }

        // Track retry count
        const retryCount = (this.failedOperations.get(opKey) || 0) + 1
        this.failedOperations.set(opKey, retryCount)

        if (retryCount >= this.maxRetries) {
          // Max retries reached - remove from queue
          console.error(`[Sync] Max retries (${this.maxRetries}) reached for operation:`, opKey)
          this.queue.shift()
          this.failedOperations.delete(opKey)

          events.emit(EVENT.SYNC_ERROR, {
            message: error.message,
            maxRetriesReached: true
          } as any)
        } else {
          // Retry with exponential backoff
          console.log(`[Sync] Retry ${retryCount}/${this.maxRetries} for operation:`, opKey)
          events.emit(EVENT.SYNC_ERROR, {
            message: error.message,
            retryCount,
            maxRetries: this.maxRetries
          } as any)

          await new Promise(resolve => setTimeout(resolve, this.retryDelay))
          this.retryDelay = Math.min(this.retryDelay * 1.5, this.maxRetryDelay)
        }
      }
    }

    this.processing = false
    this.retryDelay = 2000
    this.updateUI()
  }

  private getOperationKey(op: SyncOperation): string {
    if (op.type === 'save-note' || op.type === 'delete-note') {
      return `${op.type}-${op.data.context}-${op.data.date}`
    }
    return `${op.type}-${op.id}`
  }

  private async executeOperation(op: SyncOperation): Promise<any> {
    console.log('[Sync] Executing operation:', op.type, op.data)

    switch (op.type) {
      case 'save-note':
        console.log('[Sync] Calling API saveNote')
        return await this.api.saveNote(op.data)

      case 'delete-note':
        console.log(
          '[Sync] Calling API deleteNote with context:',
          op.data.context,
          'date:',
          op.data.date
        )
        const result = await this.api.deleteNote(op.data.context, op.data.date)
        console.log('[Sync] API deleteNote result:', result)
        return result

      case 'create-context':
        console.log('[Sync] Calling API createContext')
        return await this.api.createContext(op.data)

      default:
        throw new Error('Unknown operation type')
    }
  }

  getPendingCount(): number {
    return this.queue.length
  }

  clear(): void {
    this.queue = []
    this.failedOperations.clear()
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    this.updateUI()
  }

  // Get statistics for debugging
  getStats(): SyncStats {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      failedOperations: this.failedOperations.size,
      retryDelay: this.retryDelay
    }
  }
}
