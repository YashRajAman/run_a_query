export interface IConnection {
    id: string;
    name: string;
    dbType: 'postgresql' | 'mysql' | 'sqlite';
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database: string; // For SQLite, this is the file path
}