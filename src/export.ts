import * as vscode from 'vscode';
import * as fs from 'fs';
import { getLastQueryResult } from './queryRunner';

function toCSV(data: any[], columns: string[]): string {
    const header = columns.join(',') + '\n';
    const body = data.map(row => {
        return columns.map(col => {
            let val = row[col];
            if (val === null || val === undefined) {
                return '';
            }
            val = String(val);
            // Escape quotes and handle commas
            if (val.includes('"') || val.includes(',')) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(',');
    }).join('\n');
    return header + body;
}

async function selectColumns(allColumns: string[]): Promise<string[] | undefined> {
    const selected = await vscode.window.showQuickPick(
        allColumns.map(c => ({ label: c, picked: true })),
        {
            canPickMany: true,
            title: 'Select columns to export',
            placeHolder: 'Choose which columns to include in the export'
        }
    );

    return selected?.map(s => s.label);
}

export async function exportLastResult(format: 'csv' | 'json') {
    const lastResult = getLastQueryResult();
    if (!lastResult || lastResult.rows.length === 0) {
        vscode.window.showWarningMessage('No query result to export.');
        return;
    }

    const { rows, fields } = lastResult;
    const allColumns = fields.map(f => f.name);

    const selectedColumns = await selectColumns(allColumns);
    if (!selectedColumns || selectedColumns.length === 0) {
        return; // User cancelled column selection
    }

    const filteredRows = rows.map(row => {
        const filteredRow: { [key: string]: any } = {};
        for (const col of selectedColumns) {
            filteredRow[col] = row[col];
        }
        return filteredRow;
    });

    let content: string;
    if (format === 'csv') {
        content = toCSV(filteredRows, selectedColumns);
    } else { // json
        content = JSON.stringify(filteredRows, null, 2);
    }

    const fileExtension = format;
    const defaultUri = vscode.workspace.workspaceFolders ?
        vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `query_result.${fileExtension}`) :
        undefined;

    const uri = await vscode.window.showSaveDialog({
        defaultUri: defaultUri,
        filters: {
            [format.toUpperCase()]: [fileExtension]
        }
    });

    if (uri) {
        try {
            await fs.promises.writeFile(uri.fsPath, content);
            vscode.window.showInformationMessage(`Successfully exported to ${uri.fsPath}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to export file: ${error.message}`);
        }
    }
}