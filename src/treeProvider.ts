import * as vscode from 'vscode';
import { Pool, PoolClient } from 'pg';
import { IConnection } from './IConnection';
import { connectionManager } from './connectionManager';

export class ConnectionsTreeDataProvider implements vscode.TreeDataProvider<BaseTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BaseTreeItem | undefined | null | void> = new vscode.EventEmitter<BaseTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<BaseTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BaseTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: BaseTreeItem): Promise<BaseTreeItem[]> {
        if (!element) {
            // Root level: show connections
            const connections = vscode.workspace.getConfiguration('sql-runner').get<IConnection[]>('connections', []);
            const activeConnectionId = vscode.workspace.getConfiguration('sql-runner').get<string>('activeConnection');

            return connections.map(conn => new ConnectionTreeItem(conn, conn.id === activeConnectionId));
        }

        // Expand a connection item
        if (element instanceof ConnectionTreeItem) {
            const isConnected = connectionManager.getActiveConnections().has(element.connection.id);
            if (!isConnected) {
                return []; // Don't show schemas/tables if not connected
            }

            if (element.connection.dbType === 'postgresql') {
                return this.getPostgresSchemas(element.connection);
            }
            if (element.connection.dbType === 'mysql') {
                // For MySQL, we can list tables directly as it doesn't have a schema concept in the same way
                return this.getMysqlTables(element.connection);
            }
            // SQLite doesn't have schemas, list tables directly
            if (element.connection.dbType === 'sqlite') {
                return this.getSqliteTables(element.connection);
            }
        }

        // Expand a schema item
        if (element instanceof SchemaTreeItem) {
            if (element.connection.dbType === 'postgresql') {
                return this.getPostgresTables(element.connection, element.label as string);
            }
        }

        return [];
    }

    private async getPostgresSchemas(connection: IConnection): Promise<SchemaTreeItem[]> {
        const query = `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema') AND schema_name NOT LIKE 'pg_toast%';`;
        const client = connectionManager.getClient(connection.id);
        if (!client) return []; // Should not happen if isConnected is true
        let pgClient: PoolClient | Pool;
        if (client instanceof Pool) {
            pgClient = await client.connect(); // Get a temporary client from the pool
        } else {
            pgClient = client as PoolClient; // It's already a PoolClient if in transaction
        }
        try {
            const result = await (pgClient as any).query(query);
            return result.rows.map((row: { schema_name: string }) => new SchemaTreeItem(row.schema_name, connection));
        } finally {
            if (client instanceof Pool) { // Only release if we acquired it from the pool
                (pgClient as PoolClient).release();
            }
        }
    }

    private async getPostgresTables(connection: IConnection, schema: string): Promise<TableTreeItem[]> {
        const query = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' AND table_type = 'BASE TABLE';`;
        const client = connectionManager.getClient(connection.id);
        if (!client) return [];
        let pgClient: PoolClient | Pool;
        if (client instanceof Pool) {
            pgClient = await client.connect();
        } else {
            pgClient = client as PoolClient;
        }
        try {
            const result = await (pgClient as any).query(query);
            return result.rows.map((row: { table_name: string }) => new TableTreeItem(row.table_name, connection));
        } finally {
            if (client instanceof Pool) {
                (pgClient as PoolClient).release();
            }
        }
    }

    private async getMysqlTables(connection: IConnection): Promise<TableTreeItem[]> {
        const query = `SHOW TABLES;`;
        const client = connectionManager.getClient(connection.id);
        if (!client) return [];
        const [rows] = await (client as any).query(query);
        const key = `Tables_in_${connection.database}`;
        return (rows as any[]).map(row => new TableTreeItem(row[key], connection));
    }

    private async getSqliteTables(connection: IConnection): Promise<TableTreeItem[]> {
        const query = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`;
        const client = connectionManager.getClient(connection.id);
        if (!client) return [];
        return new Promise((resolve, reject) => {
            (client as any).all(query, (err: Error, rows: { name: string }[]) => {
                if (err) {
                    return reject(err);
                }
                resolve(rows.map(row => new TableTreeItem(row.name, connection)));
            });
        });
    }
}

export abstract class BaseTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

export class ConnectionTreeItem extends BaseTreeItem {
    constructor(
        public readonly connection: IConnection,
        private readonly isActive: boolean
    ) {
        const isConnected = connectionManager.getActiveConnections().has(connection.id);
        const collapsibleState = (isActive || isConnected) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;

        super(connection.name, collapsibleState);

        this.contextValue = 'connection';
        this.label = this.connection.name;

        const connectionState = connectionManager.getConnectionState(connection.id);

        if (isConnected) {
            this.iconPath = new vscode.ThemeIcon('zap', new vscode.ThemeColor('debugIcon.startForeground'));
            const uncommitted = connectionState?.uncommittedQueries || 0;
            const uncommittedText = uncommitted > 0 ? ` Transactional (${uncommitted})` : '';
            this.description = this.isActive ? `${connection.dbType} (active)${uncommittedText}` : `${connection.dbType} (connected)${uncommittedText}`;
        } else {
            this.iconPath = new vscode.ThemeIcon('zap', new vscode.ThemeColor('errorForeground'));
            this.description = `${connection.dbType} (disconnected)`;
        }
    }
}

export class SchemaTreeItem extends BaseTreeItem {
    constructor(
        public readonly label: string,
        public readonly connection: IConnection
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'schema';
        this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    }
}

export class TableTreeItem extends BaseTreeItem {
    constructor(
        public readonly label: string,
        public readonly connection: IConnection
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'table';
        this.iconPath = new vscode.ThemeIcon('symbol-structure');
    }
}