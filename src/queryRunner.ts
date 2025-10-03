
import * as vscode from 'vscode';
import { Pool } from 'pg';
import * as mysql from 'mysql2/promise';
import * as sqlite3 from 'sqlite3';
import { IConnection } from './IConnection';
import { connectionManager } from './connectionManager';
import { builtins as pg_types } from 'pg-types';

let lastQueryResult: { rows: any[], fields: any[] } | null = null;
export function getLastQueryResult() { return lastQueryResult; }

async function getDbClient(): Promise<any> {
    const config = vscode.workspace.getConfiguration('sql-runner');
    const activeConnectionId = config.get<string>('activeConnection');
    if (!activeConnectionId) {
        throw new Error('No active connection set. Please set one in the SQL Runner connection manager.');
    }

    const connections = config.get<IConnection[]>('connections', []);
    const activeConnection = connections.find(c => c.id === activeConnectionId);

    if (!activeConnection) {
        throw new Error(`Active connection with ID '${activeConnectionId}' not found.`);
    }

    const connectionState = connectionManager.getConnectionState(activeConnection.id);
    if (!connectionState) {
        const connectAction = 'Connect';
        const selection = await vscode.window.showErrorMessage(`Connection to '${activeConnection.name}' is not active.`, connectAction)
            .then(selection => {
                if (selection === connectAction) {
                    vscode.commands.executeCommand('sql-runner.connect', { connection: activeConnection });
                }
            });
        throw new Error(`Connection to '${activeConnection.name}' is not active.`);
    }
    return connectionState;
}

export async function runQuery(document: vscode.TextDocument, range: vscode.Range) {
    let query = document.getText(range);
    const config = vscode.workspace.getConfiguration('sql-runner');
    const defaultLimit = config.get<number>('defaultQueryLimit', 100);

    // Add a default limit to SELECT queries if one isn't present
    if (defaultLimit > 0 && query.trim().toLowerCase().startsWith('select') && !/limit\s+\d+/i.test(query)) {
        const trimmedQuery = query.trim();
        if (trimmedQuery.endsWith(';')) {
            query = trimmedQuery.slice(0, -1) + ` LIMIT ${defaultLimit};`;
        } else {
            query = trimmedQuery + ` LIMIT ${defaultLimit}`;
        }
    }

    await executeAndShowResults(query, range);
}

export async function runSelectedQuery() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }
    const selection = editor.selection;
    const query = editor.document.getText(selection);
    if (!query.trim()) {
        vscode.window.showErrorMessage('No query selected');
        return;
    }
    await executeAndShowResults(query, selection);
}

