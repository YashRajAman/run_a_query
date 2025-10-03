SQL Runner for VS Code
SQL Runner is a powerful and lightweight VS Code extension designed to let you run SQL queries directly from your editor. It provides a seamless experience for interacting with your databases, featuring an intuitive connection manager, in-editor query execution via CodeLens, and a side-panel for exploring your database schemas.

It currently supports PostgreSQL, MySQL, and SQLite.

Features
Run Queries from the Editor: Execute SQL statements directly from your .sql files using a handy ▶ Run Query CodeLens that appears above your queries. You can also run any highlighted SQL snippet.
Multi-Database Support: Natively connect to PostgreSQL, MySQL, and SQLite databases.
Connection Manager UI: A dedicated webview panel to easily add, edit, test, and delete your database connections. All connections are securely stored in your VS Code settings.
Database Explorer: A new activity bar icon gives you access to a tree view that lists all your configured connections.
See the status of each connection (active, connected, disconnected).
Browse schemas (for PostgreSQL) and tables for all connected databases.
Transaction Control: Take full control of your database transactions.
Choose between auto, smart, and off auto-commit modes.
Manually commit or roll back transactions directly from the connection's context menu in the explorer.
The explorer view clearly indicates when a connection has uncommitted changes.
Formatted Results: Query results are displayed in a clean, formatted table within a dedicated "SQL Runner Results" output channel.
Data Export: Easily export the results of your last query to either CSV or JSON format with a single click.
Safe by Default: SELECT queries are automatically limited to 100 rows to prevent accidental fetching of large datasets. This is configurable.
Getting Started
1. Manage Connections
Click on the new SQL Runner icon in the activity bar.
In the "SQL Connections" view, click the "Manage Database Connections" icon (looks like a settings gear) in the title bar, or run the SQL Runner: Manage Database Connections command from the Command Palette.
In the Connection Manager tab:
Click "Add New Connection" to create a new connection profile.
Fill in the details for your database (PostgreSQL, MySQL, or SQLite).
Use the "Test Connection" button to verify your credentials.
Click "Save All Changes".
2. Set the Active Connection
To run queries, you must have an active connection. You can set one in two ways:

From the Connection Manager: Click the "Set Active" button on the connection you want to use.
From the Explorer: Right-click on a connection in the "SQL Connections" view and select "Set Active SQL Runner Connection".
The active connection is highlighted in the explorer.

3. Run Queries
Once a connection is active and you have an .sql file open:

CodeLens: Click the ▶ Run Query text that appears above any SQL statement ending with a semicolon (;).
Selection: Select any block of SQL text, right-click, and choose Run Selected SQL Query.
Results will appear in the "SQL Runner Results" output channel. If your query returns rows, you'll see a notification with options to export the data.

Configuration
You can configure SQL Runner in your VS Code settings (settings.json):

sql-runner.connections: An array of your saved database connection objects. It's recommended to manage this through the UI.
sql-runner.activeConnection: The ID of the connection to be used for running queries.
sql-runner.defaultQueryLimit: The default row limit for SELECT queries that do not have a LIMIT clause. Set to 0 to disable this feature.
Default: 100
sql-runner.autoCommit: Controls the transaction behavior.
auto (Default): Every query is committed automatically.
smart: SELECT queries are auto-committed, but INSERT, UPDATE, DELETE, etc., will start a transaction that must be manually committed or rolled back.
off: No query is auto-committed. All queries are part of a transaction until you manually commit or roll back.
Enjoy a more integrated SQL experience right inside your favorite editor!

** The readme is AI generated. **
