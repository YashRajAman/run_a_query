import * as vscode from 'vscode';

export class SqlCodeLensProvider implements vscode.CodeLensProvider {
    private codeLenses: vscode.CodeLens[] = [];
    private regex = /[^;]+;/g; // match up to semicolon only

    onDidChangeCodeLenses?: vscode.Event<void> | undefined;

    provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
        this.codeLenses = [];
        const text = document.getText();
        let matches;

        while ((matches = this.regex.exec(text)) !== null) {
            const query = matches[0];
            const startPos = document.positionAt(matches.index);
            const endPos = document.positionAt(matches.index + query.length);

            // By default, show lens above the NEXT line after the query
            let lensLine = endPos.line + 1;

            // Clamp to last line of document (so we don’t overflow)
            if (lensLine >= document.lineCount) {
                lensLine = endPos.line;
            }

            const range = new vscode.Range(lensLine, 0, lensLine, 0);

            this.codeLenses.push(new vscode.CodeLens(range, {
                title: '▶ Run Query',
                command: 'sql-runner.runQuery',
                // pass both doc + block range, command will decide
                arguments: [document, new vscode.Range(startPos, endPos)]
            }));
        }

        return this.codeLenses;
    }
}
