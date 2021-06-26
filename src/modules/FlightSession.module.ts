import fs from 'fs/promises';

export default class FlightSession {
    private data: { [key: string]: any } = {};

    private sessionFile: string = './session.json';

    private async load(): Promise<boolean> {
        try {
            const raw: string = await fs.readFile(this.sessionFile, 'utf-8');

            this.data = JSON.parse(raw);

            return true;
        } catch {
            return false;
        }
    }

    private async save(): Promise<boolean> {
        try {
            const json: string = JSON.stringify(this.data);

            await fs.writeFile(this.sessionFile, json, 'utf-8');

            return true;
        } catch {
            return false;
        }
    }

    constructor(sessionFile: string = './session.json') {
        this.sessionFile = sessionFile;

        this.load();
    }

    public get(key: string): any {
        return this.data[key];
    }

    public async set(key: string, value: any): Promise<void> {
        this.data[key] = value;

        await this.save();
    }

    public async clear(): Promise<void> {
        this.data = {};

        await this.save();
    }
}
