import fs from 'fs/promises';
import { Client } from 'basic-ftp';

export default class FTP {
    private client: Client;

    private port: number = 61;

    constructor(private host: string = '192.168.42.1') {
        this.client = new Client(5000);

        this.client.ftp.verbose = true;
    }

    public async connect(): Promise<boolean> {
        try {
            await this.client.access({
                host: this.host,
                port: this.port,
                user: 'anonymous',
                password: '',
            });

            return true;
        } catch {
            return false;
        }
    }

    public disconnect(): boolean {
        try {
            this.client.close();

            return true;
        } catch {
            return false;
        }
    }

    public isConnected(): boolean {
        return !this.client.closed;
    }

    public async upload(localFile: string, remoteFile: string): Promise<boolean> {
        return false;
    }

    public async download(remoteFile: string, localFile: string): Promise<boolean> {
        console.log(await this.client.downloadTo(localFile, remoteFile));

        return false;
    }

    public async list(remotePath: string = ''): Promise<string[]> {
        return (await this.client.list(remotePath)).map((file) => file.name);
    }

    public async delete(remotePath: string): Promise<boolean> {
        return false;
    }
}
