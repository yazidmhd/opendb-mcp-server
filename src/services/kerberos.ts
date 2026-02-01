/**
 * Kerberos authentication service for Hive/Impala
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { KerberosError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

export interface KerberosConfig {
  keytab: string;
  principal: string;
}

/**
 * Manages Kerberos authentication using keytab files
 */
export class KerberosAuth {
  private initialized = false;
  private ticketExpiry: Date | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: KerberosConfig) {}

  /**
   * Initialize Kerberos authentication using keytab
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const keytabPath = path.resolve(this.config.keytab);

    // Validate keytab file exists
    if (!fs.existsSync(keytabPath)) {
      throw new KerberosError(`Keytab file not found: ${keytabPath}`);
    }

    // Check file permissions
    const stats = fs.statSync(keytabPath);
    const mode = stats.mode & 0o777;
    if (mode & 0o004) {
      logger.warn(`Keytab file ${keytabPath} is world-readable. This is a security risk.`);
    }

    try {
      await this.kinit(keytabPath, this.config.principal);
      this.initialized = true;
      this.scheduleRefresh();
      logger.info(`Kerberos authentication initialized for ${this.config.principal}`);
    } catch (error) {
      throw new KerberosError(
        `Failed to initialize Kerberos: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Destroy Kerberos credentials
   */
  async destroy(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    try {
      await this.kdestroy();
      this.initialized = false;
      this.ticketExpiry = null;
      logger.info('Kerberos credentials destroyed');
    } catch (error) {
      logger.warn('Failed to destroy Kerberos credentials', error);
    }
  }

  /**
   * Check if authentication is initialized and valid
   */
  isValid(): boolean {
    if (!this.initialized) return false;
    if (!this.ticketExpiry) return true;
    return new Date() < this.ticketExpiry;
  }

  /**
   * Refresh Kerberos ticket if needed
   */
  async refresh(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
      return;
    }

    const keytabPath = path.resolve(this.config.keytab);
    await this.kinit(keytabPath, this.config.principal);
    this.scheduleRefresh();
  }

  /**
   * Run kinit to obtain Kerberos ticket
   */
  private kinit(keytabPath: string, principal: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const kinit = spawn('kinit', ['-kt', keytabPath, principal], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      kinit.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      kinit.on('close', (code) => {
        if (code === 0) {
          // Get ticket expiry time
          this.getTicketExpiry()
            .then((expiry) => {
              this.ticketExpiry = expiry;
              resolve();
            })
            .catch(() => resolve());
        } else {
          reject(new Error(`kinit failed with code ${code}: ${stderr}`));
        }
      });

      kinit.on('error', (error) => {
        reject(new Error(`Failed to run kinit: ${error.message}`));
      });
    });
  }

  /**
   * Run kdestroy to destroy Kerberos credentials
   */
  private kdestroy(): Promise<void> {
    return new Promise((resolve, reject) => {
      const kdestroy = spawn('kdestroy', [], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      kdestroy.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`kdestroy failed with code ${code}`));
        }
      });

      kdestroy.on('error', (error) => {
        reject(new Error(`Failed to run kdestroy: ${error.message}`));
      });
    });
  }

  /**
   * Get ticket expiry time from klist
   */
  private getTicketExpiry(): Promise<Date> {
    return new Promise((resolve, reject) => {
      const klist = spawn('klist', ['-c'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';

      klist.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      klist.on('close', (code) => {
        if (code === 0) {
          // Parse klist output to find expiry
          const expiryMatch = stdout.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/);
          if (expiryMatch) {
            const expiry = new Date(expiryMatch[1]);
            resolve(expiry);
          } else {
            // Default to 8 hours from now
            resolve(new Date(Date.now() + 8 * 60 * 60 * 1000));
          }
        } else {
          reject(new Error('Failed to get ticket expiry'));
        }
      });

      klist.on('error', () => {
        reject(new Error('Failed to run klist'));
      });
    });
  }

  /**
   * Schedule ticket refresh before expiry
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Refresh 10 minutes before expiry, or in 4 hours if no expiry known
    const refreshIn = this.ticketExpiry
      ? Math.max(0, this.ticketExpiry.getTime() - Date.now() - 10 * 60 * 1000)
      : 4 * 60 * 60 * 1000;

    this.refreshTimer = setTimeout(() => {
      this.refresh().catch((error) => {
        logger.error('Failed to refresh Kerberos ticket', error);
      });
    }, refreshIn);
  }
}