async function executeAndShowResults(query: string, range: vscode.Range) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Running SQL Query...",
        cancellable: false
    }, async (progress) => {
        let client: any;
        let connectionState: any;
        try {
            connectionState = await getDbClient();
            let result;
            const config = vscode.workspace.getConfiguration('sql-runner');
            const activeConnectionId = config.get<string>('activeConnection');
            const connections = config.get<IConnection[]>('connections', []);
            const activeConnection = connections.find((c: IConnection) => c.id === activeConnectionId);

            if (!activeConnection) {
                throw new Error("No active connection found.");
            }

            const dbType = activeConnection.dbType;

            const autoCommit = config.get<'auto' | 'off' | 'smart'>('autoCommit', 'auto');
            const isSelect = query.trim().toLowerCase().startsWith('select');

            if (autoCommit === 'off' && !connectionState.inTransaction) {
                await connectionManager.beginTransaction(activeConnection.id);
                connectionState = connectionManager.getConnectionState(activeConnection.id)!; // Re-fetch state after beginning transaction
            } else if (autoCommit === 'smart' && !isSelect && !connectionState.inTransaction) {
                await connectionManager.beginTransaction(activeConnection.id);
                connectionState = connectionManager.getConnectionState(activeConnection.id)!; // Re-fetch state after beginning transaction
            }
            client = connectionManager.getClient(activeConnection.id)!; // Get the correct client (transactional or main)

            if (dbType === 'postgresql') {
                if (connectionState.inTransaction) {
                    result = await client.query(query); // client is a dedicated client
                } else {
                    // For pg, client is a Pool. Get a client from the pool for a single query.
                    const poolClient = await client.connect();
                    try {
                        result = await poolClient.query(query);
                    } finally {
                        poolClient.release();
                    }
                }
            } else if (dbType === 'mysql') {
                result = await (client as mysql.Connection).query(query);
            } else {
                // sqlite
                result = await new Promise<any[]>((resolve, reject) => {
                    client.all(query, (err: any, rows: any) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });
            }

            if (connectionState.inTransaction) {
                connectionState.uncommittedQueries++;
            }

            // This is a bit of a hack to force the tree view to re-render with the new uncommitted count
            vscode.commands.executeCommand('sql-runner.setActiveConnection', activeConnection.id, activeConnection.name);

            // Display results in output channel
            const output = vscode.window.createOutputChannel('SQL Runner Results');
            output.clear();
            output.show();

            let rows: any[], fields: any[];
            if (dbType === 'sqlite') {
                rows = result;
                // For sqlite, we can only get column names if there are rows.
                fields = rows.length > 0 ? Object.keys(rows[0]).map(name => ({ name })) : [];
            } else if (dbType === 'mysql') {
                // mysql2 returns an array of [rows, fields]
                if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
                    rows = result[0];
                    fields = result[1];
                } else {
                    // Handle DML statements like INSERT, UPDATE, DELETE
                    const affectedRows = result.affectedRows;
                    const message = `Query OK, ${affectedRows} row${affectedRows !== 1 ? 's' : ''} affected.`;
                    output.appendLine(message);
                    vscode.window.showInformationMessage(message);
                    return;
                }
            } else {
                // For postgres, check if the result is an array of results (from multi-statement queries)
                const lastResult = Array.isArray(result) ? result[result.length - 1] : result;

                if (lastResult.command === 'SELECT') {
                    rows = lastResult.rows || [];
                    fields = lastResult.fields || [];
                } else {
                    // Handle DML statements
                    const rowCount = lastResult.rowCount || 0;
                    const message = `${lastResult.command} ${rowCount}`;
                    output.appendLine(message);
                    vscode.window.showInformationMessage(message);
                    return;
                }
            }

            lastQueryResult = { rows, fields };

            if (fields.length === 0) {
                output.appendLine('Query executed successfully, but no columns were returned.');
                vscode.window.showInformationMessage('Query executed successfully.');
            } else {
                // Map mysql field types (numeric) to string representations for readability
                const mysqlTypeMap: { [key: number]: string } = {
                    0: 'DECIMAL', 1: 'TINY', 2: 'SHORT', 3: 'LONG', 4: 'FLOAT', 5: 'DOUBLE',
                    7: 'TIMESTAMP', 8: 'LONGLONG', 9: 'INT24', 10: 'DATE', 11: 'TIME',
                    12: 'DATETIME', 13: 'YEAR', 15: 'VARCHAR', 16: 'BIT', 245: 'JSON',
                    246: 'NEWDECIMAL', 247: 'ENUM', 248: 'SET', 249: 'TINY_BLOB',
                    250: 'MEDIUM_BLOB', 251: 'LONG_BLOB', 252: 'BLOB', 253: 'VAR_STRING',
                    254: 'STRING', 255: 'GEOMETRY'
                };
                
                const pgTypeMap: { [key: number]: string } = {};
                // Create a reverse mapping from OID to type name
                for (const typeName of Object.keys(pg_types) as Array<keyof typeof pg_types>) {
                    const oid = pg_types[typeName];
                    pgTypeMap[oid] = typeName;
                }

                const headers = fields.map(field => {
                    let typeName = '';
                    if (dbType === 'mysql' && field.type) {
                        typeName = mysqlTypeMap[field.type] || `UNKNOWN(${field.type})`;
                    } else if (dbType === 'postgresql' && field.dataTypeID) {
                        // For postgres, you could map OIDs to names, but for now we'll just show the OID
                        typeName = pgTypeMap[field.dataTypeID] || `OID(${field.dataTypeID})`;
                    } 
                    return typeName ? `${field.name}\n(${typeName})` : field.name;
                });

                const columnNames = fields.map(field => field.name);
                const data = [headers, ...rows.map(row => columnNames.map(col => row[col] !== null && row[col] !== undefined ? row[col] : 'NULL'))];
                // @ts-ignore
                const { table } = require('table');
                output.appendLine(table(data));
                output.appendLine(`(${rows.length} row${rows.length !== 1 ? 's' : ''})`);

                const message = `Query returned ${rows.length} row${rows.length !== 1 ? 's' : ''}.`;
                vscode.window.showInformationMessage(message, 'Export as CSV', 'Export as JSON').then(selection => {
                    if (selection === 'Export as CSV') {
                        vscode.commands.executeCommand('sql-runner.exportAsCsv');
                    } else if (selection === 'Export as JSON') {
                        vscode.commands.executeCommand('sql-runner.exportAsJson');
                    }
                });
            }
        } catch (error: any) {
            const activeConnectionId = vscode.workspace.getConfiguration('sql-runner').get<string>('activeConnection');
            if (connectionState && connectionState.inTransaction && activeConnectionId) {
                await connectionManager.rollbackTransaction(activeConnectionId);
                vscode.window.showErrorMessage(`Query failed and transaction was rolled back: ${error.message}`);
            } else {
                vscode.window.showErrorMessage(`Query failed: ${error.message}`);
            }
        } finally {
            // Connections are now managed by the ConnectionManager, so we don't close them here.
            // They will be closed on deactivation or when a connection is deleted.
        }
    });
}
