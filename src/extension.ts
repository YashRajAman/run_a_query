import * as vscode from 'vscode';
import { SqlCodeLensProvider } from './codeLensProvider';
import { runQuery, runSelectedQuery } from './queryRunner';
import { Client } from 'pg';
import * as mysql from 'mysql2/promise';
import * as sqlite3 from 'sqlite3';
import { IConnection } from './IConnection';
import { v4 as uuidv4 } from 'uuid';
import { connectionManager } from './connectionManager';
import { ConnectionTreeItem, ConnectionsTreeDataProvider } from './treeProvider';
import { exportLastResult } from './export';

async function testConnection(connection: IConnection) {
    try {
        if (connection.dbType === 'postgresql') {
            const client = new Client({
                host: connection.host,
                port: connection.port,
                user: connection.user,
                password: connection.password,
                database: connection.database,
            });
            await client.connect();
            await client.end();
        } else if (connection.dbType === 'mysql') {
            const mysqlConnection = await mysql.createConnection({
                host: connection.host,
                port: connection.port,
                user: connection.user,
                password: connection.password,
                database: connection.database,
            });
            await mysqlConnection.end();
        } else {
            // sqlite
            await new Promise<void>((resolve, reject) => {
                const db = new sqlite3.Database(connection.database, (err) => {
                    if (err) {
                        return reject(err);
                    }
                    db.close((closeErr) => {
                        if (closeErr) return reject(closeErr);
                        resolve();
                    });
                });
            });
        }
        vscode.window.showInformationMessage('Connection test successful.');
    } catch (error: any) {
        vscode.window.showErrorMessage(`Connection test failed: ${error.message}`);
    }
}

class ConnectionManagerPanel {
    public static currentPanel: ConnectionManagerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (ConnectionManagerPanel.currentPanel) {
            ConnectionManagerPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'connectionManager',
            'SQL Runner Connections',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        ConnectionManagerPanel.currentPanel = new ConnectionManagerPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'saveConnections':
                        const connections = message.connections.map((c: IConnection) => {
                            if (!c.id) {
                                c.id = uuidv4();
                            }
                            return c;
                        });
                        vscode.workspace.getConfiguration('sql-runner').update('connections', connections, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('Connection settings saved.');
                        this._update();
                        connectionsTreeProvider.refresh();
                        return;
                    case 'testConnection':
                        testConnection(message.connection);
                        return;
                    case 'deleteConnection':
                        const currentConnections = vscode.workspace.getConfiguration('sql-runner').get<IConnection[]>('connections', []);
                        const updatedConnections = currentConnections.filter(c => c.id !== message.id);
                        vscode.workspace.getConfiguration('sql-runner').update('connections', updatedConnections, vscode.ConfigurationTarget.Global);
                        connectionManager.disconnect(message.id);
                        vscode.window.showInformationMessage('Connection deleted.');
                        this._update();
                        connectionsTreeProvider.refresh();
                        return;
                    case 'setActiveConnection':
                        vscode.workspace.getConfiguration('sql-runner').update('activeConnection', message.id, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage(`Connection '${message.name}' is now active.`);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        ConnectionManagerPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;

        this._panel.title = 'SQL Runner Connections';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('sql-runner');
        const connections = config.get<IConnection[]>('connections', []);

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>SQL Runner Connections</title>
                <style>
                    :root {
                        --form-background: var(--vscode-sideBar-background);
                        --form-border: var(--vscode-sideBar-border);
                        --input-background: var(--vscode-input-background);
                        --input-foreground: var(--vscode-input-foreground);
                        --input-border: var(--vscode-input-border);
                        --button-background: var(--vscode-button-background);
                        --button-foreground: var(--vscode-button-foreground);
                        --button-hover-background: var(--vscode-button-hoverBackground);
                        --button-secondary-background: var(--vscode-button-secondaryBackground);
                        --button-secondary-foreground: var(--vscode-button-secondaryForeground);
                        --button-secondary-hover-background: var(--vscode-button-secondaryHoverBackground);
                        --description-foreground: var(--vscode-descriptionForeground);
                    }
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-editor-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 0.75rem;
                    }
                    h2 {
                        color: var(--vscode-foreground);
                        border-bottom: 1px solid var(--vscode-editor-widget-border);
                        padding-bottom: 0.25rem;
                        margin: 0 0 0.75rem 0;
                    }
                    .connection-form {
                        background-color: var(--form-background);
                        border: 1px solid var(--form-border);
                        border-radius: 4px;
                        padding: 0.75rem;
                        margin-bottom: 0.75rem;
                    }
                    .form-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 0.6rem;
                    }
                    .form-header h3 {
                        margin: 0;
                        font-size: 1rem;
                    }
                    .form-grid {
                        display: grid;
                        grid-template-columns: repeat(2, 1fr);
                        gap: 0.4rem 0.75rem;
                    }
                    .form-group {
                        display: flex;
                        flex-direction: column;
                        gap: 0.2rem;
                    }
                    .form-group.full-width {
                        grid-column: 1 / -1;
                    }
                    label {
                        font-size: 0.9rem;
                        color: var(--description-foreground);
                    }
                    input, select {
                        font-family: var(--vscode-font-family);
                        background-color: var(--input-background);
                        color: var(--input-foreground);
                        border: 1px solid var(--input-border);
                        padding: 0.2rem 0.4rem;
                        border-radius: 4px;
                        width: 100%;
                        box-sizing: border-box;
                    }
                    input:focus, select:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: -1px;
                    }
                    .form-actions {
                        margin-top: 0.6rem;
                        display: flex;
                        gap: 0.5rem;
                        justify-content: flex-start;
                    }
                    .main-actions {
                        margin-top: 1rem;
                        display: flex;
                        gap: 1rem;
                    }
                    button {
                        font-family: var(--vscode-font-family);
                        border: none;
                        padding: 0.6rem 1rem;
                        border-radius: 4px;
                        cursor: pointer;
                        text-align: center;
                        color: var(--button-foreground);
                        background: var(--button-background);
                    }
                    button:hover {
                        background: var(--button-hover-background);
                    }
                    button.secondary {
                        color: var(--button-secondary-foreground);
                        background: var(--button-secondary-background);
                    }
                    button.secondary:hover {
                        background: var(--button-secondary-hover-background);
                    }
                </style>
            </head>
            <body>
                <h2>Manage Database Connections</h2>

