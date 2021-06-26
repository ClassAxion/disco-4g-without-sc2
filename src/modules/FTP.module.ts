export default class FTP {
    private ip: string = '';
    private port: number = 61;

    contructor(ip: string = '192.168.42.1') {
        this.ip = ip;
    }

    public connect() {}

    public disconnect() {}

    public async upload(localFile: string, remoteFile: string): Promise<boolean> {
        return false;
    }

    public async download(remoteFile: string, localFile: string): Promise<boolean> {
        return false;
    }

    public async list(remotePath: string): Promise<string[]> {
        return [];
    }

    public async delete(remotePath: string): Promise<boolean> {
        return false;
    }
}
