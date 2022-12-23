import { Instance as Peer } from 'simple-peer';

import { User } from '../interfaces/User.interface';

export default class Users {
    private users: { [key: string]: User } = {};

    public create(id: string, ip: string): void {
        this.users[id] = {
            id,
            ip,
            permissions: {},
        };
    }

    public delete(id: string): void {
        delete this.users[id];
    }

    public setIp(id: string, ip: string): void {
        this.users[id].ip = ip;
    }

    public getIp(id: string): string | undefined {
        return this.users[id]?.ip;
    }

    public setPeer(id: string, peer: Peer): void {
        this.users[id].peer = peer;
    }

    public getPeer(id: string): Peer {
        return this.users[id].peer;
    }

    public setSocket(id: string, socket: any): void {
        this.users[id].socket = socket;
    }

    public getSocket(id: string): any {
        return this.users[id].socket;
    }

    public getPermissions(id: string): { [key: string]: boolean } {
        return this.users[id].permissions;
    }

    public getPermission(id: string, key: string): boolean {
        return this.users[id].permissions[key];
    }

    public setPermission(id: string, key: string, value: boolean): void {
        this.users[id].permissions[key] = value;
    }
}