                <div id="connections-list"></div>

                <div class="main-actions">
                    <button id="add-connection-btn" class="secondary">Add New Connection</button>
                    <button id="save-all-btn">Save All Changes</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let connections = ${JSON.stringify(connections)};

                    const listContainer = document.getElementById('connections-list');

                    function renderConnections() {
                        listContainer.innerHTML = '';
                        connections.forEach((conn, index) => {
                            const form = document.createElement('form');
                            form.className = 'connection-form';
                            form.dataset.index = index;
                            const isSqlite = conn.dbType === 'sqlite';
                            const otherDbFieldsDisplay = isSqlite ? 'none' : 'flex';

                            form.innerHTML = \`
                                <div class="form-header">
                                    <h3>\${conn.name || 'New Connection'}</h3>
                                    <button type="button" class="secondary set-active-btn">Set Active</button>
                                </div>
                                <input type="hidden" name="id" value="\${conn.id || ''}">
                                <div class="form-grid">
                                    <div class="form-group">
                                        <label for="name-\${index}">Connection Name</label>
                                        <input id="name-\${index}" name="name" value="\${conn.name || ''}" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="dbType-\${index}">Database Type</label>
                                        <select id="dbType-\${index}" name="dbType">
                                            <option value="postgresql" \${conn.dbType === 'postgresql' ? 'selected' : ''}>PostgreSQL</option>
                                            <option value="mysql" \${conn.dbType === 'mysql' ? 'selected' : ''}>MySQL</option>
                                            <option value="sqlite" \${conn.dbType === 'sqlite' ? 'selected' : ''}>SQLite</option>
                                        </select>
                                    </div>
                                    <div class="form-group" style="display: \${otherDbFieldsDisplay}">
                                        <label for="host-\${index}">Host</label>
                                        <input id="host-\${index}" name="host" value="\${conn.host || 'localhost'}">
                                    </div>
                                    <div class="form-group" style="display: \${otherDbFieldsDisplay}">
                                        <label for="port-\${index}">Port</label>
                                        <input id="port-\${index}" type="number" name="port" value="\${conn.port || (conn.dbType === 'postgresql' ? 5432 : 3306)}">
                                    </div>
                                    <div class="form-group" style="display: \${otherDbFieldsDisplay}">
                                        <label for="user-\${index}">User</label>
                                        <input id="user-\${index}" name="user" value="\${conn.user || ''}">
                                    </div>
                                    <div class="form-group" style="display: \${otherDbFieldsDisplay}">
                                        <label for="password-\${index}">Password</label>
                                        <input id="password-\${index}" type="password" name="password" value="\${conn.password || ''}">
                                    </div>
                                    <div class="form-group full-width">
                                        <label for="database-\${index}">\${isSqlite ? 'Database File Path' : 'Database Name'}</label>
                                        <input id="database-\${index}" name="database" value="\${conn.database || ''}" required>
                                    </div>
                                </div>
                                <div class="form-actions">
                                    <button type="button" class="test-btn">Test Connection</button>
                                    <button type="button" class="secondary delete-btn">Delete</button>
                                </div>
                            \`;
                            listContainer.appendChild(form);
                        });
                    }

                    listContainer.addEventListener('change', (event) => {
                        // When a field changes, re-read all forms to update the state,
                        // then re-render everything. This is simple and robust.
                        const target = event.target;
                        if (target.closest('.connection-form')) {
                            connections = Array.from(document.querySelectorAll('.connection-form')).map(f => readForm(f));
                            renderConnections(); // Re-render to show/hide fields on dbType change and update name
                        }
                    });

                    listContainer.addEventListener('click', (event) => {
                        const target = event.target.closest('button');
                        if (!target) return;
                        const form = target.closest('.connection-form');
                        if (!form) return;

                        const index = parseInt(form.dataset.index, 10);
                        const connection = readForm(form);

                        if (target.classList.contains('test-btn')) {
                            vscode.postMessage({ command: 'testConnection', connection });
                        } else if (target.classList.contains('delete-btn')) {
                            if (confirm('Are you sure you want to delete this connection?')) {
                                vscode.postMessage({ command: 'deleteConnection', id: connection.id });
                            }
                        } else if (target.classList.contains('set-active-btn')) {
                             vscode.postMessage({ command: 'setActiveConnection', id: connection.id, name: connection.name });
                        }
                    });

                    document.getElementById('add-connection-btn').addEventListener('click', () => {
                        connections.push({
                            id: '',
                            name: 'New Connection',
                            dbType: 'postgresql',
                            host: 'localhost',
                            port: 5432,
                            user: '',
                            password: '',
                            database: ''
                        });
                        renderConnections();
                    });

                    document.getElementById('save-all-btn').addEventListener('click', () => {
                        const forms = document.querySelectorAll('.connection-form');
                        const updatedConnections = Array.from(forms).map(form => readForm(form));
                        vscode.postMessage({
                            command: 'saveConnections',
                            connections: updatedConnections
                        });
                    });

                    function readForm(form) {
                        const formData = new FormData(form);
                        const conn = {
                            port: 0 // Default port
                        };
                        for (const [key, value] of formData.entries()) {
                            conn[key] = typeof value === 'string' ? value.trim() : value;
                        }
                        conn.port = parseInt(conn.port, 10);
                        return conn;
                    }

                    renderConnections();
                </script>
            </body>
            </html>
        `;
    }
}

let connectionsTreeProvider: ConnectionsTreeDataProvider;

export function activate(context: vscode.ExtensionContext) {
    const codeLensProvider = new SqlCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider('sql', codeLensProvider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-runner.runQuery', runQuery)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-runner.runSelectedQuery', runSelectedQuery)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-runner.setActiveConnection', (id: string, name: string) => {
            vscode.workspace.getConfiguration('sql-runner').update('activeConnection', id, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Connection '${name}' is now active.`);
            connectionsTreeProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-runner.manageConnections', () => {
            ConnectionManagerPanel.createOrShow(context.extensionUri);
        })
    );

    connectionsTreeProvider = new ConnectionsTreeDataProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('sqlRunnerConnections', connectionsTreeProvider)
    );
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('sql-runner.connections') || e.affectsConfiguration('sql-runner.activeConnection')) {
            connectionsTreeProvider.refresh();
        }
    }));

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-runner.connect', async (item: ConnectionTreeItem) => {
            if (item && item.connection) {
                try {
                    await connectionManager.connect(item.connection);
                    vscode.window.showInformationMessage(`Connected to ${item.connection.name}.`);
                    connectionsTreeProvider.refresh();
                } catch (error: any) {
                    // Error is already shown by getClient
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-runner.disconnect', async (item: ConnectionTreeItem) => {
            if (item && item.connection) {
                await connectionManager.disconnect(item.connection.id);
                vscode.window.showInformationMessage(`Disconnected from ${item.connection.name}.`);
                connectionsTreeProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-runner.commit', async (item: ConnectionTreeItem) => {
            if (item && item.connection) {
                try {
                    await connectionManager.commitTransaction(item.connection.id);
                    vscode.window.showInformationMessage(`Transaction committed for ${item.connection.name}.`);
                    connectionsTreeProvider.refresh();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Commit failed: ${error.message}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-runner.rollback', async (item: ConnectionTreeItem) => {
            if (item && item.connection) {
                try {
                    await connectionManager.rollbackTransaction(item.connection.id);
                    vscode.window.showInformationMessage(`Transaction rolled back for ${item.connection.name}.`);
                    connectionsTreeProvider.refresh();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Rollback failed: ${error.message}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-runner.exportAsCsv', () => {
            exportLastResult('csv');
        }),
        vscode.commands.registerCommand('sql-runner.exportAsJson', () => {
            exportLastResult('json');
        })
    );
}

export function deactivate() {
    connectionManager.disconnectAll();
}
