export default class FlightCache {
    private cache: { [key: string]: any };

    constructor(cache: { [key: string]: any } = {}) {
        this.cache = cache;
    }

    public get(key: string): any {
        return this.cache[key];
    }

    public set(key: string, value: any): void {
        this.cache[key] = value;
    }

    public clear(): void {
        this.cache = {};
    }
}
