import * as vscode from 'vscode';
import { Client, Pool, PoolClient } from 'pg';
import * as mysql from 'mysql2/promise';
import * as sqlite3 from 'sqlite3';
import { IConnection } from './IConnection';
import { EventEmitter } from 'events';

type DbClient = {
    mainClient: Pool | mysql.Connection | sqlite3.Database; // The primary client (pool for pg, direct connection for others)
    transactionClient?: PoolClient; // Dedicated client for pg transactions
    uncommittedQueries: number;
    dbType: 'postgresql' | 'mysql' | 'sqlite';
    inTransaction: boolean;
};

class ConnectionManager {
    private static instance: ConnectionManager;

    private constructor() { }

    public static getInstance(): ConnectionManager {
        if (!ConnectionManager.instance) {
            ConnectionManager.instance = new ConnectionManager();
        }
        return ConnectionManager.instance;
    }

    private activeConnections: Map<string, DbClient> = new Map();

    public getClient(connectionId: string): Pool | PoolClient | mysql.Connection | sqlite3.Database | undefined {
        const connectionState = this.activeConnections.get(connectionId);
        if (!connectionState) {
            return undefined;
        }
        return connectionState.transactionClient || connectionState.mainClient;
    }

    public getConnectionState(connectionId: string): DbClient | undefined {
        return this.activeConnections.get(connectionId);
    }

    public async connect(connection: IConnection): Promise<DbClient> {
        if (this.activeConnections.has(connection.id)) {
            return this.activeConnections.get(connection.id)!;
        }
        try {
            const connectionState: DbClient = {
                mainClient: null as any, // Will be assigned below
                uncommittedQueries: 0,
                dbType: connection.dbType,
                inTransaction: false,
            };

            switch (connection.dbType) {
                case 'postgresql':
                    const pgPool = new Pool({
                        host: connection.host,
                        port: connection.port,
                        user: connection.user,
                        password: connection.password,
                        database: connection.database,
                    });
                    await pgPool.query('SELECT 1'); // Test the connection
                    connectionState.mainClient = pgPool; break;
                case 'mysql':
                    const mysqlConnection = await mysql.createConnection({
                        host: connection.host,
                        port: connection.port,
                        user: connection.user,
                        password: connection.password,
                        database: connection.database,
                    });
                    // For mysql2, the connection is established here. We'll reuse this connection object.
                    connectionState.mainClient = mysqlConnection; break;
                case 'sqlite':
                    const client = await new Promise<sqlite3.Database>((resolve, reject) => {
                        const db = new sqlite3.Database(connection.database, (err) => {
                            if (err) {
                                return reject(err);
                            }
                            resolve(db);
                        });
                    });
                    connectionState.mainClient = client; break;
                default:
                    throw new Error(`Unsupported database type: ${connection.dbType}`);
            }
            this.activeConnections.set(connection.id, connectionState);
            return connectionState;

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to connect to ${connection.name}: ${error.message}`);
            throw error;
        }
    }

    public async disconnect(connectionId: string): Promise<void> {
        const connectionState = this.activeConnections.get(connectionId);
        if (connectionState) {
            // If there's an active transaction client, release it first
            if (connectionState.transactionClient) {
                (connectionState.transactionClient as PoolClient).release();
                connectionState.transactionClient = undefined;
            }
            // Then end the main client (pool or direct connection)
            if (connectionState.mainClient instanceof Pool) {
                await (connectionState.mainClient as Pool).end(); // pg pool
            } else if ('end' in connectionState.mainClient && typeof connectionState.mainClient.end === 'function') {
                await (connectionState.mainClient as mysql.Connection).end(); // mysql
            } else if ('close' in connectionState.mainClient && typeof (connectionState.mainClient as any).close === 'function') {
                (connectionState.mainClient as sqlite3.Database).close(); // sqlite
            }
            this.activeConnections.delete(connectionId);
        }
    }

    public disconnectAll(): void {
        this.activeConnections.forEach(async (client, id) => {
            await this.disconnect(id);
        });
    }

    public async beginTransaction(connectionId: string) {
        const connectionState = this.getConnectionState(connectionId);
        if (connectionState && !connectionState.inTransaction) {
            if (connectionState.dbType === 'postgresql') {
                const pool = connectionState.mainClient as Pool;
                const client = await pool.connect();
                await client.query('BEGIN');
                connectionState.transactionClient = client; // Store the dedicated client
            } else if (connectionState.dbType === 'mysql') {
                await (connectionState.mainClient as mysql.Connection).beginTransaction();
            } else if (connectionState.dbType === 'sqlite') {
                await new Promise<void>((resolve, reject) => {
                    (connectionState.mainClient as sqlite3.Database).run('BEGIN TRANSACTION', (err) => {
                        if (err) reject(err); else resolve();
                    });
                });
            }
            connectionState.inTransaction = true;
            connectionState.uncommittedQueries = 0;
            }
    }
    public async commitTransaction(connectionId: string) {
        const connectionState = this.getConnectionState(connectionId);
        if (connectionState && connectionState.inTransaction) {
            if (connectionState.dbType === 'postgresql') {
                const client = connectionState.transactionClient as PoolClient;
                await client.query('COMMIT');
                client.release(); // Release client back to the pool
                connectionState.transactionClient = undefined; // Clear reference to the dedicated client
            } else if (connectionState.dbType === 'mysql') {
                await (connectionState.mainClient as mysql.Connection).commit();
            } else if (connectionState.dbType === 'sqlite') {
                await new Promise<void>((resolve, reject) => {
                    (connectionState.mainClient as sqlite3.Database).run('COMMIT', (err) => {
                        if (err) reject(err); else resolve();
                    });
                });
            }
            connectionState.inTransaction = false;
            connectionState.uncommittedQueries = 0;
        }
    }

    public async rollbackTransaction(connectionId: string) {
        const connectionState = this.getConnectionState(connectionId);
        if (connectionState && connectionState.inTransaction) {
            if (connectionState.dbType === 'postgresql') {
                const client = connectionState.transactionClient as PoolClient;
                await client.query('ROLLBACK');
                client.release();
                connectionState.transactionClient = undefined; // Clear reference to the dedicated client
            } else if (connectionState.dbType === 'mysql') {
                await (connectionState.mainClient as mysql.Connection).rollback();
            } else if (connectionState.dbType === 'sqlite') {
                await new Promise<void>((resolve, reject) => {
                    (connectionState.mainClient as sqlite3.Database).run('ROLLBACK', (err) => {
                        if (err) reject(err); else resolve();
                    });
                });
            }
            connectionState.inTransaction = false;
            connectionState.uncommittedQueries = 0;
        }
    }

    public getActiveConnections(): Map<string, DbClient> {
        return this.activeConnections;
    }
}

export const connectionManager = ConnectionManager.getInstance();

export function buildPostgresConnectionString(connection: IConnection): string {
    const user = encodeURIComponent(connection.user || '');
    const password = encodeURIComponent(connection.password || '');
    const host = connection.host;
    const port = connection.port;
    const database = connection.database;
    return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}